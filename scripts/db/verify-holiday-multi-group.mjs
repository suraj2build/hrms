#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14, checkpoint 28 — proves the multi-group holiday
 * fix end-to-end against real Postgres + real HTTP + the real attendance
 * engine, for both engines the audit touched:
 *
 *   PART 1 — attendance-engine.ts's computeDay(): seeds two sites, each
 *     observing a DIFFERENT holiday group (A, B). Assigns ONE holiday to
 *     BOTH groups via the real POST /masters/holidays/group-assignments
 *     endpoint (group_ids: [B, A] — B first, deliberately not A, since the
 *     confirmed bug was "only group_ids[0] took effect"). Seeds one
 *     employee per site, each with a punch session on that date. Confirms
 *     via a direct DB read of attendance_daily that BOTH employees'
 *     statuses are 'holiday' — group A's employee (listed SECOND in
 *     group_ids) must not be silently excluded.
 *
 *   PART 2 — the atomic group-assignment write itself: confirms the
 *     legacy holiday_calendar.holiday_group_id column is no longer
 *     written (stays NULL) and the real holiday_group_assignments table
 *     holds exactly the 2 rows requested.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'HolidayMultiGroup!1'
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

async function main() {
  const tenantId = uuid()
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`,
    [tenantId, 'Holiday Multi Group', `holiday-mg-${Date.now()}`])

  const hrEmail = `holiday-mg-hr-${Date.now()}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`,
    [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)

  // Two holiday groups.
  const groupAId = uuid()
  const groupBId = uuid()
  await pool.query(`INSERT INTO roster_holiday_groups (id, tenant_id, name) VALUES ($1,$2,'Group A'), ($3,$2,'Group B')`,
    [groupAId, tenantId, groupBId])

  // Two sites, each observing a different group.
  const siteAId = uuid()
  const siteBId = uuid()
  await pool.query(
    `INSERT INTO sites (id, tenant_id, name, code, timezone, holiday_group_id)
     VALUES ($1,$2,'Site A','SITE-A','Asia/Kolkata',$3), ($4,$2,'Site B','SITE-B','Asia/Kolkata',$5)`,
    [siteAId, tenantId, groupAId, siteBId, groupBId],
  )

  // Two employees, one per site.
  async function seedEmployee(label, siteId) {
    const empId = uuid()
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status, site_id)
       VALUES ($1,$2,$3,'HolidayMG',$4,$5,'2020-01-01','active',$6)`,
      [empId, tenantId, `HMG-${label}`, label, `holiday-mg-emp-${label}-${Date.now()}@test.local`, siteId],
    )
    return empId
  }
  const empAId = await seedEmployee('A', siteAId)
  const empBId = await seedEmployee('B', siteBId)

  // A holiday, initially with no group assignment.
  const holidayDate = '2025-11-19' // a Wednesday, clear of weekly-offs
  const holidayId = uuid()
  await pool.query(
    `INSERT INTO holiday_calendar (id, tenant_id, date, name, is_optional) VALUES ($1,$2,$3,'Multi-Group Test Holiday',false)`,
    [holidayId, tenantId, holidayDate],
  )

  // Assign the holiday to BOTH groups via the real HTTP endpoint —
  // deliberately group B first, A second (the confirmed bug only honored
  // index 0).
  const assignRes = await fetch(`${API_BASE}/masters/holidays/group-assignments`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ holiday_id: holidayId, group_ids: [groupBId, groupAId] }),
  })
  const assignBody = await assignRes.json()
  check('[assign] group-assignments POST succeeds', assignRes.status === 200, { status: assignRes.status, assignBody })

  // ── PART 2: verify the write itself ──────────────────────────────────────
  const { rows: legacyRows } = await pool.query(`SELECT holiday_group_id FROM holiday_calendar WHERE id=$1`, [holidayId])
  check('[write] legacy holiday_calendar.holiday_group_id is no longer written (stays NULL)', legacyRows[0]?.holiday_group_id === null, legacyRows[0])

  const { rows: assignmentRows } = await pool.query(
    `SELECT group_id FROM holiday_group_assignments WHERE tenant_id=$1 AND holiday_id=$2 ORDER BY group_id`, [tenantId, holidayId])
  const assignedSet = new Set(assignmentRows.map(r => r.group_id))
  check('[write] both groups are actually assigned in holiday_group_assignments',
    assignedSet.has(groupAId) && assignedSet.has(groupBId) && assignmentRows.length === 2, assignmentRows)

  // ── PART 1: real attendance computation for employees in BOTH groups ────
  // attendance_raw_logs requires a device_id or source_id (chk_raw_logs_origin).
  const sourceId = uuid()
  await pool.query(
    `INSERT INTO attendance_api_sources (id, tenant_id, name, endpoint_url) VALUES ($1,$2,'Test Source','http://test.local')`,
    [sourceId, tenantId],
  )

  // Seed one raw punch session per employee on a given date so
  // computeDay() has something to classify.
  async function seedPunch(empId, empCode, date = holidayDate) {
    const ts = `${date}T04:00:00.000Z` // ~9:30am IST
    await pool.query(
      `INSERT INTO attendance_raw_logs (tenant_id, employee_code, "timestamp", direction, processed, source_id)
       VALUES ($1,$2,$3,'in',false,$4)`,
      [tenantId, empCode, ts, sourceId],
    )
  }
  await seedPunch(empAId, 'HMG-A')
  await seedPunch(empBId, 'HMG-B')

  // Run the real attendance processor over this date via its HTTP route.
  const processRes = await fetch(`${API_BASE}/attendance/process`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ date: holidayDate, force: true }),
  })
  const processBody = await processRes.json().catch(() => ({}))
  check('[process] attendance processing endpoint responds OK', [200, 202].includes(processRes.status), { status: processRes.status, processBody })

  // Poll briefly in case processing is async.
  async function pollStatuses(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT employee_id, status FROM attendance_daily WHERE tenant_id=$1 AND date=$2 AND employee_id IN ($3,$4)`,
        [tenantId, holidayDate, empAId, empBId],
      )
      if (rows.length === 2) return rows
      await new Promise(r => setTimeout(r, 1000))
    }
    const { rows } = await pool.query(
      `SELECT employee_id, status FROM attendance_daily WHERE tenant_id=$1 AND date=$2 AND employee_id IN ($3,$4)`,
      [tenantId, holidayDate, empAId, empBId],
    )
    return rows
  }
  const statusRows = await pollStatuses()
  const statusByEmp = Object.fromEntries(statusRows.map(r => [r.employee_id, r.status]))

  check('[attendance] Group A employee (group_ids[1], the one the bug dropped) is classified as holiday',
    statusByEmp[empAId] === 'holiday', { statusByEmp, empAId, empBId })
  check('[attendance] Group B employee (group_ids[0]) is classified as holiday',
    statusByEmp[empBId] === 'holiday', { statusByEmp, empAId, empBId })

  // ── PART 3: overlapping group coverage must NOT double-apply (no duplicate
  // attendance/leave/benefit effect) ──────────────────────────────────────
  // Real-schema finding: a second, SEPARATE holiday_calendar row on the SAME
  // DATE for the same tenant is not just undesirable, it is IMPOSSIBLE —
  // `uq_holiday_calendar_tenant_date` is a real UNIQUE(tenant_id, date)
  // constraint. Confirm that directly (not assumed) by attempting exactly
  // that insert and catching the real Postgres rejection.
  let overlapInsertRejected = false
  try {
    await pool.query(
      `INSERT INTO holiday_calendar (id, tenant_id, date, name, is_optional) VALUES ($1,$2,$3,'Overlapping Second Holiday',false)`,
      [uuid(), tenantId, holidayDate],
    )
  } catch (e) {
    overlapInsertRejected = e?.code === '23505' && e?.constraint === 'uq_holiday_calendar_tenant_date'
  }
  check('[overlap] DB rejects a second holiday_calendar row for the same (tenant,date) — duplicate-holiday-record overlap is structurally impossible, not just avoided',
    overlapInsertRejected)

  // The remaining overlap surface is per-employee group matching: since
  // employee eligibility resolves through exactly one group id (their site's
  // single holiday_group_id — see org-context.ts), one employee can only
  // ever match a holiday via one group, even when that holiday is assigned
  // to several groups (Part 1 above already proved multi-group assignment
  // works for every assigned group's employees, not just group_ids[0]).
  // Re-run attendance processing again over the already-processed date to
  // confirm idempotent re-processing (a holiday applying "for every matched
  // group" in isHolidayForEmployee's OR-across-groups logic) still yields
  // exactly one attendance_daily row per employee, not a duplicate/updated-
  // twice row — backed by attendance_daily's own UNIQUE(tenant_id,
  // employee_id, date) constraint plus the single-upsert-per-employee
  // pattern in every consumer.
  await fetch(`${API_BASE}/attendance/process`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ date: holidayDate, force: true }),
  })
  await new Promise(r => setTimeout(r, 2000))
  const { rows: overlapRows } = await pool.query(
    `SELECT id, status, work_hours FROM attendance_daily WHERE tenant_id=$1 AND employee_id=$2 AND date=$3`,
    [tenantId, empAId, holidayDate],
  )
  check('[overlap] exactly ONE attendance_daily row exists for employee A after re-processing the multi-group holiday date (no duplicate row)',
    overlapRows.length === 1, overlapRows)
  check('[overlap] that row is still a plain holiday (status/work_hours not stacked or corrupted by re-processing)',
    overlapRows[0]?.status === 'holiday' && Number(overlapRows[0]?.work_hours) === 0, overlapRows[0])

  // ── PART 4: legacy single-group and global (no-group) behavior preserved ──
  // A holiday with ZERO group assignments must still behave as GLOBAL
  // (applies to every employee, any group or none) — the exact meaning the
  // old `holiday_group_id IS NULL` case had. A holiday assigned to exactly
  // ONE group must still correctly EXCLUDE employees outside that group —
  // not just include members (proven already above) but actually scope out
  // non-members, matching the old single-FK column's behavior exactly.
  const globalDate = '2025-11-20'
  const globalHolidayId = uuid()
  await pool.query(
    `INSERT INTO holiday_calendar (id, tenant_id, date, name, is_optional) VALUES ($1,$2,$3,'Global No-Group Holiday',false)`,
    [globalHolidayId, tenantId, globalDate],
  )
  // Deliberately left with ZERO group assignments (no POST to group-assignments at all).
  await seedPunch(empAId, 'HMG-A', globalDate)
  await seedPunch(empBId, 'HMG-B', globalDate)
  await fetch(`${API_BASE}/attendance/process`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ date: globalDate, force: true }),
  })
  await new Promise(r => setTimeout(r, 2000))
  const { rows: globalRows } = await pool.query(
    `SELECT employee_id, status FROM attendance_daily WHERE tenant_id=$1 AND date=$2 AND employee_id IN ($3,$4)`,
    [tenantId, globalDate, empAId, empBId],
  )
  const globalByEmp = Object.fromEntries(globalRows.map(r => [r.employee_id, r.status]))
  check('[global] a zero-group holiday still applies globally to Group A employee',
    globalByEmp[empAId] === 'holiday', globalByEmp)
  check('[global] a zero-group holiday still applies globally to Group B employee',
    globalByEmp[empBId] === 'holiday', globalByEmp)

  const singleGroupDate = '2025-11-21'
  const singleGroupHolidayId = uuid()
  await pool.query(
    `INSERT INTO holiday_calendar (id, tenant_id, date, name, is_optional) VALUES ($1,$2,$3,'Single-Group Holiday (Group B only)',false)`,
    [singleGroupHolidayId, tenantId, singleGroupDate],
  )
  const singleAssignRes = await fetch(`${API_BASE}/masters/holidays/group-assignments`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ holiday_id: singleGroupHolidayId, group_ids: [groupBId] }),
  })
  check('[single-group] single-group assignment succeeds', singleAssignRes.status === 200, await singleAssignRes.json().catch(() => ({})))
  await seedPunch(empAId, 'HMG-A', singleGroupDate)
  await seedPunch(empBId, 'HMG-B', singleGroupDate)
  await fetch(`${API_BASE}/attendance/process`, {
    method: 'POST', headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ date: singleGroupDate, force: true }),
  })
  await new Promise(r => setTimeout(r, 2000))
  const { rows: singleRows } = await pool.query(
    `SELECT employee_id, status FROM attendance_daily WHERE tenant_id=$1 AND date=$2 AND employee_id IN ($3,$4)`,
    [tenantId, singleGroupDate, empAId, empBId],
  )
  const singleByEmp = Object.fromEntries(singleRows.map(r => [r.employee_id, r.status]))
  check('[single-group] Group B employee (the assigned group) IS classified as holiday',
    singleByEmp[empBId] === 'holiday', singleByEmp)
  check('[single-group] Group A employee (NOT the assigned group) is correctly EXCLUDED (not holiday) — single-group scoping still works',
    singleByEmp[empAId] !== 'holiday', singleByEmp)

  console.log(allOk ? '\n✅ All checks passed.' : '\n❌ Some checks failed — see above.')
  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
