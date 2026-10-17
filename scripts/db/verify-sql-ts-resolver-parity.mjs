#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 16 — user-directed requirement:
 * "Keep SQL and TypeScript policy resolvers aligned with shared
 * precedence/effective-date test cases."
 *
 * Migration 470 shipped TWO independent implementations of the same
 * employee > department > work_location > site > default scope-resolution
 * logic:
 *   - SQL:        resolve_engine_policy_rule() (migration 470)
 *   - TypeScript: the resolveApplicableRule() closure duplicated inside
 *                 BOTH runEngineMonthlyAccrual() and runEngineYearlyCredit()
 *                 (leave-entitlement-service.ts) — used for the real,
 *                 batch-efficient crediting path.
 *
 * verify-scoped-policy-accrual.mjs already proved the TS path's BEHAVIOR
 * is correct against hand-computed expectations. It never directly called
 * the SQL function to cross-check — so a silent drift between the two
 * implementations (e.g. a future edit to one resolver that isn't mirrored
 * in the other) would not be caught by that script alone, since it has no
 * independent "what would SQL have picked" oracle to compare against.
 *
 * This script is that oracle. For each case it:
 *   1. Calls resolve_engine_policy_rule() directly over the real Postgres
 *      connection — the SQL resolver's actual answer.
 *   2. Triggers the real HTTP monthly-accrual job — the code path that
 *      runs the TS resolver — and reads back the actual credited ledger
 *      amount.
 *   3. Asserts the TS-credited amount equals round(SQL's
 *      accrual_days_per_year / 12, 1) (the exact formula
 *      runEngineMonthlyAccrual applies to whatever rule it resolves), AND
 *      that SQL's matched_scope_type is the one each case's unique
 *      per-scope day-count makes unambiguous — so a numeric coincidence
 *      can't mask the two resolvers disagreeing about WHICH scope won.
 *
 * Six cases, chosen to directly cover precedence ordering and the
 * effective-date boundary (the two areas the user flagged for drift risk):
 *   A. department wins over work_location/site (employee has all three)
 *   B. work_location wins over site (no department assignment)
 *   C. site wins alone (no department/work_location assignment)
 *   D. default only (no scoped assignment at all)
 *   E. employee-scope override wins over department/work_location/site
 *   F. effective-date boundary — department's RULE (not the assignment)
 *      is not yet effective as of today, so resolution must fall through
 *      to default even though the department assignment itself is active.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'ResolverParity!1'
const pool      = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }
let allOk = true
function check(label, cond, extra) {
  if (cond) { console.log(`✅ ${label}`) } else { console.log(`❌ ${label}`, extra ?? ''); allOk = false }
}

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

async function seedTenant(label) {
  const tenantId = uuid()
  const hrEmail = `parity-${label}-hr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, `Resolver Parity ${label}`, `parity-${label}-${Date.now()}`])
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`, [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)
  return { tenantId, hrToken }
}

