#!/usr/bin/env node
/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 13 — real-Postgres + real-HTTP proof
 * for the idempotency-key payload-fingerprint gap on
 * POST /leave/encashment/request, per the user's explicit ask: "Test
 * same-key reuse with a different payload and retry after a committed
 * request whose HTTP response was lost."
 *
 * Before this round, checkIdempotency (lib/idempotency.ts) replayed
 * whatever was stored under a (tenant_id, key) pair with no comparison
 * against the CURRENT request body. A client that reused an
 * Idempotency-Key across two meaningfully different submissions would
 * silently get back the FIRST request's result describing a DIFFERENT
 * request than the one it just sent — the second request never inserted,
 * never reported as refused either. Migration 466 adds an opt-in
 * request_hash column; this route now fingerprints the parsed body
 * (hashIdempotencyPayload) and checks it via getStoredRequestHash BEFORE
 * ever reaching the replay path.
 *
 * This script proves, against the REAL compiled API + REAL Postgres
 * (not mocked supabase, unlike the sibling vitest file
 * leave-encashment-request-hash-mismatch.test.ts which proves the same
 * route logic against a mock):
 *
 *   STEP 1-3: seed a tenant + employee with a linked profile, an
 *   encashable leave type with a 10-day/year cap.
 *   STEP 4: first submission (key K, 3 days) → 201, persisted exactly once.
 *   STEP 5: SAME key K, DIFFERENT payload (2 days) → 409
 *   IDEMPOTENCY_KEY_REUSED, NOT the first response replayed, and — read
 *   back from real Postgres — still exactly ONE row for this employee/
 *   leave_type/year (the second request was never inserted, not silently
 *   processed as a third untracked request either).
 *   STEP 6: retry with the SAME key K and the SAME payload as step 4
 *   (simulating a client that genuinely committed the first request but
 *   never saw its HTTP response, e.g. a dropped connection) → 201 with
 *   Idempotency-Replayed: true, byte-identical response body to step 4's,
 *   and — read back from real Postgres — still exactly ONE row (no
 *   duplicate insert from the "lost response" retry).
 */
import pg from 'pg'

const AUTH_BASE = 'http://localhost:9000'
const API_BASE = 'http://localhost:2001'
const PASSWORD = 'EncHashVerify!1'
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hrms_uat'
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

