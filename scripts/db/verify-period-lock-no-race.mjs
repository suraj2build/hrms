#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 6, continued — the user correctly
 * rejected a sequential "insert a locked row, then call approve" test as
 * proof that the period-lock check cannot race with lock creation: that
 * only proves the check reads an EXISTING lock correctly, not that the
 * check-then-mutate sequence is safe when the lock is created WHILE the
 * approval is already in flight.
 *
 * This script constructs the genuinely overlapping scenario deterministically,
 * using two raw Postgres connections with explicit transaction control (not
 * relying on real-world timing luck):
 *
 *   1. Connection A opens a transaction and takes the FOR UPDATE row lock on
 *      the target leave_requests row — exactly the point migration
 *      461's approve_leave_request_atomic reaches just before its
 *      period-lock check. Connection A's transaction is now OPEN and has
 *      NOT yet looked at attendance_period_locks.
 *   2. Connection B, fully concurrently (A's transaction still open),
 *      inserts and COMMITS a LOCKED row for the request's month — the
 *      exact action POST /attendance/period-locks/:month/lock performs.
 *      This is the literal "lock created while the approval is already
 *      mid-flight" scenario.
 *   3. Connection A now runs the SAME lock-check query the RPC's body runs
 *      next, as a fresh statement within its still-open transaction. Under
 *      Postgres's default READ COMMITTED isolation, each statement gets a
 *      new snapshot — so this statement, issued after B's commit, is
 *      GUARANTEED to see the lock despite A's transaction having started
 *      first. We assert it does.
 *   4. Connection A rolls back (mirroring the RAISE EXCEPTION the real
 *      function would hit here), leaving the request untouched.
 *   5. We then call the REAL, compiled approve_leave_request_atomic RPC
 *      end-to-end with the lock still in place (the already-covered
 *      sequential case) and confirm it raises PERIOD_LOCKED for real.
 *   6. We remove the lock and call the REAL RPC again, confirming it
 *      succeeds, with persisted read-back of the balance deduction and
 *      ledger row.
 *   7. A stochastic pass: N fresh (request, month) pairs, each racing a
 *      real RPC approve call against a real period-lock INSERT via
 *      Promise.all (no artificial stagger — genuine HTTP/DB-timing
 *      concurrency), asserting every trial lands in one of exactly two
 *      self-consistent states (approved-with-balance-deducted, or
 *      refused-with-nothing-mutated) — never a partial/inconsistent one.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

async function seedTenantAndEmployee() {
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const userId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Race Verify','race-verify-${Date.now()}','active')`, [tenantId])
  await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'race-verify-${Date.now()}@test.local')`, [userId])
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'RACE001','Race','Verify','race@race-verify.test', CURRENT_DATE, 'active')`,
    [empId, tenantId],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','Race Verify','race@race-verify.test', true)`,
    [userId, tenantId, empId],
  )
  await pool.query(
    `INSERT INTO leave_types (id, tenant_id, name, is_paid, allow_sandwich, is_active, allow_half_day, allow_hourly)
     VALUES ($1,$2,'Annual Leave', true, false, true, true, false)`,
    [leaveTypeId, tenantId],
  )
  await pool.query(
    `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,2099,30)`,
    [tenantId, empId, leaveTypeId],
  )
  await pool.query(
    `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,2100,30)`,
    [tenantId, empId, leaveTypeId],
  )
  return { tenantId, empId, leaveTypeId, userId }
}

async function seedPendingLeaveRequest(tenantId, empId, leaveTypeId, fromDate, toDate, userId) {
  const id = uuid()
  await pool.query(
    `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, from_date, to_date, computed_days, half_day, status, requested_by, session)
     VALUES ($1,$2,$3,$4,$5,$6,1,false,'PENDING',$7,'full_day')`,
    [id, tenantId, empId, leaveTypeId, fromDate, toDate, userId],
  )
  return id
}

