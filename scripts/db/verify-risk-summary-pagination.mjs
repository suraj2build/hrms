#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 15 — attendance file sweep.
 *
 * risk.ts's GET /attendance/risk/summary read attendance_risk_profiles
 * with a plain, unpaginated .select() — the same CLAUDE.md-flagged bug
 * class as the health-index.ts fix earlier this checkpoint. For a tenant
 * with more than 1,000 qualifying rows, PostgREST's max-rows ceiling
 * silently truncated the result, so total_employees/avg_risk_score/
 * by_level/elevated_pct reflected an arbitrary partial slice instead of
 * the whole tenant. risk_score is also a DECIMAL(5,2) column that can come
 * back as a string, which would make scoreSum += row.risk_score concatenate
 * instead of sum.
 *
 * Fixed with fetchAllRows() + Number() coercion, mirroring the
 * health-index.ts fix exactly. This script proves it against real
 * Postgres + real HTTP: seeds 1,050 real employees, one risk-profile row
 * each (1,000 at score 10.00 / level 'low', 50 at score 80.00 / level
 * 'critical'), calls the real endpoint, and confirms total_employees=1050
 * and avg_risk_score equals the TRUE average of all 1,050 rows.
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'RiskSummaryAgg!1'
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
  const hrEmail  = `risk-summary-hr-${Date.now()}@test.local`

  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,$2,$3,'active')`, [tenantId, 'Risk Summary Agg', `risk-summary-${Date.now()}`])

  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','Risk HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const hrToken = await loginAndGetToken(hrEmail)

  const total = 1050
  const trueSum = 1000 * 10 + 50 * 80
  const trueAvg = Math.round((trueSum / total) * 100) / 100

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
      empValues.push(`($${pe++}, $${pe++}, $${pe++}, 'Risk', 'Synthetic', $${pe++}, CURRENT_DATE - INTERVAL '1 year', 'active')`)
      empParams.push(empId, tenantId, `RISK${idx}`, `risk-synth-${idx}-${Date.now()}@test.local`)

      const score = idx < 1000 ? 10.00 : 80.00
      const level = idx < 1000 ? 'low' : 'critical'
      riskValues.push(`($${pr++}, $${pr++}, CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE, $${pr++}, $${pr++}, now())`)
      riskParams.push(tenantId, empId, score, level)
    }
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status) VALUES ${empValues.join(',')}`,
      empParams,
    )
    await pool.query(
      `INSERT INTO attendance_risk_profiles (tenant_id, employee_id, period_start, period_end, risk_score, risk_level, computed_at) VALUES ${riskValues.join(',')}`,
      riskParams,
    )
  }

  const res = await fetch(`${API_BASE}/attendance/risk/summary`, {
    headers: { authorization: `Bearer ${hrToken}` },
  })
  const body = await res.json()
  console.log('summary response:', JSON.stringify(body))
  console.log('true average:', trueAvg)

  const checks = []
  checks.push(['total_employees === 1050 (not capped at 1000)', body.total_employees === 1050])
  checks.push([`avg_risk_score === true average (${trueAvg})`, body.avg_risk_score === trueAvg])
  checks.push(['by_level.low === 1000', body.by_level?.low === 1000])
  checks.push(['by_level.critical === 50', body.by_level?.critical === 50])

  let allPass = true
  for (const [label, pass] of checks) {
    console.log(`  ${pass ? '✅' : '❌'} ${label}`)
    if (!pass) allPass = false
  }

  console.log(allPass
    ? '\n✅ FIXED: /attendance/risk/summary reflects all 1,050 rows via fetchAllRows + Number() coercion.'
    : '\n❌ STILL BROKEN.')

  await pool.end()
  if (!allPass) process.exit(1)
}

main().catch((err) => { console.error('FATAL', err); process.exit(1) })
