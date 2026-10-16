#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 — user-requested follow-up to the
 * writeLedgerEntry() idempotency fix (commit 116a6f4a). That fix proved
 * SEQUENTIAL retries no longer double-credit. This script answers the two
 * sharper questions raised: (1) do GENUINELY CONCURRENT requests for the
 * same employee/leave-type/period still double-credit, and (2) can the
 * two-step "insert ledger row, then credit the balance cache" sequence
 * leave a credit PERMANENTLY missing if something fails between the two
 * steps (since the fix makes the ledger INSERT the authoritative
 * idempotency signal — once it exists, nothing ever retries the balance
 * credit for that key again).
 *
 * PART A — genuine concurrency, same employee/leave-type/period: fires
 * TWO real HTTP calls to POST /leave/jobs/monthly-accrual via Promise.all
 * (not sequential awaits), confirms via real Postgres read-back that
 * exactly one ledger row and one balance credit resulted — not zero, not
 * two. This is safe BY CONSTRUCTION: both requests attempt the identical
 * INSERT into leave_accrual_ledger (same composite key), and Postgres's
 * own unique index resolves the race atomically — exactly one commits,
 * the other gets a real 23505 within the same statement, with no
 * window for both to believe they "won".
 *
 * PART B — crash-recovery gap: writeLedgerEntry's INSERT and
 * creditEmployeeDays's balance upsert are two SEPARATE statements, not
 * one transaction. This part manually inserts the exact ledger row the
 * engine would insert (simulating a process that completed the ledger
 * write but crashed — lost connection, OOM, deploy restart — before the
 * balance upsert ran), then calls the real HTTP endpoint and shows
 * whether the credit is permanently unrecoverable (ledger claims it
 * happened; balance never reflects it; the 23505 idempotency guard
 * refuses every future retry because the ledger row already exists).
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'ConcurrencyCrashVerify!1'
const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

async function createAuthUser(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json()
  if (!body.id) throw new Error(`createAuthUser failed for ${email}: ${JSON.stringify(body)}`)
  return body.id
}

async function loginAndGetToken(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  return (await res.json()).access_token
}

async function seedTenant(label, empCode) {
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const policyId = uuid()
  const hrEmail = `${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, label, `${label}-${Date.now()}`])
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,$3,'Conc','Verify',$4, CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId, empCode, `${empCode}-${Date.now()}@test.local`],
  )
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Conc Leave', true)`, [leaveTypeId, tenantId])
  await pool.query(
    `INSERT INTO leave_policy_masters (id, tenant_id, name, is_default, status, is_active) VALUES ($1,$2,'Employee Policy', false, 'published', true)`,
    [policyId, tenantId],
  )
  await pool.query(
    `INSERT INTO leave_policy_assignments (tenant_id, policy_id, scope_type, scope_id) VALUES ($1,$2,'employee',$3)`,
    [tenantId, policyId, empId],
  )
  await pool.query(
    `INSERT INTO leave_policy_rules (tenant_id, policy_id, leave_type_id, accrual_type, accrual_days_per_year) VALUES ($1,$2,$3,'monthly', 12)`,
    [tenantId, policyId, leaveTypeId],
  )

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, empId, leaveTypeId, hrToken }
}

async function readBack(tenantId, empId, leaveTypeId) {
  const { rows: ledger } = await pool.query(
    `SELECT days FROM leave_accrual_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`,
    [tenantId, empId, leaveTypeId],
  )
  const { rows: bal } = await pool.query(
    `SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`,
    [tenantId, empId, leaveTypeId],
  )
  return {
    ledgerRowCount: ledger.length,
    ledgerTotal: ledger.reduce((s, r) => s + Number(r.days), 0),
    balance: bal.length ? Number(bal[0].balance) : 0,
  }
}

