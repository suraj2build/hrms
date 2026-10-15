#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 (attendance batch) — investigating a
 * suspected gap found while reading leave-accrual.ts / leave-jobs.ts /
 * leave-entitlement-service.ts together: there appear to be THREE
 * independent, HR-admin-configurable systems that can credit monthly leave
 * accrual for the same leave_type_id:
 *   (A) leave_accrual_rules          -> accrual-engine.ts's runMonthlyAccrual
 *       (CRUD: POST/PUT/DELETE /leave/accrual/rules in leave-accrual.ts)
 *   (B) leave_policy_rules + leave_policy_assignments (scope_type='employee')
 *       -> leave-entitlement-service.ts's runEngineMonthlyAccrual
 *       (Phase 1 of monthlyAccrualJob)
 *   (C) legacy leave_policies        -> monthlyAccrualJob's Phase 2
 * The scheduler (leave-scheduler.ts's execLeaveMonthlyAccrual) calls
 * monthlyAccrualJob (B+C) AND accrual-engine.ts's runMonthlyAccrual (A)
 * unconditionally for every tenant every month, with NO cross-system
 * deduplication (the `engineProcessed` exclusion set only deconflicts B
 * from C, not A from B/C).
 *
 * runEngineMonthlyAccrual (B) only queries assignments with
 * scope_type='employee' — its own docstring says department/work_location/
 * default-scoped assignments are someone else's problem, but nothing else
 * in the job system actually processes those scopes for CREDITING (as
 * opposed to duration/lifecycle READING, which leave-duration.ts and
 * leave-accrual-lifecycle.ts do correctly resolve through the full scope
 * chain). This script empirically determines what actually happens to an
 * employee who is covered ONLY by a default-scope leave_policy_rules
 * configuration (the most common real-world shape — most employees don't
 * get a named per-employee override) when the real monthly-accrual HTTP
 * endpoints run for their tenant.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'AccrualScopeVerify!1'
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
  const tenantId = uuid()
  const empId = uuid()
  const leaveTypeId = uuid()
  const policyId = uuid()
  const hrEmail = `asv-hr-${Date.now()}@test.local`

  console.log('=== Part 1: default-scope-only employee — does monthlyAccrualJob credit them at all? ===')
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Accrual Scope Verify','asv-${Date.now()}','active')`, [tenantId])
  // Employee joined 2 years ago — well past any proration edge case.
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'ASV001','Scope','Gap','asv-emp-${Date.now()}@test.local', CURRENT_DATE - INTERVAL '2 years', 'active')`,
    [empId, tenantId],
  )
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Scope Gap Leave', true)`, [leaveTypeId, tenantId])

  // New-style policy: a default-scope assignment (no employee/department/work_location
  // override) with a monthly accrual_type rule for this leave type — the shape most
  // employees in a real tenant are actually covered by.
  await pool.query(
    `INSERT INTO leave_policy_masters (id, tenant_id, name, is_default, status, is_active)
     VALUES ($1,$2,'Default Policy', true, 'published', true)`,
    [policyId, tenantId],
  )
  await pool.query(
    `INSERT INTO leave_policy_assignments (tenant_id, policy_id, scope_type, scope_id)
     VALUES ($1,$2,'default', NULL)`,
    [tenantId, policyId],
  )
  await pool.query(
    `INSERT INTO leave_policy_rules (tenant_id, policy_id, leave_type_id, accrual_type, accrual_days_per_year)
     VALUES ($1,$2,$3,'monthly', 12)`,
    [tenantId, policyId, leaveTypeId],
  )

  console.log('=== Creating HR admin + logging in ===')
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','ASV HR','${hrEmail}',true)`,
    [hrUserId, tenantId],
  )
  const hrToken = await loginAndGetToken(hrEmail)
  if (!hrToken) { console.log('❌ Failed to log in as HR admin'); process.exit(1) }

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const period = `${year}-${String(month).padStart(2, '0')}`

  console.log(`=== Calling real POST /leave/jobs/monthly-accrual for ${period} (Phase 1+2: employee-scope + legacy leave_policies) ===`)
  const jobRes = await fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-14 scope-gap verification' }),
  })
  const jobBody = await jobRes.json()
  console.log('monthly-accrual job result:', JSON.stringify(jobBody.data ?? jobBody, null, 2).slice(0, 800))

  const { rows: ledgerRows1 } = await pool.query(
    `SELECT id, days, accrual_type, accrued_on FROM leave_accrual_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3`,
    [tenantId, empId, leaveTypeId],
  )
  console.log(`Ledger rows after monthlyAccrualJob (direct Postgres read): ${ledgerRows1.length}`, ledgerRows1)

  if (ledgerRows1.length === 0) {
    console.log('❌ CONFIRMED GAP: the default-scope-covered employee received ZERO monthly accrual credit from POST /leave/jobs/monthly-accrual — runEngineMonthlyAccrual (Phase 1) only queries scope_type=\'employee\' assignments, and Phase 2 only checks the legacy leave_policies table. An employee covered exclusively by a default/department/work_location-scoped leave_policy_rules configuration is silently skipped by every accrual-crediting code path this job touches.')
  } else {
    console.log('✅ No gap found for this scope — employee was credited.')
  }

  console.log('\n=== Part 2: does leave_accrual_rules (system A) ALSO credit if configured for the same leave type, causing a double-credit on top of (or instead of) the gap in Part 1? ===')
  await pool.query(
    `INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, accrual_frequency, days_per_period, effective_from)
     VALUES ($1,$2,'monthly', 1, CURRENT_DATE - INTERVAL '1 year')`,
    [tenantId, leaveTypeId],
  )
  const runRes = await fetch(`${API_BASE}/leave/accrual/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period }),
  })
  const runBody = await runRes.json()
  console.log('leave/accrual/run result:', JSON.stringify(runBody.data ?? runBody, null, 2).slice(0, 800))

  const { rows: ledgerRows2 } = await pool.query(
    `SELECT id, days, accrual_type, accrued_on FROM leave_accrual_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 ORDER BY created_at`,
    [tenantId, empId, leaveTypeId],
  )
  console.log(`Ledger rows after BOTH systems ran for the same period (direct Postgres read): ${ledgerRows2.length}`, ledgerRows2)

  if (ledgerRows2.length >= 1 && ledgerRows1.length === 0) {
    console.log(`\n⚠️  Employee had ZERO credit from system (B) alone, then got credited once system (A) [leave_accrual_rules] ran too. If BOTH systems had instead been configured for the same leave type with the employee covered by system (B) via an EMPLOYEE-scope assignment (not default), both would independently credit the SAME period — confirmed as a real double-credit risk by code inspection of the two independent crediting paths and their lack of cross-awareness (see Part 3).`)
  }

  console.log('\n=== Part 3: direct double-credit — employee-scope leave_policy_rules assignment (Phase 1) PLUS leave_accrual_rules (system A) for the SAME leave type ===')
  const leaveTypeId2 = uuid()
  const policyId2 = uuid()
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Double Credit Leave', true)`, [leaveTypeId2, tenantId])
  await pool.query(
    `INSERT INTO leave_policy_masters (id, tenant_id, name, is_default, status, is_active)
     VALUES ($1,$2,'Employee Override Policy', false, 'published', true)`,
    [policyId2, tenantId],
  )
  await pool.query(
    `INSERT INTO leave_policy_assignments (tenant_id, policy_id, scope_type, scope_id)
     VALUES ($1,$2,'employee', $3)`,
    [tenantId, policyId2, empId],
  )
  await pool.query(
    `INSERT INTO leave_policy_rules (tenant_id, policy_id, leave_type_id, accrual_type, accrual_days_per_year)
     VALUES ($1,$2,$3,'monthly', 12)`,
    [tenantId, policyId2, leaveTypeId2],
  )
  await pool.query(
    `INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, accrual_frequency, days_per_period, effective_from)
     VALUES ($1,$2,'monthly', 1, CURRENT_DATE - INTERVAL '1 year')`,
    [tenantId, leaveTypeId2],
  )

  await fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-14 double-credit verification' }),
  })
  await fetch(`${API_BASE}/leave/accrual/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period }),
  })

  const { rows: ledgerRows3 } = await pool.query(
    `SELECT id, days, accrual_type, accrued_on FROM leave_accrual_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 ORDER BY created_at`,
    [tenantId, empId, leaveTypeId2],
  )
  console.log(`Ledger rows for the dual-configured leave type (direct Postgres read): ${ledgerRows3.length}`, ledgerRows3)

  if (ledgerRows3.length >= 2) {
    console.log(`\n❌ CONFIRMED DOUBLE-CREDIT: an employee with BOTH an employee-scope leave_policy_rules assignment (system B, 1 day/month) AND a leave_accrual_rules row (system A, 1 day/month) for the same leave type received ${ledgerRows3.length} separate ledger credits totalling ${ledgerRows3.reduce((s, r) => s + Number(r.days), 0)} days for a single month, when exactly one credit of 1 day was intended.`)
  } else {
    console.log('✅ No double-credit observed in this configuration.')
  }

  process.exit(0)
}

main()
  .catch((err) => { console.error('FATAL', err); process.exit(1) })
  .finally(() => pool.end())
