#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 — real-HTTP (not Fastify inject) proof that
 * routes/attendance/leave.ts's legacy leave_applications apply/approve flow
 * is reachable, and that the new period-lock hard-block actually fires
 * against real Postgres, in the same tenant seeded by
 * seed-and-verify-scope.mjs (reads its printed tenant/employee ids via env).
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const API_BASE = 'http://localhost:2001'
const AUTH_BASE = 'http://localhost:9000'
const PASSWORD = 'ScopeVerify!1'

const pool = new pg.Pool({ connectionString: DB_URL })

const TENANT_ID = process.env.TENANT_ID
const HR_EMAIL  = process.env.HR_EMAIL
const EMP_EMAIL = process.env.EMP_EMAIL
if (!TENANT_ID || !HR_EMAIL || !EMP_EMAIL) {
  console.error('Set TENANT_ID, HR_EMAIL, EMP_EMAIL from the previous seed script output')
  process.exit(1)
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

async function api(token, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* no body */ }
  return { status: res.status, json }
}

async function main() {
  const empToken = await login(EMP_EMAIL)
  const hrToken   = await login(HR_EMAIL)

  const leaveTypeRow = await pool.query(
    `SELECT id FROM leave_types WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID],
  )
  const leaveTypeId = leaveTypeRow.rows[0].id

  // ── 1. Reachability: POST /attendance/leave/apply over REAL HTTP ──────────
  const applyRes = await api(empToken, 'POST', '/attendance/leave/apply', {
    leave_type_id: leaveTypeId, from_date: '2099-03-10', to_date: '2099-03-10', session: 'full_day',
  })
  console.log('=== REAL HTTP: POST /attendance/leave/apply ===')
  console.log(JSON.stringify(applyRes, null, 2))

  const appId = applyRes.json?.data?.id
  if (!appId) { console.error('apply did not return an id — aborting'); await pool.end(); process.exit(1) }

  // Confirm it's really in Postgres, not just a 201 response.
  const persisted = await pool.query(`SELECT id, status, from_date, to_date FROM leave_applications WHERE id = $1`, [appId])
  console.log('=== PERSISTED READ-BACK: leave_applications row ===')
  console.log(JSON.stringify(persisted.rows[0], null, 2))

  // ── 2. Lock the period, then attempt approve — must 409, real Postgres ────
  await pool.query(
    `INSERT INTO attendance_period_locks (tenant_id, period_month, state) VALUES ($1, '2099-03', 'LOCKED')`,
    [TENANT_ID],
  )
  const lockedApproveRes = await api(hrToken, 'POST', `/attendance/leave/${appId}/approve`, {})
  console.log('=== REAL HTTP: POST /attendance/leave/:id/approve — period LOCKED ===')
  console.log(JSON.stringify(lockedApproveRes, null, 2))

  const stillPending = await pool.query(`SELECT status FROM leave_applications WHERE id = $1`, [appId])
  console.log('=== PERSISTED READ-BACK after refused approve — status must still be pending ===')
  console.log(JSON.stringify(stillPending.rows[0], null, 2))

  // ── 3. Unlock, retry — the pre-existing path should proceed past the new guard ──
  await pool.query(`UPDATE attendance_period_locks SET state = 'OPEN' WHERE tenant_id = $1 AND period_month = '2099-03'`, [TENANT_ID])
  const openApproveRes = await api(hrToken, 'POST', `/attendance/leave/${appId}/approve`, {})
  console.log('=== REAL HTTP: POST /attendance/leave/:id/approve — period OPEN (retry) ===')
  console.log(JSON.stringify(openApproveRes, null, 2))

  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
