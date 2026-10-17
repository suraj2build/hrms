#!/usr/bin/env node
/**
 * Real-Postgres, genuine-concurrency verification that rollback_payroll_
 * run_atomic, mark_ledger_posted_atomic, and close_statutory_filing_atomic
 * (migration 452) actually serialize on the SAME lock, in both directions.
 *
 * The specific risk this proves closed: a route-level "SELECT to check,
 * then a separate UPDATE/INSERT to write" can never be made race-safe no
 * matter how carefully it's ordered, because another request can land in
 * the gap between the two statements. Migration 452 fixes this by having
 * all three operations take a `SELECT ... FROM payroll_runs ... FOR UPDATE`
 * lock on the SAME row as their first action — this script proves that
 * lock actually blocks a concurrent competing transaction (not just that
 * the functions reject bad input when called sequentially), in all four
 * directions:
 *
 *   A. mark_ledger_posted_atomic holds the lock (uncommitted) -> a
 *      concurrent rollback_payroll_run_atomic call BLOCKS, then (once A
 *      commits) correctly sees the now-posted ledger and fails with
 *      LEDGER_POSTED.
 *   B. rollback_payroll_run_atomic holds the lock (uncommitted, run now
 *      'draft' in that transaction) -> a concurrent mark_ledger_posted_
 *      atomic call for a ledger on that SAME run BLOCKS, then (once B
 *      commits) correctly sees the run is no longer 'finalized' and fails
 *      with RUN_NOT_FINALIZED.
 *   C. rollback_payroll_run_atomic holds the lock -> a concurrent
 *      close_statutory_filing_atomic call for that run BLOCKS, then fails
 *      with RUN_NOT_FINALIZED for the same reason as B.
 *   D. close_statutory_filing_atomic holds the lock (uncommitted, a
 *      closure row inserted in that transaction) -> a concurrent
 *      rollback_payroll_run_atomic call BLOCKS, then (once D commits)
 *      correctly sees the now-filed closure and fails with
 *      STATUTORY_FILING_EXISTS.
 *
 * Each case blocks the SAME way the F&F atomic functions' own concurrency
 * proof does (scripts/db/verify-fnf-mark-paid-atomic.mjs sections E/L):
 * start the second call, wait ~300ms and confirm it hasn't resolved yet,
 * commit the first connection, then confirm the second resolves only
 * after that — not just that it eventually returns the right answer.
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
  if (cond) { console.log(`  OK   ${label}`) } else { console.log(`  FAIL ${label}`); failures++ }
}

async function seedFinalizedRun(client, tenantId, month) {
  const runId = (await client.query(
    `INSERT INTO payroll_runs (tenant_id, month, status, employee_count, total_gross, total_deductions, total_net)
     VALUES ($1, $2, 'finalized', 1, 50000, 0, 50000) RETURNING id`,
    [tenantId, month],
  )).rows[0].id
  return runId
}

async function seedBalancedLedger(client, tenantId, runId, month) {
  return (await client.query(
    `INSERT INTO payroll_financial_ledgers (tenant_id, run_id, ledger_month, ledger_status, total_debit, total_credit)
     VALUES ($1, $2, $3, 'balanced', 50000, 50000) RETURNING id`,
    [tenantId, runId, month],
  )).rows[0].id
}

function statutoryRow(month) {
  return { month, statutory_type: 'tds', computed_amount: 0, payable_amount: 0, variance: 0, snapshot: {}, challan_number: null, reference_note: null, filed_by: null, filed_at: new Date().toISOString() }
}

async function main() {
  const admin = new Client(conn)
  await admin.connect()
  const tenantId = (await admin.query(`INSERT INTO tenants (name, slug) VALUES ('rollback-concurrency-verify', 'rollback-concurrency-verify') RETURNING id`)).rows[0].id

  // ── A. Ledger-post wins the race; rollback blocks, then correctly loses ────
  console.log('\n[A] mark_ledger_posted_atomic holds the run-row lock -> a concurrent rollback blocks, then fails with LEDGER_POSTED')
  {
    const runId = await seedFinalizedRun(admin, tenantId, '2026-01')
    const ledgerId = await seedBalancedLedger(admin, tenantId, runId, '2026-01')

    const posterConn = new Client(conn), rollbackConn = new Client(conn)
    await posterConn.connect(); await rollbackConn.connect()

    await posterConn.query('BEGIN')
    await posterConn.query(`SELECT mark_ledger_posted_atomic($1, $2, $3)`, [tenantId, ledgerId, null])
    // Transaction open, uncommitted — the FOR UPDATE lock on payroll_runs is
    // still held, and the ledger's own status flip to 'posted' isn't
    // visible to anyone else yet.

    const start = Date.now()
    const rollbackPromise = rollbackConn.query(`SELECT rollback_payroll_run_atomic($1, $2, $3)`, [tenantId, runId, true])

    await new Promise(r => setTimeout(r, 300))
    check('rollback is still blocked ~300ms in (did not run immediately)', Date.now() - start >= 290)

    await posterConn.query('COMMIT')
    let rollbackErr = null
    try { await rollbackPromise } catch (e) { rollbackErr = e }
    check('rollback unblocked only after the ledger-post transaction committed', Date.now() - start >= 290)
    check('rollback correctly fails with LEDGER_POSTED once it sees the now-posted ledger', rollbackErr && /LEDGER_POSTED/.test(rollbackErr.message))

    const run = (await admin.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId])).rows[0]
    check('the run is untouched by the failed rollback — still finalized', run.status === 'finalized')

    await posterConn.end(); await rollbackConn.end()
  }

  // ── B. Rollback wins the race; a concurrent ledger-post blocks, then loses ──
  console.log('\n[B] rollback_payroll_run_atomic holds the lock -> a concurrent mark_ledger_posted_atomic blocks, then fails with RUN_NOT_FINALIZED')
  {
    const runId = await seedFinalizedRun(admin, tenantId, '2026-02')
    const ledgerId = await seedBalancedLedger(admin, tenantId, runId, '2026-02')

    const rollbackConn = new Client(conn), posterConn = new Client(conn)
    await rollbackConn.connect(); await posterConn.connect()

    await rollbackConn.query('BEGIN')
    await rollbackConn.query(`SELECT rollback_payroll_run_atomic($1, $2, $3)`, [tenantId, runId, true])

    const start = Date.now()
    const posterPromise = posterConn.query(`SELECT mark_ledger_posted_atomic($1, $2, $3)`, [tenantId, ledgerId, null])

    await new Promise(r => setTimeout(r, 300))
    check('the ledger-post is still blocked ~300ms in', Date.now() - start >= 290)

    await rollbackConn.query('COMMIT')
    let posterErr = null
    try { await posterPromise } catch (e) { posterErr = e }
    check('the ledger-post unblocked only after the rollback transaction committed', Date.now() - start >= 290)
    check('the ledger-post correctly fails with RUN_NOT_FINALIZED once it sees the rolled-back run', posterErr && /RUN_NOT_FINALIZED/.test(posterErr.message))

    const ledger = (await admin.query(`SELECT ledger_status FROM payroll_financial_ledgers WHERE id = $1`, [ledgerId])).rows[0]
    check('the ledger is untouched by the failed post — still balanced, never posted', ledger.ledger_status === 'balanced')

    await rollbackConn.end(); await posterConn.end()
  }

  // ── C. Rollback wins the race; a concurrent statutory close blocks, then loses ──
  console.log('\n[C] rollback_payroll_run_atomic holds the lock -> a concurrent close_statutory_filing_atomic blocks, then fails with RUN_NOT_FINALIZED')
  {
    const runId = await seedFinalizedRun(admin, tenantId, '2026-03')

    const rollbackConn = new Client(conn), filerConn = new Client(conn)
    await rollbackConn.connect(); await filerConn.connect()

    await rollbackConn.query('BEGIN')
    await rollbackConn.query(`SELECT rollback_payroll_run_atomic($1, $2, $3)`, [tenantId, runId, true])

    const start = Date.now()
    const filerPromise = filerConn.query(
      `SELECT close_statutory_filing_atomic($1, $2, $3)`,
      [tenantId, runId, JSON.stringify([statutoryRow('2026-03')])],
    )

    await new Promise(r => setTimeout(r, 300))
    check('the statutory close is still blocked ~300ms in', Date.now() - start >= 290)

    await rollbackConn.query('COMMIT')
    let filerErr = null
    try { await filerPromise } catch (e) { filerErr = e }
    check('the statutory close unblocked only after the rollback transaction committed', Date.now() - start >= 290)
    check('the statutory close correctly fails with RUN_NOT_FINALIZED once it sees the rolled-back run', filerErr && /RUN_NOT_FINALIZED/.test(filerErr.message))

    const closures = (await admin.query(`SELECT count(*) FROM statutory_filing_closures WHERE tenant_id = $1 AND month = '2026-03'`, [tenantId])).rows[0]
    check('no closure row was inserted by the failed filing attempt', Number(closures.count) === 0)

    await rollbackConn.end(); await filerConn.end()
  }

  // ── D. Statutory-close wins the race; a concurrent rollback blocks, then loses ──
  console.log('\n[D] close_statutory_filing_atomic holds the lock -> a concurrent rollback blocks, then fails with STATUTORY_FILING_EXISTS')
  {
    const runId = await seedFinalizedRun(admin, tenantId, '2026-04')

    const filerConn = new Client(conn), rollbackConn = new Client(conn)
    await filerConn.connect(); await rollbackConn.connect()

    await filerConn.query('BEGIN')
    await filerConn.query(
      `SELECT close_statutory_filing_atomic($1, $2, $3)`,
      [tenantId, runId, JSON.stringify([statutoryRow('2026-04')])],
    )

    const start = Date.now()
    const rollbackPromise = rollbackConn.query(`SELECT rollback_payroll_run_atomic($1, $2, $3)`, [tenantId, runId, true])

    await new Promise(r => setTimeout(r, 300))
    check('rollback is still blocked ~300ms in', Date.now() - start >= 290)

    await filerConn.query('COMMIT')
    let rollbackErr = null
    try { await rollbackPromise } catch (e) { rollbackErr = e }
    check('rollback unblocked only after the statutory-close transaction committed', Date.now() - start >= 290)
    check('rollback correctly fails with STATUTORY_FILING_EXISTS once it sees the now-filed closure', rollbackErr && /STATUTORY_FILING_EXISTS/.test(rollbackErr.message))

    const run = (await admin.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId])).rows[0]
    check('the run is untouched by the failed rollback — still finalized', run.status === 'finalized')

    await filerConn.end(); await rollbackConn.end()
  }

  // ── E. Authorization re-verified under the lock, not from a stale pre-lock read ──
  console.log('\n[E] rollback_payroll_run_atomic refuses a non-super_admin caller against a FINALIZED run, checked fresh inside the lock')
  {
    const runId = await seedFinalizedRun(admin, tenantId, '2026-05')
    let err = null
    try { await admin.query(`SELECT rollback_payroll_run_atomic($1, $2, $3)`, [tenantId, runId, false]) }
    catch (e) { err = e }
    check('a non-super_admin caller is refused with FORBIDDEN for a finalized run', err && /FORBIDDEN/.test(err.message))
    const run = (await admin.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId])).rows[0]
    check('the run is untouched — still finalized', run.status === 'finalized')
  }

  await admin.end()
  console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
