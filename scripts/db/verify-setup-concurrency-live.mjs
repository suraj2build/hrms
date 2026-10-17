#!/usr/bin/env node
/**
 * Real-stack concurrency test for POST /setup, run against the actual
 * compiled API server (localhost:2001) + a local PostgREST/Auth-compatible
 * gateway (localhost:9000, apps/api/.env's SUPABASE_URL) + real Postgres
 * (hrms_uat). SYSTEM_AUDIT_2026-10-14 continuation: an earlier round proved
 * Postgres returns SQLSTATE 23505 on a raced profiles.id insert in
 * isolation; that does not prove the whole /setup workflow recovers
 * correctly end-to-end (one tenant/profile, correct ownership, no orphan
 * tenant, successful interrupted-retry recovery) — this does.
 *
 * Prerequisites (not started by this script): Postgres 16 running with the
 * hrms_uat database and its full migration history applied; the gateway
 * shim and the compiled API server (`node --env-file=.env dist/index.js`
 * from apps/api) both running and pointed at each other per apps/api/.env.
 *
 * Usage: node scripts/db/verify-setup-concurrency-live.mjs
 */
import pg from 'pg'

const pool = new pg.Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/hrms_uat' })
const API = 'http://localhost:2001'

async function createAuthUser(email, fullName) {
  const id = (await pool.query('select gen_random_uuid() as id')).rows[0].id
  await pool.query(
    `insert into auth.users (id, email, created_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`,
    [id, email, JSON.stringify({ full_name: fullName })],
  )
  return id
}

async function ageAuthUser(userId, minutesAgo) {
  await pool.query(`update auth.users set created_at = now() - interval '${minutesAgo} minutes' where id = $1`, [userId])
}

