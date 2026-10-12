#!/usr/bin/env node
/**
 * Real-Postgres verification of mark_leave_encashment_paid_atomic and
 * reverse_leave_encashment_atomic (migration 446, G12).
 *
 * Proves, against a real Postgres transaction:
 *   A. mark-paid posts the payout into a draft payslip (gross/net/tds_deducted/
 *      component_breakdown all updated), keeps the run's own aggregate totals
 *      in sync, and flips the request to 'paid'.
 *   B. mark-paid refuses a finalized run (RUN_NOT_DRAFT), nothing written.
 *   C. Retry after success raises ALREADY_DECIDED, no double-posting.
 *   D. Reversal of a 'paid' request (slip still draft) removes exactly the
 *      posted lines, restores the slip/run totals, and credits the leave
 *      balance back.
 *   E. Reversal refuses once the linked payslip is finalized (PAYROLL_FINALIZED),
 *      leaving the slip and the request's own status untouched.
 */
import pg from 'pg'
const { Client } = pg
const conn = {
  host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'g12_verify',
}

let failures = 0
function check(label, cond) {
  if (cond) console.log(`  OK   ${label}`)
  else { console.log(`  FAIL ${label}`); failures++ }
}

async function main() {
  const db = new Client(conn)
  await db.connect()

  const tenantId = (await db.query(`INSERT INTO tenants (name, slug) VALUES ('g12-verify','g12-verify') RETURNING id`)).rows[0].id
  const userId = (await db.query(`INSERT INTO auth.users (email) VALUES ('hr-admin@g12-verify.test') RETURNING id`)).rows[0].id
  await db.query(`INSERT INTO profiles (id, tenant_id, role, full_name) VALUES ($1, $2, 'hr_admin', 'HR Admin')`, [userId, tenantId])
  const leaveTypeId = (await db.query(`INSERT INTO leave_types (tenant_id, name, is_paid) VALUES ($1, 'Earned Leave', true) RETURNING id`, [tenantId])).rows[0].id

  async function seedRequest({ runStatus = 'draft', slipStatus = 'draft', days = 10, grossAmount = 5000, tdsAmount = 500 } = {}) {
    const empId = (await db.query(
      `INSERT INTO employees (tenant_id, employee_code, first_name, last_name, email, joining_date)
       VALUES ($1, $2, 'G12', 'Test', $3, '2020-01-01') RETURNING id`,
      [tenantId, `E${Math.random().toString(36).slice(2, 8)}`, `g12-${Math.random().toString(36).slice(2)}@example.com`],
    )).rows[0].id
    const reqId = (await db.query(
      `INSERT INTO leave_encashment_requests (tenant_id, employee_id, leave_type_id, year, days, status, rate_per_day, gross_amount, tds_amount, net_amount)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, $8, $9) RETURNING id`,
      [tenantId, empId, leaveTypeId, new Date().getFullYear(), days, grossAmount / days, grossAmount, tdsAmount, grossAmount - tdsAmount],
    )).rows[0].id
    const runId = (await db.query(
      `INSERT INTO payroll_runs (tenant_id, month, status, total_gross, total_deductions, total_net)
       VALUES ($1, $2, $3, 100000, 20000, 80000) RETURNING id`,
      [tenantId, `2026-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}`, runStatus],
    )).rows[0].id
    const slipId = (await db.query(
      `INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, total_deductions, net_pay, tds_deducted, component_breakdown, status)
       VALUES ($1, $2, $3, '2026-11', 50000, 10000, 40000, 3000,
         '[{"code":"BASIC","name":"Basic","type":"earning","monthly_amount":30000},{"code":"TDS","name":"TDS","type":"deduction","monthly_amount":3000}]'::jsonb,
         $4)
       RETURNING id`,
      [tenantId, runId, empId, slipStatus],
    )).rows[0].id
    return { empId, reqId, runId, slipId, grossAmount, tdsAmount, days }
  }

  // ── A. Happy path ──────────────────────────────────────────────────────────
  console.log('\n[A] mark-paid posts into a draft payslip')
  {
    const s = await seedRequest()
    const { rows } = await db.query(`SELECT mark_leave_encashment_paid_atomic($1,$2,$3,$4) AS result`, [tenantId, s.reqId, s.runId, userId])
    check('RPC returned a result', !!rows[0].result)

    const req = (await db.query(`SELECT status, payroll_run_id FROM leave_encashment_requests WHERE id = $1`, [s.reqId])).rows[0]
    check("request flipped to 'paid' and linked to the run", req.status === 'paid' && req.payroll_run_id === s.runId)

    const slip = (await db.query(`SELECT gross_pay, total_deductions, net_pay, tds_deducted, component_breakdown FROM payroll_slips WHERE id = $1`, [s.slipId])).rows[0]
    check('gross_pay increased by the encashment gross amount', Number(slip.gross_pay) === 50000 + s.grossAmount)
    check('total_deductions increased by the TDS amount', Number(slip.total_deductions) === 10000 + s.tdsAmount)
    check('net_pay reflects both changes', Number(slip.net_pay) === (50000 + s.grossAmount) - (10000 + s.tdsAmount))
    check('tds_deducted now sums ALL TDS-coded lines (original 3000 + new 500)', Number(slip.tds_deducted) === 3000 + s.tdsAmount)
    const components = slip.component_breakdown
    check('component_breakdown has a LEAVE_ENCASHMENT earning line', components.some(c => c.code === 'LEAVE_ENCASHMENT' && Number(c.monthly_amount) === s.grossAmount))
    check('component_breakdown has a second TDS line for the encashment withholding', components.filter(c => c.code === 'TDS').length === 2)

    const run = (await db.query(`SELECT total_gross, total_deductions, total_net FROM payroll_runs WHERE id = $1`, [s.runId])).rows[0]
    check("run's own aggregate totals stay in sync", Number(run.total_gross) === 100000 + s.grossAmount && Number(run.total_deductions) === 20000 + s.tdsAmount)

    // ── C. Retry after success ────────────────────────────────────────────────
    console.log('\n[C] Retry after success cannot double-post')
    let retryErr = null
    try { await db.query(`SELECT mark_leave_encashment_paid_atomic($1,$2,$3,$4)`, [tenantId, s.reqId, s.runId, userId]) }
    catch (e) { retryErr = e }
    check('retry raises ALREADY_DECIDED', retryErr && /ALREADY_DECIDED/.test(retryErr.message))
    const slipAfterRetry = (await db.query(`SELECT gross_pay FROM payroll_slips WHERE id = $1`, [s.slipId])).rows[0]
    check('gross_pay unchanged by the retry — no double-posting', Number(slipAfterRetry.gross_pay) === 50000 + s.grossAmount)

    // ── D. Reversal while the slip is still draft ─────────────────────────────
    console.log('\n[D] Reversal (slip still draft) removes the posting and credits the balance back')
    await db.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance)
       VALUES ($1, $2, $3, $4, 5) ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE SET balance = 5`,
      [tenantId, s.empId, leaveTypeId, new Date().getFullYear()],
    )
    const { rows: revRows } = await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4) AS result`, [tenantId, s.reqId, userId, 'test reversal'])
    check('reversal RPC returned a result', !!revRows[0].result)

    const reqAfterReversal = (await db.query(`SELECT status, reversed_by FROM leave_encashment_requests WHERE id = $1`, [s.reqId])).rows[0]
    check("request status is 'reversed'", reqAfterReversal.status === 'reversed' && reqAfterReversal.reversed_by === userId)

    const slipAfterReversal = (await db.query(`SELECT gross_pay, total_deductions, net_pay, tds_deducted, component_breakdown FROM payroll_slips WHERE id = $1`, [s.slipId])).rows[0]
    check('gross_pay restored to the pre-encashment value', Number(slipAfterReversal.gross_pay) === 50000)
    check('total_deductions restored', Number(slipAfterReversal.total_deductions) === 10000)
    check('tds_deducted back to the original single TDS line', Number(slipAfterReversal.tds_deducted) === 3000)
    check('component_breakdown no longer has the LEAVE_ENCASHMENT line', !slipAfterReversal.component_breakdown.some(c => c.code === 'LEAVE_ENCASHMENT'))

    const runAfterReversal = (await db.query(`SELECT total_gross, total_deductions FROM payroll_runs WHERE id = $1`, [s.runId])).rows[0]
    check('run totals restored', Number(runAfterReversal.total_gross) === 100000 && Number(runAfterReversal.total_deductions) === 20000)

    const balAfterReversal = (await db.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`, [tenantId, s.empId, leaveTypeId])).rows[0]
    check(`balance credited back by ${s.days} days`, Number(balAfterReversal.balance) === 5 + s.days)

    // Idempotency of the reversal itself — reversing an already-reversed request.
    let secondReversalErr = null
    try { await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, s.reqId, userId, 'second attempt']) }
    catch (e) { secondReversalErr = e }
    check('reversing an already-reversed request raises CONFLICT, no double credit', secondReversalErr && /CONFLICT/.test(secondReversalErr.message))
    const balAfterSecondAttempt = (await db.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`, [tenantId, s.empId, leaveTypeId])).rows[0]
    check('balance unchanged by the second (rejected) reversal attempt', Number(balAfterSecondAttempt.balance) === 5 + s.days)
  }

  // ── B. mark-paid refuses a finalized run ────────────────────────────────────
  console.log('\n[B] mark-paid refuses a finalized run — nothing written')
  {
    const s = await seedRequest({ runStatus: 'finalized', slipStatus: 'finalized' })
    let err = null
    try { await db.query(`SELECT mark_leave_encashment_paid_atomic($1,$2,$3,$4)`, [tenantId, s.reqId, s.runId, userId]) }
    catch (e) { err = e }
    check('raises RUN_NOT_DRAFT', err && /RUN_NOT_DRAFT/.test(err.message))
    const req = (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [s.reqId])).rows[0]
    check("request left 'approved' — nothing half-applied", req.status === 'approved')
  }

  // ── E. Reversal refuses once the payslip is finalized ───────────────────────
  console.log('\n[E] Reversal refuses once the linked payslip is finalized')
  {
    const s = await seedRequest({ runStatus: 'draft', slipStatus: 'draft' })
    await db.query(`SELECT mark_leave_encashment_paid_atomic($1,$2,$3,$4)`, [tenantId, s.reqId, s.runId, userId])
    // Finalize the slip after payment, as a normal payroll finalize step would.
    await db.query(`UPDATE payroll_slips SET status = 'finalized' WHERE id = $1`, [s.slipId])

    let err = null
    try { await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, s.reqId, userId, 'too late']) }
    catch (e) { err = e }
    check('raises PAYROLL_FINALIZED', err && /PAYROLL_FINALIZED/.test(err.message))
    const req = (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [s.reqId])).rows[0]
    check("request still 'paid' — the abort rolled back the status change too", req.status === 'paid')
    const slip = (await db.query(`SELECT gross_pay FROM payroll_slips WHERE id = $1`, [s.slipId])).rows[0]
    check('finalized slip gross_pay untouched', Number(slip.gross_pay) === 50000 + s.grossAmount)
  }

  await db.end()
  console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
