#!/usr/bin/env node
/**
 * Real-Postgres verification of SYSTEM_AUDIT_2026-10-14 item 2 (payroll
 * rollback transactionality) — migration 460's extension of
 * rollback_payroll_run_atomic (migration 452).
 *
 * Previously the atomic RPC locked the run, validated, and flipped status
 * to 'draft', then RETURNED — and the route went on to delete slips,
 * resync totals, revert leave encashments, and clean up unposted ledgers
 * as SEPARATE, uncoordinated calls after that commit. A crash between any
 * of them left a torn state (most seriously: a leave-encashment request
 * stuck 'paid' for a run whose slip no longer exists). Migration 460 folds
 * every one of those steps into the SAME transaction as the status flip.
 *
 * Proves, against a real Postgres transaction:
 *   A. Happy path: a single rollback call atomically flips status to
 *      'draft', deletes the run's slips, zeroes its totals, reverts a
 *      'paid' leave-encashment request back to 'approved', deletes its
 *      unposted (draft/balanced) ledger + entries + cost allocations, and
 *      archives its snapshot (replayable=false, run.snapshot_id cleared).
 *   B. Every guard still blocks, and blocking leaves NOTHING touched:
 *      a posted (non-reversal) ledger, a filed statutory closure, a
 *      'processing' run, and a non-super-admin on a finalized run.
 *   C. Real concurrency: rollback raced against mark_ledger_posted_atomic
 *      for the SAME run. Whichever call acquires the payroll_runs row lock
 *      first fully completes before the other proceeds — the loser always
 *      sees fresh, post-commit state and correctly refuses (never a torn
 *      "ledger posted AND run rolled back" or vice versa).
 *   D. Idempotent retry: calling rollback a second time on an
 *      already-'draft' run succeeds as a safe no-op — not an error, and
 *      nothing is double-deleted or double-reverted.
 *   E. A moderate-size run (500 slips) rolls back correctly and quickly.
 *
 * Usage: node scripts/db/verify-payroll-rollback-atomic.mjs
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const { Pool } = pg
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'hrms_uat',
})

let failures = 0
function check(label, cond, detail) {
  if (cond) console.log(`  OK   ${label}`)
  else { console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); failures++ }
}

async function rollback(client, tenantId, runId, isSuperAdmin) {
  try {
    const res = await client.query(
      `SELECT rollback_payroll_run_atomic($1,$2,$3) AS result`,
      [tenantId, runId, isSuperAdmin],
    )
    return { ok: true, result: res.rows[0].result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function makeTenant(client, name) {
  const id = randomUUID()
  await client.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`,
    [id, name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`])
  return id
}

async function makeEmployee(client, tenantId, idx) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,$4,$5,$6,'2020-01-01','active')`,
    [id, tenantId, `E${tenantId.slice(0, 6)}-${idx}`, `Emp${idx}`, `Test${idx}`, `emp${idx}-${id.slice(0, 6)}@test.local`],
  )
  return id
}

async function makeRun(client, tenantId, month, status = 'finalized') {
  const id = randomUUID()
  await client.query(
    `INSERT INTO payroll_runs (id, tenant_id, month, status, employee_count, total_gross, total_deductions, total_net, total_lop_amount, finalized_at)
     VALUES ($1,$2,$3,$4,0,0,0,0,0, CASE WHEN $4='finalized' THEN now() ELSE NULL END)`,
    [id, tenantId, month, status],
  )
  return id
}

async function makeSlip(client, tenantId, runId, employeeId, month, grossPay) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO payroll_slips (id, tenant_id, run_id, employee_id, month, gross_pay, net_pay, status)
     VALUES ($1,$2,$3,$4,$5,$6,$6,'finalized')`,
    [id, tenantId, runId, employeeId, month, grossPay],
  )
  return id
}

async function makeSnapshot(client, tenantId, runId, month) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO payroll_run_snapshots (id, tenant_id, run_id, month, replayable) VALUES ($1,$2,$3,$4,true)`,
    [id, tenantId, runId, month],
  )
  await client.query(`UPDATE payroll_runs SET snapshot_id = $1 WHERE id = $2`, [id, runId])
  return id
}

async function makeLedger(client, tenantId, runId, month, status) {
  const id = randomUUID()
  await client.query(
    `INSERT INTO payroll_financial_ledgers (id, tenant_id, run_id, ledger_month, ledger_status, total_debit, total_credit)
     VALUES ($1,$2,$3,$4,$5,1000,1000)`,
    [id, tenantId, runId, month, status],
  )
  return id
}

async function makeLedgerEntry(client, tenantId, ledgerId) {
  await client.query(
    `INSERT INTO payroll_ledger_entries (ledger_id, tenant_id, entry_type, entry_category, gl_account_code, gl_account_name, debit_amount, credit_amount)
     VALUES ($1,$2,'salary_expense','expense','5000','Salary Expense',1000,0)`,
    [ledgerId, tenantId],
  )
}

async function makeCostAllocation(client, tenantId, ledgerId) {
  await client.query(
    `INSERT INTO payroll_cost_allocations (ledger_id, tenant_id, gross_pay, net_pay, total_cost, allocation_pct)
     VALUES ($1,$2,1000,1000,1000,100)`,
    [ledgerId, tenantId],
  )
}

async function makeEncashment(client, tenantId, employeeId, runId, status = 'paid') {
  const leaveTypeId = randomUUID()
  await client.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'EL-enc',true)`, [leaveTypeId, tenantId])
  const id = randomUUID()
  await client.query(
    `INSERT INTO leave_encashment_requests (id, tenant_id, employee_id, leave_type_id, year, days, status, payroll_run_id, paid_at)
     VALUES ($1,$2,$3,$4,2026,5,$5,$6, CASE WHEN $5='paid' THEN now() ELSE NULL END)`,
    [id, tenantId, employeeId, leaveTypeId, status, runId],
  )
  return id
}

async function cleanupTenant(client, tenantId) {
  // A run intentionally left 'finalized' by a correctly-blocked rollback
  // attempt would otherwise make the cascade-delete below fail against
  // fn_block_finalized_payroll_run_mutation's own DELETE guard (migration
  // 263) — force it to 'draft' first; this is test teardown, not something
  // the behavior under test depends on.
  await client.query(`UPDATE payroll_runs SET status = 'draft' WHERE tenant_id = $1 AND status = 'finalized'`, [tenantId])
  await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
}

// ── Tests ────────────────────────────────────────────────────────────────

async function testHappyPathFullAtomicity(pool) {
  console.log('\n[A] Happy path: one call atomically does everything')
  const client = await pool.connect()
  try {
    const tenantId = await makeTenant(client, 'RollbackHappy')
    const empId = await makeEmployee(client, tenantId, 1)
    const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
    await makeSlip(client, tenantId, runId, empId, '2026-11', 50000)
    await makeSlip(client, tenantId, runId, await makeEmployee(client, tenantId, 2), '2026-11', 60000)
    await client.query(`UPDATE payroll_runs SET total_gross=110000, total_net=100000, total_deductions=10000, total_lop_amount=0, employee_count=2 WHERE id=$1`, [runId])
    const snapId = await makeSnapshot(client, tenantId, runId, '2026-11')
    const ledgerId = await makeLedger(client, tenantId, runId, '2026-11', 'balanced')
    await makeLedgerEntry(client, tenantId, ledgerId)
    await makeCostAllocation(client, tenantId, ledgerId)
    const encId = await makeEncashment(client, tenantId, empId, runId, 'paid')

    const { ok, result, error } = await rollback(client, tenantId, runId, true)
    check('A1: rollback succeeds', ok, error)
    check('A2: result reports encashments_reverted=1', ok && result.encashments_reverted === 1, JSON.stringify(result))
    check('A3: result reports unposted_ledgers_cleaned=1', ok && result.unposted_ledgers_cleaned === 1, JSON.stringify(result))

    const { rows: runRows } = await client.query(`SELECT status, total_gross, total_net, total_deductions, total_lop_amount, employee_count, snapshot_id, finalized_at FROM payroll_runs WHERE id=$1`, [runId])
    const run = runRows[0]
    check('A4: run.status = draft', run.status === 'draft', run.status)
    check('A5: totals zeroed', Number(run.total_gross) === 0 && Number(run.total_net) === 0 && Number(run.total_deductions) === 0 && Number(run.employee_count) === 0, JSON.stringify(run))
    check('A6: snapshot_id cleared', run.snapshot_id === null)
    check('A7: finalized_at cleared', run.finalized_at === null)

    const { rows: slipRows } = await client.query(`SELECT count(*)::int AS n FROM payroll_slips WHERE run_id=$1`, [runId])
    check('A8: all slips deleted', slipRows[0].n === 0, `${slipRows[0].n} remain`)

    const { rows: encRows } = await client.query(`SELECT status, paid_at FROM leave_encashment_requests WHERE id=$1`, [encId])
    check('A9: encashment reverted to approved, paid_at cleared', encRows[0].status === 'approved' && encRows[0].paid_at === null, JSON.stringify(encRows[0]))

    const { rows: ledgerRows } = await client.query(`SELECT count(*)::int AS n FROM payroll_financial_ledgers WHERE id=$1`, [ledgerId])
    check('A10: unposted ledger deleted', ledgerRows[0].n === 0)
    const { rows: entryRows } = await client.query(`SELECT count(*)::int AS n FROM payroll_ledger_entries WHERE ledger_id=$1`, [ledgerId])
    check('A11: its ledger entries deleted', entryRows[0].n === 0)
    const { rows: allocRows } = await client.query(`SELECT count(*)::int AS n FROM payroll_cost_allocations WHERE ledger_id=$1`, [ledgerId])
    check('A12: its cost allocations deleted', allocRows[0].n === 0)

    const { rows: snapRows } = await client.query(`SELECT replayable FROM payroll_run_snapshots WHERE id=$1`, [snapId])
    check('A13: snapshot marked non-replayable', snapRows[0].replayable === false)

    await cleanupTenant(client, tenantId)
  } finally {
    client.release()
  }
}

async function testGuardsBlockWithNoPartialEffect(pool) {
  console.log('\n[B] Every guard still blocks — and blocking leaves nothing touched')
  const client = await pool.connect()
  try {
    // B1: posted (non-reversal) ledger blocks.
    {
      const tenantId = await makeTenant(client, 'RollbackPostedLedger')
      const empId = await makeEmployee(client, tenantId, 1)
      const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
      await makeSlip(client, tenantId, runId, empId, '2026-11', 50000)
      const ledgerId = await makeLedger(client, tenantId, runId, '2026-11', 'posted')

      const { ok, error } = await rollback(client, tenantId, runId, true)
      check('B1a: blocked with LEDGER_POSTED', !ok && error.includes('LEDGER_POSTED'), error)
      const { rows } = await client.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
      check('B1b: run still finalized (nothing touched)', rows[0].status === 'finalized')
      const { rows: slipRows } = await client.query(`SELECT count(*)::int AS n FROM payroll_slips WHERE run_id=$1`, [runId])
      check('B1c: slip still exists', slipRows[0].n === 1)
      await cleanupTenant(client, tenantId)
    }

    // B2: filed statutory closure blocks.
    {
      const tenantId = await makeTenant(client, 'RollbackStatutoryFiled')
      const empId = await makeEmployee(client, tenantId, 1)
      const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
      await makeSlip(client, tenantId, runId, empId, '2026-11', 50000)
      await client.query(
        `INSERT INTO statutory_filing_closures (tenant_id, month, statutory_type, status, run_id) VALUES ($1,'2026-11','pf','filed',$2)`,
        [tenantId, runId],
      )
      const { ok, error } = await rollback(client, tenantId, runId, true)
      check('B2a: blocked with STATUTORY_FILING_EXISTS', !ok && error.includes('STATUTORY_FILING_EXISTS'), error)
      const { rows } = await client.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
      check('B2b: run still finalized (nothing touched)', rows[0].status === 'finalized')
      await cleanupTenant(client, tenantId)
    }

    // B3: processing run blocks.
    {
      const tenantId = await makeTenant(client, 'RollbackProcessing')
      const runId = await makeRun(client, tenantId, '2026-11', 'processing')
      const { ok, error } = await rollback(client, tenantId, runId, false)
      check('B3: blocked with PROCESSING', !ok && error.includes('PROCESSING'), error)
      await cleanupTenant(client, tenantId)
    }

    // B4: non-super-admin cannot roll back a finalized run.
    {
      const tenantId = await makeTenant(client, 'RollbackForbidden')
      const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
      const { ok, error } = await rollback(client, tenantId, runId, false)
      check('B4a: blocked with FORBIDDEN', !ok && error.includes('FORBIDDEN'), error)
      const { rows } = await client.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
      check('B4b: run still finalized', rows[0].status === 'finalized')
      // Confirm a super_admin CAN.
      const { ok: ok2 } = await rollback(client, tenantId, runId, true)
      check('B4c: super_admin succeeds on the same run', ok2)
      await cleanupTenant(client, tenantId)
    }
  } finally {
    client.release()
  }
}

async function testConcurrencyAgainstLedgerPost(pool) {
  console.log('\n[C] Real concurrency: rollback races mark_ledger_posted_atomic for the SAME run')
  const clientA = await pool.connect()
  const clientB = await pool.connect()
  try {
    const tenantId = await makeTenant(clientA, 'RollbackConcurrency')
    const empId = await makeEmployee(clientA, tenantId, 1)
    const runId = await makeRun(clientA, tenantId, '2026-11', 'finalized')
    await makeSlip(clientA, tenantId, runId, empId, '2026-11', 50000)
    const ledgerId = await makeLedger(clientA, tenantId, runId, '2026-11', 'balanced')

    const [rollbackOutcome, postOutcome] = await Promise.all([
      rollback(clientA, tenantId, runId, true),
      clientB.query(`SELECT mark_ledger_posted_atomic($1,$2,$3) AS result`, [tenantId, ledgerId, randomUUID()])
        .then((r) => ({ ok: true, result: r.rows[0].result }))
        .catch((err) => ({ ok: false, error: err.message })),
    ])

    const { rows: runRows } = await clientA.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    const { rows: ledgerRows } = await clientA.query(`SELECT ledger_status FROM payroll_financial_ledgers WHERE id=$1`, [ledgerId])
    const runStatus = runRows[0].status
    const ledgerExists = ledgerRows.length > 0

    if (rollbackOutcome.ok && !postOutcome.ok) {
      check('C1: rollback won the race — run is draft, ledger (unposted) was cleaned up by rollback, and the post attempt correctly failed', runStatus === 'draft' && !ledgerExists && postOutcome.error.includes('NOT_FOUND'), `runStatus=${runStatus} ledgerExists=${ledgerExists} postError=${postOutcome.error}`)
    } else if (!rollbackOutcome.ok && postOutcome.ok) {
      check('C1: ledger-post won the race — ledger is posted, run is still finalized, and rollback correctly refused with LEDGER_POSTED', runStatus === 'finalized' && ledgerExists && rollbackOutcome.error.includes('LEDGER_POSTED'), `runStatus=${runStatus} ledgerExists=${ledgerExists} rollbackError=${rollbackOutcome.error}`)
    } else {
      check('C1: exactly one of the two concurrent operations succeeded (never both, never neither)', false, `rollback.ok=${rollbackOutcome.ok} post.ok=${postOutcome.ok}`)
    }

    await cleanupTenant(clientA, tenantId)
  } finally {
    clientA.release()
    clientB.release()
  }
}

async function testIdempotentRetry(pool) {
  console.log('\n[D] Idempotent retry: rolling back an already-draft run is a safe no-op')
  const client = await pool.connect()
  try {
    const tenantId = await makeTenant(client, 'RollbackRetry')
    const empId = await makeEmployee(client, tenantId, 1)
    const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
    await makeSlip(client, tenantId, runId, empId, '2026-11', 50000)
    const encId = await makeEncashment(client, tenantId, empId, runId, 'paid')

    const first = await rollback(client, tenantId, runId, true)
    check('D1: first rollback succeeds', first.ok, first.error)
    check('D2: first rollback reverted the encashment', first.ok && first.result.encashments_reverted === 1)

    const second = await rollback(client, tenantId, runId, false)
    check('D3: second rollback (retry) also succeeds — not an error', second.ok, second.error)
    check('D4: second rollback reverts nothing further (already approved)', second.ok && second.result.encashments_reverted === 0, JSON.stringify(second.result))

    const { rows: encRows } = await client.query(`SELECT status FROM leave_encashment_requests WHERE id=$1`, [encId])
    check('D5: encashment still just \'approved\' once, not double-touched', encRows[0].status === 'approved')

    await cleanupTenant(client, tenantId)
  } finally {
    client.release()
  }
}

async function testModerateScale(pool) {
  console.log('\n[E] Moderate-size run (500 slips) rolls back correctly')
  const client = await pool.connect()
  try {
    const tenantId = await makeTenant(client, 'RollbackScale')
    const runId = await makeRun(client, tenantId, '2026-11', 'finalized')
    const empIds = []
    for (let i = 0; i < 500; i++) empIds.push(await makeEmployee(client, tenantId, i))
    for (const empId of empIds) await makeSlip(client, tenantId, runId, empId, '2026-11', 40000)

    const t0 = Date.now()
    const { ok, error } = await rollback(client, tenantId, runId, true)
    const elapsedMs = Date.now() - t0
    check('E1: rollback succeeds for a 500-slip run', ok, error)
    console.log(`    (elapsed: ${elapsedMs}ms for 500 slips)`)

    const { rows } = await client.query(`SELECT count(*)::int AS n FROM payroll_slips WHERE run_id=$1`, [runId])
    check('E2: all 500 slips deleted', rows[0].n === 0, `${rows[0].n} remain`)

    await cleanupTenant(client, tenantId)
  } finally {
    client.release()
  }
}

async function main() {
  console.log(`--- verify-payroll-rollback-atomic.mjs against ${process.env.PGDATABASE || 'hrms_uat'} ---`)
  await testHappyPathFullAtomicity(pool)
  await testGuardsBlockWithNoPartialEffect(pool)
  await testConcurrencyAgainstLedgerPost(pool)
  await testIdempotentRetry(pool)
  await testModerateScale(pool)

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
  await pool.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