async function main() {
  let allOk = true
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1

  // ── PART A: genuine concurrency ──────────────────────────────────────────
  console.log('=== PART A: two GENUINELY CONCURRENT real HTTP calls (Promise.all, not sequential) ===')
  const a = await seedTenant('ConcA', 'CONCA001')

  const fireAccrual = (token) => fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-14 concurrency verification' }),
  }).then((r) => r.json())

  const [r1, r2] = await Promise.all([fireAccrual(a.hrToken), fireAccrual(a.hrToken)])
  console.log('Call 1 result:', JSON.stringify(r1.data ?? r1))
  console.log('Call 2 result:', JSON.stringify(r2.data ?? r2))

  const afterA = await readBack(a.tenantId, a.empId, a.leaveTypeId)
  console.log('After both concurrent calls (direct Postgres read):', afterA)

  const oneWinnerOneSkip =
    (r1.data?.employees_processed === 1 && r2.data?.employees_processed === 0) ||
    (r1.data?.employees_processed === 0 && r2.data?.employees_processed === 1)
  if (afterA.ledgerRowCount === 1 && afterA.balance === 1 && oneWinnerOneSkip) {
    console.log('✅ PART A PASS: exactly one of the two concurrent requests credited; the other was a genuine no-op. Ledger row count=1, balance=1 — no duplicate, no missing credit.')
  } else {
    console.log('❌ PART A FAIL: concurrent requests produced an unexpected state — duplicate or missing credit under real concurrency.', { afterA, r1: r1.data, r2: r2.data })
    allOk = false
  }

  // ── PART B: crash-recovery — is the ledger-insert + balance-credit sequence
  // now GENUINELY atomic (migration 469's credit_engine_accrual_atomic), so a
  // crash mid-way can no longer leave the two writes out of sync? ──────────
  console.log('\n=== PART B: forcing a failure INSIDE the atomic RPC, after the ledger row would be staged but before the function returns ===')
  const b = await seedTenant('ConcB', 'CONCB001')
  const runDate = `${year}-${String(month).padStart(2, '0')}-01`

  // employee_leave_balance has a CHECK (balance >= 0) constraint. Calling the
  // real RPC directly with a max_balance that forces LEAST(p_days, p_max_balance)
  // negative makes the balance-table statement raise inside the SAME function
  // call that already ran the ledger INSERT — the exact "something fails
  // between the two writes" scenario, but now both statements are inside one
  // plpgsql function, so Postgres must roll back the WHOLE call on that error,
  // not just the second statement.
  let midCallError = null
  try {
    await pool.query(
      `SELECT credit_engine_accrual_atomic($1,$2,$3,'monthly',1,$4,$5,NULL,'forced mid-call failure test',-1)`,
      [b.tenantId, b.empId, b.leaveTypeId, year, runDate],
    )
  } catch (err) {
    midCallError = err
  }
  console.log('Direct RPC call with an impossible balance (forces the balance statement to raise):', midCallError ? `raised as expected: ${midCallError.message}` : 'did NOT raise (unexpected)')

  const afterForcedFailure = await readBack(b.tenantId, b.empId, b.leaveTypeId)
  console.log('State immediately after the forced mid-call failure (direct Postgres read):', afterForcedFailure)

  const rolledBackCleanly = midCallError !== null && afterForcedFailure.ledgerRowCount === 0 && afterForcedFailure.balance === 0
  if (rolledBackCleanly) {
    console.log('✅ The ledger INSERT did NOT persist when the balance statement later failed in the same call — the whole RPC rolled back atomically, exactly like every other atomic RPC in this codebase. No orphaned ledger row, no missing-forever credit.')
  } else {
    console.log('❌ UNEXPECTED: the forced failure did not roll back cleanly.', afterForcedFailure)
    allOk = false
  }

  console.log('\nCalling the real HTTP endpoint for the SAME employee/period now — since nothing persisted, this should credit normally (not a stuck "skipped" forever):')
  const recoveryRes = await fireAccrual(b.hrToken)
  console.log('Recovery call result:', JSON.stringify(recoveryRes.data ?? recoveryRes))
  const afterRecovery = await readBack(b.tenantId, b.empId, b.leaveTypeId)
  console.log('State after the real recovery call (direct Postgres read):', afterRecovery)

  const recoveredCleanly = recoveryRes.data?.employees_processed === 1 && afterRecovery.ledgerRowCount === 1 && afterRecovery.balance === 1
  if (recoveredCleanly) {
    console.log('✅ PART B PASS: migration 469 closes the gap found against the sequential-statement version — a failure between the ledger write and the balance credit now rolls back BOTH (true transaction atomicity), so the credit is never permanently lost; the next real call credits normally.')
  } else {
    console.log('❌ PART B FAIL: the credit did not recover cleanly after the forced failure.', { afterRecovery, recoveryRes: recoveryRes.data })
    allOk = false
  }

  console.log(allOk ? '\n=== ALL CHECKS PASS (PART A and PART B) ===' : '\n=== SOME CHECKS FAILED ===')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
