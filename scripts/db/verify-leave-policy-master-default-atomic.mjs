#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14, checkpoint 27 — proves migration 482
 * (create_leave_policy_master_atomic / update_leave_policy_master_atomic)
 * actually closes the "demote-then-write" torn-state bug found while
 * auditing masters/leave-policy-masters.ts: POST/PUT used to clear the
 * tenant's current is_default=true policy, then separately insert/update —
 * if that second step failed (e.g. a duplicate name), the demote had
 * already committed, leaving the tenant with ZERO default policies.
 *
 * Against real Postgres + real HTTP:
 *   1. Create policy A as default. Confirm it's the only is_default=true row.
 *   2. Attempt to create policy B, ALSO default, but with A's exact name
 *      (forces a (tenant_id, name) unique-constraint failure on the insert
 *      step, after the demote step would have already run under the old code).
 *   3. Confirm the request failed (409 DUPLICATE) AND policy A is STILL
 *      is_default=true — the demote must have been rolled back, not committed.
 *   4. Repeat the same proof for PUT /:id (create B with a different name,
 *      not default; then PUT B to is_default=true using A's name as a
 *      forced update collision... actually PATCH name collision isn't
 *      possible without changing B's own name, so instead: PUT B's
 *      is_default=true with a bogus expected_version to force a 0-row CAS
 *      mismatch after the demote step's WHERE-matched scope, then confirm
 *      A is still default).
 */
import pg from 'pg'

const DB_URL    = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
const AUTH_BASE = 'http://localhost:9000'
const API_BASE  = 'http://localhost:2001'
const PASSWORD  = 'LeavePolicyDefaultAtomic!1'
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
    [tenantId, 'LPM Default Atomic', `lpm-default-atomic-${Date.now()}`])
  const hrEmail = `lpm-default-atomic-hr-${Date.now()}@test.local`
  const hrUserId = await createAuthUser(hrEmail)
  await pool.query(`INSERT INTO profiles (id, tenant_id, role, full_name, email, is_active) VALUES ($1,$2,'hr_admin','HR',$3,true)`,
    [hrUserId, tenantId, hrEmail])
  const hrToken = await loginAndGetToken(hrEmail)

  const headers = { authorization: `Bearer ${hrToken}`, 'content-type': 'application/json' }

  // ── Part A: POST demote-rollback-on-insert-failure ──────────────────────
  const nameA = `Policy A ${Date.now()}`
  const createA = await fetch(`${API_BASE}/masters/leave-policy-masters`, {
    method: 'POST', headers, body: JSON.stringify({ name: nameA, is_default: true, year_type: 'calendar' }),
  })
  const bodyA = await createA.json()
  check('[A] policy A created as default', createA.status === 201 && bodyA.data?.is_default === true, bodyA)
  const policyAId = bodyA.data?.id

  const { rows: afterA } = await pool.query(
    `SELECT id FROM leave_policy_masters WHERE tenant_id=$1 AND is_default=true`, [tenantId])
  check('[A] exactly one default policy exists (A)', afterA.length === 1 && afterA[0].id === policyAId, afterA)

  // Attempt to create policy B with A's EXACT name (forces 23505 on the
  // (tenant_id, name) unique constraint during the INSERT step, which under
  // the old two-step code would run AFTER the demote had already committed).
  const createB = await fetch(`${API_BASE}/masters/leave-policy-masters`, {
    method: 'POST', headers, body: JSON.stringify({ name: nameA, is_default: true, year_type: 'calendar' }),
  })
  const bodyB = await createB.json()
  check('[B] duplicate-name create correctly rejected with 409 DUPLICATE', createB.status === 409 && bodyB.error === 'DUPLICATE', bodyB)

  const { rows: afterB } = await pool.query(
    `SELECT id, is_default FROM leave_policy_masters WHERE tenant_id=$1`, [tenantId])
  const stillDefaultA = afterB.find(r => r.id === policyAId)?.is_default === true
  const defaultCount  = afterB.filter(r => r.is_default).length
  check('[B] policy A is STILL is_default=true after the failed insert (demote rolled back)', stillDefaultA, afterB)
  check('[B] exactly one default policy exists, not zero (the torn-state bug would leave zero)', defaultCount === 1, afterB)

  // ── Part B: PUT demote-rollback-on-CAS-mismatch ──────────────────────────
  const nameC = `Policy C ${Date.now()}`
  const createC = await fetch(`${API_BASE}/masters/leave-policy-masters`, {
    method: 'POST', headers, body: JSON.stringify({ name: nameC, is_default: false, year_type: 'calendar' }),
  })
  const bodyC = await createC.json()
  const policyCId = bodyC.data?.id
  check('[C] policy C created, not default', createC.status === 201 && bodyC.data?.is_default === false, bodyC)

  // PUT C to is_default=true with a bogus expected_version — forces 0 rows
  // matched on the real UPDATE (after the demote step's WHERE scope has
  // already run inside the SAME atomic function call).
  const putC = await fetch(`${API_BASE}/masters/leave-policy-masters/${policyCId}`, {
    method: 'PUT', headers, body: JSON.stringify({ is_default: true, expected_version: 999999 }),
  })
  const putCBody = await putC.json()
  check('[C] PUT with bogus expected_version correctly rejected (409 VERSION_CONFLICT)', putC.status === 409, putCBody)

  const { rows: afterC } = await pool.query(
    `SELECT id, is_default FROM leave_policy_masters WHERE tenant_id=$1`, [tenantId])
  const stillDefaultA2 = afterC.find(r => r.id === policyAId)?.is_default === true
  const defaultCount2  = afterC.filter(r => r.is_default).length
  check('[C] policy A is STILL is_default=true after the failed PUT (demote rolled back)', stillDefaultA2, afterC)
  check('[C] exactly one default policy exists, not zero', defaultCount2 === 1, afterC)

  // ── Part D: a REAL successful default transfer still works ──────────────
  const putC2 = await fetch(`${API_BASE}/masters/leave-policy-masters/${policyCId}`, {
    method: 'PUT', headers, body: JSON.stringify({ is_default: true }),
  })
  const putC2Body = await putC2.json()
  check('[D] real default transfer (no CAS, no name clash) succeeds', putC2.status === 200 && putC2Body.data?.is_default === true, putC2Body)

  const { rows: afterD } = await pool.query(
    `SELECT id, is_default FROM leave_policy_masters WHERE tenant_id=$1`, [tenantId])
  const onlyCDefault = afterD.filter(r => r.is_default).length === 1 && afterD.find(r => r.id === policyCId)?.is_default === true
  check('[D] exactly one default policy, now C (A correctly demoted)', onlyCDefault, afterD)

  console.log(allOk ? '\n✅ All checks passed.' : '\n❌ Some checks failed.')
  await pool.end()
  if (!allOk) process.exit(1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
