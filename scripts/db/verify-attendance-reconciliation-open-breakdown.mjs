#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 15 — attendance file sweep.
 *
 * GET /attendance/reconciliation/open computed its by_type/by_severity
 * breakdown from the SAME capped (`limit`, ≤200) page returned as `data` —
 * the exact bug class already found and fixed in the sibling
 * `leave-reconciliation.ts`'s `/leave/reconciliation/open` earlier in this
 * audit. For a tenant with more than `limit` unresolved issues, `total`
 * (from an exact count) would show the true number while by_type/
 * by_severity silently undercounted, summing to only the capped page.
 *
 * Fixed in attendance/reconciliation.ts by deriving the breakdown from a
 * dedicated fetchAllRows pull, independent of the capped `data` feed —
 * mirroring the exact fix already applied to leave-reconciliation.ts.
 *
 * This script proves it over real HTTP against real Postgres: seeds 210
 * unresolved attendance_reconciliation_issues rows (> the default limit of
 * 50 AND > the max limit of 200) with a known type/severity distribution,
 * calls the real endpoint with a small limit, and confirms:
 *   - `total` === 210 (exact count, unaffected either way)
 *   - `data.length` === requested limit (the capped page, unchanged)
 *   - by_type/by_severity sum to 210, not to the capped page size
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'ReconOpenBreakdown!1'
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

async function main() {
  const tenantId = uuid()
  const hrEmail  = `recon-open-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, 'Recon Open Breakdown', `recon-open-${Date.now()}`])

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','Recon HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  // One reconciliation run row (FK target for the issues)
  const { rows: [run] } = await pool.query(
    `INSERT INTO attendance_reconciliation_runs (tenant_id, status, scan_from, scan_to, completed_at)
     VALUES ($1, 'completed', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE, now())
     RETURNING id`,
    [tenantId],
  )

  // 210 unresolved issues: 110 'missing_daily_row'/'warning', 100 'orphan_raw_log'/'critical'.
  // employee_id left NULL (nullable, ON DELETE SET NULL) — not needed for this check.
  const ISSUE_TYPES = ['missing_daily_row', 'orphan_raw_log']
  const total = 210
  const values = []
  const params = []
  let p = 1
  for (let i = 0; i < total; i++) {
    const issueType = i < 110 ? 'missing_daily_row' : 'orphan_raw_log'
    const severity  = i < 110 ? 'warning' : 'critical'
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, false)`)
    params.push(run.id, tenantId, issueType, severity)
  }
  await pool.query(
    `INSERT INTO attendance_reconciliation_issues (run_id, tenant_id, issue_type, severity, resolved) VALUES ${values.join(',')}`,
    params,
  )

  // Call the real endpoint with a small limit — well under `total`.
  const res = await fetch(`${API_BASE}/attendance/reconciliation/open?limit=20`, {
    headers: { authorization: `Bearer ${hrToken}` },
  })
  const body = await res.json()

  console.log('Response:', JSON.stringify({ total: body.total, dataLength: body.data?.length, by_type: body.by_type, by_severity: body.by_severity }, null, 2))

  const checks = []
  checks.push(['total === 210 (exact count)', body.total === 210])
  checks.push(['data.length === 20 (capped page unchanged)', body.data?.length === 20])
  checks.push(['by_type.missing_daily_row === 110 (not capped to page)', body.by_type?.missing_daily_row === 110])
  checks.push(['by_type.orphan_raw_log === 100 (not capped to page)', body.by_type?.orphan_raw_log === 100])
  checks.push(['by_severity.warning === 110', body.by_severity?.warning === 110])
  checks.push(['by_severity.critical === 100', body.by_severity?.critical === 100])
  const byTypeSum = Object.values(body.by_type ?? {}).reduce((a, b) => a + b, 0)
  checks.push(['by_type values sum to 210 (not 20)', byTypeSum === 210])

  let allPass = true
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✅' : '❌'} ${label}`)
    if (!pass) allPass = false
  }

  console.log(allPass
    ? '\n✅ FIXED: by_type/by_severity reflect every unresolved issue, not just the capped page.'
    : '\n❌ STILL BROKEN: breakdown does not match the full unresolved set.')

  await pool.end()
  if (!allPass) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