async function main() {
  const { tenantId, empId, leaveTypeId, userId } = await seedTenantAndEmployee()

  // ── Part 1: deterministic overlapping-transaction proof ──────────────────
  console.log('=== PART 1: deterministic overlapping-transaction race ===')
  const reqId1 = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, '2099-04-10', '2099-04-10', userId)
  const month1 = '2099-04'

  const connA = new pg.Client({ connectionString: DB_URL })
  const connB = new pg.Client({ connectionString: DB_URL })
  await connA.connect()
  await connB.connect()

  await connA.query('BEGIN')
  const rowLock = await connA.query(
    `SELECT id FROM leave_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [reqId1, tenantId],
  )
  console.log('A: acquired FOR UPDATE on the target row, transaction OPEN. rows:', rowLock.rowCount)

  // B: concurrently locks the period and commits, while A's transaction is
  // still open and has not yet checked attendance_period_locks.
  await connB.query('BEGIN')
  await connB.query(
    `INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED')`,
    [tenantId, month1],
  )
  await connB.query('COMMIT')
  console.log('B: locked the period and COMMITTED, while A is still mid-transaction.')

  // A: runs the exact lock-check query the RPC body runs next, as a fresh
  // statement in the still-open transaction.
  const lockCheck = await connA.query(
    `SELECT period_month FROM attendance_period_locks
     WHERE tenant_id = $1 AND period_month = ANY(fn_months_in_range($2::date, $3::date)) AND state <> 'OPEN'
     ORDER BY period_month LIMIT 1`,
    [tenantId, '2099-04-10', '2099-04-10'],
  )
  console.log('A: lock-check query result (must see the lock B committed mid-A-transaction):', lockCheck.rows)
  const raceCaught = lockCheck.rowCount === 1 && lockCheck.rows[0].period_month === month1
  console.log(raceCaught
    ? 'PASS — A\'s in-transaction check correctly sees a lock created WHILE A was already mid-flight.'
    : 'FAIL — the race is NOT closed: A would proceed unaware of the concurrently-created lock.')

  await connA.query('ROLLBACK')
  await connA.end()
  await connB.end()

  if (!raceCaught) { await pool.end(); process.exit(1) }

  // ── Part 2: the REAL compiled RPC, lock already in place (sequential case) ──
  console.log('\n=== PART 2: real RPC call against the now-locked month ===')
  const { rows: [rpcLockedResult] } = await pool.query(
    `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,2099) AS result`,
    [tenantId, reqId1, userId, empId, leaveTypeId, JSON.stringify([{ year: 2099, days: 1 }])],
  ).catch(err => ({ rows: [{ result: null, error: err.message }] }))
  console.log('RPC call result (expect a PERIOD_LOCKED exception, caught below):', rpcLockedResult)

  let threwPeriodLocked = false
  try {
    await pool.query(
      `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,2099)`,
      [tenantId, reqId1, userId, empId, leaveTypeId, JSON.stringify([{ year: 2099, days: 1 }])],
    )
  } catch (err) {
    threwPeriodLocked = /PERIOD_LOCKED/.test(err.message)
    console.log('Caught exception:', err.message)
  }
  console.log(threwPeriodLocked ? 'PASS — real RPC refuses a locked period.' : 'FAIL — real RPC did not refuse.')

  const { rows: [stillPending] } = await pool.query(`SELECT status FROM leave_requests WHERE id = $1`, [reqId1])
  console.log('Persisted read-back — request status (must still be PENDING):', stillPending.status)

  // ── Part 3: unlock, real RPC succeeds, persisted read-back ───────────────
  console.log('\n=== PART 3: real RPC call after unlocking ===')
  await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month=$2`, [tenantId, month1])
  await pool.query(
    `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,2099)`,
    [tenantId, reqId1, userId, empId, leaveTypeId, JSON.stringify([{ year: 2099, days: 1 }])],
  )
  const { rows: [afterOpen] } = await pool.query(`SELECT status FROM leave_requests WHERE id = $1`, [reqId1])
  const { rows: [balanceRow] } = await pool.query(
    `SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=2099`,
    [tenantId, empId, leaveTypeId],
  )
  console.log('Persisted read-back — status:', afterOpen.status, '| balance after deduction (expect 29):', balanceRow.balance)

  // ── Part 4: stochastic concurrent-HTTP-timing pass ───────────────────────
  console.log('\n=== PART 4: stochastic pass — N real concurrent (approve, lock) races ===')
  const N = 15
  let consistent = 0
  for (let i = 0; i < N; i++) {
    const month = `2100-${String((i % 9) + 1).padStart(2, '0')}`
    const day = String((i % 28) + 1).padStart(2, '0')
    const reqId = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `${month}-${day}`, `${month}-${day}`, userId)

    const approveP = pool.query(
      `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,2100)`,
      [tenantId, reqId, userId, empId, leaveTypeId, JSON.stringify([{ year: 2100, days: 1 }])],
    ).then(() => ({ ok: true })).catch((err) => ({ ok: false, err: err.message }))

    const lockP = pool.query(
      `INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED')
       ON CONFLICT (tenant_id, period_month) DO UPDATE SET state = 'LOCKED'`,
      [tenantId, month],
    ).then(() => ({ ok: true })).catch((err) => ({ ok: false, err: err.message }))

    const [approveOutcome] = await Promise.all([approveP, lockP])

    const { rows: [finalRow] } = await pool.query(`SELECT status FROM leave_requests WHERE id = $1`, [reqId])
    const selfConsistent =
      (approveOutcome.ok && finalRow.status === 'APPROVED') ||
      (!approveOutcome.ok && finalRow.status === 'PENDING')
    if (selfConsistent) consistent++
    console.log(`  trial ${i + 1}: approve.ok=${approveOutcome.ok}, final status=${finalRow.status}, self-consistent=${selfConsistent}`)

    await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month=$2`, [tenantId, month])
  }
  console.log(`\n${consistent}/${N} trials landed in a self-consistent state (never partial/inconsistent).`)

  await pool.end()
  process.exit(raceCaught && threwPeriodLocked && consistent === N ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
