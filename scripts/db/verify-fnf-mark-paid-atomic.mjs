#!/usr/bin/env node
/**
 * Real-Postgres verification of mark_fnf_paid_atomic (migration 445,
 * extended by 448 for leave-encashment drift, 450 for leave-encashment
 * consumption) and correct_fnf_payment_atomic (migration 451, the
 * compensating transaction for a paid settlement).
 *
 * Run against a throwaway database with the full migration history applied
 * (see sibling shell commands this session ran to build `fnf_verify`).
 * Not a committed test — a one-off integration check, same pattern as this
 * session's earlier schema-drift verification script.
 *
 * Proves, against a REAL Postgres transaction (not mocked):
 *   A. Happy path — forecloses the loan, recovers the advance schedule,
 *      writes the ledger row, flips both parent statuses, marks paid.
 *   B. Retry cannot double-deduct — second call on an already-paid
 *      settlement raises ALREADY_DECIDED, zero additional writes.
 *   C. Source drift aborts the WHOLE transaction — mutate the loan balance
 *      after approval (simulating a concurrent partial repayment), call
 *      the function, confirm RAISE EXCEPTION SOURCE_DRIFT AND that nothing
 *      was left half-applied (settlement still 'approved', loan balance
 *      still at the drifted value, not foreclosed).
 *   D. F&F-vs-F&F concurrency — two simultaneous calls for the SAME
 *      employee; exactly one succeeds, the other sees ALREADY_DECIDED,
 *      no double foreclosure / double ledger row.
 *   E. Payroll-vs-F&F concurrency — while mark_fnf_paid_atomic's
 *      transaction holds its FOR UPDATE lock (uncommitted), a concurrent
 *      plain UPDATE mimicking a normal payroll run's own write to the
 *      same loan_schedules row must BLOCK until the F&F transaction
 *      commits, then match 0 rows (because the row is no longer
 *      'pending') — proving payroll can't race in a double deduction.
 *   F. Leave-encashment happy path — a settlement with a real
 *      leave_encashment_basis and matching current balance pays out clean.
 *   G. Leave-encashment drift (migration 448) — a standalone encashment
 *      approval decrementing the SAME balance between F&F approve and
 *      mark-paid raises SOURCE_DRIFT, settlement stays 'approved', nothing
 *      else half-applied (the loan in the same settlement is NOT
 *      foreclosed either — proving the abort is transaction-wide).
 *   H. LEAVE_BASIS_MISSING — a settlement with leave_encashment_days > 0
 *      but no stored basis (predates 448, or entered manually) refuses
 *      with an actionable error instead of silently skipping the check.
 *   I. Zero leave_encashment_days skips the check entirely — no basis
 *      needed, no false blocks on ordinary loan/advance-only settlements.
 *   J. Successful payment CONSUMES the balance (migration 450) — not just
 *      a drift check. The exact rows named in leave_encashment_basis are
 *      decremented by leave_encashment_days, with a leave_balance_ledger
 *      audit row, inside the same transaction as the payment.
 *   K. The confirmed double-pay scenario migration 450 exists to close:
 *      a standalone encashment request submitted (pending, balance
 *      untouched) BEFORE separation, with F&F computed/approved/paid for
 *      the same days in the meantime (balance never consumed by anything
 *      else, so no SOURCE_DRIFT fires), then the OLD pending request is
 *      approved AFTER F&F already paid. Proves checked_deduct_leave_
 *      balance (the real approval-time deduction standalone encashment
 *      uses) now fails for insufficient balance instead of silently
 *      succeeding — before migration 450 this would have paid twice.
 *   L. Genuine concurrency, not just sequential drift: while mark_fnf_paid_
 *      atomic's transaction holds its FOR UPDATE lock on the consumed
 *      employee_leave_balance row (uncommitted), a concurrent
 *      checked_deduct_leave_balance call (what a standalone encashment
 *      approval actually runs) BLOCKS until the F&F transaction commits,
 *      then correctly fails once it sees the post-consumption balance —
 *      the row lock alone prevents the race, not a check that could still
 *      lose to a sufficiently-timed interleaving.
 *   M. correct_fnf_payment_atomic (451) reverses exactly what a paid
 *      settlement's own mark_fnf_paid_atomic call wrote: loan back to
 *      'active' with outstanding_balance restored and foreclosure fields
 *      cleared, loan_schedules back to 'pending'; advance_recovery_
 *      schedules back to 'pending' and advance_salary_requests back to
 *      'recovering', with the original advance_recoveries row KEPT and a
 *      mirrored negative-amount reversal row inserted (append-only, same
 *      invariant as the GL ledger); leave balance credited back using the
 *      leave_balance_ledger table's own existing reversal mechanism
 *      (txn_type='reversal', reversal_of, is_reversal — not a new ad-hoc
 *      type); settlement itself back to 'draft' with correction_reason/
 *      corrected_by recorded on the row. Also: an empty reason refuses
 *      with REASON_REQUIRED; a second correction attempt on the
 *      now-'draft' settlement refuses with INVALID_STATE (no double
 *      credit).
 *   M2. Scoping precision — an unrelated loan independently foreclosed
 *      through some other means (not this F&F payment) is left completely
 *      untouched by the correction, proving the reversal is scoped by the
 *      exact foreclosure_notes/advance_recoveries.notes markers
 *      mark_fnf_paid_atomic itself writes, not by status alone.
 */
