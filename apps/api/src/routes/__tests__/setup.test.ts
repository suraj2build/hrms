/**
 * POST /setup — ownership-guard regression (SYSTEM_AUDIT_2026-10-14 item 3,
 * corrected after a follow-up security review).
 *
 * This route is deliberately unauthenticated (called before email
 * confirmation, before any session exists), so the only thing standing
 * between "the real account owner" and "anyone who merely knows this
 * user_id" is the ownership guard below. An earlier version of this fix
 * moved the idempotency check AHEAD of the guard, reasoning that returning
 * an EXISTING profile carried no hijack risk. That reasoning was wrong —
 * it turned the idempotent-return path into an unauthenticated IDOR: a
 * caller who merely knew another user's user_id could retrieve their
 * tenant id, slug and profile with nothing else, because the idempotency
 * check doesn't verify who is asking, only that the profile exists.
 *
 * The corrected guard runs BEFORE either branch (create or idempotent
 * return), with OR semantics: either the account is fresh (<=15 minutes
 * old — the original, narrower protection), or the caller's full_name
 * matches what Supabase captured in user_metadata at signUp() time (proof
 * of ownership that doesn't expire, since an attacker who only has a
 * leaked UUID has no way to also know it). Passing EITHER is sufficient;
 * passing NEITHER refuses the request before it reads or writes anything
 * for that user_id.
 */

import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import setupRoute from '../setup.js'

function buildApp(opts: {
  userCreatedAt?: string | null
  userMetadataFullName?: string
  userNotFound?: boolean
  existingProfile?: { id: string; tenant_id: string; role: string } | null
  existingTenant?: Record<string, unknown> | null
  // Simulates a second concurrent /setup call winning the profiles-insert
  // race (PK conflict, Postgres error code 23505) against this call.
  profileInsertConflict?: { winnerProfile: { id: string; tenant_id: string; role: string }; winnerTenant: Record<string, unknown> }
}) {
  const app = Fastify()
  const profilesQueried: string[] = []
  const tenantsDeleted: string[] = []
  let profileReadCount = 0
  const supabase = {
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue(
          opts.userNotFound
            ? { data: { user: null }, error: null }
            : { data: { user: { id: 'user-1', created_at: opts.userCreatedAt, user_metadata: { full_name: opts.userMetadataFullName } } }, error: null },
        ),
      },
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => {
                profilesQueried.push(val)
                profileReadCount += 1
                // First read (pre-insert idempotency check) sees opts.existingProfile.
                // Second read (post-conflict re-fetch) sees the race's winner, if any.
                const data = profileReadCount === 1
                  ? (opts.existingProfile ?? null)
                  : (opts.profileInsertConflict?.winnerProfile ?? opts.existingProfile ?? null)
                return Promise.resolve({ data, error: null })
              },
            }),
          }),
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                if (opts.profileInsertConflict) {
                  return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
                }
                return Promise.resolve({ data: { ...row, id: row.id }, error: null })
              },
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => {
                const data = opts.profileInsertConflict && val === opts.profileInsertConflict.winnerTenant.id
                  ? opts.profileInsertConflict.winnerTenant
                  : (opts.existingTenant ?? null)
                return Promise.resolve({ data, error: null })
              },
            }),
          }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'tenant-new' }, error: null }) }) }),
          delete: () => ({ eq: (_col: string, val: string) => { tenantsDeleted.push(val); return Promise.resolve({ data: null, error: null }) } }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(setupRoute)
  return { app, profilesQueried, tenantsDeleted }
}

