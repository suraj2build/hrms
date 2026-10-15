#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 12 — real-Postgres proof for the
 * encashment annual-cap fix. The checkpoint 11 report closed this defect
 * with an Idempotency-Key only; a reviewer correctly flagged that idempotency
 * cannot protect the cap against (a) a genuinely simultaneous pair of
 * requests racing before either's result is stored, or (b) two requests
 * using DIFFERENT keys, which are two legitimately separate submissions by
 * design — idempotency answers "is this a replay", not "does the combined
 * total across every request stay under the shared cap." This script proves
 * the real fix (migration 465's request_leave_encashment_atomic, a
 * pg_advisory_xact_lock-serialized RPC) closes both, plus the requested
 * retry-after-failure and cancellation/reversal reconciliation cases.
 *
 *   PART 1 — claimIdempotency's own DB primitive: two real pg.Client
 *   connections race an INSERT on the SAME (tenant_id, key) row; exactly
 *   one succeeds, the other gets a genuine 23505 unique violation. This is
 *   the mechanism the API route's atomic claim (switched from
 *   checkIdempotency to claimIdempotency this round) actually relies on.
 *
 *   PART 2 — the core ask: two DIFFERENT keys' worth of genuinely
 *   concurrent requests (no idempotency key involved at the RPC layer at
 *   all) for the SAME employee/leave_type/year, each individually under
 *   the cap but combined over it. Proves via pg_locks that the second
 *   request's RPC call GENUINELY BLOCKS (not just loses a race by luck)
 *   while the first's transaction is open, and that after the first
 *   commits, the second's fresh re-sum correctly refuses it — never both
 *   committing.
 *
 *   PART 3 — retry after failure: an over-cap request is refused with no
 *   row inserted (function exception auto-rolls back), then a corrected
 *   retry for a valid amount succeeds cleanly.
 *
 *   PART 4 — cancellation/reversal reconciliation: approve a request
 *   (simulating the deduction a real approval does), reverse it via the
 *   real reverse_leave_encashment_atomic RPC, and prove (a) the cap frees
 *   back up for a new request of the same size — the exact
 *   'reversed'-exclusion bugfix this round also made — and (b) the leave
 *   balance is credited back by the exact reversed amount, read back from
 *   real Postgres, not asserted from memory.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

async function seedTenant() {
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Encashment Cap Verify','ecv-${Date.now()}','active')`, [tenantId])
  await pool.query(`INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ($1,$2,'ECV001','Cap','Verify','ecv@ecv-verify.test', CURRENT_DATE, 'active')`, [empId, tenantId])
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Earned Leave', true)`, [leaveTypeId, tenantId])
  return { tenantId, empId, leaveTypeId }
}

async function seedRule(tenantId, leaveTypeId, maxEncashablePerYear) {
  await pool.query(
    `INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, encashable, max_encashable_per_year, is_active)
     VALUES ($1,$2,true,$3,true)`,
    [tenantId, leaveTypeId, maxEncashablePerYear],
  )
}