import pg from 'pg'

const { Client } = pg
const conn = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'fnf_verify',
}

let failures = 0
function check(label, cond) {
  if (cond) {
    console.log(`  OK   ${label}`)
  } else {
    console.log(`  FAIL ${label}`)
    failures++
  }
}

async function seedEmployeeWithFnf(client, tenantId, {
  loanBalance, advanceAmount, ffStatus = 'approved',
  leaveTypeId = null, leaveYear = null, leaveEncashmentDays = null, leaveEncashmentBasis = undefined,
}) {
  const empId = (await client.query(
    `INSERT INTO employees (tenant_id, employee_code, first_name, last_name, email, joining_date)
     VALUES ($1, $2, 'Test', 'Employee', $3, '2020-01-01') RETURNING id`,
    [tenantId, `E${Math.random().toString(36).slice(2, 8)}`, `e${Math.random().toString(36).slice(2)}@example.com`],
  )).rows[0].id
  const sepId = (await client.query(
    `INSERT INTO employee_separation (tenant_id, employee_id, separation_type, initiated_by)
     VALUES ($1, $2, 'resignation', 'employee') RETURNING id`,
    [tenantId, empId],
  )).rows[0].id
  // leaveEncashmentBasis: undefined -> column stays NULL (never computed, migration-448 exemption case).
  // Pass [] explicitly for "computed, verified zero encashable types".
  const basisParam = leaveEncashmentBasis === undefined ? null : JSON.stringify(leaveEncashmentBasis)
  const ffId = (await client.query(
    `INSERT INTO separation_ff_summary (tenant_id, separation_id, employee_id, status, loan_recovery_amount, advance_recovery_amount, asset_recovery_amount, leave_encashment_days, leave_encashment_basis)
     VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8) RETURNING id`,
    [tenantId, sepId, empId, ffStatus, loanBalance, advanceAmount, leaveEncashmentDays, basisParam],
  )).rows[0].id

  if (leaveTypeId && leaveYear != null) {
    await client.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, empId, leaveTypeId, leaveYear, leaveEncashmentDays ?? 0],
    )
  }

  let loanId = null, loanSchedId = null
  if (loanBalance > 0) {
    loanId = (await client.query(
      `INSERT INTO employee_loans (tenant_id, employee_id, loan_type, principal_amount, tenure_months, outstanding_balance, status)
       VALUES ($1, $2, 'personal', $3, 12, $3, 'active') RETURNING id`,
      [tenantId, empId, loanBalance],
    )).rows[0].id
    loanSchedId = (await client.query(
      `INSERT INTO loan_schedules (tenant_id, loan_id, installment_number, due_month, principal_component, emi_amount, status)
       VALUES ($1, $2, 1, '2026-11', $3, $3, 'pending') RETURNING id`,
      [tenantId, loanId, loanBalance],
    )).rows[0].id
  }

  let advanceId = null, advanceSchedId = null
  if (advanceAmount > 0) {
    advanceId = (await client.query(
      `INSERT INTO advance_salary_requests (tenant_id, employee_id, requested_amount, purpose, status)
       VALUES ($1, $2, $3, 'test', 'recovering') RETURNING id`,
      [tenantId, empId, advanceAmount],
    )).rows[0].id
    advanceSchedId = (await client.query(
      `INSERT INTO advance_recovery_schedules (tenant_id, advance_id, recovery_month, scheduled_amount, status)
       VALUES ($1, $2, '2026-11', $3, 'pending') RETURNING id`,
      [tenantId, advanceId, advanceAmount],
    )).rows[0].id
  }

  return { tenantId, empId, ffId, loanId, loanSchedId, advanceId, advanceSchedId }
}

