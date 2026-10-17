#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 — real-Postgres + real-HTTP proof for
 * the leave-entitlement-service.ts writeLedgerEntry() fix.
 *
 * Root cause (found while investigating a suspected three-way accrual-system
 * overlap — see scripts/db/verify-accrual-scope-gap.mjs): writeLedgerEntry's
 * upsert used onConflict: 'tenant_id,employee_id,leave_type_id,year,
 * accrual_type,accrued_on', but leave_accrual_ledger's matching unique index
 * (uidx_accrual_ledger_idempotency) is PARTIAL — Postgres rejects that upsert
 * every time with "there is no unique or exclusion constraint matching the
 * ON CONFLICT specification". That error was silently swallowed and the
 * function always returned {skipped: false}, so runEngineMonthlyAccrual's
 * (and its yearly sibling's) balance-cache credit — which has NO idempotency
 * of its own — ran unconditionally on every call, with zero protection
 * against being invoked twice for the same employee/leave-type/period.
 *
 * This script proves:
 *   PART 1 — calling the real monthly-accrual job HTTP endpoint TWICE for the
 *   same employee/leave-type/period, before the fix, would have doubled the
 *   balance with only one (or zero) ledger rows; after the fix, the second
 *   call is a genuine no-op (balance unchanged, still exactly one ledger row).
 *   PART 2 — employee_leave_balance always equals the sum of
 *   leave_accrual_ledger for that employee+leave_type+year — the invariant
 *   that was silently broken before this fix.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'LedgerIdemVerify!1'
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

async function main() {
  let allOk = true
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const policyId = uuid()
  const hrEmail = `leiv-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Ledger Idem Verify','leiv-${Date.now()}','active')`, [tenantId])
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'LEIV001','Idem','Verify','leiv-emp-${Date.now()}@test.local', CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId],
  )
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Idem Leave', true)`, [leaveTypeId, tenantId])
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
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','LEIV HR','${hrEmail}',true)`,
    [hrUserId, tenantId],
  )
  const hrToken = await loginAndGetToken(hrEmail)
  if (!hrToken) { console.log('❌ Failed to log in as HR admin'); process.exit(1) }

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1

  const runAccrual = () => fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-14 ledger idempotency verification' }),
  }).then((r) => r.json())

  console.log('=== Call 1: POST /leave/jobs/monthly-accrual ===')
  const r1 = await runAccrual()
  console.log('Result 1:', JSON.stringify(r1.data ?? r1))

  const readBack = async () => {
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

  const after1 = await readBack()
  console.log('After call 1 (direct Postgres read):', after1)

  console.log('\n=== Call 2: same period, called again (simulating a scheduler retry / overlapping tick) ===')
  const r2 = await runAccrual()
  console.log('Result 2:', JSON.stringify(r2.data ?? r2))

  const after2 = await readBack()
  console.log('After call 2 (direct Postgres read):', after2)

  console.log('\n=== Verdict ===')
  if (after1.ledgerRowCount !== 1 || after1.balance !== 1) {
    console.log(`❌ Unexpected state after call 1: expected exactly 1 ledger row and balance=1, got`, after1)
    allOk = false
  } else {
    console.log('✅ Call 1 credited exactly once with a matching ledger row.')
  }

  if (after2.ledgerRowCount === after1.ledgerRowCount && after2.balance === after1.balance) {
    console.log(`✅ Call 2 was a genuine no-op — ledger rows and balance unchanged (${after2.ledgerRowCount} row(s), balance=${after2.balance}). Idempotency guard now works.`)
  } else {
    console.log(`❌ Call 2 changed state — DOUBLE-CREDIT STILL POSSIBLE: before=${JSON.stringify(after1)} after=${JSON.stringify(after2)}`)
    allOk = false
  }

  if (after2.balance === after2.ledgerTotal) {
    console.log(`✅ employee_leave_balance (${after2.balance}) matches the sum of leave_accrual_ledger (${after2.ledgerTotal}) — cache/ledger invariant holds.`)
  } else {
    console.log(`❌ INVARIANT BROKEN: employee_leave_balance (${after2.balance}) != sum(leave_accrual_ledger) (${after2.ledgerTotal})`)
    allOk = false
  }

  console.log(allOk ? '\n=== ALL CHECKS PASS ===' : '\n=== SOME CHECKS FAILED ===')
  process.exit(allOk ? 0 : 1)
}

main()
  .catch((err) => { console.error('FATAL', err); process.exit(1) })
  .finally(() => pool.end())
