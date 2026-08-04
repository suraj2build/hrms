/**
 * auth.ts write-gate — integration test
 *
 * Unlike auth.test.ts (which locks in the pure-function contracts), this
 * registers the REAL auth plugin against a mocked Supabase client and drives
 * it through fastify.inject() — proving the actual request-handling behavior
 * ISSUE-141 fixed: a write must re-read `tenants.status`/`trial_ends_at`
 * fresh from the DB on every request, even when the request hits the warm
 * profileCache (which deliberately never stores status/trial_ends_at at all).
 *
 * Scenarios covered:
 *   1. Cache-miss write (first request) — a suspended tenant is gated (402).
 *   2. Cache-hit write — profileCache is warmed by a prior read, the tenant
 *      is THEN suspended, and the write still gets gated (402) because the
 *      cache-hit path re-queries `tenants` live rather than trusting any
 *      cached value. Also asserts the tenants table was actually queried on
 *      both the warm-up and the write (not skipped on the second call).
 *   3. Cache-hit write with an active tenant still succeeds (200) — the
 *      counter-proof that the gate isn't just unconditionally blocking.
 *   4. Reads are never gated, even for a suspended tenant (so a lapsed
 *      tenant can still reach the billing page to recover).
 *
 * What is NOT tested:
 *   - The is_active re-check branch (IS_ACTIVE_TTL) — same-millisecond
 *     warm-up + write in these tests never crosses that 60s TTL
 *   - allow_login / TENANT_LOGIN_DISABLED (separate gate, not this contract)
 *   - The Supabase Auth server fallback path (verifySupabaseJwt succeeds
 *     locally for every token these tests construct)
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { createHmac } from 'node:crypto'

import authPlugin from '../auth.js'

const JWT_SECRET = 'test-jwt-secret'

// ── JWT helper — builds a token verifySupabaseJwt() will accept locally ───────

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function signToken(sub: string, secret: string = JWT_SECRET): string {
  const header  = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({ sub, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
  const sig     = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// ── Mock Supabase — profiles + tenants chains only ─────────────────────────────

interface TenantState {
  allow_login:   boolean
  status:        string
  trial_ends_at: string | null
}

function buildMockSupabase(tenantState: TenantState, profileRow: {
  tenant_id: string; role: string; employee_id: string | null; is_active: boolean
}) {
  const tenantsSpy = vi.fn()

  const supabase = {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: profileRow, error: null }),
            }),
          }),
        }
      }
      if (table === 'tenants') {
        tenantsSpy()
        // Read tenantState live on every call — proves freshness, since the
        // test mutates this object between requests.
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { ...tenantState }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`buildMockSupabase: unexpected table "${table}"`)
    },
  }

  return { supabase, tenantsSpy }
}

// ── Fastify test app builder — registers the REAL auth plugin ─────────────────

async function buildApp(tenantState: TenantState, profileRow: {
  tenant_id: string; role: string; employee_id: string | null; is_active: boolean
}): Promise<{ app: FastifyInstance; tenantsSpy: ReturnType<typeof vi.fn> }> {
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET

  const { supabase, tenantsSpy } = buildMockSupabase(tenantState, profileRow)

  const app = Fastify({ logger: false })
  app.decorate('supabase', supabase as any)
  await app.register(authPlugin)

  app.get('/test/read', { preHandler: [app.authenticate] }, async () => ({ ok: true }))
  app.post('/test/write', { preHandler: [app.authenticate] }, async () => ({ ok: true }))

  await app.ready()
  return { app, tenantsSpy }
}

function authHeaders(sub: string) {
  return { authorization: `Bearer ${signToken(sub)}` }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('auth write-gate — cache-miss path', () => {
  it('a suspended tenant is gated on its very first write (no prior cache)', async () => {
    const tenantState: TenantState = { allow_login: true, status: 'suspended', trial_ends_at: null }
    const profileRow = { tenant_id: 'tenant-miss', role: 'hr_admin', employee_id: null, is_active: true }
    const { app } = await buildApp(tenantState, profileRow)

    const res = await app.inject({ method: 'POST', url: '/test/write', headers: authHeaders('user-miss-1') })

    expect(res.statusCode).toBe(402)
    expect(JSON.parse(res.body).error).toBe('SUBSCRIPTION_REQUIRED')
  })
})

describe('auth write-gate — cache-hit path re-reads tenants fresh', () => {
  it('a tenant suspended mid-session is still gated on a cache-hit write', async () => {
    const tenantState: TenantState = { allow_login: true, status: 'active', trial_ends_at: null }
    const profileRow = { tenant_id: 'tenant-hit-1', role: 'hr_admin', employee_id: null, is_active: true }
    const { app, tenantsSpy } = await buildApp(tenantState, profileRow)
    const headers = authHeaders('user-hit-1')

    // Warm-up read — populates profileCache via the cache-miss path.
    const readRes = await app.inject({ method: 'GET', url: '/test/read', headers })
    expect(readRes.statusCode).toBe(200)

    // Simulate the tenant being suspended between requests — profileCache
    // never stores status, so this can only be caught by a fresh read.
    tenantState.status = 'suspended'

    // Write — must hit profileCache (same user, cache still warm) yet still
    // observe the live suspended status.
    const writeRes = await app.inject({ method: 'POST', url: '/test/write', headers })

    expect(writeRes.statusCode).toBe(402)
    expect(JSON.parse(writeRes.body).error).toBe('SUBSCRIPTION_REQUIRED')
    // tenants must have been queried on BOTH the warm-up read and the write —
    // proves the write path didn't skip the query and rely on a stale value.
    expect(tenantsSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('a cache-hit write succeeds when the tenant is still active (counter-proof)', async () => {
    const tenantState: TenantState = { allow_login: true, status: 'active', trial_ends_at: null }
    const profileRow = { tenant_id: 'tenant-hit-2', role: 'hr_admin', employee_id: null, is_active: true }
    const { app } = await buildApp(tenantState, profileRow)
    const headers = authHeaders('user-hit-2')

    await app.inject({ method: 'GET', url: '/test/read', headers }) // warm up
    const writeRes = await app.inject({ method: 'POST', url: '/test/write', headers })

    expect(writeRes.statusCode).toBe(200)
  })
})

describe('auth write-gate — reads are never gated', () => {
  it('a suspended tenant can still read (e.g. to reach the billing page)', async () => {
    const tenantState: TenantState = { allow_login: true, status: 'suspended', trial_ends_at: null }
    const profileRow = { tenant_id: 'tenant-read', role: 'hr_admin', employee_id: null, is_active: true }
    const { app } = await buildApp(tenantState, profileRow)

    const res = await app.inject({ method: 'GET', url: '/test/read', headers: authHeaders('user-read-1') })

    expect(res.statusCode).toBe(200)
  })
})
