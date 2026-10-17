#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 (recruitment/talent/succession/onboarding/positions/
 * manager sweep) — verifies the fix to GET /employees/:id/readiness and
 * GET /employees/:id/onboarding-timeline.
 *
 * Both routes were HR-admin-only (apps/api/src/routes/onboarding/readiness.ts,
 * timeline.ts), but EssOnboarding.tsx's ReadinessCard.tsx and
 * LifecycleTimeline.tsx call these EXACT endpoints with the caller's OWN
 * employeeId so every employee can see their own onboarding readiness/
 * timeline — that self-view was silently 403'ing for every non-HR-admin
 * employee. Confirms:
 *   1. A plain employee CAN read their own readiness/timeline (self).
 *   2. A plain employee CANNOT read a DIFFERENT employee's readiness/timeline
 *      (the original IDOR concern the HR-admin-only fix was trying to close
 *      stays closed).
 *   3. An HR admin can still read anyone's.
 */
import pg from 'pg'

const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'ReadinessSelfVerify!1'
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
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Readiness Self Verify',$2,'active')`,
    [tenantId, `rsv-${stamp}`],
  )

  // Two employee records, each linked to its own auth profile.
  const empAId = uuid()
  const empBId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'RSVA','Readiness','A','rsv-emp-a-${stamp}@test.local', CURRENT_DATE, 'active')`,
    [empAId, tenantId],
  )
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'RSVB','Readiness','B','rsv-emp-b-${stamp}@test.local', CURRENT_DATE, 'active')`,
    [empBId, tenantId],
  )

  const empAEmail = `rsv-user-a-${stamp}@test.local`
  const empBEmail = `rsv-user-b-${stamp}@test.local`
  const hrEmail   = `rsv-hr-${stamp}@test.local`
  const userAId = await createAuthUser(empAEmail)
  const userBId = await createAuthUser(empBEmail)
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, employee_id, full_name, email, is_active) VALUES ($1,$2,'employee',$3,'Employee A',$4,true)`,
    [userAId, tenantId, empAId, empAEmail],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, employee_id, full_name, email, is_active) VALUES ($1,$2,'employee',$3,'Employee B',$4,true)`,
    [userBId, tenantId, empBId, empBEmail],
  )
  await pool.query(
    `INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','RSV HR',$3,true)`,
    [hrUserId, tenantId, hrEmail],
  )
  const tokenA = await loginAndGetToken(empAEmail)
  const tokenB = await loginAndGetToken(empBEmail)
  const tokenHr = await loginAndGetToken(hrEmail)
  if (!tokenA || !tokenB || !tokenHr) { console.log('❌ Failed to log in all three users'); process.exit(1) }

  for (const [label, path] of [
    ['readiness', `/employees/${empAId}/readiness`],
    ['onboarding-timeline', `/employees/${empAId}/onboarding-timeline`],
  ]) {
    console.log(`\n=== ${label}: Employee A reads their OWN ${label} ===`)
    const selfRes = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${tokenA}` } })
    check(selfRes.status === 200, `Self-access to own ${label} returns 200`, `Self-access to own ${label} returned ${selfRes.status} (expected 200) — EssOnboarding.tsx's self-view would be broken`)

    console.log(`=== ${label}: Employee B tries to read Employee A's ${label} ===`)
    const crossRes = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${tokenB}` } })
    check(crossRes.status === 403, `Cross-employee access is still blocked (${crossRes.status})`, `Cross-employee access returned ${crossRes.status} (expected 403) — the original IDOR this HR-admin-only fix targeted would have reopened`)

    console.log(`=== ${label}: HR admin reads Employee A's ${label} ===`)
    const hrRes = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bearer ${tokenHr}` } })
    check(hrRes.status === 200, `HR admin access still returns 200`, `HR admin access returned ${hrRes.status} (expected 200)`)
  }

  console.log(failed ? '\n❌ VERIFICATION FAILED' : '\n✅ VERIFICATION PASSED')
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
  await pool.end()
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