describe('POST /setup — ownership guard', () => {
  it('idempotent retry past 15 minutes succeeds when full_name matches signup metadata (the resumability fix)', async () => {
    const { app } = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago — not fresh
      userMetadataFullName: 'Real Owner Name',
      existingProfile: { id: 'user-1', tenant_id: 'tenant-1', role: 'super_admin' },
      existingTenant: { id: 'tenant-1', name: 'Acme', slug: 'acme-1234' },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Real Owner Name', company_name: 'Whatever' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.profile).toMatchObject({ id: 'user-1', tenant_id: 'tenant-1' })
    expect(body.tenant).toMatchObject({ id: 'tenant-1' })
  })

  it('SECURITY: a caller who only knows the user_id — wrong/no full_name, account not fresh — cannot read an existing tenant/profile (IDOR/disclosure)', async () => {
    const { app, profilesQueried } = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago — not fresh
      userMetadataFullName: 'Real Owner Name',
      existingProfile: { id: 'user-1', tenant_id: 'tenant-1', role: 'super_admin' },
      existingTenant: { id: 'tenant-1', name: 'Acme', slug: 'acme-1234' },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      // Attacker supplies a plausible-looking name, but not the real one.
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Attacker Guess', company_name: 'Irrelevant' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('SETUP_VERIFICATION_FAILED')
    // The response body must not leak the tenant/profile — confirms the
    // guard refused BEFORE reading them, not merely withheld them after reading.
    const body = res.json()
    expect(body.tenant).toBeUndefined()
    expect(body.profile).toBeUndefined()
    expect(profilesQueried).toHaveLength(0)
  })

  it('SECURITY: no user_metadata at all and account not fresh — refuses, never falls back to "no metadata means skip the check"', async () => {
    const { app, profilesQueried } = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      userMetadataFullName: undefined,
      existingProfile: { id: 'user-1', tenant_id: 'tenant-1', role: 'super_admin' },
      existingTenant: { id: 'tenant-1', name: 'Acme', slug: 'acme-1234' },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Anything At All', company_name: 'Irrelevant' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('SETUP_VERIFICATION_FAILED')
    expect(profilesQueried).toHaveLength(0)
  })

  it('a genuine CREATE attempt still succeeds when fresh, even with no existing profile', async () => {
    const { app } = buildApp({
      userCreatedAt: new Date().toISOString(),
      existingProfile: null,
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Someone', company_name: 'New Co' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('a stale CREATE attempt (no existing profile, not fresh, no metadata match) is refused', async () => {
    const { app } = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      userMetadataFullName: 'Real Signup Name',
      existingProfile: null,
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Attacker Name', company_name: 'New Co' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('SETUP_VERIFICATION_FAILED')
  })

  it('a legitimate interrupted retry — WITHIN the fresh window, profile already created by the first call the client never saw a response for — succeeds with no metadata needed', async () => {
    const { app } = buildApp({
      userCreatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago — fresh
      userMetadataFullName: undefined, // freshness alone is the proof here
      existingProfile: { id: 'user-1', tenant_id: 'tenant-1', role: 'super_admin' },
      existingTenant: { id: 'tenant-1', name: 'Acme', slug: 'acme-1234' },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Someone', company_name: 'Whatever' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().profile).toMatchObject({ id: 'user-1', tenant_id: 'tenant-1' })
  })

  it('USER_NOT_FOUND: no Supabase auth user for this id — refused before any ownership check or data read', async () => {
    const { app, profilesQueried } = buildApp({ userNotFound: true })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Someone', company_name: 'Whatever' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('USER_NOT_FOUND')
    expect(profilesQueried).toHaveLength(0)
  })

  it('VALIDATION_ERROR: malformed body (bad UUID) is rejected before the Supabase auth lookup even runs', async () => {
    const { app } = buildApp({ userCreatedAt: new Date().toISOString() })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: 'not-a-uuid', full_name: 'Someone', company_name: 'Whatever' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('VALIDATION_ERROR')
  })

  it('CONCURRENCY: two fresh CREATE calls race on the same user_id — the loser rolls back its own tenant row and returns the winner\'s profile/tenant instead of erroring', async () => {
    const { app, tenantsDeleted } = buildApp({
      userCreatedAt: new Date().toISOString(), // fresh — both calls pass the ownership guard
      existingProfile: null, // pre-insert idempotency check sees nothing yet — genuinely racing, not a stale retry
      profileInsertConflict: {
        winnerProfile: { id: 'user-1', tenant_id: 'tenant-winner', role: 'super_admin' },
        winnerTenant:  { id: 'tenant-winner', name: 'Acme', slug: 'acme-5678' },
      },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Someone', company_name: 'Acme' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().profile).toMatchObject({ id: 'user-1', tenant_id: 'tenant-winner' })
    expect(res.json().tenant).toMatchObject({ id: 'tenant-winner' })
    // This call's own just-inserted tenant ("tenant-new") must be cleaned up —
    // the race's loser must not leave an orphaned tenant row with no profile.
    expect(tenantsDeleted).toContain('tenant-new')
  })
})
