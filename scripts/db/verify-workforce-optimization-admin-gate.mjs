#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 15 — attendance file sweep.
 *
 * workforce-optimization.ts's 7 GET routes (fairness-balance,
 * consecutive-shifts, rest-gaps, ot-distribution, staffing-hints,
 * shift-overload, hints) had `fastify.authenticate` only — no role check —
 * unlike every sibling file in the same intelligence cluster (anomalies.ts,
 * confidence.ts, health-index.ts, inference.ts), which all gate reads
 * behind HR_ADMIN_ROLES. Any authenticated employee could read every
 * coworker's name alongside fairness scores, OT hours, rest-gap and
 * consecutive-shift violations, and shift-overload status, tenant-wide.
 *
 * Fixed by adding the same `requireAdmin` gate already used by this file's
 * two write routes. This script proves it over real HTTP: a plain
 * 'employee'-role user gets 403 FORBIDDEN on all 7 routes; an 'hr_admin'
 * gets 200 on the same routes.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'WfOptAdminGate!1'
const pool      = new pg.Pool({ connectionString: DB_URL })

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

const ROUTES = [
  '/attendance/workforce-optimization/fairness-balance?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/consecutive-shifts?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/rest-gaps?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/ot-distribution?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/staffing-hints?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/shift-overload?from=2026-01-01&to=2026-01-31',
  '/attendance/workforce-optimization/hints',
]

async function main() {
  const tenantId = uuid()
  const empEmail = `wfopt-emp-${Date.now()}@test.local`
  const hrEmail  = `wfopt-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, 'WF Opt Gate', `wfopt-gate-${Date.now()}`])

  const empUserId = await createAuthUser(empEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'employee','WF Opt Employee',$3,true)`,
    [empUserId, tenantId, empEmail],
  )
  const empToken = await loginAndGetToken(empEmail)

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','WF Opt HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  let allPass = true
  console.log('=== Non-admin employee: expecting 403 on every route ===')
  for (const route of ROUTES) {
    const res = await fetch(`${API_BASE}${route}`, { headers: { authorization: `Bearer ${empToken}` } })
    const pass = res.status === 403
    console.log(`  ${pass ? '✅' : '❌'} ${route} -> ${res.status}`)
    if (!pass) allPass = false
  }

  console.log('\n=== HR admin: expecting 200 on every route ===')
  for (const route of ROUTES) {
    const res = await fetch(`${API_BASE}${route}`, { headers: { authorization: `Bearer ${hrToken}` } })
    const pass = res.status === 200
    console.log(`  ${pass ? '✅' : '❌'} ${route} -> ${res.status}`)
    if (!pass) allPass = false
  }

  console.log(allPass
    ? '\n✅ FIXED: all 7 read routes now require hr_admin/super_admin; a plain employee is blocked, HR admin is not.'
    : '\n❌ STILL BROKEN: at least one route does not enforce the admin gate correctly.')

  await pool.end()
  if (!allPass) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