async function main() {
  let allOk = true
  const stamp = Date.now()
  const tenantId = uuid()

  console.log('=== SEED ===')
  await pool.query(`INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Encashment Idempotency Hash Verify','eihv-${stamp}','active')`, [tenantId])

  const empEmail = `eihv-emp-${stamp}@test.local`
  const empUserId = await createAuthUser(empEmail)
  const empId = uuid()
  await pool.query(
    `INSERT INTO employees (id, tenant_id, employee_code, first_name, last_name, email, joining_date, status)
     VALUES ($1,$2,'EIHVEMP','Hash','Verify',$3, CURRENT_DATE, 'active')`,
    [empId, tenantId, empEmail],
  )
  await pool.query(`INSERT INTO profiles (id, tenant_id, employee_id, role, full_name, email, is_active) VALUES ($1,$2,$3,'employee','Hash Verify',$4,true)`, [empUserId, tenantId, empId, empEmail])

  const leaveTypeId = uuid()
  await pool.query(`INSERT INTO leave_types (id, tenant_id, name, is_active) VALUES ($1,$2,'Earned Leave', true)`, [leaveTypeId, tenantId])
  await pool.query(
    `INSERT INTO leave_accrual_rules (tenant_id, leave_type_id, encashable, max_encashable_per_year, is_active)
     VALUES ($1,$2,true,10,true)`,
    [tenantId, leaveTypeId],
  )
  console.log('seeded tenant', tenantId, '| employee', empId, '| leave_type', leaveTypeId, '(cap 10/year)')

  const token = await loginAndGetToken(empEmail)
  const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': 'eihv-shared-key-1' }

  async function countPersisted(year) {
    const { rows } = await pool.query(
      `SELECT count(*) AS n FROM leave_encashment_requests WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
      [tenantId, empId, leaveTypeId, year],
    )
    return Number(rows[0].n)
  }

  const year = 2104
  const firstPayload = { leave_type_id: leaveTypeId, days: 3, year }

  // ── STEP 4: first submission ────────────────────────────────────────────
  console.log('\n=== STEP 4: first submission (key K, 3 days) ===')
  const firstRes = await fetch(`${API_BASE}/leave/encashment/request`, { method: 'POST', headers: authHeaders, body: JSON.stringify(firstPayload) })
  const firstBody = await firstRes.json()
  console.log('status', firstRes.status, firstBody)
  const firstOk = firstRes.status === 201
  const countAfterFirst = await countPersisted(year)
  console.log('persisted rows after first submission (expect 1):', countAfterFirst)
  allOk = allOk && firstOk && countAfterFirst === 1

  // ── STEP 5: SAME key, DIFFERENT payload ─────────────────────────────────
  console.log('\n=== STEP 5: SAME Idempotency-Key, DIFFERENT payload (2 days instead of 3) ===')
  const differentPayload = { leave_type_id: leaveTypeId, days: 2, year }
  const mismatchRes = await fetch(`${API_BASE}/leave/encashment/request`, { method: 'POST', headers: authHeaders, body: JSON.stringify(differentPayload) })
  const mismatchBody = await mismatchRes.json()
  console.log('status', mismatchRes.status, mismatchBody)
  const refused409 = mismatchRes.status === 409 && mismatchBody.error === 'IDEMPOTENCY_KEY_REUSED'
  const notReplayedFirstResponse = JSON.stringify(mismatchBody) !== JSON.stringify(firstBody)
  const countAfterMismatch = await countPersisted(year)
  console.log('persisted rows after the mismatched-payload attempt (expect STILL 1 — not silently inserted as a 2nd row):', countAfterMismatch)
  console.log('refused 409 IDEMPOTENCY_KEY_REUSED (not replayed, not silently processed):', refused409 ? 'PASS' : 'FAIL')
  console.log('response is NOT the first request\'s cached result:', notReplayedFirstResponse ? 'PASS' : 'FAIL')
  console.log('no duplicate/third row persisted by the refused attempt:', countAfterMismatch === 1 ? 'PASS' : 'FAIL')
  allOk = allOk && refused409 && notReplayedFirstResponse && countAfterMismatch === 1

  // ── STEP 6: SAME key, SAME payload — simulating a lost HTTP response ───
  console.log('\n=== STEP 6: retry with the SAME key K and the SAME payload as step 4 (client never saw step 4\'s response) ===')
  const retryRes = await fetch(`${API_BASE}/leave/encashment/request`, { method: 'POST', headers: authHeaders, body: JSON.stringify(firstPayload) })
  const retryBody = await retryRes.json()
  console.log('status', retryRes.status, 'Idempotency-Replayed:', retryRes.headers.get('idempotency-replayed'), retryBody)
  const retryReplayed = retryRes.status === 201 && retryRes.headers.get('idempotency-replayed') === 'true'
  const retryBodyIdentical = JSON.stringify(retryBody) === JSON.stringify(firstBody)
  const countAfterRetry = await countPersisted(year)
  console.log('persisted rows after the lost-response retry (expect STILL 1 — no duplicate insert):', countAfterRetry)
  console.log('retry correctly replayed the ORIGINAL committed response, byte-identical:', retryReplayed && retryBodyIdentical ? 'PASS' : 'FAIL')
  console.log('no duplicate row from the retry:', countAfterRetry === 1 ? 'PASS' : 'FAIL')
  allOk = allOk && retryReplayed && retryBodyIdentical && countAfterRetry === 1

  // ── Final reconciliation: exactly one real row, with the step-4 amount ──
  const { rows: finalRows } = await pool.query(
    `SELECT id, days, status FROM leave_encashment_requests WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
    [tenantId, empId, leaveTypeId, year],
  )
  console.log('\nfinal persisted state:', finalRows)
  const finalStateCorrect = finalRows.length === 1 && Number(finalRows[0].days) === 3
  console.log('exactly one row, days=3 (the step-4 request — never overwritten, never duplicated, never bypassed by the mismatched or retried attempts):', finalStateCorrect ? 'PASS' : 'FAIL')
  allOk = allOk && finalStateCorrect

  console.log(allOk ? '\nALL STEPS PASS' : '\nFAIL')
  await pool.end()
  process.exit(allOk ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
