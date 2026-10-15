#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 9 — real-Postgres proof for migration
 * 463's recheck_attendance_lock_for_finalize, called by POST /payroll/runs/
 * :id/finalize right before Step 1 to close the gap the user's acceptance
 * criteria named directly: "Payroll finalization must calculate from the
 * protected state — not persist results calculated before acquiring the
 * lock."
 *
 *   A. No attendance_period_locks row at all -> refused (ATTENDANCE_REOPENED).
 *   B. Locked -> succeeds, returns the current state.
 *   C. Reopened (unlocked) after B -> refused again — proves this is a live
 *      re-check, not a cached/stale read.
 *   D. The recheck genuinely shares migration 462's advisory lock with the
 *      period-lock writer side: while the recheck's transaction holds the
 *      lock open, a concurrent lock_period_atomic call for the SAME month
 *      is shown blocked in pg_locks (not just slow) until the recheck's
 *      transaction ends.
 */
import pg from 'pg'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })
function uuid() { return crypto.randomUUID() }

async function main() {
  const tenantId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'FinalizeRecheck','fr-${Date.now()}','active')`, [tenantId])

  // Part A: state is OPEN (no row) -> refused
  let refusedNoRow = false
  try {
    await pool.query(`SELECT recheck_attendance_lock_for_finalize($1,'2106-01')`, [tenantId])
  } catch (err) {
    refusedNoRow = /ATTENDANCE_REOPENED/.test(err.message)
  }
  console.log('Part A — no lock row at all -> refused:', refusedNoRow ? 'PASS' : 'FAIL')

  // Part B: lock it, then recheck succeeds
  await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,'2106-01','LOCKED')`, [tenantId])
  let succeeded = false
  try {
    const { rows } = await pool.query(`SELECT recheck_attendance_lock_for_finalize($1,'2106-01') AS r`, [tenantId])
    succeeded = rows[0].r.state === 'LOCKED'
  } catch (err) { console.log('unexpected error', err.message) }
  console.log('Part B — LOCKED -> succeeds:', succeeded ? 'PASS' : 'FAIL')

  // Part C: unlock it -> refused again
  await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month='2106-01'`, [tenantId])
  let refusedReopened = false
  try {
    await pool.query(`SELECT recheck_attendance_lock_for_finalize($1,'2106-01')`, [tenantId])
  } catch (err) {
    refusedReopened = /ATTENDANCE_REOPENED/.test(err.message)
  }
  console.log('Part C — reopened -> refused:', refusedReopened ? 'PASS' : 'FAIL')

  // Part D: the recheck genuinely shares the lock with lock_period_atomic —
  // hold the recheck's advisory lock open in a transaction, confirm a
  // concurrent lock_period_atomic call for the SAME month blocks (pg_locks).
  await pool.query(`UPDATE attendance_period_locks SET state='LOCKED' WHERE tenant_id=$1 AND period_month='2106-01'`, [tenantId])
  const connA = new pg.Client({ connectionString: DB_URL })
  await connA.connect()
  const { rows: [{ pid: pidA }] } = await connA.query('SELECT pg_backend_pid() AS pid')
  await connA.query('BEGIN')
  await connA.query(`SELECT recheck_attendance_lock_for_finalize($1,'2106-01')`, [tenantId])
  // not committed yet — lock held open

  const connB = new pg.Client({ connectionString: DB_URL })
  await connB.connect()
  const { rows: [{ pid: pidB }] } = await connB.query('SELECT pg_backend_pid() AS pid')
  const lockPromise = connB.query(`SELECT lock_period_atomic($1,'2106-01',$2,'concurrent unlock attempt')`, [tenantId, uuid()])
    .catch((e) => ({ _error: e }))

  let sawBlocked = false
  for (let i = 0; i < 40; i++) {
    const { rows } = await pool.query(`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND pid=$1 AND granted=false`, [pidB])
    if (Number(rows[0].n) > 0) { sawBlocked = true; break }
    await new Promise(r => setTimeout(r, 25))
  }
  console.log('Part D — concurrent lock_period_atomic blocks while recheck holds the lock:', sawBlocked ? 'PASS' : 'FAIL')
  await connA.query('COMMIT')
  await connA.end()
  await lockPromise
  await connB.end()

  const ok = refusedNoRow && succeeded && refusedReopened && sawBlocked
  console.log(ok ? '\nALL PARTS PASS' : '\nFAIL')
  await pool.end()
  process.exit(ok ? 0 : 1)
}
main().catch((err) => { console.error(err); process.exit(1) })
