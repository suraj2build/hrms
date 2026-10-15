#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 14 (attendance batch) — real-Postgres +
 * real-HTTP proof for the roster-api.ts fetchAllRows fix.
 *
 * GET /attendance/roster's parallel batch-fetch had `employees` correctly
 * paginated via fetchAllRows, but `shift_roster`, `employee_shifts`, and
 * `job_history` were plain unbounded .select() calls — silently truncated
 * at PostgREST's server-side max-rows ceiling (1000 in both real Supabase
 * and this sandbox's test gateway), the exact bug class CLAUDE.md's
 * universal fetchAllRows rule exists to prevent. employee_shifts and
 * job_history are each sized 1:1 with active employee count, so a tenant
 * with >1000 employees would silently lose standing-shift and
 * work-location data for every employee past row 1000, while the
 * (correctly paginated) employee list itself would still include them —
 * a roster grid that looks complete but has wrong data for most of a
 * large tenant.
 *
 * This script seeds 1050 employees in a single tenant, each with a
 * current employee_shifts row and a current job_history row (1050 > the
 * gateway's MAX_ROWS=1000 ceiling), then calls the real
 * GET /attendance/roster endpoint over HTTP and confirms:
 *   (a) employees array has all 1050 rows (already fetchAllRows'd before this fix — sanity check)
 *   (b) standing array (employee_shifts) has all 1050 rows, not truncated at 1000
 *   (c) every one of the 1050 employees has a non-null work_location (sourced from job_history)
 *   (d) no employee past row #1000 (ordered by employee_code) is missing standing/work_location data
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'RosterPagingVerify!1'
const pool = new pg.Pool({ connectionString: DB_URL })
const N = 1050

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
  const shiftId = uuid()
  const hrEmail = `rpv-hr-${Date.now()}@test.local`

  console.log('=== Seeding tenant + 1050 employees + standing shifts + job_history ===')
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Roster Paging Verify','rpv-${Date.now()}','active')`,
    [tenantId],
  )
  await pool.query(
    `INSERT INTO shifts (id, tenant_id, name, code, start_time, end_time, is_active)
     VALUES ($1,$2,'General','GEN','09:00','18:00', true)`,
    [shiftId, tenantId],
  )

  // Bulk-seed N employees via generate_series — avoids 1050 individual round trips.
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     SELECT gen_random_uuid(), $1, 'RPV' || lpad(g::text, 5, '0'), 'Emp', g::text, 'rpv-emp-' || g || '-${Date.now()}@test.local', CURRENT_DATE, 'active'
     FROM generate_series(1, $2) AS g`,
    [tenantId, N],
  )

  // One current employee_shifts row per employee (trg_close_previous_employee_shift
  // only matters on a SECOND insert for the same employee, so a single bulk insert is safe).
  await pool.query(
    `INSERT INTO employee_shifts (id, tenant_id, employee_id, shift_id, effective_from, is_current)
     SELECT gen_random_uuid(), $1, e.id, $2, CURRENT_DATE, true
     FROM employees e WHERE e.tenant_id = $1`,
    [tenantId, shiftId],
  )

  // One current job_history row per employee, each with a distinct work_location
  // so we can later verify every employee's work_location resolved correctly.
  await pool.query(
    `INSERT INTO work_locations (id, tenant_id, name)
     SELECT gen_random_uuid(), $1, 'Loc ' || e.employee_code
     FROM employees e WHERE e.tenant_id = $1`,
    [tenantId],
  )
  await pool.query(
    `INSERT INTO job_history (id, tenant_id, employee_id, work_location_id, employment_type, effective_from, is_current)
     SELECT gen_random_uuid(), $1, e.id, wl.id, 'permanent', CURRENT_DATE, true
     FROM employees e
     JOIN work_locations wl ON wl.tenant_id = e.tenant_id AND wl.name = 'Loc ' || e.employee_code
     WHERE e.tenant_id = $1`,
    [tenantId],
  )

  const { rows: countRows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM employees WHERE tenant_id=$1) AS employees,
       (SELECT count(*) FROM employee_shifts WHERE tenant_id=$1 AND is_current) AS standing,
       (SELECT count(*) FROM job_history WHERE tenant_id=$1 AND is_current) AS job_history`,
    [tenantId],
  )
  console.log('Seeded counts (direct Postgres read):', countRows[0])
  if (Number(countRows[0].employees) !== N || Number(countRows[0].standing) !== N || Number(countRows[0].job_history) !== N) {
    console.log(`❌ Seed itself didn't reach ${N} rows — aborting`)
    process.exit(1)
  }

  console.log('=== Creating HR admin auth user + logging in ===')
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','RPV HR','${hrEmail}',true)`,
    [hrUserId, tenantId],
  )
  const hrToken = await loginAndGetToken(hrEmail)
  if (!hrToken) { console.log('❌ Failed to log in as HR admin'); process.exit(1) }

  const month = new Date().toISOString().slice(0, 7)
  console.log(`=== Calling real GET /attendance/roster?month=${month} ===`)
  const res = await fetch(`${API_BASE}/attendance/roster?month=${month}`, {
    headers: { authorization: `Bearer ${hrToken}` },
  })
  const body = await res.json()
  if (res.status !== 200) {
    console.log('❌ Roster endpoint returned non-200:', res.status, JSON.stringify(body).slice(0, 500))
    process.exit(1)
  }

  const employees = body.employees ?? []
  const standing = body.standing ?? []

  console.log(`HTTP response: employees=${employees.length}, standing=${standing.length}`)

  // (a) employees array
  if (employees.length === N) {
    console.log(`✅ employees array has all ${N} rows (not truncated)`)
  } else {
    console.log(`❌ employees array has ${employees.length}, expected ${N}`)
    allOk = false
  }

  // (b) standing array — THIS is the fix under test. Before the fix this would be
  // capped at the gateway's MAX_ROWS (1000), silently dropping 50 employees' standing shifts.
  if (standing.length === N) {
    console.log(`✅ standing (employee_shifts) array has all ${N} rows (not truncated at 1000)`)
  } else {
    console.log(`❌ standing array has ${standing.length} rows, expected ${N} — PAGINATION BUG REPRODUCED`)
    allOk = false
  }

  // (c) every employee has a resolved work_location (sourced from job_history, also fixed)
  const missingWorkLocation = employees.filter((e) => !e.work_location)
  if (missingWorkLocation.length === 0) {
    console.log(`✅ all ${N} employees have a resolved work_location (job_history not truncated)`)
  } else {
    console.log(`❌ ${missingWorkLocation.length} employees missing work_location — PAGINATION BUG REPRODUCED. First few:`,
      missingWorkLocation.slice(0, 5).map((e) => e.employee_code))
    allOk = false
  }

  // (d) specifically check employees past row #1000 (ordered by employee_code, matching
  // the route's own .order('employee_code')) — these are exactly the rows a 1000-row
  // ceiling would have silently dropped from standing/job_history before the fix.
  const sorted = [...employees].sort((a, b) => a.employee_code.localeCompare(b.employee_code))
  const pastThousand = sorted.slice(1000)
  const standingByEmployee = new Set(standing.map((s) => s.employee_id))
  const pastThousandMissingStanding = pastThousand.filter((e) => !standingByEmployee.has(e.id))
  const pastThousandMissingLocation = pastThousand.filter((e) => !e.work_location)
  if (pastThousandMissingStanding.length === 0 && pastThousandMissingLocation.length === 0) {
    console.log(`✅ all ${pastThousand.length} employees past row #1000 have standing + work_location data`)
  } else {
    console.log(`❌ employees past row #1000: ${pastThousandMissingStanding.length} missing standing, ${pastThousandMissingLocation.length} missing work_location`)
    allOk = false
  }

  console.log(allOk ? '\n=== ALL CHECKS PASS ===' : '\n=== SOME CHECKS FAILED ===')
  process.exit(allOk ? 0 : 1)
}

main()
  .catch((err) => { console.error('FATAL', err); process.exit(1) })
  .finally(() => pool.end())
