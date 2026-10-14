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
  userCreatedAt: string
  userMetadataFullName?: string
  existingProfile?: { id: string; tenant_id: string; role: string } | null
  existingTenant?: Record<string, unknown> | null
}) {
  const app = Fastify()
  const profilesQueried: string[] = []
  const supabase = {
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', created_at: opts.userCreatedAt, user_metadata: { full_name: opts.userMetadataFullName } } },
          error: null,
        }),
      },
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: (_col: string, val: string) => ({ maybeSingle: () => { profilesQueried.push(val); return Promise.resolve({ data: opts.existingProfile ?? null, error: null }) } }) }),
          insert: (row: any) => ({ select: () => ({ single: () => Promise.resolve({ data: { ...row, id: row.id }, error: null }) }) }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.existingTenant ?? null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'tenant-new' }, error: null }) }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  app.decorate('supabase', supabase as any)
  app.register(setupRoute)
  return { app, profilesQueried }
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
})