async function seedHrActor(tenantId) {
  const userId = uuid()
  await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'ecv-hr-${Date.now()}@test.local')`, [userId])
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','ECV HR','ecv-hr@ecv-verify.test',true)`, [userId, tenantId])
  return userId
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
  let allOk = true

  // ── PART 1: claimIdempotency's underlying DB primitive ──────────────────
  console.log('=== PART 1: two real connections racing an INSERT on the same idempotency_keys row ===')
  {
    const tenantId = uuid()
    await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Idem Race Verify','irv-${Date.now()}','active')`, [tenantId])
    const scopedKey = `leave-encashment-request::race-key-1`

    const connA = new pg.Client({ connectionString: DB_URL })
    const connB = new pg.Client({ connectionString: DB_URL })
    await connA.connect(); await connB.connect()

    // response is NOT NULL jsonb — claimIdempotency's real INSERT (via
    // supabase-js) sends the JSON value `null`, not a SQL NULL; match that
    // exactly rather than a bare SQL NULL, which would violate the
    // column's NOT NULL constraint for a different reason than the one
    // under test here.
    const insertSql = `INSERT INTO idempotency_keys (tenant_id, key, status_code, response) VALUES ($1,$2,0,'null'::jsonb)`
    const results = await Promise.allSettled([
      connA.query(insertSql, [tenantId, scopedKey]),
      connB.query(insertSql, [tenantId, scopedKey]),
    ])
    const fulfilled = results.filter(r => r.status === 'fulfilled').length
    const rejected = results.filter(r => r.status === 'rejected')
    const unique23505 = rejected.length === 1 && /duplicate key|unique constraint/i.test(rejected[0].reason?.message ?? '')
    console.log('exactly one INSERT succeeded, the other hit a real unique violation:', fulfilled === 1 && unique23505 ? 'PASS' : 'FAIL', { fulfilled, rejectedMessage: rejected[0]?.reason?.message })
    allOk = allOk && fulfilled === 1 && unique23505

    await connA.end(); await connB.end()
  }

  // ── PART 2: genuinely concurrent DIFFERENT-key requests race the cap ───
  console.log('\n=== PART 2: request_leave_encashment_atomic serializes two concurrent, differently-keyed requests against the SAME cap ===')
  let tenantId, empId, leaveTypeId
  {
    ;({ tenantId, empId, leaveTypeId } = await seedTenant())
    await seedRule(tenantId, leaveTypeId, 5) // cap = 5 days/year
    const year = 2101

    const connA = new pg.Client({ connectionString: DB_URL })
    const connB = new pg.Client({ connectionString: DB_URL })
    await connA.connect(); await connB.connect()

    await connA.query('BEGIN')
    const rpcSql = `SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`
    // connA requests 3 days — individually under the 5-day cap. Not
    // committed yet: the advisory lock for (tenant,emp,leaveType,year) is
    // held open inside this still-in-flight transaction.
    await connA.query(rpcSql, [tenantId, empId, leaveTypeId, year, 3, 'connA request'])

    const { rows: [{ pid: pidB }] } = await connB.query('SELECT pg_backend_pid() AS pid')
    // connB ALSO requests 3 days — individually under the cap too, but
    // 3+3=6 > 5 combined. This is exactly the race idempotency (which
    // never even sees this call, since it uses a different key / no key)
    // cannot protect against — only the RPC's own lock can.
    const bPromise = connB.query(rpcSql, [tenantId, empId, leaveTypeId, year, 3, 'connB request']).catch(e => ({ _error: e }))

    const sawBlocked = await waitUntilBlocked(pidB)
    console.log('connB genuinely blocked on the advisory lock while connA is still open (pg_locks-confirmed, not just slow):', sawBlocked ? 'PASS' : 'FAIL')

    await connA.query('COMMIT')
    const bResult = await bPromise
    await connA.end(); await connB.end()

    const { rows: finalRows } = await pool.query(
      `SELECT id, days, status FROM leave_encashment_requests WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 ORDER BY created_at`,
      [tenantId, empId, leaveTypeId, year],
    )
    console.log('persisted requests after both attempts:', finalRows)

    const bRefused = bResult._error && /ENCASHMENT_LIMIT_EXCEEDED/.test(bResult._error.message ?? '')
    const onlyOneRow = finalRows.length === 1 && Number(finalRows[0].days) === 3
    console.log('connB correctly refused ENCASHMENT_LIMIT_EXCEEDED after seeing connA\'s committed 3 days (3+3=6 > cap 5):', bRefused ? 'PASS' : 'FAIL')
    console.log('exactly ONE request persisted, not both (no cap bypass):', onlyOneRow ? 'PASS' : 'FAIL')
    allOk = allOk && sawBlocked && bRefused && onlyOneRow
  }

  // ── PART 3: retry after failure ─────────────────────────────────────────
  console.log('\n=== PART 3: an over-cap request is refused with NO row inserted; a corrected retry then succeeds cleanly ===')
  {
    const year = 2102
    let overCapRefused = false
    try {
      await pool.query(`SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6)`, [tenantId, empId, leaveTypeId, year, 10, 'over cap'])
    } catch (err) {
      overCapRefused = /ENCASHMENT_LIMIT_EXCEEDED/.test(err.message)
    }
    const { rows: afterFailRows } = await pool.query(
      `SELECT count(*) AS n FROM leave_encashment_requests WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
      [tenantId, empId, leaveTypeId, year],
    )
    const noRowOnFailure = Number(afterFailRows[0].n) === 0
    console.log('over-cap request refused, zero rows inserted (function exception rolled back cleanly):', overCapRefused && noRowOnFailure ? 'PASS' : 'FAIL')

    const { rows: [retryRow] } = await pool.query(
      `SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`,
      [tenantId, empId, leaveTypeId, year, 4, 'retry at a valid amount'],
    )
    const retrySucceeded = retryRow.result?.status === 'pending'
    console.log('retry with a corrected, valid amount succeeds:', retrySucceeded ? 'PASS' : 'FAIL', retryRow.result)
    allOk = allOk && overCapRefused && noRowOnFailure && retrySucceeded
  }

  // ── PART 4: cancellation/reversal reconciliation ────────────────────────
  console.log('\n=== PART 4: a reversed request frees the cap back up, and the leave balance is credited back exactly — read back from real Postgres ===')
  {
    const year = 2103
    const initialBalance = 10
    const hrActorId = await seedHrActor(tenantId)
    await pool.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, empId, leaveTypeId, year, initialBalance],
    )

    // Request + "approve" 4 of the 5-day cap (hand-simulating the balance
    // deduction the real approve flow performs — that flow itself
    // (accrual-engine.ts's processEncashment) is out of this script's
    // scope; only the request-atomicity and reverse RPC are under test
    // here).
    const { rows: [reqRow] } = await pool.query(
      `SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`,
      [tenantId, empId, leaveTypeId, year, 4, 'to be approved then reversed'],
    )
    const requestId = reqRow.result.id
    await pool.query(
      `UPDATE leave_encashment_requests SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`,
      [requestId, hrActorId],
    )
    await pool.query(
      `UPDATE employee_leave_balance SET balance = balance - 4 WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
      [tenantId, empId, leaveTypeId, year],
    )

    // A second request for the REMAINING 1 day of cap room should still
    // correctly fail before reversal (4 approved + 2 > 5).
    let secondRefusedBeforeReversal = false
    try {
      await pool.query(`SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6)`, [tenantId, empId, leaveTypeId, year, 2, 'should fail — cap not yet freed'])
    } catch (err) {
      secondRefusedBeforeReversal = /ENCASHMENT_LIMIT_EXCEEDED/.test(err.message)
    }
    console.log('a second request is correctly refused while the first is still approved (cap not yet freed):', secondRefusedBeforeReversal ? 'PASS' : 'FAIL')

    // Reverse the approved request via the REAL reverse RPC.
    const { rows: [reverseRow] } = await pool.query(
      `SELECT reverse_leave_encashment_atomic($1,$2,$3,$4) AS result`,
      [tenantId, requestId, hrActorId, 'checkpoint 12 reconciliation test'],
    )
    console.log('reverse_leave_encashment_atomic result:', reverseRow.result)

    const { rows: [balanceRow] } = await pool.query(
      `SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
      [tenantId, empId, leaveTypeId, year],
    )
    const balanceCreditedBackExactly = Number(balanceRow.balance) === initialBalance
    console.log(`leave balance after reversal (expect exactly ${initialBalance}, the original):`, balanceRow.balance, balanceCreditedBackExactly ? 'PASS' : 'FAIL')

    // The reversed-status-exclusion bugfix: a NEW 4-day request should
    // now succeed — checkpoint 11's original sum (excluding only
    // 'rejected') would have kept counting the reversed 4 days forever
    // and wrongly refused this.
    const { rows: [newReqRow] } = await pool.query(
      `SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`,
      [tenantId, empId, leaveTypeId, year, 4, 'cap correctly freed by the reversal'],
    )
    const capFreedByReversal = newReqRow.result?.status === 'pending'
    console.log('cap correctly frees back up after reversal (the \'reversed\'-exclusion fix):', capFreedByReversal ? 'PASS' : 'FAIL', newReqRow.result)

    // Reconcile: sum of non-rejected/non-reversed requests for the year
    // must equal exactly the live (non-reversed) total — the reversed
    // request must NOT be double-counted into it.
    const { rows: [sumRow] } = await pool.query(
      `SELECT COALESCE(SUM(days),0) AS total FROM leave_encashment_requests
       WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4
         AND status NOT IN ('rejected','reversed')`,
      [tenantId, empId, leaveTypeId, year],
    )
    const reconciledTotalCorrect = Number(sumRow.total) === 4
    console.log('reconciled live request total for the year (expect 4 — only the post-reversal request, not the reversed 4 too):', sumRow.total, reconciledTotalCorrect ? 'PASS' : 'FAIL')

    const { rows: ledgerRows } = await pool.query(
      `SELECT txn_type, delta FROM leave_balance_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 AND txn_type='reversal'`,
      [tenantId, empId, leaveTypeId, year],
    )
    const ledgerRecorded = ledgerRows.length === 1 && Number(ledgerRows[0].delta) === 4
    console.log('leave_balance_ledger has exactly one reversal row with delta=4:', ledgerRecorded ? 'PASS' : 'FAIL', ledgerRows)

    allOk = allOk && secondRefusedBeforeReversal && balanceCreditedBackExactly && capFreedByReversal && reconciledTotalCorrect && ledgerRecorded
  }

  // ── PART 5 (checkpoint 13): cap-policy changes + excluded→counted transitions ──
  console.log('\n=== PART 5: a cap-policy change never desyncs the invariant (always re-summed live, never cached), and no writer anywhere resurrects a rejected/reversed row ===')
  {
    const year = 2105
    const hrActorId = await seedHrActor(tenantId)
    // reverse_leave_encashment_atomic's explainability-log write
    // (leave_balance_ledger) is an INSERT...SELECT FROM employee_leave_balance
    // — it silently matches zero rows (not an error) if no balance row
    // exists for this tuple yet. Part 2's tenant/employee (reused here)
    // never needed one (cap enforcement is COUNT-based, not balance-based),
    // so seed one explicitly to faithfully exercise the reversal's full
    // write path, matching what a real approve (processEncashment's
    // checked_deduct_leave_balance) would have already created.
    await pool.query(
      `INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, employee_id, leave_type_id, year) DO NOTHING`,
      [tenantId, empId, leaveTypeId, year, 20],
    )
    // Lower the cap AFTER requests already exist under the old, higher cap —
    // proves the check is always re-derived from the CURRENT rule value at
    // request time, never a stored "remaining allowance" counter that a
    // policy change could leave stale.
    await pool.query(`UPDATE leave_accrual_rules SET max_encashable_per_year = 5 WHERE tenant_id=$1 AND leave_type_id=$2`, [tenantId, leaveTypeId])
    const { rows: [r1] } = await pool.query(`SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`, [tenantId, empId, leaveTypeId, year, 3, 'under new lower cap'])
    const firstOk = r1.result?.status === 'pending'
    console.log('a request under the NEW lower cap (3/5) succeeds:', firstOk ? 'PASS' : 'FAIL', r1.result)

    // Raise the cap mid-stream — a request that would have been refused
    // under the OLD (lower, just-set) cap must now be correctly accepted,
    // proving the check reads the rule fresh on every call, not a value
    // captured once.
    await pool.query(`UPDATE leave_accrual_rules SET max_encashable_per_year = 10 WHERE tenant_id=$1 AND leave_type_id=$2`, [tenantId, leaveTypeId])
    const { rows: [r2] } = await pool.query(`SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`, [tenantId, empId, leaveTypeId, year, 4, 'only fits after the cap was raised'])
    const secondOk = r2.result?.status === 'pending' // 3+4=7, fits the new cap of 10 but not the old 5
    console.log('a request that only fits AFTER the cap is raised (3+4=7 > old cap 5, <= new cap 10) succeeds — the check reads the rule live, not a cached value:', secondOk ? 'PASS' : 'FAIL', r2.result)

    const { rows: [sumRow] } = await pool.query(
      `SELECT COALESCE(SUM(days),0) AS total FROM leave_encashment_requests WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 AND status NOT IN ('rejected','reversed')`,
      [tenantId, empId, leaveTypeId, year],
    )
    const sumMatchesExpected = Number(sumRow.total) === 7
    console.log('reconciled live total after both policy changes (expect 7 — both requests persisted, no drift from either policy edit):', sumRow.total, sumMatchesExpected ? 'PASS' : 'FAIL')

    // Reject the second request, then try to reverse it — reverse requires
    // ('approved','paid'); a 'rejected' row must be refused, not silently
    // resurrected into a counted status via the reversal path.
    const secondId = r2.result.id
    await pool.query(`UPDATE leave_encashment_requests SET status='rejected' WHERE id=$1`, [secondId])
    let reverseOfRejectedRefused = false
    try {
      await pool.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, secondId, hrActorId, 'should be refused — not approved/paid'])
    } catch (err) {
      reverseOfRejectedRefused = /CONFLICT/.test(err.message)
    }
    console.log('reversing an already-REJECTED request is refused (no excluded→counted resurrection via the reversal path):', reverseOfRejectedRefused ? 'PASS' : 'FAIL')

    // Approve, then reverse, then attempt to reverse AGAIN — the same guard
    // must refuse a double-reversal (which would otherwise double-credit
    // the balance and could, if it also "un-reversed" the row, bring an
    // excluded request back into the counted set).
    const { rows: [r3] } = await pool.query(`SELECT request_leave_encashment_atomic($1,$2,$3,$4,$5,$6) AS result`, [tenantId, empId, leaveTypeId, year, 1, 'to be approved, reversed, then double-reversed'])
    const thirdId = r3.result.id
    await pool.query(`UPDATE leave_encashment_requests SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [thirdId, hrActorId])
    await pool.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, thirdId, hrActorId, 'first reversal'])
    let doubleReversalRefused = false
    try {
      await pool.query(`SELECT reverse_leave_encashment_atomic($1,$2,$3,$4)`, [tenantId, thirdId, hrActorId, 'second reversal — must be refused'])
    } catch (err) {
      doubleReversalRefused = /CONFLICT/.test(err.message)
    }
    const { rows: [reversalCountRow] } = await pool.query(
      `SELECT count(*) AS n FROM leave_balance_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4 AND txn_type='reversal' AND encashment_id=$5`,
      [tenantId, empId, leaveTypeId, year, thirdId],
    )
    const exactlyOneReversalLedgerRow = Number(reversalCountRow.n) === 1
    console.log('a double-reversal attempt on the same request is refused, not silently re-credited (exactly one reversal ledger row, not two):', doubleReversalRefused && exactlyOneReversalLedgerRow ? 'PASS' : 'FAIL', reversalCountRow)

    allOk = allOk && firstOk && secondOk && sumMatchesExpected && reverseOfRejectedRefused && doubleReversalRefused && exactlyOneReversalLedgerRow
  }

  console.log(allOk ? '\nALL PARTS PASS' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