async function seedEmployee(tenantId, code, { departmentId = null, workLocationId = null, siteId = null, joiningDaysAgo = 730 } = {}) {
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, department_id, work_location_id, site_id)
     VALUES ($1,$2,$3,'Parity','Verify',$4, CURRENT_DATE - ($5 || ' days')::interval, 'active', $6, $7, $8)`,
    [empId, tenantId, code, `${code}-${Date.now()}@test.local`, joiningDaysAgo, departmentId, workLocationId, siteId],
  )
  return empId
}

async function seedPolicy(tenantId, leaveTypeId, scopeType, scopeId, { daysPerYear = 12, ruleEffectiveFrom = null, ruleEffectiveTo = null } = {}) {
  const policyId = uuid()
  await pool.query(
    `INSERT INTO leave_policy_masters (id, tenant_id, name, is_default, status, is_active) VALUES ($1,$2,$3,$4,'published',true)`,
    [policyId, tenantId, `Policy ${scopeType} ${policyId.slice(0, 8)}`, scopeType === 'default'],
  )
  await pool.query(
    `INSERT INTO leave_policy_assignments (tenant_id, policy_id, scope_type, scope_id) VALUES ($1,$2,$3,$4)`,
    [tenantId, policyId, scopeType, scopeId],
  )
  await pool.query(
    `INSERT INTO leave_policy_rules (tenant_id, policy_id, leave_type_id, accrual_type, accrual_days_per_year, effective_from, effective_to) VALUES ($1,$2,$3,'monthly',$4,$5,$6)`,
    [tenantId, policyId, leaveTypeId, daysPerYear, ruleEffectiveFrom, ruleEffectiveTo],
  )
  return policyId
}

async function runMonthlyAccrual(hrToken, year, month) {
  return fetch(`${API_BASE}/leave/jobs/monthly-accrual`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, reason: 'checkpoint-16 SQL/TS resolver parity' }),
  }).then((r) => r.json())
}

async function sqlResolve(tenantId, empId, leaveTypeId, asOf) {
  const { rows } = await pool.query(
    `SELECT * FROM resolve_engine_policy_rule($1, $2, $3, $4)`,
    [tenantId, empId, leaveTypeId, asOf],
  )
  return rows[0] ?? null
}

async function creditedDays(tenantId, empId, leaveTypeId, year) {
  const { rows } = await pool.query(
    `SELECT sum(days) AS total FROM leave_accrual_ledger WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
    [tenantId, empId, leaveTypeId, year],
  )
  return rows[0]?.total != null ? Number(rows[0].total) : 0
}

const now   = new Date()
const YEAR  = now.getUTCFullYear()
const MONTH = now.getUTCMonth() + 1
const TODAY = now.toISOString().slice(0, 10)

async function runCase(label, expectedScope, setupFn) {
  console.log(`\n=== Case ${label}: expect matched_scope_type='${expectedScope}' ===`)
  const { tenantId, hrToken } = await seedTenant(label)
  const leaveTypeId = uuid()
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Parity Leave', true)`, [leaveTypeId, tenantId])

  const empId = await setupFn(tenantId, leaveTypeId)

  // 1. SQL resolver's direct answer
  const sqlResult = await sqlResolve(tenantId, empId, leaveTypeId, TODAY)
  console.log('  SQL resolver:', sqlResult ? { matched_scope_type: sqlResult.matched_scope_type, accrual_days_per_year: sqlResult.accrual_days_per_year } : null)

  check(`[${label}] SQL resolver matched scope = '${expectedScope}'`, sqlResult?.matched_scope_type === expectedScope, sqlResult)

  // 2. TS resolver's answer, observed via the real HTTP job + ledger credit
  await runMonthlyAccrual(hrToken, YEAR, MONTH)
  const tsCredited = await creditedDays(tenantId, empId, leaveTypeId, YEAR)
  console.log('  TS resolver (via real HTTP job, read back from ledger): credited =', tsCredited)

  const expectedMonthly = sqlResult ? Math.round((Number(sqlResult.accrual_days_per_year) / 12) * 10) / 10 : 0
  check(`[${label}] TS-credited (${tsCredited}) === round(SQL accrual_days_per_year/12, 1) (${expectedMonthly})`, tsCredited === expectedMonthly)
}

