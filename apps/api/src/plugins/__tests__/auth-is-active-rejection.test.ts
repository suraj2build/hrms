/**
 * `authenticate` preHandler — proves actual session rejection on
 * revocation (SYSTEM_AUDIT_2026-10-14 continuation). The user correctly
 * pushed back that mocked calls to revokeEmployeeAuth alone don't prove
 * access was revoked — this exercises the REAL `authenticate` plugin code
 * (not a mock of it) against a fake Supabase client, proving that once
 * `profiles.is_active` flips to false (exactly what revokeEmployeeAuth
 * does), an already-issued, still-cryptographically-valid bearer token
 * is rejected with 401 on its next request — both on a cold cache (no
 * prior request from this user) and on an already-cached "session" once
 * the bounded re-check window (IS_ACTIVE_TTL, 60s) elapses.
 *
 * What this does NOT prove, and is not claimed to: Supabase Auth's own
 * JWT-level ban (`ban_duration`, set via `auth.admin.updateUserById` in
 * revokeEmployeeAuth) is a hosted-Supabase mechanism this local test has
 * no way to exercise — that half of revocation remains blocked on hosted
 * access, same as every other hosted-Supabase check in this audit. What
 * IS proven here is the app's own defense-in-depth layer: even if a
 * revoked user's JWT were somehow still accepted by Supabase, this app's
 * own is_active recheck independently rejects them within 60 seconds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import authPlugin from '../auth.js'

function buildApp(profilesByUserId: Map<string, { tenant_id: string; role: string; employee_id: string | null; is_active: boolean }>) {
  const app = Fastify()
  const getUserMock = vi.fn((token: string) => {
    const userId = token.replace('token-for-', '')
    return Promise.resolve({ data: { user: { id: userId } }, error: null })
  })
  app.decorate('supabase', {
    auth: { getUser: getUserMock },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => ({
              single: () => Promise.resolve({ data: profilesByUserId.get(userId) ?? null, error: null }),
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { allow_login: true, status: 'active', trial_ends_at: null }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any)
  app.register(authPlugin)
  // `app.authenticate` is a decorator added asynchronously inside authPlugin's
  // encapsulation — it isn't on the instance yet at this synchronous point.
  // A wrapper that looks it up at call time (by which point app.inject() has
  // already awaited readiness) avoids registering routes after .ready().
  app.get('/protected', { preHandler: [(req, reply) => app.authenticate(req, reply)] }, async () => ({ ok: true }))
  return app
}

describe('authenticate preHandler — is_active revocation is actually enforced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cold cache: an already-deactivated profile is rejected on its very first request after revocation (401, not silently let through)', async () => {
    const userId = 'user-cold-deactivated'
    const profiles = new Map([[userId, { tenant_id: 'tenant-1', role: 'employee', employee_id: 'emp-1', is_active: false }]])
    const app = buildApp(profiles)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })

    expect(res.statusCode).toBe(401)
    expect(res.json().message).toBe('Account is deactivated')
  })

  it('cold cache: an active profile is let through (control case — proves the rejection above is about is_active, not a broken mock)', async () => {
    const userId = 'user-cold-active'
    const profiles = new Map([[userId, { tenant_id: 'tenant-1', role: 'employee', employee_id: 'emp-1', is_active: true }]])
    const app = buildApp(profiles)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })

    expect(res.statusCode).toBe(200)
  })

  it('EXISTING SESSION: a request that succeeded while active is rejected on a LATER request after revocation, once the bounded recheck window elapses — this is the actual "existing session is rejected" proof', async () => {
    const userId = 'user-session-then-revoked'
    const profiles = new Map([[userId, { tenant_id: 'tenant-1', role: 'employee', employee_id: 'emp-1', is_active: true }]])
    const app = buildApp(profiles)
    await app.ready()

    // Request 1: active, succeeds — this is the "existing session" getting established in the cache.
    const res1 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })
    expect(res1.statusCode).toBe(200)

    // The employee is now separated/suspended — revokeEmployeeAuth's real effect on profiles.is_active.
    profiles.set(userId, { ...profiles.get(userId)!, is_active: false })

    // Advance past IS_ACTIVE_TTL (60s) so the cached session is due for its bounded DB recheck,
    // without waiting out the full 5-minute CACHE_TTL — same bound G11 already measured.
    vi.advanceTimersByTime(61_000)

    // Request 2: same bearer token as request 1 (the SAME "session") — must now be rejected.
    const res2 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })
    expect(res2.statusCode).toBe(401)
    expect(res2.json().message).toBe('Account is deactivated')
  })

  it('a request made WITHIN the recheck window after revocation still succeeds (documents the real, bounded gap — not a defect, the measured G11 SLA)', async () => {
    const userId = 'user-session-within-ttl'
    const profiles = new Map([[userId, { tenant_id: 'tenant-1', role: 'employee', employee_id: 'emp-1', is_active: true }]])
    const app = buildApp(profiles)
    await app.ready()

    const res1 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })
    expect(res1.statusCode).toBe(200)

    profiles.set(userId, { ...profiles.get(userId)!, is_active: false })
    vi.advanceTimersByTime(30_000) // well within the 60s IS_ACTIVE_TTL

    const res2 = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: `Bearer token-for-${userId}` } })
    expect(res2.statusCode).toBe(200) // still cached as active — expected, bounded by design
  })
})
