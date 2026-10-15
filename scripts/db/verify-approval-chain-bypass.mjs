#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoints 12+13 — real-Postgres + real-HTTP
 * proof for two related approval-chain bugs in lib/approval-orchestrator.
 * ts's gateApprove/gateReject, both of which let a configured multi-level
 * chain be silently bypassed via the LEGACY single-step path:
 *
 *   PART A (checkpoint 12) — config deleted/changed WHILE an instance is
 *   already open mid-chain. Checkpoint 11 proved this with mocked
 *   supabase calls only; the user asked for a test against an actual
 *   PERSISTED multi-stage chain, proof no legacy fallback can skip a
 *   pending stage, and the authorized recovery path documented.
 *
 *   PART B (checkpoint 13) — discovered WHILE building Part A: seeding a
 *   regularisation for an employee with no linked `profiles` row made
 *   Part A's very first approval silently go legacy instead of engaging
 *   the configured chain at all (getOrCreateInstance couldn't resolve
 *   submitted_by). That's a second, independent bypass: a workflow IS
 *   configured and applicable, but identity resolution failure used to
 *   silently downgrade to single-step approval instead of failing
 *   closed. Fixed in lib/approval-orchestrator.ts this round; proven here
 *   against a real persisted instance + real HTTP, not just the mocked
 *   unit tests in approval-orchestrator-identity-unresolved.test.ts.
 *
 * Uses the attendance_regularisation entity (workflow_type='regularisation')
 * — the same gateApprove/gateReject code path leave_request uses
 * (ENTITY_TO_WORKFLOW maps both through lib/approval-orchestrator.ts), but
 * with far simpler seed preconditions (no leave balance/type machinery),
 * so the real defect under test — the orchestrator's instance-vs-config
 * check — is exercised directly against real Postgres and the real
 * compiled API, not a simplified stand-in.
 *
 * Part A sequence:
 *   1. Seed a real tenant, a manager with one direct report, and a real
 *      pending attendance_regularisation row.
 *   2. Seed a REAL 2-level approval_workflow_config for 'regularisation':
 *      level 1 direct_manager, level 2 hr_admin.
 *   3. The manager approves via real HTTP (POST /attendance/regularisation/
 *      :id/approve) — proves the chain genuinely advances: regularisation
 *      stays 'pending', a real approval_instances row is created at
 *      current_level=2, final_approved=null.
 *   4. Mid-flight: BOTH config rows are deleted (the exact "config removed
 *      while an instance is open" scenario), reproducing an admin who
 *      forgot the dangling instance.
 *   5. The SAME manager (who already satisfies the level-1 direct_manager
 *      requirement, and is NOT hr_admin) attempts to approve AGAIN via
 *      real HTTP. Proves this is REFUSED (409 CONFLICT) — not silently
 *      finalized through the legacy single-step path, which checkpoint 10's
 *      pre-fix code would have allowed (the manager's own
 *      validateApprover check would have passed).
 *   6. Real Postgres read-back: the regularisation is STILL 'pending', the
 *      approval_instances row is STILL open at current_level=2 — proving
 *      no partial/hybrid state, no silent skip.
 *   7. Authorized recovery path: HR restores the SAME level config (same
 *      level numbers) via the real POST /approvals/workflows/config
 *      endpoint. The hr_admin (the correct level-2 approver) then
 *      approves via real HTTP — proves the instance resumes cleanly and
 *      finalizes normally, with no trace of the earlier refused attempt
 *      having advanced anything.
 *
 * Part B sequence (reuses Part A's tenant/manager/HR and restored config):
 *   8. Seed a SECOND employee with NO linked profiles row, and a pending
 *      regularisation for them.
 *   9. The manager attempts to approve via real HTTP. Proves it is
 *      REFUSED (409 CONFLICT, "no login profile is linked") — not a
 *      silent single-step approval.
 *  10. Real Postgres read-back: the regularisation is STILL 'pending',
 *      approved_by is STILL null, and — critically — NO approval_
 *      instances row was ever created (identity_unresolved returns
 *      before createWorkflowInstance is ever called).
 *  11. Authorized recovery path: a profile is linked to the employee
 *      (the fix a real admin would need to apply), the manager retries —
 *      now succeeds, genuinely engaging the 2-level chain (advances to
 *      level 2, stays pending), and HR finalizes it.
 */
import pg from 'pg'

const WEB_BASE = 'http://localhost:2000'
const API_BASE = 'http://localhost:2001'
const AUTH_BASE = 'http://localhost:9000'
const PASSWORD = 'ChainBypassVerify!1'
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
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Approval Chain Bypass Verify','acbv-${stamp}','active')`, [tenantId])

  const managerEmail = `acbv-mgr-${stamp}@test.local`
  const managerUserId = await createAuthUser(managerEmail)
  const managerEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'ACBVMGR','Mgr','Chain','${managerEmail}', CURRENT_DATE, 'active')`, [managerEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'manager','Mgr Chain',$4,true)`, [managerUserId, tenantId, managerEmpId, managerEmail])

  const hrEmail = `acbv-hr-${stamp}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  const hrEmpId = uuid()
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'ACBVHR','HR','Chain','${hrEmail}', CURRENT_DATE, 'active')`, [hrEmpId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'hr_admin','HR Chain',$4,true)`, [hrUserId, tenantId, hrEmpId, hrEmail])

  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, manager_id)
     VALUES ($1,$2,'ACBVEMP','Report','Chain','acbvemp-${stamp}@test.local', CURRENT_DATE, 'active', $3)`,
    [empId, tenantId, managerEmpId],
  )
  // getOrCreateInstance (approval-orchestrator.ts) resolves the new
  // instance's required submitted_by from THIS employee's own profile —
  // without one, it returns null and gateApprove falls straight to legacy
  // ("couldn't engage engine"), never even reaching the config/instance
  // check under test here. The owning employee needs a profile too, not
  // just the approvers.
  const empEmail = `acbvemp-${stamp}@test.local`
  const empUserId = await createAuthUser(empEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','Report Chain',$4,true)`, [empUserId, tenantId, empId, empEmail])
  const regId = uuid()
  await pool.query(
    `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, regularization_type)
     VALUES ($1,$2,$3,'2101-04-10','Missed punch — forgot to clock in','pending','missed_punch')`,
    [regId, tenantId, empId],
  )

  // Real, persisted 2-level approval chain for 'regularisation'.
  const level1Id = uuid(), level2Id = uuid()
  await pool.query(
    `INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active)
     VALUES ($1,$2,'regularisation',1,'direct_manager','Direct Manager',true)`,
    [level1Id, tenantId],
  )
  await pool.query(
    `INSERT INTO approval_workflow_config (id, tenant_id, workflow_type, level, approver_type, label, is_active)
     VALUES ($1,$2,'regularisation',2,'hr_admin','HR Admin',true)`,
    [level2Id, tenantId],
  )
  console.log('seeded tenant', tenantId, '| regularisation', regId, '| 2-level chain: direct_manager -> hr_admin')

  const managerToken = await loginAndGetToken(managerEmail)
  const hrToken = await loginAndGetToken(hrEmail)

  // ── Step 1: manager approves level 1 — chain should ADVANCE, not finalize ──
  console.log('\n=== STEP 1: manager approves level 1 (real HTTP) ===')
  const step1Res = await fetch(`${API_BASE}/attendance/regularisation/${regId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const step1Body = await step1Res.json()
  console.log('manager approve (level 1) response:', step1Res.status, step1Body)

  const { rows: [afterStep1] } = await pool.query(`SELECT status FROM attendance_regularisation WHERE id=$1`, [regId])
  const { rows: [instanceAfterStep1] } = await pool.query(
    `SELECT current_level, total_levels, final_approved FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  console.log('persisted after step 1 — regularisation.status:', afterStep1.status, '| approval_instances:', instanceAfterStep1)
  const step1Correct = step1Res.status === 200 && afterStep1.status === 'pending' &&
    instanceAfterStep1 && instanceAfterStep1.current_level === 2 && instanceAfterStep1.final_approved === null
  console.log('chain genuinely advanced to level 2, entity still pending, instance open and persisted:', step1Correct ? 'PASS' : 'FAIL')
  allOk = allOk && step1Correct

  // ── Step 2: admin deletes BOTH config levels mid-flight ──────────────────
  console.log('\n=== STEP 2: HR deletes both config levels while the instance is open at level 2 ===')
  await pool.query(`DELETE FROM approval_workflow_config WHERE tenant_id=$1 AND workflow_type='regularisation'`, [tenantId])
  const { rows: remainingConfig } = await pool.query(`SELECT count(*) AS n FROM approval_workflow_config WHERE tenant_id=$1 AND workflow_type='regularisation'`, [tenantId])
  console.log('remaining config rows for this workflow_type:', remainingConfig[0].n, remainingConfig[0].n === '0' ? 'PASS (config fully removed)' : 'FAIL')

  // ── Step 3: the SAME manager (who already satisfies direct_manager, and
  //    would pass legacy validateApprover) tries to approve AGAIN ─────────
  console.log('\n=== STEP 3: the ORIGINAL manager attempts to approve again — must NOT silently finalize via the legacy path ===')
  const step3Res = await fetch(`${API_BASE}/attendance/regularisation/${regId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const step3Body = await step3Res.json()
  console.log('manager re-approve attempt response:', step3Res.status, step3Body)

  const { rows: [afterStep3] } = await pool.query(`SELECT status, approved_by FROM attendance_regularisation WHERE id=$1`, [regId])
  const { rows: [instanceAfterStep3] } = await pool.query(
    `SELECT current_level, final_approved FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  console.log('persisted after step 3 — regularisation.status:', afterStep3.status, 'approved_by:', afterStep3.approved_by, '| approval_instances:', instanceAfterStep3)

  const bypassRefused = step3Res.status === 409 && /approval chain in progress/i.test(step3Body.message ?? '')
  const stillPendingNoSkip = afterStep3.status === 'pending' && afterStep3.approved_by === null &&
    instanceAfterStep3 && instanceAfterStep3.current_level === 2 && instanceAfterStep3.final_approved === null
  console.log('legacy fallback correctly REFUSED the bypass attempt (409, not a silent finalize):', bypassRefused ? 'PASS' : 'FAIL')
  console.log('entity remains pending, nothing skipped, instance unchanged — no hybrid/partial state:', stillPendingNoSkip ? 'PASS' : 'FAIL')
  allOk = allOk && bypassRefused && stillPendingNoSkip

  // ── Step 4: authorized recovery path — HR restores the SAME config ──────
  console.log('\n=== STEP 4: authorized recovery — HR restores the config (same level numbers), then the CORRECT level-2 approver proceeds ===')
  const recoverRes = await fetch(`${API_BASE}/approvals/workflows/config`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ workflow_type: 'regularisation', level: 1, approver_type: 'direct_manager', label: 'Direct Manager' }),
  })
  console.log('HR restores level 1 config via real POST /approvals/workflows/config:', recoverRes.status, await recoverRes.json().catch(() => null))
  const recoverRes2 = await fetch(`${API_BASE}/approvals/workflows/config`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ workflow_type: 'regularisation', level: 2, approver_type: 'hr_admin', label: 'HR Admin' }),
  })
  console.log('HR restores level 2 config via real POST /approvals/workflows/config:', recoverRes2.status, await recoverRes2.json().catch(() => null))

  const hrApproveRes = await fetch(`${API_BASE}/attendance/regularisation/${regId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const hrApproveBody = await hrApproveRes.json()
  console.log('HR (level-2 approver) approve after config restored:', hrApproveRes.status, hrApproveBody)

  const { rows: [finalReg] } = await pool.query(`SELECT status, approved_by FROM attendance_regularisation WHERE id=$1`, [regId])
  const { rows: [finalInstance] } = await pool.query(
    `SELECT current_level, final_approved FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, regId],
  )
  console.log('persisted final state — regularisation.status:', finalReg.status, 'approved_by:', finalReg.approved_by, '| approval_instances:', finalInstance)

  const recoveryWorked = hrApproveRes.status === 200 && finalReg.status === 'approved' &&
    finalReg.approved_by === hrUserId && finalInstance.final_approved === true
  console.log('the documented recovery path (HR restores matching-level config, correct approver then proceeds) genuinely resumes and finalizes the chain:', recoveryWorked ? 'PASS' : 'FAIL')
  allOk = allOk && recoveryWorked

  // ══════════════════════════════════════════════════════════════════════
  // PART B (checkpoint 13) — identity cannot be resolved for a NEW
  // instance, even though the (now-restored, still active) 2-level chain
  // genuinely applies.
  // ══════════════════════════════════════════════════════════════════════

  // ── Step 8: a second employee with NO linked profiles row ───────────────
  console.log('\n=== STEP 8 (checkpoint 13): seed a second employee with NO linked profile, and a pending regularisation for them ===')
  const noProfileEmpId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, manager_id)
     VALUES ($1,$2,'ACBVNOPROF','NoProfile','Chain','acbv-noprofile-${stamp}@test.local', CURRENT_DATE, 'active', $3)`,
    [noProfileEmpId, tenantId, managerEmpId],
  )
  // Deliberately NO profiles row for this employee.
  const noProfileRegId = uuid()
  await pool.query(
    `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, regularization_type)
     VALUES ($1,$2,$3,'2101-05-10','Missed punch — forgot to clock in','pending','missed_punch')`,
    [noProfileRegId, tenantId, noProfileEmpId],
  )
  const { rows: configStillActive } = await pool.query(
    `SELECT level, approver_type FROM approval_workflow_config WHERE tenant_id=$1 AND workflow_type='regularisation' AND is_active=true ORDER BY level`,
    [tenantId],
  )
  console.log('regularisation', noProfileRegId, 'seeded for an employee with no profile; chain still active:', configStillActive)

  // ── Step 9: manager attempts to approve — must fail CLOSED, not legacy ──
  console.log('\n=== STEP 9: manager attempts to approve a request whose owner has no linked profile — must be refused, not silently single-step approved ===')
  const step9Res = await fetch(`${API_BASE}/attendance/regularisation/${noProfileRegId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const step9Body = await step9Res.json()
  console.log('manager approve attempt (no linked profile) response:', step9Res.status, step9Body)

  const { rows: [afterStep9] } = await pool.query(`SELECT status, approved_by FROM attendance_regularisation WHERE id=$1`, [noProfileRegId])
  const { rows: [instanceAfterStep9] } = await pool.query(
    `SELECT id FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, noProfileRegId],
  )
  console.log('persisted after step 9 — regularisation.status:', afterStep9.status, 'approved_by:', afterStep9.approved_by, '| approval_instances row exists:', !!instanceAfterStep9)

  const identityBypassRefused = step9Res.status === 409 && /no login profile is linked/i.test(step9Body.message ?? '')
  const noSilentApproval = afterStep9.status === 'pending' && afterStep9.approved_by === null && !instanceAfterStep9
  console.log('refused with a real 409 naming the actual problem, not a silent legacy approval:', identityBypassRefused ? 'PASS' : 'FAIL')
  console.log('entity still pending, no approval_instances row ever created (failed before creation, not after):', noSilentApproval ? 'PASS' : 'FAIL')
  allOk = allOk && identityBypassRefused && noSilentApproval

  // ── Step 10: authorized recovery — link a profile, retry succeeds ───────
  console.log('\n=== STEP 10: authorized recovery — link a profile to the employee, then the SAME manager retries and the chain genuinely engages ===')
  const noProfileEmpEmail = `acbv-noprofile-login-${stamp}@test.local`
  const noProfileEmpUserId = await createAuthUser(noProfileEmpEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','NoProfile Chain',$4,true)`,
    [noProfileEmpUserId, tenantId, noProfileEmpId, noProfileEmpEmail],
  )

  const step10Res = await fetch(`${API_BASE}/attendance/regularisation/${noProfileRegId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const step10Body = await step10Res.json()
  console.log('manager retry after linking a profile:', step10Res.status, step10Body)

  const { rows: [afterStep10] } = await pool.query(`SELECT status FROM attendance_regularisation WHERE id=$1`, [noProfileRegId])
  const { rows: [instanceAfterStep10] } = await pool.query(
    `SELECT current_level, total_levels, final_approved, submitted_by FROM approval_instances WHERE tenant_id=$1 AND entity_type='attendance_regularisation' AND entity_id=$2`,
    [tenantId, noProfileRegId],
  )
  console.log('persisted after step 10 — regularisation.status:', afterStep10.status, '| approval_instances:', instanceAfterStep10)
  const recoveryEngagedChain = step10Res.status === 200 && afterStep10.status === 'pending' &&
    instanceAfterStep10 && instanceAfterStep10.current_level === 2 && instanceAfterStep10.final_approved === null &&
    instanceAfterStep10.submitted_by === noProfileEmpUserId
  console.log('linking a profile is a genuine recovery — the chain now engages for real (advances to level 2, not finalized by the manager alone):', recoveryEngagedChain ? 'PASS' : 'FAIL')
  allOk = allOk && recoveryEngagedChain

  const hrFinalizeRes = await fetch(`${API_BASE}/attendance/regularisation/${noProfileRegId}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }, body: JSON.stringify({}),
  })
  const hrFinalizeBody = await hrFinalizeRes.json()
  console.log('HR finalizes level 2:', hrFinalizeRes.status, hrFinalizeBody)
  const { rows: [finalNoProfileReg] } = await pool.query(`SELECT status FROM attendance_regularisation WHERE id=$1`, [noProfileRegId])
  const fullyRecovered = hrFinalizeRes.status === 200 && finalNoProfileReg.status === 'approved'
  console.log('full recovery — chain completes normally end to end:', fullyRecovered ? 'PASS' : 'FAIL')
  allOk = allOk && fullyRecovered

  console.log(allOk ? '\nALL STEPS PASS' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