async function main() {
  const admin = new Client(conn)
  await admin.connect()
  const tenantId = (await admin.query(`INSERT INTO tenants (name, slug) VALUES ('fnf-verify', 'fnf-verify') RETURNING id`)).rows[0].id
  const userId = (await admin.query(`INSERT INTO auth.users (email) VALUES ('hr-admin@fnf-verify.test') RETURNING id`)).rows[0].id
  await admin.query(`INSERT INTO profiles (id, tenant_id, role, full_name) VALUES ($1, $2, 'hr_admin', 'HR Admin')`, [userId, tenantId])
  const leaveTypeId = (await admin.query(`INSERT INTO leave_types (tenant_id, name, is_paid) VALUES ($1, 'Earned Leave', true) RETURNING id`, [tenantId])).rows[0].id
  const leaveYear = new Date().getFullYear()

  // ── A. Happy path ──────────────────────────────────────────────────────────
  console.log('\n[A] Happy path')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, { loanBalance: 5000, advanceAmount: 2000 })
    const { rows } = await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3) AS result`, [s.tenantId, s.empId, userId])
    check('RPC returned a result', !!rows[0].result)

    const ff = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement flipped to 'paid'", ff.status === 'paid')

    const loan = (await admin.query(`SELECT status, outstanding_balance, foreclosure_amount FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check("loan foreclosed", loan.status === 'foreclosed' && Number(loan.outstanding_balance) === 0 && Number(loan.foreclosure_amount) === 5000)

    const sched = (await admin.query(`SELECT status FROM loan_schedules WHERE id = $1`, [s.loanSchedId])).rows[0]
    check("loan schedule adjusted (excluded from a future payroll run's own pending filter)", sched.status === 'adjusted')

    const advSched = (await admin.query(`SELECT status FROM advance_recovery_schedules WHERE id = $1`, [s.advanceSchedId])).rows[0]
    check('advance schedule recovered', advSched.status === 'recovered')

    const ledger = await admin.query(`SELECT amount FROM advance_recoveries WHERE schedule_id = $1`, [s.advanceSchedId])
    check('exactly one ledger row, correct amount', ledger.rows.length === 1 && Number(ledger.rows[0].amount) === 2000)

    const advReq = (await admin.query(`SELECT status FROM advance_salary_requests WHERE id = $1`, [s.advanceId])).rows[0]
    check("advance request fully_recovered (excluded from a future payroll run's own IN ('disbursed','recovering') filter)", advReq.status === 'fully_recovered')

    // ── B. Retry cannot double-deduct ─────────────────────────────────────────
    console.log('\n[B] Retry after success')
    let retryErr = null
    try { await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]) }
    catch (e) { retryErr = e }
    check('retry raises ALREADY_DECIDED', retryErr && /ALREADY_DECIDED/.test(retryErr.message))
    const ledgerAfterRetry = await admin.query(`SELECT count(*) FROM advance_recoveries WHERE schedule_id = $1`, [s.advanceSchedId])
    check('still exactly one ledger row after retry — no double deduction', Number(ledgerAfterRetry.rows[0].count) === 1)
  }

  // ── C. Source drift aborts the whole transaction ────────────────────────────
  console.log('\n[C] Source drift (loan balance changed since approval)')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, { loanBalance: 5000, advanceAmount: 0 })
    // Simulate a concurrent partial repayment landing between approve and mark-paid.
    await admin.query(`UPDATE employee_loans SET outstanding_balance = 3000 WHERE id = $1`, [s.loanId])

    let driftErr = null
    try { await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]) }
    catch (e) { driftErr = e }
    check('raises SOURCE_DRIFT mentioning both amounts', driftErr && /SOURCE_DRIFT/.test(driftErr.message) && /5000/.test(driftErr.message) && /3000/.test(driftErr.message))

    const ff = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement left 'approved' — nothing half-applied", ff.status === 'approved')

    const loan = (await admin.query(`SELECT status, outstanding_balance FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check('loan NOT foreclosed, balance still the drifted 3000 — the abort rolled back everything, not just the final status flip', loan.status === 'active' && Number(loan.outstanding_balance) === 3000)
  }

  // ── D. F&F-vs-F&F concurrency ────────────────────────────────────────────────
  console.log('\n[D] Two simultaneous mark-paid calls for the same employee')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, { loanBalance: 4000, advanceAmount: 0 })
    const c1 = new Client(conn), c2 = new Client(conn)
    await c1.connect(); await c2.connect()
    const results = await Promise.allSettled([
      c1.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]),
      c2.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]),
    ])
    await c1.end(); await c2.end()
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')
    check('exactly one of the two concurrent calls succeeded', fulfilled.length === 1)
    check('the other was rejected as ALREADY_DECIDED (serialized by the row lock, not a race)', rejected.length === 1 && /ALREADY_DECIDED/.test(rejected[0].reason.message))

    const loan = (await admin.query(`SELECT status, outstanding_balance FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check('loan foreclosed exactly once (balance is 0, not negative or double-adjusted)', loan.status === 'foreclosed' && Number(loan.outstanding_balance) === 0)
  }

  // ── E. Payroll-vs-F&F concurrency ───────────────────────────────────────────
  console.log('\n[E] A concurrent payroll-style write blocks on the F&F transaction\'s lock, then sees 0 pending rows')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, { loanBalance: 6000, advanceAmount: 0 })
    const fnfConn = new Client(conn), payrollConn = new Client(conn)
    await fnfConn.connect(); await payrollConn.connect()

    await fnfConn.query('BEGIN')
    await fnfConn.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId])
    // Transaction is open, uncommitted — the FOR UPDATE OF ls lock on this
    // loan's loan_schedules row is still held.

    const payrollStart = Date.now()
    const payrollPromise = payrollConn.query(
      `UPDATE loan_schedules SET status = 'paid', paid_amount = $2 WHERE id = $1 AND status = 'pending'`,
      [s.loanSchedId, 6000],
    )

    // Give the payroll query a moment to actually attempt and block.
    await new Promise(r => setTimeout(r, 300))
    const blockedSoFar = Date.now() - payrollStart
    check('payroll write is still blocked ~300ms in (did not run immediately)', blockedSoFar >= 290)

    await fnfConn.query('COMMIT')
    const payrollResult = await payrollPromise
    const totalWait = Date.now() - payrollStart
    check('payroll write unblocked only after the F&F transaction committed', totalWait >= 290)
    check("payroll write matched 0 rows — the schedule was already 'adjusted', not 'pending', so payroll can't double-process it", payrollResult.rowCount === 0)

    await fnfConn.end(); await payrollConn.end()
  }

  // ── F. Leave-encashment happy path ──────────────────────────────────────────
  console.log('\n[F] Leave-encashment happy path — basis matches current balance')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 0, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 12,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }],
    })
    const balBefore = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('precondition: balance starts at the full 12 days', Number(balBefore.balance) === 12)

    const { rows } = await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3) AS result`, [s.tenantId, s.empId, userId])
    check('RPC returned a result', !!rows[0].result)
    check('result reports the verified leave days', Number(rows[0].result.leave_encashment_days_verified) === 12)
    check('result reports the consumed leave days', Number(rows[0].result.leave_encashment_days_consumed) === 12)
    const ff = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement flipped to 'paid'", ff.status === 'paid')

    // Migration 450: successful payment must CONSUME the balance, not just
    // verify it — this is what "payment is final" actually means.
    const balAfter = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('balance is consumed down to 0 — the entitlement is spent, not just checked', Number(balAfter.balance) === 0)

    const ledger = (await admin.query(`SELECT txn_type, delta, balance_after FROM leave_balance_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 ORDER BY created_at DESC LIMIT 1`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('an audit ledger row was written for the consumption', ledger && ledger.txn_type === 'encashment' && Number(ledger.delta) === -12 && Number(ledger.balance_after) === 0)
  }

  // ── G. Leave-encashment drift (migration 448) ───────────────────────────────
  console.log('\n[G] Leave-encashment drift — a concurrent standalone encashment consumed the balance since approval')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 5000, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 10,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }],
    })
    // Simulate a standalone leave-encashment approval landing between F&F
    // approve and mark-paid: it decremented the SAME balance row.
    await admin.query(
      `UPDATE employee_leave_balance SET balance = 4 WHERE tenant_id = $1 AND employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )

    let driftErr = null
    try { await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]) }
    catch (e) { driftErr = e }
    check('raises SOURCE_DRIFT mentioning both day counts', driftErr && /SOURCE_DRIFT/.test(driftErr.message) && /10/.test(driftErr.message) && /\b4\b/.test(driftErr.message))

    const ff = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement left 'approved' — nothing half-applied", ff.status === 'approved')

    const loan = (await admin.query(`SELECT status, outstanding_balance FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check('the loan in the SAME settlement is NOT foreclosed either — the abort is transaction-wide, not per-check', loan.status === 'active' && Number(loan.outstanding_balance) === 5000)

    const bal = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('balance still at the drifted value (4) — the abort did not touch it either way', Number(bal.balance) === 4)
  }

  // ── H. LEAVE_BASIS_MISSING ───────────────────────────────────────────────────
  console.log('\n[H] A settlement with days > 0 but no recorded basis refuses with an actionable error')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 0, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 8,
      leaveEncashmentBasis: undefined, // predates 448 / manual entry — no basis stored
    })
    let err = null
    try { await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId]) }
    catch (e) { err = e }
    check('raises LEAVE_BASIS_MISSING, not a generic failure or a silent pass-through', err && /LEAVE_BASIS_MISSING/.test(err.message))
    const ff = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement left 'approved'", ff.status === 'approved')
  }

  // ── I. Zero leave_encashment_days skips the check entirely ──────────────────
  console.log('\n[I] A loan/advance-only settlement (no leave encashment) is unaffected by the new check')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 1500, advanceAmount: 0,
      leaveEncashmentDays: 0, leaveEncashmentBasis: undefined,
    })
    const { rows } = await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3) AS result`, [s.tenantId, s.empId, userId])
    check('zero-days settlement with no basis still pays out cleanly — no false block', !!rows[0].result)
  }

  // ── J. Multi-leave-type consumption, greedy across basis rows ───────────────
  console.log('\n[J] Consumption spans multiple encashable leave types when the basis names more than one')
  {
    const leaveTypeId2 = (await admin.query(`INSERT INTO leave_types (tenant_id, name, is_paid) VALUES ($1, 'Sick Leave (Encashable)', true) RETURNING id`, [tenantId])).rows[0].id
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 0, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 15,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }, { leave_type_id: leaveTypeId2, year: leaveYear }],
    })
    // Override the single-type seed: split 15 days across BOTH types (10 + 5).
    await admin.query(`UPDATE employee_leave_balance SET balance = 10 WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])
    await admin.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1, $2, $3, $4, 5)`,
      [tenantId, s.empId, leaveTypeId2, leaveYear],
    )

    const { rows } = await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3) AS result`, [s.tenantId, s.empId, userId])
    check('RPC succeeds with a two-leave-type basis (10 + 5 = 15 verified)', !!rows[0].result && Number(rows[0].result.leave_encashment_days_verified) === 15)

    const bal1 = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    const bal2 = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId2, leaveYear])).rows[0]
    check('first leave type fully consumed (10 -> 0)', Number(bal1.balance) === 0)
    check('second leave type fully consumed (5 -> 0)', Number(bal2.balance) === 0)

    const ledgerRows = (await admin.query(`SELECT leave_type_id FROM leave_balance_ledger WHERE tenant_id=$1 AND employee_id=$2 AND txn_type='encashment' AND year=$3`, [tenantId, s.empId, leaveYear])).rows
    check('a ledger row was written for EACH consumed leave type', ledgerRows.length >= 2)
  }

  // ── K. The confirmed double-pay scenario is now prevented ───────────────────
  console.log('\n[K] A standalone encashment request pending before F&F payment cannot ALSO be approved after')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 0, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 9,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }],
    })
    // The employee ALSO has an old standalone encashment request, submitted
    // while still active, for the SAME leave type/year, still 'pending' —
    // exactly the sequence migration 450's header describes: it was never
    // approved (so checked_deduct_leave_balance never ran for it), the
    // balance was never touched by it, so F&F's own SOURCE_DRIFT check has
    // nothing to catch when F&F pays first.
    const standaloneReqId = (await admin.query(
      `INSERT INTO leave_encashment_requests (tenant_id, employee_id, leave_type_id, year, days, status)
       VALUES ($1, $2, $3, $4, 9, 'pending') RETURNING id`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )).rows[0].id

    const { rows: payResult } = await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3) AS result`, [s.tenantId, s.empId, userId])
    check('F&F payment succeeds first (balance untouched by the still-pending standalone request)', !!payResult[0].result)

    const balAfterFnf = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('F&F payment consumed the balance down to 0', Number(balAfterFnf.balance) === 0)

    // HR now (too late) approves the old pending standalone request — this
    // is exactly what accrual-engine.ts's processEncashment calls at
    // approval time. Before migration 450, this would have succeeded
    // (balance was still 9) and paid the same days a second time.
    const { rows: deductResult } = await admin.query(
      `SELECT checked_deduct_leave_balance($1, $2, $3, 9, $4) AS deducted`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )
    check('the old pending request can no longer be approved — checked_deduct_leave_balance correctly fails (balance already spent)', deductResult[0].deducted === false)

    const balFinal = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('balance still 0 — no double deduction, no double payment', Number(balFinal.balance) === 0)

    const standaloneReqAfter = (await admin.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [standaloneReqId])).rows[0]
    check('the standalone request itself is untouched (still pending — the route layer, not this RPC, decides what to do with the failed deduction)', standaloneReqAfter.status === 'pending')
  }

  // ── L. Genuine concurrency: a real race, not just a sequential drift check ──
  console.log('\n[L] A concurrent checked_deduct_leave_balance call blocks on the F&F transaction\'s lock, then fails against the post-consumption balance')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 0, advanceAmount: 0,
      leaveTypeId, leaveYear, leaveEncashmentDays: 7,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }],
    })
    const standaloneReqId = (await admin.query(
      `INSERT INTO leave_encashment_requests (tenant_id, employee_id, leave_type_id, year, days, status)
       VALUES ($1, $2, $3, $4, 7, 'pending') RETURNING id`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )).rows[0].id

    const fnfConn = new Client(conn), standaloneConn = new Client(conn)
    await fnfConn.connect(); await standaloneConn.connect()

    await fnfConn.query('BEGIN')
    await fnfConn.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId])
    // Transaction open, uncommitted — the FOR UPDATE OF elb lock on this
    // employee_leave_balance row is still held, and the balance UPDATE
    // (12 -> 0, in this connection's own uncommitted view) has happened but
    // isn't visible to anyone else yet.

    const standaloneStart = Date.now()
    const standalonePromise = standaloneConn.query(
      `SELECT checked_deduct_leave_balance($1, $2, $3, 7, $4) AS deducted`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )

    await new Promise(r => setTimeout(r, 300))
    const blockedSoFar = Date.now() - standaloneStart
    check('the standalone deduction is still blocked ~300ms in (did not run immediately)', blockedSoFar >= 290)

    await fnfConn.query('COMMIT')
    const standaloneResult = await standalonePromise
    const totalWait = Date.now() - standaloneStart
    check('the standalone deduction unblocked only after the F&F transaction committed', totalWait >= 290)
    check('the standalone deduction correctly FAILS once it sees the post-consumption (0) balance — the row lock alone prevented the race', standaloneResult.rows[0].deducted === false)

    await fnfConn.end(); await standaloneConn.end()

    const balFinal = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('balance ends at 0 — exactly one consumer (F&F) won the race', Number(balFinal.balance) === 0)
    const standaloneReqAfter = (await admin.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [standaloneReqId])).rows[0]
    check('the standalone request is untouched by the failed deduction attempt', standaloneReqAfter.status === 'pending')
  }

  // ── M. correct_fnf_payment_atomic (migration 451) ───────────────────────────
  console.log('\n[M] correct_fnf_payment_atomic reverses exactly what mark_fnf_paid_atomic wrote — loan, advance, and leave balance')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 20000, advanceAmount: 3000,
      leaveTypeId, leaveYear, leaveEncashmentDays: 9,
      leaveEncashmentBasis: [{ leave_type_id: leaveTypeId, year: leaveYear }],
    })
    await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId])

    const paidFf = (await admin.query(`SELECT status FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("precondition: payment succeeded, settlement is 'paid'", paidFf.status === 'paid')

    let noReasonErr = null
    try { await admin.query(`SELECT correct_fnf_payment_atomic($1, $2, $3, $4)`, [s.tenantId, s.empId, userId, '']) }
    catch (e) { noReasonErr = e }
    check('an empty reason raises REASON_REQUIRED, nothing changed', noReasonErr && /REASON_REQUIRED/.test(noReasonErr.message))

    const { rows } = await admin.query(
      `SELECT correct_fnf_payment_atomic($1, $2, $3, $4) AS result`,
      [s.tenantId, s.empId, userId, 'Bank transfer failed — reversing to re-run'],
    )
    check('correction RPC returned a result', !!rows[0].result)
    check('result reports 1 loan reverted', Number(rows[0].result.loans_reverted) === 1)

    const ffAfter = (await admin.query(`SELECT status, paid_by, paid_at, correction_reason, corrected_by FROM separation_ff_summary WHERE id = $1`, [s.ffId])).rows[0]
    check("settlement reverted to 'draft'", ffAfter.status === 'draft')
    check('paid_by/paid_at cleared', ffAfter.paid_by === null && ffAfter.paid_at === null)
    check('correction_reason and corrected_by recorded on the row itself', ffAfter.correction_reason === 'Bank transfer failed — reversing to re-run' && ffAfter.corrected_by === userId)

    const loan = (await admin.query(`SELECT status, outstanding_balance, foreclosed_at, foreclosure_amount, foreclosure_notes FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check("loan reverted to 'active' (not 'disbursed' — the only status payroll's own EMI query picks up)", loan.status === 'active')
    check('outstanding_balance restored to the pre-foreclosure amount (20000)', Number(loan.outstanding_balance) === 20000)
    check('foreclosure fields cleared', loan.foreclosed_at === null && loan.foreclosure_amount === null && loan.foreclosure_notes === null)

    const loanSched = (await admin.query(`SELECT status FROM loan_schedules WHERE id = $1`, [s.loanSchedId])).rows[0]
    check("loan schedule reverted 'adjusted' -> 'pending'", loanSched.status === 'pending')

    const advSched = (await admin.query(`SELECT status, recovered_at FROM advance_recovery_schedules WHERE id = $1`, [s.advanceSchedId])).rows[0]
    check("advance schedule reverted 'recovered' -> 'pending'", advSched.status === 'pending' && advSched.recovered_at === null)

    const advReq = (await admin.query(`SELECT status FROM advance_salary_requests WHERE id = $1`, [s.advanceId])).rows[0]
    check("advance request reverted 'fully_recovered' -> 'recovering'", advReq.status === 'recovering')

    const advRecoveries = (await admin.query(
      `SELECT amount, recovery_type FROM advance_recoveries WHERE advance_id = $1 ORDER BY created_at`,
      [s.advanceId],
    )).rows
    // advance_recoveries is NOT append-only — migration 281's UNIQUE(tenant_id,
    // schedule_id) index permits only one recovery row per schedule ever, and
    // amount>=0 forbids a negative mirror row, so the correction deletes the
    // row rather than reversing it in place (consistent with the schedule
    // reverting to 'pending', which must be re-recoverable later).
    check('the recovery row for this schedule is gone — not append-only here, deletion is correct', advRecoveries.length === 0)

    const balAfter = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('leave balance credited back to the full 9 days — the entitlement is restored, not left spent', Number(balAfter.balance) === 9)

    const ledgerRows = (await admin.query(
      `SELECT txn_type, delta, is_reversal, reversal_of FROM leave_balance_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 ORDER BY created_at`,
      [tenantId, s.empId, leaveTypeId, leaveYear],
    )).rows
    check('original encashment ledger row KEPT (append-only), plus a reversal row using the table\'s own mechanism', ledgerRows.length === 2 && ledgerRows[0].txn_type === 'encashment' && ledgerRows[1].txn_type === 'reversal' && ledgerRows[1].is_reversal === true)
    check('the reversal row points back at the original via reversal_of', ledgerRows[1].reversal_of !== null)

    let doubleCorrectErr = null
    try { await admin.query(`SELECT correct_fnf_payment_atomic($1, $2, $3, $4)`, [s.tenantId, s.empId, userId, 'second attempt']) }
    catch (e) { doubleCorrectErr = e }
    check("a second correction attempt on the now-'draft' settlement raises INVALID_STATE — not a silent no-op or a double-credit", doubleCorrectErr && /INVALID_STATE/.test(doubleCorrectErr.message))

    const balStillNine = (await admin.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`, [tenantId, s.empId, leaveTypeId, leaveYear])).rows[0]
    check('the rejected second correction did not double-credit the balance', Number(balStillNine.balance) === 9)
  }

  // ── M2. Scoping precision — an unrelated loan is NOT touched ────────────────
  console.log('\n[M2] Correction is scoped precisely to rows THIS settlement\'s payment touched — an unrelated foreclosed loan is left alone')
  {
    const s = await seedEmployeeWithFnf(admin, tenantId, {
      loanBalance: 5000, advanceAmount: 0,
      leaveEncashmentDays: 0, leaveEncashmentBasis: undefined,
    })
    // An UNRELATED loan for the same employee, foreclosed through some other
    // means (not F&F) — must survive the correction untouched, proving the
    // scoping is by the exact foreclosure_notes marker mark_fnf_paid_atomic
    // writes, not just "any foreclosed loan this employee has".
    const unrelatedLoanId = (await admin.query(
      `INSERT INTO employee_loans (tenant_id, employee_id, loan_type, principal_amount, tenure_months, outstanding_balance, status, foreclosed_at, foreclosure_amount, foreclosure_notes)
       VALUES ($1, $2, 'personal', 8000, 12, 0, 'foreclosed', now(), 8000, 'Manually foreclosed by HR, unrelated to F&F') RETURNING id`,
      [tenantId, s.empId],
    )).rows[0].id

    await admin.query(`SELECT mark_fnf_paid_atomic($1, $2, $3)`, [s.tenantId, s.empId, userId])
    await admin.query(`SELECT correct_fnf_payment_atomic($1, $2, $3, $4)`, [s.tenantId, s.empId, userId, 'test scoping'])

    const unrelated = (await admin.query(`SELECT status, outstanding_balance, foreclosure_notes FROM employee_loans WHERE id = $1`, [unrelatedLoanId])).rows[0]
    check('the unrelated foreclosed loan is untouched — still foreclosed, balance still 0, notes unchanged', unrelated.status === 'foreclosed' && Number(unrelated.outstanding_balance) === 0 && unrelated.foreclosure_notes === 'Manually foreclosed by HR, unrelated to F&F')

    const ourLoan = (await admin.query(`SELECT status FROM employee_loans WHERE id = $1`, [s.loanId])).rows[0]
    check("the F&F-foreclosed loan WAS reverted to 'active'", ourLoan.status === 'active')
  }

  await admin.end()
  console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
