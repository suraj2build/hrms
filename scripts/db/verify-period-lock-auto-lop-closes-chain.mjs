#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 13 batch sweep — period-locks.ts's
 * /lock route auto-rejects every still-pending regularisation for the
 * locked month via a raw UPDATE (status='rejected'), bypassing gateReject
 * entirely. If a regularisation had an OPEN multi-level approval_instances
 * row (advanced past level 1, awaiting a later approver), that row was left
 * orphaned: current_level/final_approved unchanged, final_approved still
 * NULL — the entity reads 'rejected' but the chain metadata still claims
 * "awaiting approval," which would keep surfacing in an approver's
 * pending-approvals view for a request that can no longer be acted on.
 * Fixed by closing any such open instance (final_approved=false,
 * closed_at=now()) in the same fire-and-forget block, mirroring
 * recordAndAdvance's own close semantics.
 *
 * This script proves it against the real compiled API + real Postgres:
 *   1. Seed a tenant, manager-with-direct-report, HR admin, and a real
 *      2-level 'regularisation' chain (direct_manager -> hr_admin).
 *   2. Seed a pending regularisation dated inside the month under test and
 *      advance it to level 2 via a real manager approval (same as Part A's
 *      step 1) — leaving a genuinely OPEN approval_instances row.
 *   3. HR locks the period via real HTTP POST /attendance/period-locks/
 *      :month/lock.
 *   4. Poll Postgres briefly for the fire-and-forget auto-LOP job to settle,
 *      then assert: the regularisation reads 'rejected', AND the
 *      approval_instances row is now closed (final_approved=false,
 *      closed_at set) — not left open claiming the request is still
 *      awaiting HR's action.
 */
import pg from 'pg'

const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'LopChainCloseVerify!1'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

async function createAuthUser(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`createAuthUser failed for ${email}: ${JSON.stringify(body)}`)
  return body.id
}

async function loginAndGetToken(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return (await res.json()).access_token
}

async function main() {
  let allOk = true
  const stamp = Date.now()
  const tenantId = uuid()
  const month = '2102-07'

  console.log('=== SEED ===')
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'LOP Chain Close Verify','lccv-${stamp}','active')`, [tenantId])

  const managerEmail = `lccv-mgr-${stamp}@test.local`
  const managerUserId = await createAuthUser(managerEmail)
  const managerEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'LCCVMGR','Mgr','LopClose','${managerEmail}', CURRENT_DATE, 'active')`, [managerEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'manager','Mgr LopClose',$4,true)`, [managerUserId, tenantId, managerEmpId, managerEmail])

  const hrEmail = `lccv-hr-${stamp}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  const hrEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'LCCVHR','HR','LopClose','${hrEmail}', CURRENT_DATE, 'active')`, [hrEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'hr_admin','HR LopClose',$4,true)`, [hrUserId, tenantId, hrEmpId, hrEmail])

  const empId = uuid()
  const empEmail = `lccvemp-${stamp}@test.local`
  const empUserId = await createAuthUser(empEmail)
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, manager_id)
     VALUES ($1,$2,'LCCVEMP','Report','LopClose',$3, CURRENT_DATE, 'active', $4)`,
    [empId, tenantId, empEmail, managerEmpId],
  )
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','Report LopClose',$4,true)`, [empUserId, tenantId, empId, empEmail])

  const regId = uuid()
  await pool.query(
    `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, regularization_type)
     VALUES ($1,$2,$3,'${month}-15','Missed punch','pending','missed_punch')`,
    [regId, tenantId, empId],
  )

  const level1Id = uuid(), level2Id = uuid()
  await pool.query(`INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active) VALUES ($1,$2,'regularisation',1,'direct_manager','Direct Manager',true)`, [level1Id, tenantId])
  await pool.query(`INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active) VALUES ($1,$2,'regularisation',2,'hr_admin','HR Admin',true)`, [level2Id, tenantId])
  console.log('seeded tenant', tenantId, '| regularisation', regId, 'dated', `${month}-15`, '| 2-level chain')

  const managerToken = await loginAndGetToken(managerEmail)
  const hrToken = await loginAndGetToken(hrEmail)

  // ── Advance the chain to level 2 (real HTTP), leaving it genuinely OPEN ──
  const advanceRes = await fetch(`${API_BASE}/attendance/regularisation/${regId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  console.log('manager advances to level 2:', advanceRes.status, await advanceRes.json())
  const { rows: [instanceBeforeLock] } = await pool.query(
    `SELECT current_level, final_approved FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  const chainOpenBeforeLock = instanceBeforeLock && instanceBeforeLock.current_level === 2 && instanceBeforeLock.final_approved === null
  console.log('chain is genuinely OPEN at level 2 before the lock (precondition for this test):', chainOpenBeforeLock ? 'PASS' : 'FAIL', instanceBeforeLock)
  allOk = allOk && chainOpenBeforeLock

  // ── HR locks the period via real HTTP ────────────────────────────────────
  console.log(`\n=== HR locks period ${month} via real HTTP ===`)
  const lockRes = await fetch(`${API_BASE}/attendance/period-locks/${month}/lock`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'month-end close' }),
  })
  console.log('lock response:', lockRes.status, await lockRes.json())

  // The auto-LOP job runs via setImmediate after the response is sent — poll briefly.
  let afterReg, afterInstance
  for (let i = 0; i < 20; i++) {
    const { rows: [r] } = await pool.query(`SELECT status, rejection_reason FROM attendance_regularisation WHERE id=$1`, [regId])
    afterReg = r
    if (afterReg.status === 'rejected') break
    await new Promise((res) => setTimeout(res, 150))
  }
  const { rows: [inst] } = await pool.query(
    `SELECT current_level, final_approved, closed_at FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  afterInstance = inst
  console.log('persisted after lock — regularisation:', afterReg, '| approval_instances:', afterInstance)

  const regAutoRejected = afterReg.status === 'rejected' && /Period locked/i.test(afterReg.rejection_reason ?? '')
  const chainClosedNotOrphaned = afterInstance && afterInstance.final_approved === false && afterInstance.closed_at !== null
  console.log('regularisation auto-rejected as LOP by the period lock:', regAutoRejected ? 'PASS' : 'FAIL')
  console.log('BEFORE this fix, approval_instances would stay open (final_approved still NULL) forever — an approver\'s pending-approvals view would keep showing a request that can no longer be acted on. Now the chain is correctly closed alongside the entity:', chainClosedNotOrphaned ? 'PASS' : 'FAIL')
  allOk = allOk && regAutoRejected && chainClosedNotOrphaned

  console.log(allOk ? '\nALL STEPS PASS' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
