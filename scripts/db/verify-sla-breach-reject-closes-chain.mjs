#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 (attendance batch continuation) —
 * regularisation-policy.ts's POST /attendance/regularisation/breach-check
 * auto-rejected SLA-breached regularisations via a raw UPDATE, bypassing
 * gateReject entirely — the same bug class already fixed in period-locks.ts's
 * auto-LOP path (migration 467). If a regularisation had an OPEN multi-level
 * approval_instances row (advanced to level 2, awaiting HR) when its SLA
 * breached, the raw UPDATE left that row orphaned (final_approved still
 * NULL) — a dead request that would keep surfacing in an approver's
 * pending-approvals view forever.
 *
 * Fixed by routing this path through the same
 * auto_lop_reject_regularisations_atomic RPC used by period-locks.ts,
 * extended (migration 468) with a p_rejection_reason parameter so this path
 * can supply its own SLA-breach message instead of the period-lock one.
 *
 * This script proves it against the real compiled API + real Postgres:
 *   1. Seed a tenant, manager-with-direct-report, HR admin, a real 2-level
 *      'regularisation' chain, and a regularisation_policy with a 1-hour SLA
 *      and auto_reject_on_sla_breach=true.
 *   2. Seed a pending regularisation and advance it to level 2 via a real
 *      manager approval, leaving a genuinely OPEN approval_instances row.
 *   3. Backdate its created_at well past the 1-hour SLA.
 *   4. HR calls real HTTP POST /attendance/regularisation/breach-check.
 *   5. Assert: the regularisation reads 'rejected' with the SLA-breach
 *      message, AND approval_instances is closed (final_approved=false,
 *      closed_at set) — not left open.
 */
import pg from 'pg'

const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'SlaBreachChainVerify!1'
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

  console.log('=== SEED ===')
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'SLA Breach Chain Verify','sbcv-${stamp}','active')`, [tenantId])
  await pool.query(
    `INSERT INTO regularisation_policy (tenant_id, submission_window_days, max_per_month, sla_hours, auto_reject_on_sla_breach)
     VALUES ($1, 7, 5, 1, true)`,
    [tenantId],
  )

  const managerEmail = `sbcv-mgr-${stamp}@test.local`
  const managerUserId = await createAuthUser(managerEmail)
  const managerEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'SBCVMGR','Mgr','SlaBreach','${managerEmail}', CURRENT_DATE, 'active')`, [managerEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'manager','Mgr SlaBreach',$4,true)`, [managerUserId, tenantId, managerEmpId, managerEmail])

  const hrEmail = `sbcv-hr-${stamp}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  const hrEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'SBCVHR','HR','SlaBreach','${hrEmail}', CURRENT_DATE, 'active')`, [hrEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'hr_admin','HR SlaBreach',$4,true)`, [hrUserId, tenantId, hrEmpId, hrEmail])

  const empId = uuid()
  const empEmail = `sbcvemp-${stamp}@test.local`
  const empUserId = await createAuthUser(empEmail)
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, manager_id)
     VALUES ($1,$2,'SBCVEMP','Report','SlaBreach',$3, CURRENT_DATE, 'active', $4)`,
    [empId, tenantId, empEmail, managerEmpId],
  )
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','Report SlaBreach',$4,true)`, [empUserId, tenantId, empId, empEmail])

  const regId = uuid()
  await pool.query(
    `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, regularization_type)
     VALUES ($1,$2,$3, CURRENT_DATE - INTERVAL '2 days', 'Missed punch','pending','missed_punch')`,
    [regId, tenantId, empId],
  )

  const level1Id = uuid(), level2Id = uuid()
  await pool.query(`INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active) VALUES ($1,$2,'regularisation',1,'direct_manager','Direct Manager',true)`, [level1Id, tenantId])
  await pool.query(`INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active) VALUES ($1,$2,'regularisation',2,'hr_admin','HR Admin',true)`, [level2Id, tenantId])
  console.log('seeded tenant', tenantId, '| regularisation', regId, '| 2-level chain | SLA 1h, auto-reject ON')

  const managerToken = await loginAndGetToken(managerEmail)
  const hrToken = await loginAndGetToken(hrEmail)

  // ── Advance the chain to level 2 (real HTTP), leaving it genuinely OPEN ──
  const advanceRes = await fetch(`${API_BASE}/attendance/regularisation/${regId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  console.log('manager advances to level 2:', advanceRes.status, await advanceRes.json())
  const { rows: [instanceBeforeBreach] } = await pool.query(
    `SELECT current_level, final_approved FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  const chainOpenBeforeBreach = instanceBeforeBreach && instanceBeforeBreach.current_level === 2 && instanceBeforeBreach.final_approved === null
  console.log('chain is genuinely OPEN at level 2 before the SLA breach scan (precondition):', chainOpenBeforeBreach ? 'PASS' : 'FAIL', instanceBeforeBreach)
  allOk = allOk && chainOpenBeforeBreach

  // ── Backdate created_at past the 1-hour SLA ──────────────────────────────
  await pool.query(`UPDATE attendance_regularisation SET created_at = now() - INTERVAL '3 hours' WHERE id = $1`, [regId])

  // ── HR runs the breach-check scan via real HTTP ──────────────────────────
  console.log('\n=== HR calls real HTTP POST /attendance/regularisation/breach-check ===')
  const breachRes = await fetch(`${API_BASE}/attendance/regularisation/breach-check`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const breachBody = await breachRes.json()
  console.log('breach-check response:', breachRes.status, breachBody)

  const { rows: [afterReg] } = await pool.query(`SELECT status, rejection_reason FROM attendance_regularisation WHERE id=$1`, [regId])
  const { rows: [afterInstance] } = await pool.query(
    `SELECT current_level, final_approved, closed_at FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  console.log('persisted after breach-check — regularisation:', afterReg, '| approval_instances:', afterInstance)

  const regAutoRejected = afterReg.status === 'rejected' && /SLA of 1 hours exceeded/i.test(afterReg.rejection_reason ?? '')
  const chainClosedNotOrphaned = afterInstance && afterInstance.final_approved === false && afterInstance.closed_at !== null
  console.log('regularisation auto-rejected with the SLA-breach message:', regAutoRejected ? 'PASS' : 'FAIL')
  console.log('BEFORE this fix, approval_instances would stay open (final_approved still NULL) forever. Now the chain is correctly closed alongside the entity:', chainClosedNotOrphaned ? 'PASS' : 'FAIL')
  allOk = allOk && regAutoRejected && chainClosedNotOrphaned

  console.log(allOk ? '\nALL STEPS PASS' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