async function callSetup(userId, fullName, companyName) {
  const res = await fetch(`${API}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, full_name: fullName, company_name: companyName }),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function countOrphanTenants(tenantIds) {
  if (tenantIds.length === 0) return 0
  const { rows } = await pool.query(
    `select t.id from tenants t left join profiles p on p.tenant_id = t.id where t.id = any($1) and p.id is null`,
    [tenantIds],
  )
  return rows.length
}

async function test1_genuineRace() {
  console.log('\n=== TEST 1: genuine concurrent race — two /setup calls fired at the same instant ===')
  const userId = await createAuthUser(`race-${Date.now()}@example.com`, 'Race Tester')
  const [r1, r2] = await Promise.all([
    callSetup(userId, 'Race Tester', 'Race Co A'),
    callSetup(userId, 'Race Tester', 'Race Co B'),
  ])
  console.log('  call A:', r1.status, r1.body?.profile?.tenant_id ?? r1.body)
  console.log('  call B:', r2.status, r2.body?.profile?.tenant_id ?? r2.body)

  const okCalls = [r1, r2].filter(r => r.status === 200 || r.status === 201)
  const tenantIdsReturned = new Set(okCalls.map(r => r.body.profile.tenant_id))

  const { rows: profileRows } = await pool.query('select id, tenant_id from profiles where id = $1', [userId])
  const { rows: tenantRowsForUser } = await pool.query(
    `select t.id from tenants t join profiles p on p.tenant_id = t.id where p.id = $1`, [userId],
  )

  const pass =
    okCalls.length === 2 &&                        // both the racer and the "loser" get a 200/201, neither errors
    tenantIdsReturned.size === 1 &&                 // both calls agree on the SAME tenant — no split-brain
    profileRows.length === 1 &&                     // exactly one profile row exists for this user
    tenantRowsForUser.length === 1 &&                // exactly one tenant is linked to it
    profileRows[0].tenant_id === [...tenantIdsReturned][0]

  console.log('  profiles for this user_id:', profileRows.length, '| tenants linked:', tenantRowsForUser.length, '| distinct tenant_ids returned to callers:', tenantIdsReturned.size)
  console.log(pass ? '  PASS: exactly one tenant/profile pair, both callers agree, correct ownership' : '  FAIL')
  return { pass, userId, tenantId: profileRows[0]?.tenant_id }
}

async function test2_orphanCheck(precedingTenantIds) {
  console.log('\n=== TEST 2: no orphan tenant left behind by the race\'s loser ===')
  // The loser's own INSERT into tenants (before it discovers the profile PK
  // conflict) must have been rolled back by the DELETE in setup.ts's conflict
  // handler. Scan ALL tenants created in the last minute, not just the ones
  // callers happened to report, in case a loser's own tenant was never
  // reported back to any caller at all.
  const { rows: recentTenants } = await pool.query(
    `select id from tenants where created_at > now() - interval '2 minutes'`,
  )
  const orphanCount = await countOrphanTenants(recentTenants.map(r => r.id))
  console.log(`  tenants created in the last 2 minutes: ${recentTenants.length}, of which orphaned (no profile points to them): ${orphanCount}`)
  console.log(orphanCount === 0 ? '  PASS: no orphan tenant rows' : '  FAIL: orphan tenant(s) found')
  return orphanCount === 0
}

async function test3_interruptedRetryRecovery() {
  console.log('\n=== TEST 3: interrupted-retry recovery — sequential retry of a call whose profile already exists (simulates "client never saw the first response") ===')
  const userId = await createAuthUser(`retry-${Date.now()}@example.com`, 'Retry Tester')

  const first = await callSetup(userId, 'Retry Tester', 'Retry Co')
  console.log('  first call (genuine create):', first.status)

  // Simulate the account aging past the 15-minute freshness window before the
  // client retries — the real resumability case this fix targets.
  await pool.query(`update auth.users set created_at = now() - interval '20 minutes' where id = $1`, [userId])

  const retry = await callSetup(userId, 'Retry Tester', 'Retry Co') // same full_name -> metadata match should carry it
  console.log('  retry call (20 min later, stale account, full_name matches signup metadata):', retry.status)

  const { rows } = await pool.query('select id, tenant_id from profiles where id = $1', [userId])
  const pass =
    first.status === 201 &&
    retry.status === 200 &&
    rows.length === 1 &&
    retry.body.profile.tenant_id === rows[0].tenant_id &&
    retry.body.profile.tenant_id === first.body.profile.tenant_id

  console.log(pass ? '  PASS: retry recovered the SAME tenant/profile, no duplicate, no error' : '  FAIL')
  return pass
}

async function test4_unauthorizedRetryStillRefused() {
  console.log('\n=== TEST 4: a stranger who only knows the user_id (no metadata match, account not fresh) is still refused even for an EXISTING profile ===')
  const userId = await createAuthUser(`idor-${Date.now()}@example.com`, 'Real Owner')
  const first = await callSetup(userId, 'Real Owner', 'IDOR Co')
  console.log('  genuine create:', first.status)

  await pool.query(`update auth.users set created_at = now() - interval '20 minutes' where id = $1`, [userId])
  const attacker = await callSetup(userId, 'Attacker Guess', 'Whatever')
  console.log('  attacker call (wrong full_name, stale account, same user_id):', attacker.status, attacker.body)

  const pass = attacker.status === 403 && attacker.body?.tenant === undefined && attacker.body?.profile === undefined
  console.log(pass ? '  PASS: refused, no data disclosed' : '  FAIL')
  return pass
}

const results = {}
results.race           = (await test1_genuineRace()).pass
results.noOrphan       = await test2_orphanCheck()
results.interruptedRetry = await test3_interruptedRetryRecovery()
results.idorStillBlocked = await test4_unauthorizedRetryStillRefused()

console.log('\n=== SUMMARY ===')
console.log(results)
const allPass = Object.values(results).every(Boolean)
console.log(allPass ? 'ALL PASS' : 'SOME FAILED')
await pool.end()
process.exit(allPass ? 0 : 1)
