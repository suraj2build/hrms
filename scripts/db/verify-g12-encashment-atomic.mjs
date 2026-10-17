#!/usr/bin/env node
/**
 * Real-Postgres verification of migration 447's G12 functions:
 * assign_leave_encashment_to_payroll_run_atomic,
 * fn_finalize_leave_encashments_for_run,
 * fn_revert_leave_encashments_for_rollback, and the replaced
 * reverse_leave_encashment_atomic.
 *
 * Migration 447 replaced migration 446's mark_leave_encashment_paid_atomic
 * (which spliced the payout directly into an already-persisted
 * payroll_slips row and flipped status to 'paid' immediately) because that
 * design loses the posting silently: POST /payroll/runs explicitly permits
 * deleting and recomputing every slip in a non-finalized ("draft") run on
 * re-run. The new design never mutates payroll_slips at assignment time —
 * assign_leave_encashment_to_payroll_run_atomic only records intent
 * (payroll_run_id), and every (re)generation of that run's slip for this
 * employee is expected to re-derive the payout fresh from
 * leave_encashment_requests (apps/api/src/routes/payroll/runs.ts's
 * fetchEncashmentPayout + lib/payroll-engine.ts's applyEncashmentPayout —
 * covered at the pure-function level by payroll-engine.test.ts). Status
 * only becomes 'paid' once the run is actually finalized.
 *
 * Proves, against a real Postgres transaction:
 *   A. Assign: happy path sets payroll_run_id, leaves status 'approved'.
 *   B. Assign refuses: NOT_FOUND, RUN_NOT_FOUND, NO_PAYSLIP, RUN_NOT_DRAFT,
 *      ALREADY_ASSIGNED, ALREADY_DECIDED, NOT_COMPUTED — nothing written on
 *      any of these.
 *   C. Regeneration-survival: the exact query fetchEncashmentPayout runs
 *      (status='approved' AND payroll_run_id=run) still returns the full
 *      gross/TDS figures after the run's payroll_slips row for this
 *      employee is deleted and re-inserted — i.e. after simulating exactly
 *      what POST /payroll/runs's re-run path does to a draft run. This is
 *      the property migration 446 did NOT have.
 *   D. fn_finalize_leave_encashments_for_run flips only approved requests
 *      assigned to that run to 'paid' (with paid_at set) — requests
 *      assigned to a DIFFERENT run, or already decided otherwise, are left
 *      alone.
 *   E. fn_revert_leave_encashments_for_rollback flips 'paid' requests
 *      assigned to that run back to 'approved' (paid_at cleared) — the
 *      request stays assigned, so the next regeneration picks it up again.
 *   F. reverse_leave_encashment_atomic credits the leave balance back for
 *      an approved (even if assigned-but-not-yet-paid) or paid request, and
 *      refuses once the linked run is finalized (PAYROLL_FINALIZED) with
 *      nothing changed.
 *   G. Retrying an already-decided reversal raises CONFLICT, no double
 *      credit.
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

  async function seedEmployee() {
    return (await db.query(
      `INSERT INTO employees (tenant_id, employee_code, first_name, last_name, email, joining_date)
       VALUES ($1, $2, 'G12', 'Test', $3, '2020-01-01') RETURNING id`,
      [tenantId, `E${Math.random().toString(36).slice(2, 8)}`, `g12-${Math.random().toString(36).slice(2)}@example.com`],
    )).rows[0].id
  }

  let runMonthCounter = 0
  async function seedRun(status = 'draft') {
    // One run per (tenant, month) — payroll_runs_tenant_id_month_key. Walk
    // forward through years/months so repeated calls in this script never
    // collide (12 possible months/year would birthday-collide quickly).
    runMonthCounter++
    const year = 2020 + Math.floor(runMonthCounter / 12)
    const month = (runMonthCounter % 12) + 1
    return (await db.query(
      `INSERT INTO payroll_runs (tenant_id, month, status, total_gross, total_deductions, total_net)
       VALUES ($1, $2, $3, 100000, 20000, 80000) RETURNING id`,
      [tenantId, `${year}-${String(month).padStart(2, '0')}`, status],
    )).rows[0].id
  }

  async function seedSlip(runId, empId) {
    return (await db.query(
      `INSERT INTO payroll_slips (tenant_id, run_id, employee_id, month, gross_pay, total_deductions, net_pay, tds_deducted, component_breakdown, status)
       VALUES ($1, $2, $3, '2026-11', 50000, 10000, 40000, 3000,
         '[{"code":"BASIC","name":"Basic","type":"earning","monthly_amount":30000},{"code":"TDS","name":"TDS","type":"deduction","monthly_amount":3000}]'::jsonb,
         'draft')
       RETURNING id`,
      [tenantId, runId, empId],
    )).rows[0].id
  }

  async function seedRequest(empId, { gross = 5000, tds = 500, days = 10 } = {}) {
    return (await db.query(
      `INSERT INTO leave_encashment_requests (tenant_id, employee_id, leave_type_id, year, days, status, rate_per_day, gross_amount, tds_amount, net_amount)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, $8, $9) RETURNING id`,
      [tenantId, empId, leaveTypeId, new Date().getFullYear(), days, gross / days, gross, tds, gross - tds],
    )).rows[0].id
  }

  /** Mirrors runs.ts's fetchEncashmentPayout query exactly. */
  async function fetchEncashmentPayout(empId, runId) {
    const { rows } = await db.query(
      `SELECT id, gross_amount, tds_amount FROM leave_encashment_requests
       WHERE tenant_id = $1 AND employee_id = $2 AND payroll_run_id = $3 AND status = 'approved'`,
      [tenantId, empId, runId],
    )
    if (!rows.length) return null
    return {
      request_ids: rows.map(r => r.id),
      gross: rows.reduce((s, r) => s + Number(r.gross_amount), 0),
      tds:   rows.reduce((s, r) => s + Number(r.tds_amount), 0),
    }
  }

  // ── A. Assign: happy path ────────────────────────────────────────────────
  console.log('\n[A] Assign: happy path sets payroll_run_id, status stays approved')
  const empA = await seedEmployee()
  const runA = await seedRun('draft')
  const slipA = await seedSlip(runA, empA)
  const reqA = await seedRequest(empA, { gross: 5000, tds: 500, days: 10 })
  {
    const { rows } = await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3) AS result`, [tenantId, reqA, runA])
    check('RPC returned a result', !!rows[0].result)
    const req = (await db.query(`SELECT status, payroll_run_id FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0]
    check("status stays 'approved' — not yet paid", req.status === 'approved')
    check('payroll_run_id is set to the assigned run', req.payroll_run_id === runA)
    const slip = (await db.query(`SELECT gross_pay FROM payroll_slips WHERE id = $1`, [slipA])).rows[0]
    check('payroll_slips row is completely untouched by assignment', Number(slip.gross_pay) === 50000)
  }

  // ── B. Assign refuses ────────────────────────────────────────────────────
  console.log('\n[B] Assign refuses invalid states, nothing written')
  {
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, '00000000-0000-0000-0000-000000000000', runA]) }
    catch (e) { err = e }
    check('unknown request raises NOT_FOUND', err && /NOT_FOUND/.test(err.message))
  }
  {
    const emp = await seedEmployee()
    const req = await seedRequest(emp)
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, '00000000-0000-0000-0000-000000000000']) }
    catch (e) { err = e }
    check('unknown run raises RUN_NOT_FOUND', err && /RUN_NOT_FOUND/.test(err.message))
    const after = (await db.query(`SELECT payroll_run_id FROM leave_encashment_requests WHERE id = $1`, [req])).rows[0]
    check('request left unassigned', after.payroll_run_id === null)
  }
  {
    const emp = await seedEmployee()
    const run = await seedRun('draft') // no payslip seeded for this employee in this run
    const req = await seedRequest(emp)
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run]) }
    catch (e) { err = e }
    check('run with no payslip for this employee raises NO_PAYSLIP', err && /NO_PAYSLIP/.test(err.message))
  }
  {
    const emp = await seedEmployee()
    const run = await seedRun('finalized')
    await seedSlip(run, emp)
    const req = await seedRequest(emp)
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run]) }
    catch (e) { err = e }
    check('finalized run raises RUN_NOT_DRAFT (not misclassified as RUN_NOT_FOUND)', err && /RUN_NOT_DRAFT/.test(err.message))
  }
  {
    // Already assigned to runA from test A — assigning again (to a second valid run) must refuse.
    const run2 = await seedRun('draft')
    await seedSlip(run2, empA)
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, reqA, run2]) }
    catch (e) { err = e }
    check('already-assigned request raises ALREADY_ASSIGNED', err && /ALREADY_ASSIGNED/.test(err.message))
    const after = (await db.query(`SELECT payroll_run_id FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0]
    check('original assignment (runA) is undisturbed', after.payroll_run_id === runA)
  }
  {
    const emp = await seedEmployee()
    const run = await seedRun('draft')
    await seedSlip(run, emp)
    const req = await seedRequest(emp)
    await db.query(`UPDATE leave_encashment_requests SET status = 'rejected' WHERE id = $1`, [req])
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run]) }
    catch (e) { err = e }
    check('non-approved request raises ALREADY_DECIDED', err && /ALREADY_DECIDED/.test(err.message))
  }
  {
    const emp = await seedEmployee()
    const run = await seedRun('draft')
    await seedSlip(run, emp)
    const { rows } = await db.query(
      `INSERT INTO leave_encashment_requests (tenant_id, employee_id, leave_type_id, year, days, status, tds_amount)
       VALUES ($1, $2, $3, $4, 5, 'approved', 0) RETURNING id`,
      [tenantId, emp, leaveTypeId, new Date().getFullYear()],
    )
    const req = rows[0].id // gross_amount left NULL — predates amount computation
    let err = null
    try { await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run]) }
    catch (e) { err = e }
    check('NULL gross_amount raises NOT_COMPUTED', err && /NOT_COMPUTED/.test(err.message))
  }

  // ── C. Regeneration-survival ─────────────────────────────────────────────
  console.log('\n[C] Regeneration-survival: payout source data outlives slip deletion/recreation')
  {
    const before = await fetchEncashmentPayout(empA, runA)
    check('fetchEncashmentPayout finds the assigned request pre-regeneration', before && before.gross === 5000 && before.tds === 500)

    // Simulate exactly what POST /payroll/runs's re-run path does to a draft
    // run: delete all slips, then recompute (re-insert) them.
    await db.query(`DELETE FROM payroll_slips WHERE run_id = $1`, [runA])
    const deleted = (await db.query(`SELECT count(*)::int AS n FROM payroll_slips WHERE run_id = $1`, [runA])).rows[0].n
    check('slip was actually deleted (simulating regeneration)', deleted === 0)

    const after = await fetchEncashmentPayout(empA, runA)
    check('fetchEncashmentPayout STILL finds the same gross/tds after slip deletion — nothing was lost', after && after.gross === before.gross && after.tds === before.tds)

    // Re-insert the slip (simulating the recompute half of the re-run) and
    // confirm the request is still flagged for it to pick up.
    const newSlip = await seedSlip(runA, empA)
    const afterRecreate = await fetchEncashmentPayout(empA, runA)
    check('after the slip is recreated, the payout is still there to fold in — migration 446 could not guarantee this', afterRecreate && afterRecreate.gross === 5000 && afterRecreate.tds === 500)
    check('request status is unaffected by the slip churn (still approved+assigned, not paid)',
      (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0].status === 'approved')
  }

  // ── C2. Deleting the assigned draft run preserves the entitlement ───────
  // Mirrors what POST /payroll/runs/:id (DELETE) actually does: a hard
  // DELETE on payroll_runs for a non-finalized run (apps/api/src/routes/
  // payroll/runs.ts ~L3956) — the FK's own ON DELETE SET NULL (446) and
  // the payroll_slips FK's ON DELETE CASCADE are relied on for cleanup.
  // "Cancelled/deleted runs must not lose the entitlement" means: after
  // deletion, the request is still 'approved' and simply unassigned
  // (payroll_run_id back to NULL) — not silently dropped, not left
  // dangling on a run_id that no longer exists.
  console.log('\n[C2] Deleting the assigned draft run preserves the entitlement (unassigns, does not lose it)')
  {
    const empDel = await seedEmployee()
    const runDel = await seedRun('draft')
    await seedSlip(runDel, empDel)
    const reqDel = await seedRequest(empDel, { gross: 4200, tds: 420, days: 7 })
    await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, reqDel, runDel])

    const before = (await db.query(`SELECT status, payroll_run_id, gross_amount, tds_amount FROM leave_encashment_requests WHERE id = $1`, [reqDel])).rows[0]
    check('precondition: request is approved and assigned to runDel before deletion', before.status === 'approved' && before.payroll_run_id === runDel)

    await db.query(`DELETE FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runDel, tenantId])
    const runGone = (await db.query(`SELECT 1 FROM payroll_runs WHERE id = $1`, [runDel])).rows.length === 0
    check('the run itself is actually gone', runGone)

    const after = (await db.query(`SELECT status, payroll_run_id, gross_amount, tds_amount FROM leave_encashment_requests WHERE id = $1`, [reqDel])).rows[0]
    check('request survives the run deletion (row not cascaded away)', !!after)
    check("status stays 'approved' — the entitlement itself is not lost", after.status === 'approved')
    check('payroll_run_id reset to NULL — unassigned, not dangling on a deleted run', after.payroll_run_id === null)
    check('gross/TDS figures untouched — ready to be assigned to a different run', Number(after.gross_amount) === Number(before.gross_amount) && Number(after.tds_amount) === Number(before.tds_amount))

    // And it really is re-assignable afterward — proving "preserved" means
    // actually usable, not just structurally present.
    const runDel2 = await seedRun('draft')
    await seedSlip(runDel2, empDel)
    const { rows: reassign } = await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3) AS result`, [tenantId, reqDel, runDel2])
    check('the preserved entitlement can be assigned to a fresh run afterward', !!reassign[0].result)
  }

  // ── D. Finalize flips only this run's approved+assigned requests ────────
  console.log('\n[D] fn_finalize_leave_encashments_for_run')
  {
    // A second, unrelated request assigned to a different run must not be touched.
    const empOther = await seedEmployee()
    const runOther = await seedRun('draft')
    await seedSlip(runOther, empOther)
    const reqOther = await seedRequest(empOther, { gross: 1000, tds: 100 })
    await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, reqOther, runOther])

    const { rows } = await db.query(`SELECT fn_finalize_leave_encashments_for_run($1,$2) AS n`, [tenantId, runA])
    check('finalize affected exactly the one request assigned to runA', rows[0].n === 1)

    const reqAAfter = (await db.query(`SELECT status, paid_at FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0]
    check("runA's request flipped to 'paid' with paid_at set", reqAAfter.status === 'paid' && reqAAfter.paid_at !== null)

    const reqOtherAfter = (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [reqOther])).rows[0]
    check("the other run's request is untouched (still 'approved')", reqOtherAfter.status === 'approved')

    // Idempotence: finalizing again affects nothing (already 'paid', not 'approved').
    const { rows: again } = await db.query(`SELECT fn_finalize_leave_encashments_for_run($1,$2) AS n`, [tenantId, runA])
    check('re-finalizing the same run is a no-op (0 rows) — no double side-effects', again[0].n === 0)
  }

  // ── E. Rollback reverts paid → approved, still assigned ──────────────────
  console.log('\n[E] fn_revert_leave_encashments_for_rollback')
  {
    const { rows } = await db.query(`SELECT fn_revert_leave_encashments_for_rollback($1,$2) AS n`, [tenantId, runA])
    check('rollback affected exactly the one paid request on runA', rows[0].n === 1)
    const req = (await db.query(`SELECT status, payroll_run_id, paid_at FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0]
    check("reverted to 'approved'", req.status === 'approved')
    check('still assigned to runA (next regeneration picks it up again)', req.payroll_run_id === runA)
    check('paid_at cleared', req.paid_at === null)
  }

  // ── F. Reverse: approved+assigned-but-not-paid ───────────────────────────
  console.log('\n[F] Reversal of an approved (assigned, not yet paid) request credits the balance back')
  {
    await db.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance)
       VALUES ($1, $2, $3, $4, 5) ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE SET balance = 5`,
      [tenantId, empA, leaveTypeId, new Date().getFullYear()],
    )
    const { rows } = await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4) AS result`, [tenantId, reqA, userId, 'approved in error'])
    check('reversal RPC returned a result', !!rows[0].result)
    const req = (await db.query(`SELECT status, payroll_run_id, reversed_by FROM leave_encashment_requests WHERE id = $1`, [reqA])).rows[0]
    check("status is 'reversed'", req.status === 'reversed')
    check('payroll_run_id cleared — no longer assigned', req.payroll_run_id === null)
    const bal = (await db.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`, [tenantId, empA, leaveTypeId])).rows[0]
    check('balance credited back by the full day count', Number(bal.balance) === 15)

    let retryErr = null
    try { await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, reqA, userId, 'second attempt']) }
    catch (e) { retryErr = e }
    check('re-reversing raises CONFLICT, no double credit', retryErr && /CONFLICT/.test(retryErr.message))
    const balAfterRetry = (await db.query(`SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`, [tenantId, empA, leaveTypeId])).rows[0]
    check('balance unchanged by the rejected retry', Number(balAfterRetry.balance) === 15)
  }

  // ── G. Reverse: paid request, run still draft → allowed ──────────────────
  console.log('\n[G] Reversal of a paid request is allowed while its run is still draft')
  {
    const emp = await seedEmployee()
    const run = await seedRun('draft')
    await seedSlip(run, emp)
    const req = await seedRequest(emp, { gross: 2000, tds: 200, days: 4 })
    await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run])
    await db.query(`SELECT fn_finalize_leave_encashments_for_run($1,$2)`, [tenantId, run]) // flips to paid
    // Run is finalized in the real flow before this step, but for this
    // check we leave it 'draft' at the DB level to isolate "paid but run
    // not finalized" from case H below.
    await db.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance)
       VALUES ($1, $2, $3, $4, 2) ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO UPDATE SET balance = 2`,
      [tenantId, emp, leaveTypeId, new Date().getFullYear()],
    )
    const { rows } = await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4) AS result`, [tenantId, req, userId, 'paid in error'])
    check('paid-but-run-still-draft reversal succeeds', !!rows[0].result)
    const after = (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [req])).rows[0]
    check("status is 'reversed'", after.status === 'reversed')
  }

  // ── H. Reverse refuses once the linked run is finalized ──────────────────
  console.log('\n[H] Reversal refuses once the linked run is actually finalized')
  {
    const emp = await seedEmployee()
    const run = await seedRun('draft')
    await seedSlip(run, emp)
    const req = await seedRequest(emp, { gross: 3000, tds: 300, days: 6 })
    await db.query(`SELECT assign_leave_encashment_to_payroll_run_atomic($1,$2,$3)`, [tenantId, req, run])
    await db.query(`SELECT fn_finalize_leave_encashments_for_run($1,$2)`, [tenantId, run])
    await db.query(`UPDATE payroll_runs SET status = 'finalized' WHERE id = $1`, [run])

    let err = null
    try { await db.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, req, userId, 'too late']) }
    catch (e) { err = e }
    check('raises PAYROLL_FINALIZED', err && /PAYROLL_FINALIZED/.test(err.message))
    const after = (await db.query(`SELECT status FROM leave_encashment_requests WHERE id = $1`, [req])).rows[0]
    check("request still 'paid' — the abort rolled back the status change too", after.status === 'paid')
  }

  await db.end()
  console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
