#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10 — the user correctly rejected
 * checkpoint 9's recheck_attendance_lock_for_finalize (migration 463) as
 * a real fix: it acquired the shared advisory lock, re-read the state,
 * and RETURNED — committing its own tiny transaction and releasing the
 * lock immediately, with the actual financial writes (the route's old
 * separate Step 1 / Step 2 calls) happening later, unprotected. This
 * script proves BOTH halves of the fix:
 *
 *   PART 1 (negative control) — replays checkpoint 9's exact pattern by
 *   hand: call recheck_attendance_lock_for_finalize (confirms LOCKED,
 *   then releases its lock on return), pause, let a concurrent unlock
 *   land, THEN perform the old-style Step 1/Step 2 raw UPDATEs with no
 *   further check. This is shown to SUCCEED and seal stale payroll —
 *   proving the gap the user flagged was real, not hypothetical, and
 *   that checkpoint 9 alone did not close it.
 *
 *   PART 2 (positive proof) — migration 464's finalize_payroll_run_atomic
 *   fuses the lock acquisition, the state re-check, and BOTH seal writes
 *   into one transaction. While that transaction is open (not yet
 *   committed), a concurrent unlock_period_atomic call for the same
 *   month is shown GENUINELY BLOCKED in pg_locks (not just slow). Only
 *   after the finalize transaction commits does the unlock proceed —
 *   i.e. there is no window for a reopen to land between "confirmed
 *   locked" and "sealed." The committed payroll is proven non-stale:
 *   finalize either fully commits against a lock no one disturbed, or
 *   never starts because the unlock already won — never a hybrid.
 *
 *   PART 3 (control) — reopening BEFORE a fresh finalize attempt starts
 *   is refused outright by the real RPC, confirming the gate itself
 *   still works end-to-end.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })
function uuid() { return crypto.randomUUID() }

async function seedTenant() {
  const tenantId = uuid()
  const userId = uuid()
  const empId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Finalize Seal Verify','fsv-${Date.now()}','active')`, [tenantId])
  await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'fsv-${Date.now()}@test.local')`, [userId])
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'FSV001','Seal','Verify','fsv@fsv-verify.test', CURRENT_DATE, 'active')`, [empId, tenantId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'hr_admin','FSV','fsv@fsv-verify.test', true)`, [userId, tenantId, empId])
  return { tenantId, userId, empId }
}

async function seedDraftRun(tenantId, empId, userId, month) {
  const runId = uuid()
  await pool.query(
    `INSERT INTO payroll_runs (id, tenant_id, month, status, created_by) VALUES ($1,$2,$3,'draft',$4)`,
    [runId, tenantId, month, userId],
  )
  await pool.query(
    `INSERT INTO payroll_slips (id, tenant_id, run_id, employee_id, month, gross_pay, net_pay, status)
     VALUES ($1,$2,$3,$4,$5,50000,45000,'draft')`,
    [uuid(), tenantId, runId, empId, month],
  )
  return runId
}

async function waitUntilBlocked(pid, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND pid=$1 AND granted=false`, [pid])
    if (Number(rows[0].n) > 0) return true
    await new Promise(r => setTimeout(r, 25))
  }
  return false
}

