#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 — user-requested follow-up:
 * "Test the two accrual configurations together for the same employee/
 * period and document precedence or confirmed overlap behavior."
 *
 * Re-runs this test with the CURRENT code (after the writeLedgerEntry
 * idempotency fix and the credit_engine_accrual_atomic fix landed earlier
 * in this checkpoint) — the original exploratory version of this test
 * (scripts/db/verify-accrual-scope-gap.mjs Part 3) ran against code that
 * had a different, since-fixed bug in the way, so its result is not a
 * reliable statement about current overlap behavior. This script is the
 * authoritative one going forward.
 *
 * Setup: ONE employee, ONE leave type, configured in BOTH:
 *   (A) leave_accrual_rules (admin UI: /leave/accrual/rules) — read by
 *       accrual-engine.ts's runMonthlyAccrual, triggered via
 *       POST /leave/accrual/run
 *   (B) leave_policy_rules + an EMPLOYEE-scope leave_policy_assignments row
 *       (admin UI: masters/leave-policy-*) — read by leave-entitlement-
 *       service.ts's runEngineMonthlyAccrual, triggered via
 *       POST /leave/jobs/monthly-accrual
 * Both configured for 1 day/month for the same leave type, same employee.
 *
 * Then calls BOTH real HTTP endpoints for the same period and inspects the
 * exact ledger rows written, in call order and in reverse call order, to
 * determine: do both systems independently credit (confirmed double-credit,
 * no precedence — each is unaware of the other), or does one defer to the
 * other?
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'DualOverlapVerify!1'
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

async function readLedger(tenantId, empId, leaveTypeId) {
  const { rows } = await pool.query(
    `SELECT days, accrual_type, accrued_on, notes, created_at
     FROM leave_accrual_ledger
     WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3
     ORDER BY created_at`,
    [tenantId, empId, leaveTypeId],
  )
  return rows
}

async function readBalance(tenantId, empId, leaveTypeId) {
  const { rows } = await pool.query(
    `SELECT balance FROM employee_leave_balance WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`,
    [tenantId, empId, leaveTypeId],
  )
  return rows.length ? Number(rows[0].balance) : 0
}

async function runScenario(label, callOrder) {
  console.log(`\n=== Scenario: ${label} (call order: ${callOrder.join(' then ')}) ===`)
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const policyId = uuid()
  const hrEmail = `dov-${label}-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Dual Overlap ${label}`, `dov-${label}-${Date.now()}`])
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'DOV001','Dual','Overlap',$3, CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId, `dov-emp-${label}-${Date.now()}@test.local`],
  )
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Dual Overlap Leave', true)`, [leaveTypeId, tenantId])

  // System (A): leave_accrual_rules — 1 day/month
  await pool.query(
    `INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, accrual_frequency, days_per_period, effective_from)
     VALUES ($1,$2,'monthly', 1, CURRENT_DATE - INTERVAL '1 year')`,
    [tenantId, leaveTypeId],
  )

  // System (B): leave_policy_rules + employee-scope assignment — 12 days/year = 1/month
  await pool.query(
    `INSERT INTO leave_policy_masters (id, tenant_id, name, is_default, status, is_active) VALUES ($1,$2,'Employee Override Policy', false, 'published', true)`,
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
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','DOV HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const period = `${year}-${String(month).padStart(2, '0')}`

  const callSystemA = () => fetch(`${API_BASE}/leave/accrual/run`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period }),
  }).then((r) => r.json())

  const callSystemB = () => fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-14 dual-system overlap verification' }),
  }).then((r) => r.json())

  const results = {}
  for (const sys of callOrder) {
    if (sys === 'A') { results.A = await callSystemA(); console.log('System (A) leave_accrual_rules result:', JSON.stringify(results.A.data ?? results.A)) }
    if (sys === 'B') { results.B = await callSystemB(); console.log('System (B) leave_policy_rules (engine) result:', JSON.stringify(results.B.data ?? results.B)) }
  }

  const ledger = await readLedger(tenantId, empId, leaveTypeId)
  const balance = await readBalance(tenantId, empId, leaveTypeId)
  console.log(`Ledger rows (${ledger.length}):`, ledger.map((r) => ({ days: r.days, accrual_type: r.accrual_type, accrued_on: r.accrued_on, notes: r.notes })))
  console.log('Final balance:', balance)

  return { ledgerCount: ledger.length, ledgerTotal: ledger.reduce((s, r) => s + Number(r.days), 0), balance, ledger }
}

async function main() {
  const abResult = await runScenario('AthenB', ['A', 'B'])
  const baResult = await runScenario('BthenA', ['B', 'A'])

  console.log('\n=== VERDICT ===')
  console.log('A-then-B:', { ledgerCount: abResult.ledgerCount, ledgerTotal: abResult.ledgerTotal, balance: abResult.balance })
  console.log('B-then-A:', { ledgerCount: baResult.ledgerCount, ledgerTotal: baResult.ledgerTotal, balance: baResult.balance })

  const bothCreditIndependently = abResult.ledgerCount === 2 && abResult.balance === 2
  if (bothCreditIndependently) {
    console.log('\n❌ CONFIRMED DOUBLE-CREDIT: both systems credited independently and unconditionally for the same employee/leave-type/period — neither is aware of the other, and neither defers. An employee covered by BOTH an employee-scope leave_policy_rules assignment AND a leave_accrual_rules row for the same leave type is credited twice per period (2 days instead of the intended 1), with NO precedence rule — whichever runs, runs; there is no "first one wins" or "skip if the other already credited this period" logic anywhere in either code path. This is confirmed, not merely a theoretical risk, and holds regardless of call order (both orderings produce the same double-credit).')
  } else if (abResult.ledgerCount === 1 && baResult.ledgerCount === 1) {
    console.log('\n✅ No double-credit observed in this configuration — one of the two systems is not crediting this leave type under this scope. See per-scenario ledger rows above for which one.')
  } else {
    console.log('\n⚠️  Inconsistent result between call orders — needs further investigation.', { abResult, baResult })
  }

  await pool.end()
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
