#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 6 — real HTTP verification of the
 * manager-scope fix across a genuine 3-level hierarchy, against the real
 * API server (port 2001) backed by real Postgres (hrms_uat) through the
 * local PostgREST-compatible gateway shim (port 9000).
 *
 * Hierarchy: HR_ADMIN (no manager) ; MGR_TOP (manager-of-managers) ;
 * MGR_MID (immediate manager, manager_id = MGR_TOP) ; EMP (manager_id = MGR_MID).
 *
 * Seeds one pending item of each type for EMP, then logs in as each
 * actionable role and hits the real routes.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const API_BASE = 'http://localhost:2001'
const AUTH_BASE = 'http://localhost:9000'
const PASSWORD = 'ScopeVerify!1'

const pool = new pg.Pool({ connectionString: DB_URL })

function uuid() { return crypto.randomUUID() }

async function createAuthUser(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`createAuthUser(${email}) failed: ${JSON.stringify(body)}`)
  return body.id
}

async function login(email) {
  const res = await fetch(`${AUTH_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`login(${email}) failed: ${JSON.stringify(body)}`)
  return body.access_token
}

async function main() {
  const tenantId = uuid()
  const slug = `scope-verify-${Date.now()}`

  await pool.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')`,
    [tenantId, 'Scope Verify Co', slug],
  )

  const hrEmail   = `hr-top-${Date.now()}@test.local`
  const mgrTopEmail = `mgr-top-${Date.now()}@test.local`
  const mgrMidEmail = `mgr-mid-${Date.now()}@test.local`
  const empEmail    = `emp1-${Date.now()}@test.local`

  const hrUserId     = await createAuthUser(hrEmail)
  const mgrTopUserId = await createAuthUser(mgrTopEmail)
  const mgrMidUserId = await createAuthUser(mgrMidEmail)
  const empUserId    = await createAuthUser(empEmail)

  // Employees — hierarchy: EMP -> MGR_MID -> MGR_TOP
  const mgrTopEmpId = uuid()
  const mgrMidEmpId = uuid()
  const empEmpId    = uuid()
  const hrEmpId      = uuid()

  async function insertEmployee(id, code, firstName, managerId) {
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, manager_id, status)
       VALUES ($1, $2, $3, $4, 'Verify', $5, CURRENT_DATE, $6, 'active')`,
      [id, tenantId, code, firstName, `${code.toLowerCase()}@scope-verify.test`, managerId],
    )
  }
  await insertEmployee(hrEmpId, 'HR001', 'HrTop', null)
  await insertEmployee(mgrTopEmpId, 'MGR001', 'MgrTop', null)
  await insertEmployee(mgrMidEmpId, 'MGR002', 'MgrMid', mgrTopEmpId)
  await insertEmployee(empEmpId, 'EMP001', 'Employee', mgrMidEmpId)

  async function insertProfile(userId, employeeId, role, fullName, email) {
    await pool.query(
      `INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [userId, tenantId, employeeId, role, fullName, email],
    )
  }
  await insertProfile(hrUserId, hrEmpId, 'hr_admin', 'Hr Top', hrEmail)
  await insertProfile(mgrTopUserId, mgrTopEmpId, 'manager', 'Mgr Top', mgrTopEmail)
  await insertProfile(mgrMidUserId, mgrMidEmpId, 'manager', 'Mgr Mid', mgrMidEmail)
  await insertProfile(empUserId, empEmpId, 'employee', 'Employee One', empEmail)

  // leave_type (paid, for the pending leave request)
  const leaveTypeId = uuid()
  await pool.query(
    `INSERT INTO leave_types (id, tenant_id, name, is_paid, allow_sandwich, is_active, allow_half_day, allow_hourly)
     VALUES ($1, $2, 'Annual Leave', true, false, true, true, false)`,
    [leaveTypeId, tenantId],
  )

  // Pending items for EMP — one of each of the 4 approval types.
  const leaveReqId = uuid()
  await pool.query(
    `INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, from_date, to_date, computed_days, half_day, status, requested_by, session)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + 10, CURRENT_DATE + 10, 1, false, 'PENDING', $5, 'full_day')`,
    [leaveReqId, tenantId, empEmpId, leaveTypeId, empUserId],
  )

  const otReqId = uuid()
  await pool.query(
    `INSERT INTO overtime_requests (id, tenant_id, employee_id, attendance_date, raw_ot_minutes, status, requested_by)
     VALUES ($1, $2, $3, CURRENT_DATE - 1, 90, 'PENDING', $4)`,
    [otReqId, tenantId, empEmpId, empUserId],
  )

  const coReqId = uuid()
  await pool.query(
    `INSERT INTO comp_off_requests (id, tenant_id, employee_id, worked_date, leave_type_id, days_to_credit, status, created_by)
     VALUES ($1, $2, $3, CURRENT_DATE - 2, $4, 1, 'pending', $5)`,
    [coReqId, tenantId, empEmpId, leaveTypeId, empUserId],
  )

  const regReqId = uuid()
  await pool.query(
    `INSERT INTO attendance_regularisation (id, tenant_id, employee_id, date, reason, status, submitted_by)
     VALUES ($1, $2, $3, CURRENT_DATE - 1, 'Forgot to punch out', 'pending', $4)`,
    [regReqId, tenantId, empEmpId, empUserId],
  )

  console.log(JSON.stringify({
    tenantId, slug,
    hrEmail, mgrTopEmail, mgrMidEmail, empEmail,
    leaveReqId, otReqId, coReqId, regReqId,
  }, null, 2))

  // ── Log in as each actionable role ──────────────────────────────────────
  const hrToken     = await login(hrEmail)
  const mgrTopToken = await login(mgrTopEmail)
  const mgrMidToken = await login(mgrMidEmail)

  async function api(token, method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    let json = null
    try { json = await res.json() } catch { /* no body */ }
    return { status: res.status, json }
  }

  const results = {}

  for (const [label, token] of [['MGR_TOP (manager-of-managers)', mgrTopToken], ['MGR_MID (immediate manager)', mgrMidToken], ['HR_ADMIN', hrToken]]) {
    const pendingCount = await api(token, 'GET', '/approvals/pending-count')
    const pendingList  = await api(token, 'GET', '/approvals/pending?limit=50')
    const otList       = await api(token, 'GET', '/overtime/requests?status=PENDING')
    const coList       = await api(token, 'GET', '/attendance/comp-off?status=pending')
    results[label] = {
      pending_count: pendingCount.json?.data,
      pending_list_leave_ids: (pendingList.json?.leave_requests ?? []).map(r => r.id),
      pending_list_reg_ids:   (pendingList.json?.regularisations ?? []).map(r => r.id),
      ot_list_ids: (otList.json?.data ?? []).map(r => r.id),
      co_list_ids: (coList.json?.data ?? []).map(r => r.id),
    }
  }

  // Action attempts: each manager tries to approve EACH pending item.
  const actionResults = {}
  for (const [label, token] of [['MGR_TOP', mgrTopToken], ['MGR_MID', mgrMidToken]]) {
    actionResults[label] = {
      leave_approve_status:  (await api(token, 'POST', `/leave-requests/${leaveReqId}/approve`, {})).status,
    }
  }
  // Re-fetch fresh tokens/status for OT and comp-off approve attempts against
  // a SEPARATE still-pending item each, since the leave approve above may
  // have already consumed it for whichever caller succeeded.
  actionResults['MGR_TOP'].ot_approve_status = (await api(mgrTopToken, 'POST', `/overtime/requests/${otReqId}/approve`, {})).status
  actionResults['MGR_TOP'].co_approve_status = (await api(mgrTopToken, 'POST', `/attendance/comp-off/${coReqId}/approve`, {})).status

  console.log('=== LIST/COUNT RESULTS ===')
  console.log(JSON.stringify(results, null, 2))
  console.log('=== ACTION ATTEMPT RESULTS (MGR_TOP tried first; leave item may now be APPROVED if MGR_MID has not acted yet) ===')
  console.log(JSON.stringify(actionResults, null, 2))

  // Now have MGR_MID (the real immediate manager) approve the OT + comp-off
  // items that MGR_TOP should have been refused on, proving they're still
  // actionable by the correct manager.
  const midActs = {
    ot_approve_status: (await api(mgrMidToken, 'POST', `/overtime/requests/${otReqId}/approve`, {})).status,
    co_approve_status: (await api(mgrMidToken, 'POST', `/attendance/comp-off/${coReqId}/approve`, {})).status,
  }
  console.log('=== MGR_MID (correct immediate manager) ACTION RESULTS ===')
  console.log(JSON.stringify(midActs, null, 2))

  console.log('=== CREDENTIALS (for browser verification) ===')
  console.log(JSON.stringify({ hrEmail, mgrTopEmail, mgrMidEmail, empEmail, password: PASSWORD }, null, 2))

  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