async function main() {
  // A. department wins over work_location/site (employee has all three)
  await runCase('A-department-wins', 'department', async (tenantId, leaveTypeId) => {
    const deptId = uuid(), locId = uuid(), siteId = uuid()
    await pool.query(`INSERT INTO departments (id, tenant_id, name) VALUES ($1,$2,'Dept')`, [deptId, tenantId])
    await pool.query(`INSERT INTO work_locations (id, tenant_id, name) VALUES ($1,$2,'Loc')`, [locId, tenantId])
    await pool.query(`INSERT INTO sites (id, tenant_id, name) VALUES ($1,$2,'Site')`, [siteId, tenantId])
    const empId = await seedEmployee(tenantId, 'A001', { departmentId: deptId, workLocationId: locId, siteId })
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    await seedPolicy(tenantId, leaveTypeId, 'site', siteId, { daysPerYear: 24 })
    await seedPolicy(tenantId, leaveTypeId, 'work_location', locId, { daysPerYear: 36 })
    await seedPolicy(tenantId, leaveTypeId, 'department', deptId, { daysPerYear: 48 })
    return empId
  })

  // B. work_location wins over site (no department assignment)
  await runCase('B-work_location-wins', 'work_location', async (tenantId, leaveTypeId) => {
    const locId = uuid(), siteId = uuid()
    await pool.query(`INSERT INTO work_locations (id, tenant_id, name) VALUES ($1,$2,'Loc')`, [locId, tenantId])
    await pool.query(`INSERT INTO sites (id, tenant_id, name) VALUES ($1,$2,'Site')`, [siteId, tenantId])
    const empId = await seedEmployee(tenantId, 'B001', { workLocationId: locId, siteId })
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    await seedPolicy(tenantId, leaveTypeId, 'site', siteId, { daysPerYear: 24 })
    await seedPolicy(tenantId, leaveTypeId, 'work_location', locId, { daysPerYear: 36 })
    return empId
  })

  // C. site wins alone (no department/work_location assignment)
  await runCase('C-site-wins', 'site', async (tenantId, leaveTypeId) => {
    const siteId = uuid()
    await pool.query(`INSERT INTO sites (id, tenant_id, name) VALUES ($1,$2,'Site')`, [siteId, tenantId])
    const empId = await seedEmployee(tenantId, 'C001', { siteId })
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    await seedPolicy(tenantId, leaveTypeId, 'site', siteId, { daysPerYear: 24 })
    return empId
  })

  // D. default only (no scoped assignment at all)
  await runCase('D-default-only', 'default', async (tenantId, leaveTypeId) => {
    const empId = await seedEmployee(tenantId, 'D001', {})
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    return empId
  })

  // E. employee-scope override wins over department/work_location/site
  await runCase('E-employee-override-wins', 'employee', async (tenantId, leaveTypeId) => {
    const deptId = uuid(), locId = uuid(), siteId = uuid()
    await pool.query(`INSERT INTO departments (id, tenant_id, name) VALUES ($1,$2,'Dept')`, [deptId, tenantId])
    await pool.query(`INSERT INTO work_locations (id, tenant_id, name) VALUES ($1,$2,'Loc')`, [locId, tenantId])
    await pool.query(`INSERT INTO sites (id, tenant_id, name) VALUES ($1,$2,'Site')`, [siteId, tenantId])
    const empId = await seedEmployee(tenantId, 'E001', { departmentId: deptId, workLocationId: locId, siteId })
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    await seedPolicy(tenantId, leaveTypeId, 'site', siteId, { daysPerYear: 24 })
    await seedPolicy(tenantId, leaveTypeId, 'work_location', locId, { daysPerYear: 36 })
    await seedPolicy(tenantId, leaveTypeId, 'department', deptId, { daysPerYear: 48 })
    await seedPolicy(tenantId, leaveTypeId, 'employee', empId, { daysPerYear: 60 })
    return empId
  })

  // F. effective-date boundary — department's RULE is not yet effective,
  // so resolution must fall through to default even though the
  // department ASSIGNMENT itself is active.
  await runCase('F-rule-not-yet-effective-falls-to-default', 'default', async (tenantId, leaveTypeId) => {
    const deptId = uuid()
    await pool.query(`INSERT INTO departments (id, tenant_id, name) VALUES ($1,$2,'Dept')`, [deptId, tenantId])
    const empId = await seedEmployee(tenantId, 'F001', { departmentId: deptId })
    await seedPolicy(tenantId, leaveTypeId, 'default', null, { daysPerYear: 12 })
    // Department's rule starts tomorrow — not yet effective as of today.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await seedPolicy(tenantId, leaveTypeId, 'department', deptId, { daysPerYear: 48, ruleEffectiveFrom: tomorrow })
    return empId
  })

  console.log(allOk
    ? '\n✅ ALL PARITY CASES PASS — SQL resolve_engine_policy_rule() and the TS resolveApplicableRule() closures agree on both WHICH scope wins and the resulting credited amount, across precedence ordering and the effective-date boundary.'
    : '\n❌ PARITY MISMATCH — the SQL and TS resolvers disagree on at least one case. Treat as a real defect, not a flaky test.')

  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
