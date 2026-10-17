#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 continued audit — real-Postgres proof for
 * migration 461's cancel_legacy_leave_application_atomic (F1/F2 fix on
 * routes/attendance/leave.ts's POST /attendance/leave/:id/cancel).
 *
 * Three parts, each against the real compiled RPC on hrms_uat:
 *   A. a locked period blocks the cancel outright (no partial mutation —
 *      status stays 'approved', nothing else touched).
 *   B. once unlocked, cancel succeeds: status -> 'cancelled', balance
 *      restored, a reversal ledger row written.
 *   C. a second cancel call on the now-cancelled application is rejected
 *      by the status check and does NOT double-credit the balance.
 */
import pg from 'pg'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })
function uuid() { return crypto.randomUUID() }

async function main() {
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const appId = uuid()

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Cancel Verify','cancel-verify-${Date.now()}','active')`, [tenantId])
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'CNC001','Cancel','Verify','cancel@verify.test', CURRENT_DATE, 'active')`, [empId, tenantId])
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_paid, allow_sandwich, is_active, allow_half_day, allow_hourly) VALUES ($1,$2,'Annual Leave', true, false, true, true, false)`, [leaveTypeId, tenantId])
  await pool.query(`INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,2099,10)`, [tenantId, empId, leaveTypeId])
  await pool.query(
    `INSERT INTO leave_applications (id, tenant_id, employee_id, leave_type_id, from_date, to_date, session, status, working_days)
     VALUES ($1,$2,$3,$4,'2099-04-10','2099-04-10','full_day','approved',1)`,
    [appId, tenantId, empId, leaveTypeId],
  )

  // ── Part A: locked month blocks cancel ───────────────────────────────────
  await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,'2099-04','LOCKED')`, [tenantId])
  let blockedCorrectly = false
  try {
    await pool.query(`SELECT cancel_legacy_leave_application_atomic($1,$2,true,1)`, [tenantId, appId])
  } catch (err) {
    blockedCorrectly = /PERIOD_LOCKED/.test(err.message)
    console.log('Part A — caught:', err.message)
  }
  console.log(blockedCorrectly ? 'PASS — locked month blocks cancel.' : 'FAIL — lock did not block cancel.')
  const { rows: [afterLocked] } = await pool.query(`SELECT status FROM leave_applications WHERE id=$1`, [appId])
  console.log('Part A — persisted status (must still be approved):', afterLocked.status)

  // ── Part B: unlock, cancel succeeds, balance restored, ledger written ────
  await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month='2099-04'`, [tenantId])
  await pool.query(`SELECT cancel_legacy_leave_application_atomic($1,$2,true,1)`, [tenantId, appId])
  const { rows: [afterCancel] } = await pool.query(`SELECT status FROM leave_applications WHERE id=$1`, [appId])
  const { rows: [balanceRow] } = await pool.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=2099`, [tenantId, empId, leaveTypeId])
  const { rows: [ledgerRow] } = await pool.query(`SELECT accrual_type, days FROM leave_accrual_ledger WHERE tenant_id=$1 AND source_request_id=$2 AND accrual_type='reversal'`, [tenantId, appId])
  console.log('Part B — persisted status (expect cancelled):', afterCancel.status)
  console.log('Part B — balance after restore (expect 11):', balanceRow.balance)
  console.log('Part B — reversal ledger row:', ledgerRow)

  // ── Part C: re-cancel (already actioned) is rejected, no double-credit ──
  let conflictOnRetry = false
  try {
    await pool.query(`SELECT cancel_legacy_leave_application_atomic($1,$2,true,1)`, [tenantId, appId])
  } catch (err) {
    conflictOnRetry = /CONFLICT/.test(err.message)
    console.log('Part C — caught:', err.message)
  }
  const { rows: [balanceAfterRetry] } = await pool.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=2099`, [tenantId, empId, leaveTypeId])
  console.log('Part C — balance unchanged after retry (expect still 11):', balanceAfterRetry.balance)

  const ok = blockedCorrectly && afterLocked.status === 'approved' && afterCancel.status === 'cancelled' &&
    Number(balanceRow.balance) === 11 && conflictOnRetry && Number(balanceAfterRetry.balance) === 11
  console.log(ok ? '\nALL PARTS PASS' : '\nFAIL')
  await pool.end()
  process.exit(ok ? 0 : 1)
}
main().catch((err) => { console.error(err); process.exit(1) })
