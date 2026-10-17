#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 (recruitment/talent/succession/onboarding/positions/
 * manager sweep) — verifies the fix for ManagerRequisition.tsx's "My
 * Requisitions" table.
 *
 * Before the fix: GET /recruitment/requisitions had no way to scope to the
 * calling user, so the page (titled "My Requisitions") actually rendered
 * every requisition in the tenant — every other manager's and department's,
 * including salary_min/salary_max — under a heading that promised only the
 * caller's own.
 *
 * This script creates two managers in the same tenant, has each raise one
 * requisition, then confirms:
 *   1. GET /recruitment/requisitions?mine=true as Manager A returns ONLY
 *      Manager A's requisition.
 *   2. The same call as Manager B returns ONLY Manager B's requisition.
 *   3. GET /recruitment/requisitions (no mine param) as either manager still
 *      returns BOTH requisitions — confirming `mine` is additive, not a
 *      silent behavior change for existing callers (AdminRecruitment.tsx /
 *      AdminRecruitmentDashboard.tsx call it unfiltered as HR admin).
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'ReqMineScopeVerify!1'
const pool = new pg.Pool({ connectionString: DB_URL })

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

let failed = false
function check(cond, okMsg, failMsg) {
  if (cond) { console.log(`✅ ${okMsg}`) } else { console.log(`❌ ${failMsg}`); failed = true }
}

async function main() {
  const tenantId = uuid()
  const stamp = Date.now()
  await pool.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Req Mine Scope Verify',$2,'active')`,
    [tenantId, `rmsv-${stamp}`],
  )

  const mgrAEmail = `rmsv-mgr-a-${stamp}@test.local`
  const mgrBEmail = `rmsv-mgr-b-${stamp}@test.local`
  const mgrAId = await createAuthUser(mgrAEmail)
  const mgrBId = await createAuthUser(mgrBEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'manager','Manager A',$3,true)`,
    [mgrAId, tenantId, mgrAEmail],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'manager','Manager B',$3,true)`,
    [mgrBId, tenantId, mgrBEmail],
  )
  const tokenA = await loginAndGetToken(mgrAEmail)
  const tokenB = await loginAndGetToken(mgrBEmail)
  if (!tokenA || !tokenB) { console.log('❌ Failed to log in both managers'); process.exit(1) }

  console.log('=== Manager A raises a requisition ===')
  const postA = await fetch(`${API_BASE}/recruitment/requisitions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `RMSV Role A ${stamp}`, openings: 1, salary_min: 500000, salary_max: 700000 }),
  })
  const bodyA = await postA.json()
  if (!bodyA?.data?.id) { console.log('❌ Manager A requisition creation failed:', JSON.stringify(bodyA)); process.exit(1) }
  const reqIdA = bodyA.data.id

  console.log('=== Manager B raises a requisition ===')
  const postB = await fetch(`${API_BASE}/recruitment/requisitions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `RMSV Role B ${stamp}`, openings: 1, salary_min: 600000, salary_max: 800000 }),
  })
  const bodyB = await postB.json()
  if (!bodyB?.data?.id) { console.log('❌ Manager B requisition creation failed:', JSON.stringify(bodyB)); process.exit(1) }
  const reqIdB = bodyB.data.id

  console.log('\n=== GET /recruitment/requisitions?mine=true as Manager A ===')
  const mineA = await (await fetch(`${API_BASE}/recruitment/requisitions?mine=true`, {
    headers: { authorization: `Bearer ${tokenA}` },
  })).json()
  const mineAIds = (mineA.data ?? []).map(r => r.id)
  check(
    mineAIds.includes(reqIdA) && !mineAIds.includes(reqIdB),
    `Manager A's mine=true list has exactly their own requisition (${mineAIds.length} row(s))`,
    `Manager A's mine=true list is wrong: ${JSON.stringify(mineAIds)} (expected [${reqIdA}] only)`,
  )

  console.log('\n=== GET /recruitment/requisitions?mine=true as Manager B ===')
  const mineB = await (await fetch(`${API_BASE}/recruitment/requisitions?mine=true`, {
    headers: { authorization: `Bearer ${tokenB}` },
  })).json()
  const mineBIds = (mineB.data ?? []).map(r => r.id)
  check(
    mineBIds.includes(reqIdB) && !mineBIds.includes(reqIdA),
    `Manager B's mine=true list has exactly their own requisition (${mineBIds.length} row(s))`,
    `Manager B's mine=true list is wrong: ${JSON.stringify(mineBIds)} (expected [${reqIdB}] only)`,
  )

  console.log('\n=== GET /recruitment/requisitions (no mine param) as Manager A — must stay unfiltered (back-compat for AdminRecruitment.tsx) ===')
  const allA = await (await fetch(`${API_BASE}/recruitment/requisitions`, {
    headers: { authorization: `Bearer ${tokenA}` },
  })).json()
  const allAIds = (allA.data ?? []).map(r => r.id)
  check(
    allAIds.includes(reqIdA) && allAIds.includes(reqIdB),
    'Unfiltered GET still returns both requisitions (no regression for existing HR-admin callers)',
    `Unfiltered GET is missing a requisition it should still show: ${JSON.stringify(allAIds)}`,
  )

  console.log(failed ? '\n❌ VERIFICATION FAILED' : '\n✅ VERIFICATION PASSED')
  await pool.end()
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
