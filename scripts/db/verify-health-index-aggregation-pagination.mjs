#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 15 — attendance file sweep.
 *
 * health-index.ts's POST /attendance/health-index/compute (scope=department
 * and scope=tenant) aggregated from a plain, unpaginated
 * `.select('...').eq('scope','employee').eq('period_month', ...)` read of
 * attendance_health_scores — the exact CLAUDE.md-flagged bug class (a plain
 * select silently truncated at PostgREST's 1,000-row max-rows ceiling) for
 * any tenant with more than 1,000 scored employees in a month. The tenant-
 * scope average and every department's average would be computed from
 * whichever 1,000 rows PostgREST happened to return, not the whole tenant.
 *
 * Fixed by switching both reads to fetchAllRows(). This script proves it
 * directly against real Postgres + real HTTP for the tenant-scope branch
 * (scope_id on this table is a bare TEXT column, not an employee FK, so the
 * read path is exercised identically without needing 1,000+ real employee
 * rows): seeds 1,050 'employee'-scope attendance_health_scores rows with a
 * known, exact average, calls POST /attendance/health-index/compute with
 * scope=tenant, and confirms the persisted tenant-scope row's health_score
 * matches the TRUE average of all 1,050 rows, not the average of the first
 * 1,000 PostgREST would have returned pre-fix.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'HealthIndexAgg!1'
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
  const hrEmail  = `health-idx-agg-hr-${Date.now()}@test.local`
  const periodMonth = '2026-06'

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, 'Health Index Agg', `health-idx-agg-${Date.now()}`])

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','Health HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  // 1,050 'employee'-scope rows — scope_id is a bare TEXT column (not an FK),
  // so these don't need real employees table rows. Scores: 1,000 rows at
  // 50.00, 50 rows at 90.00 — a pre-fix (max-rows=1000) read would almost
  // certainly see only (some permutation of) the 50.00 rows and compute
  // avg=50.00; the TRUE average across all 1,050 is:
  //   (1000*50 + 50*90) / 1050 = (50000 + 4500) / 1050 = 51.904761...
  const total = 1050
  const trueSum = 1000 * 50 + 50 * 90
  const trueAvg = Math.round((trueSum / total) * 100) / 100

  const CHUNK = 200
  for (let i = 0; i < total; i += CHUNK) {
    const chunkSize = Math.min(CHUNK, total - i)
    const values = []
    const params = []
    let p = 1
    for (let j = 0; j < chunkSize; j++) {
      const idx = i + j
      const score = idx < 1000 ? 50.00 : 90.00
      values.push(`($${p++}, 'employee', $${p++}, $${p++}, $${p++}, 'A')`)
      params.push(tenantId, `synthetic-emp-${idx}`, periodMonth, score)
    }
    await pool.query(
      `INSERT INTO attendance_health_scores (tenant_id, scope, scope_id, period_month, health_score, health_grade)
       VALUES ${values.join(',')}`,
      params,
    )
  }

  // Call the real endpoint — scope=tenant aggregation.
  const res = await fetch(`${API_BASE}/attendance/health-index/compute`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ period_month: periodMonth, scope: 'tenant' }),
  })
  const body = await res.json()
  console.log('compute response:', JSON.stringify(body))

  const { rows: [persisted] } = await pool.query(
    `SELECT health_score FROM attendance_health_scores WHERE tenant_id=$1 AND scope='tenant' AND period_month=$2`,
    [tenantId, periodMonth],
  )
  console.log('persisted tenant-scope health_score:', persisted?.health_score, '| true average of all 1,050 rows:', trueAvg)

  const checks = []
  checks.push(['compute reports 1 computed row', body.computed === 1])
  checks.push([`persisted health_score === true average (${trueAvg}), not a capped-1000-row average`, Number(persisted?.health_score) === trueAvg])
  // A pre-fix (max-rows=1000) read would land near 50.00 (if the first 1,000
  // rows returned were the 50.00 ones) — explicitly assert we're NOT there.
  checks.push(['persisted health_score is NOT the capped-page average (50.00)', Number(persisted?.health_score) !== 50.00])

  let allPass = true
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✅' : '❌'} ${label}`)
    if (!pass) allPass = false
  }

  console.log(allPass
    ? '\n✅ FIXED: tenant-scope aggregation reflects all 1,050 rows via fetchAllRows, not a capped 1,000-row page.'
    : '\n❌ STILL BROKEN: aggregation does not reflect the full employee-scope set.')

  await pool.end()
  if (!allPass) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
