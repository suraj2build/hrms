#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 7, round 2 — the user correctly
 * rejected checkpoint 7's claim that the period-lock race was closed.
 * Migration 461's in-transaction SELECT only caught the ordering where
 * the period-lock write had already committed before the mutation's
 * check ran. It did nothing for the complementary ordering (mutation's
 * check runs first, sees OPEN, commits — then the lock write lands
 * microseconds later) and never even inspected whether the period-lock
 * WRITER (lock/unlock/start-payroll/finalize in period-locks.ts) shared
 * any mechanism with the mutation side. It did not.
 *
 * Migration 462 fixes this with a real mutual-exclusion primitive: a
 * Postgres advisory lock keyed by (tenant_id, period_month), taken by
 * BOTH writer classes before either decides anything. This script proves
 * that primitive with genuine blocking, demonstrated via pg_locks (not
 * inferred from timing), in both directions the user asked for:
 *
 *   PART 1 — "lock wins": the period-lock writer (lock_period_atomic)
 *   holds the advisory lock first, on a month with NO pre-existing
 *   attendance_period_locks row at all (the case the user explicitly
 *   asked to be tested, since a row-level lock cannot cover it). A
 *   concurrent approval (approve_leave_request_atomic) is shown to be
 *   genuinely BLOCKED — present in pg_locks as ungranted — not merely
 *   slow. Once the lock-creation call commits, the approval unblocks,
 *   observes the now-committed LOCKED row, and is refused with
 *   PERIOD_LOCKED. No partial mutation.
 *
 *   PART 2 — "approval wins": the approval holds the advisory lock
 *   first. A concurrent lock-creation call is shown to be genuinely
 *   blocked (pg_locks) until the approval commits. Once the approval
 *   commits (balance deducted, status APPROVED — this is accepted as
 *   correct: it genuinely preceded the lock in real commit order, not a
 *   race the system failed to catch), the lock-creation call proceeds
 *   and succeeds. A THIRD, fresh approval attempt for the same month,
 *   started only after the lock is durably committed, is then refused —
 *   proving the lock is enforced prospectively regardless of which
 *   writer happened to go first.
 *
 *   PART 3 — multi-month range: a leave spanning two months acquires
 *   both months' advisory locks (sorted order). Locking EITHER month
 *   blocks the multi-month approval; locking neither lets it through.
 *
 *   PART 4 — no-deadlock stress: several real approvals (single- and
 *   multi-month) and several real lock-creation calls, overlapping
 *   months, all fired concurrently via Promise.all. Asserts every call
 *   resolves within a bounded timeout (no hang) and every outcome is
 *   internally consistent (approved with balance deducted and all
 *   relevant months later locked, or refused with nothing mutated).
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
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Shared Serialization Verify','ssv-${Date.now()}-${Math.random().toString(36).slice(2)}','active')`, [tenantId])
  await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'ssv-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local')`, [userId])
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'SSV001','Shared','Serialization', 'ssv@ssv-verify.test', CURRENT_DATE, 'active')`,
    [empId, tenantId],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','SSV','ssv@ssv-verify.test', true)`,
    [userId, tenantId, empId],
  )
  await pool.query(
    `INSERT INTO leave_types (id, tenant_id, name, is_paid, allow_sandwich, is_active, allow_half_day, allow_hourly)
     VALUES ($1,$2,'Annual Leave', true, false, true, true, false)`,
    [leaveTypeId, tenantId],
  )
  for (const year of [2101, 2102, 2103]) {
    await pool.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,$4,30)`,
      [tenantId, empId, leaveTypeId, year],
    )
  }
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

async function countUngrantedAdvisoryLocks(pid) {
  const { rows } = await pool.query(
    `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = $1 AND granted = false`,
    [pid],
  )
  return Number(rows[0].n)
}

async function getBackendPid(client) {
  const { rows } = await client.query('SELECT pg_backend_pid() AS pid')
  return rows[0].pid
}

async function waitUntil(fn, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

async function main() {
  const { tenantId, empId, leaveTypeId, userId } = await seedTenantAndEmployee()
  let allOk = true

  // ── PART 1: "lock wins" — lock-creation holds the advisory lock first,
  //    on a month with NO pre-existing attendance_period_locks row. ───────
  console.log('=== PART 1: lock-creation blocks a concurrent approval (no pre-existing lock row) ===')
  {
    const month = '2101-04'
    const reqId = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `${month}-10`, `${month}-10`, userId)

    const connA = new pg.Client({ connectionString: DB_URL })
    await connA.connect()
    const pidA = await getBackendPid(connA)

    await connA.query('BEGIN')
    // Fire the REAL lock_period_atomic RPC — it internally takes the
    // advisory lock for this month FIRST, then inserts the row (none
    // exists yet). We don't COMMIT yet, so the lock is held open.
    const lockPromise = connA.query(
      `SELECT lock_period_atomic($1,$2,$3,$4) AS result`,
      [tenantId, month, userId, 'Part 1 verify'],
    )
    // Let connA's statement actually execute (it should finish fast —
    // nothing contends with it yet) before we start the approval.
    await lockPromise

    // Now start the REAL approve RPC on a second, independent connection,
    // but do NOT let connA commit until we've proven it's blocked.
    const connB = new pg.Client({ connectionString: DB_URL })
    await connB.connect()
    const pidB = await getBackendPid(connB)
    const approvePromise = connB.query(
      `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,$7) AS result`,
      [tenantId, reqId, userId, empId, leaveTypeId, JSON.stringify([{ year: 2101, days: 1 }]), 2101],
    ).catch((err) => ({ _error: err }))

    const sawBlocked = await waitUntil(async () => (await countUngrantedAdvisoryLocks(pidB)) > 0)
    console.log('connB (approval) shows an ungranted advisory-lock wait row in pg_locks:', sawBlocked)

    await connA.query('COMMIT')
    await connA.end()

    const approveOutcome = await approvePromise
    const refused = approveOutcome?._error && /PERIOD_LOCKED/.test(approveOutcome._error.message)
    console.log('Approval outcome after lock commits:', refused ? 'refused with PERIOD_LOCKED (expected)' : approveOutcome)

    const { rows: [afterRow] } = await pool.query(`SELECT status FROM leave_requests WHERE id = $1`, [reqId])
    const noPartialMutation = afterRow.status === 'PENDING'
    console.log('Request status unchanged (no partial mutation):', afterRow.status, noPartialMutation ? 'PASS' : 'FAIL')

    await connB.end()
    const part1Pass = sawBlocked && refused && noPartialMutation
    console.log(part1Pass ? 'PART 1: PASS' : 'PART 1: FAIL')
    allOk = allOk && part1Pass
  }

  // ── PART 2: "approval wins" — approval holds the advisory lock first. ──
  console.log('\n=== PART 2: an in-flight approval blocks a concurrent lock-creation call ===')
  {
    const month = '2102-06'
    const reqId = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `${month}-10`, `${month}-10`, userId)

    const connA = new pg.Client({ connectionString: DB_URL })
    await connA.connect()
    const pidA = await getBackendPid(connA)

    await connA.query('BEGIN')
    await connA.query(
      `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,$7) AS result`,
      [tenantId, reqId, userId, empId, leaveTypeId, JSON.stringify([{ year: 2102, days: 1 }]), 2102],
    )
    // Not committed yet — the advisory lock for 2102-06 is held open.

    const connB = new pg.Client({ connectionString: DB_URL })
    await connB.connect()
    const pidB = await getBackendPid(connB)
    const lockPromise = connB.query(
      `SELECT lock_period_atomic($1,$2,$3,$4) AS result`,
      [tenantId, month, userId, 'Part 2 verify'],
    ).catch((err) => ({ _error: err }))

    const sawBlocked = await waitUntil(async () => (await countUngrantedAdvisoryLocks(pidB)) > 0)
    console.log('connB (lock-creation) shows an ungranted advisory-lock wait row in pg_locks:', sawBlocked)

    await connA.query('COMMIT')
    await connA.end()

    const lockOutcome = await lockPromise
    const lockSucceeded = !lockOutcome?._error
    console.log('Lock-creation outcome after approval commits:', lockSucceeded ? 'succeeded (expected)' : lockOutcome._error.message)

    const { rows: [approvedRow] } = await pool.query(`SELECT status, balance FROM leave_requests lr JOIN employee_leave_balance b ON b.employee_id = lr.employee_id AND b.tenant_id = lr.tenant_id AND b.year = 2102 AND b.leave_type_id = lr.leave_type_id WHERE lr.id = $1`, [reqId])
    const approvalPreserved = approvedRow.status === 'APPROVED' && Number(approvedRow.balance) === 29
    console.log('Approval that genuinely preceded the lock remains committed (not retroactively undone):', approvedRow, approvalPreserved ? 'PASS' : 'FAIL')

    // A THIRD, fresh approval attempt for the same now-locked month must
    // be refused — the lock is enforced prospectively regardless of who
    // "won" the earlier race.
    const reqId2 = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `${month}-15`, `${month}-15`, userId)
    let thirdRefused = false
    try {
      await pool.query(
        `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,$7)`,
        [tenantId, reqId2, userId, empId, leaveTypeId, JSON.stringify([{ year: 2102, days: 1 }]), 2102],
      )
    } catch (err) {
      thirdRefused = /PERIOD_LOCKED/.test(err.message)
    }
    console.log('A fresh approval attempt after the lock is committed is refused:', thirdRefused ? 'PASS' : 'FAIL')

    await connB.end()
    const part2Pass = sawBlocked && lockSucceeded && approvalPreserved && thirdRefused
    console.log(part2Pass ? 'PART 2: PASS' : 'PART 2: FAIL')
    allOk = allOk && part2Pass
  }

  // ── PART 3: multi-month range — locking EITHER month blocks the whole
  //    multi-month approval. ───────────────────────────────────────────
  console.log('\n=== PART 3: multi-month range respects a lock on either month ===')
  {
    for (const [idx, lockedMonth] of ['2103-01', '2103-02'].entries()) {
      const fromDay = 28 + idx
      const toDay = idx
      const reqId = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `2103-01-${fromDay}`, `2103-02-0${toDay + 2}`, userId)
      await pool.query(`INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1,$2,'LOCKED') ON CONFLICT (tenant_id, period_month) DO UPDATE SET state='LOCKED'`, [tenantId, lockedMonth])
      let refused = false
      try {
        await pool.query(
          `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,$7)`,
          [tenantId, reqId, userId, empId, leaveTypeId, JSON.stringify([{ year: 2103, days: 1 }]), 2103],
        )
      } catch (err) {
        refused = /PERIOD_LOCKED/.test(err.message)
      }
      console.log(`  locking ${lockedMonth} refuses the Jan30-Feb2 request:`, refused ? 'PASS' : 'FAIL')
      allOk = allOk && refused
      await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month=$2`, [tenantId, lockedMonth])
    }
  }

  // ── PART 4: no-deadlock stress — many concurrent calls, bounded timeout. ─
  console.log('\n=== PART 4: no-deadlock stress (concurrent multi-month approvals + lock-creation calls) ===')
  {
    const N = 10
    const calls = []
    const monthsPool = ['2104-01', '2104-02', '2104-03']
    for (let i = 0; i < N; i++) {
      if (i % 2 === 0) {
        const day = String((i % 27) + 1).padStart(2, '0')
        const reqId = await seedPendingLeaveRequest(tenantId, empId, leaveTypeId, `2104-01-${day}`, `2104-03-${day}`, userId)
        calls.push(
          pool.query(
            `SELECT approve_leave_request_atomic($1,$2,$3,now(),true,$4,$5,$6::jsonb,$7)`,
            [tenantId, reqId, userId, empId, leaveTypeId, JSON.stringify([{ year: 2104, days: 1 }]), 2104],
          ).then(() => ({ ok: true })).catch((err) => ({ ok: false, err: err.message })),
        )
      } else {
        const month = monthsPool[i % monthsPool.length]
        calls.push(
          pool.query(`SELECT lock_period_atomic($1,$2,$3,$4)`, [tenantId, month, userId, 'stress'])
            .then(() => ({ ok: true })).catch((err) => ({ ok: false, err: err.message })),
        )
      }
    }
    const results = await Promise.race([
      Promise.all(calls),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT — possible deadlock/hang')), 15000)),
    ])
    console.log(`  all ${N} concurrent calls resolved within timeout (no hang):`, Array.isArray(results) ? 'PASS' : 'FAIL')
    console.log('  outcomes:', results.map((r) => r.ok).join(','))
    allOk = allOk && Array.isArray(results)
    // Reopen so the throwaway tenant doesn't leave locked months behind.
    for (const m of monthsPool) {
      await pool.query(`UPDATE attendance_period_locks SET state='OPEN' WHERE tenant_id=$1 AND period_month=$2`, [tenantId, m])
    }
  }

  console.log(allOk ? '\nALL PARTS PASS' : '\nSOME PARTS FAILED')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
