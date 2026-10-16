#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 15 — attendance file sweep.
 *
 * GET /attendance/risk's list route ordered by risk_score then computed_at
 * only — both can tie across many rows (POST /attendance/risk/compute
 * stamps every row in one call with the SAME computed_at), which makes
 * OFFSET-based .range() pagination unstable across successive page
 * requests without a unique final tie-breaker: a caller paging through
 * (offset=0, offset=500, offset=1000, ...) could see a row skipped or
 * duplicated between pages. Fixed by adding `.order('id', {ascending:
 * true})` as the final, always-unique sort key.
 *
 * This script proves it directly: seeds 1,050 employees with EXACTLY the
 * same risk_score and the same computed_at (the worst case — every prior
 * sort key tied), walks the real endpoint page by page (limit=500), and
 * confirms every one of the 1,050 ids appears in exactly one page — no
 * skips, no duplicates.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'RiskListStable!1'
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
  const hrEmail  = `risk-list-stable-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, 'Risk List Stable', `risk-list-stable-${Date.now()}`])

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','Risk List HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  const total = 1050
  const allIds = new Set()
  const CHUNK = 150
  for (let i = 0; i < total; i += CHUNK) {
    const chunkSize = Math.min(CHUNK, total - i)
    const empValues = []
    const empParams = []
    const riskValues = []
    const riskParams = []
    let pe = 1, pr = 1
    for (let j = 0; j < chunkSize; j++) {
      const idx = i + j
      const empId = uuid()
      const riskId = uuid()
      allIds.add(riskId)
      empValues.push(`($${pe++}, $${pe++}, $${pe++}, 'Risk', 'Synthetic', $${pe++}, CURRENT_DATE - INTERVAL '1 year', 'active')`)
      empParams.push(empId, tenantId, `RLS${idx}`, `risk-list-stable-${idx}-${Date.now()}@test.local`)

      // Every row: same risk_score AND same fixed computed_at ('2026-01-01
      // 00:00:00 UTC' for all) — the worst case for a two-key sort tie.
      riskValues.push(`($${pr++}, $${pr++}, $${pr++}, CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE, 50.00, 'medium', '2026-01-01T00:00:00.000Z')`)
      riskParams.push(riskId, tenantId, empId)
    }
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ${empValues.join(',')}`,
      empParams,
    )
    await pool.query(
      `INSERT INTO attendance_risk_profiles (id, tenant_id, employee_id, period_start, period_end, risk_score, risk_level, computed_at) VALUES ${riskValues.join(',')}`,
      riskParams,
    )
  }

  const seenIds = new Set()
  let duplicates = 0
  const PAGE = 500
  for (let offset = 0; offset < total; offset += PAGE) {
    const res = await fetch(`${API_BASE}/attendance/risk?limit=${PAGE}&offset=${offset}`, {
      headers: { authorization: `Bearer ${hrToken}` },
    })
    const body = await res.json()
    for (const row of body.data ?? []) {
      if (seenIds.has(row.id)) duplicates++
      seenIds.add(row.id)
    }
  }

  const missing = [...allIds].filter((id) => !seenIds.has(id))

  console.log(`Seeded: ${allIds.size} | Seen across pages: ${seenIds.size} | Missing: ${missing.length} | Duplicates: ${duplicates}`)

  const checks = []
  checks.push(['every seeded id was returned exactly once (no skips)', missing.length === 0])
  checks.push(['no id appeared in more than one page (no duplicates)', duplicates === 0])
  checks.push(['total distinct ids seen === 1050', seenIds.size === 1050])

  let allPass = true
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✅' : '❌'} ${label}`)
    if (!pass) allPass = false
  }

  console.log(allPass
    ? '\n✅ FIXED: paging through GET /attendance/risk with fully-tied risk_score+computed_at is stable with the id tie-breaker.'
    : '\n❌ STILL UNSTABLE: pagination skipped or duplicated rows under tied sort keys.')

  await pool.end()
  if (!allPass) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