async function main() {
  const { tenantId, userId, empId } = await seedTenant()
  let allOk = true

  // ── PART 1: negative control — replays checkpoint 9's exact broken pattern ──
  console.log('=== PART 1 (negative control): checkpoint 9\'s split recheck+persist pattern lets stale payroll commit ===')
  {
    const month = '2107-01'
    const runId = await seedDraftRun(tenantId, empId, userId, month)
    await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED')`, [tenantId, month])

    // Step A: the OLD recheck call — confirms LOCKED, then returns (its own
    // tiny transaction commits here, releasing the advisory lock).
    const { rows: [recheckRow] } = await pool.query(`SELECT recheck_attendance_lock_for_finalize($1,$2) AS r`, [tenantId, month])
    console.log('recheck (old pattern) confirmed:', recheckRow.r)

    // Step B: a concurrent unlock lands in the now-unprotected gap.
    await pool.query(`SELECT unlock_period_atomic($1,$2,$3,'concurrent reopen, old pattern')`, [tenantId, month, userId])
    const { rows: [afterUnlock] } = await pool.query(`SELECT state FROM attendance_period_locks WHERE tenant_id=$1 AND period_month=$2`, [tenantId, month])
    console.log('period state after the concurrent unlock:', afterUnlock.state)

    // Step C: the OLD Step 1/Step 2 — no further check, just the raw seals
    // checkpoint 9's route used to perform after the recheck returned.
    await pool.query(`UPDATE payroll_slips SET status='finalized' WHERE run_id=$1 AND tenant_id=$2 AND status='draft'`, [runId, tenantId])
    await pool.query(`UPDATE payroll_runs SET status='finalized', finalized_by=$1, finalized_at=now() WHERE id=$2 AND tenant_id=$3 AND status IN ('draft','partial_failed')`, [userId, runId, tenantId])

    const { rows: [sealedRun] } = await pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    const bugReproduced = afterUnlock.state === 'OPEN' && sealedRun.status === 'finalized'
    console.log('OLD pattern result — period OPEN yet payroll sealed anyway:', bugReproduced ? 'CONFIRMED (this is the real gap the user flagged)' : 'not reproduced')
    allOk = allOk && bugReproduced
  }

  // ── PART 2: positive proof — the fused RPC closes the gap ──────────────────
  console.log('\n=== PART 2: finalize_payroll_run_atomic blocks a concurrent unlock for its whole transaction ===')
  {
    const month = '2107-02'
    const runId = await seedDraftRun(tenantId, empId, userId, month)
    await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED')`, [tenantId, month])

    const connA = new pg.Client({ connectionString: DB_URL })
    await connA.connect()
    await connA.query('BEGIN')
    await connA.query(`SELECT finalize_payroll_run_atomic($1,$2,$3,$4,true)`, [tenantId, runId, month, userId])
    // Not committed yet — the advisory lock for 2107-02 is held open inside
    // this still-in-flight transaction. This is the "paused after
    // validation, before the transaction ends" moment the fused design
    // makes impossible to interleave into.

    const connB = new pg.Client({ connectionString: DB_URL })
    await connB.connect()
    const { rows: [{ pid: pidB }] } = await connB.query('SELECT pg_backend_pid() AS pid')
    const unlockPromise = connB.query(`SELECT unlock_period_atomic($1,$2,$3,'attempt reopen mid-finalize')`, [tenantId, month, userId])
      .catch(e => ({ _error: e }))

    const sawBlocked = await waitUntilBlocked(pidB)
    console.log('concurrent unlock attempt is genuinely blocked (pg_locks) while finalize is in-flight:', sawBlocked ? 'PASS' : 'FAIL')

    await connA.query('COMMIT')
    await connA.end()
    await unlockPromise   // now proceeds, AFTER finalize already committed
    await connB.end()

    const { rows: [finalRun] } = await pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    const { rows: [finalSlip] } = await pool.query(`SELECT status FROM payroll_slips WHERE run_id=$1`, [runId])
    const { rows: [finalLockState] } = await pool.query(`SELECT state FROM attendance_period_locks WHERE tenant_id=$1 AND period_month=$2`, [tenantId, month])
    console.log('persisted — run:', finalRun.status, '| slip:', finalSlip.status, '| period (now open, AFTER the seal):', finalLockState.state)

    const sealedBeforeReopen = finalRun.status === 'finalized' && finalSlip.status === 'finalized' && finalLockState.state === 'OPEN'
    console.log('stale payroll did NOT commit — finalize fully sealed under an undisturbed lock, reopen only took effect afterward:', sealedBeforeReopen && sawBlocked ? 'PASS' : 'FAIL')
    allOk = allOk && sawBlocked && sealedBeforeReopen
  }

  // ── PART 3: control — reopening BEFORE a fresh finalize attempt refuses it ──
  console.log('\n=== PART 3: reopening before finalize starts is refused outright ===')
  {
    const month = '2107-03'
    const runId = await seedDraftRun(tenantId, empId, userId, month)
    await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'OPEN')`, [tenantId, month])

    let refused = false
    try {
      await pool.query(`SELECT finalize_payroll_run_atomic($1,$2,$3,$4,true)`, [tenantId, runId, month, userId])
    } catch (err) {
      refused = /ATTENDANCE_REOPENED/.test(err.message)
    }
    const { rows: [stillDraft] } = await pool.query(`SELECT status FROM payroll_runs WHERE id=$1`, [runId])
    console.log('refused with ATTENDANCE_REOPENED, run stays draft:', refused, stillDraft.status, (refused && stillDraft.status === 'draft') ? 'PASS' : 'FAIL')
    allOk = allOk && refused && stillDraft.status === 'draft'
  }

  console.log(allOk ? '\nALL PARTS PASS (Part 1 is a confirmed-bug negative control, not a failure of this round\'s fix)' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
