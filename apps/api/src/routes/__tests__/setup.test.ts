/**
 * POST /setup — idempotency-before-anti-hijack-guard regression
 * (SYSTEM_AUDIT_2026-10-14 item 3).
 *
 * The anti-hijack guards (account must be <15 minutes old; full_name must
 * match signup metadata) used to run BEFORE the idempotency check. That
 * meant a legitimate retry of an ALREADY-COMPLETED setup — the first call
 * succeeded but the caller never saw the response (dropped connection,
 * process restart, a pilot-seeding script resuming after an interruption)
 * — failed with SETUP_WINDOW_EXPIRED once more than 15 minutes had passed
 * since the original signup, even though the real work (profile + tenant)
 * was already done and sitting there to be returned. Fixed by checking
 * idempotency FIRST: an existing profile for this exact user_id carries no
 * hijack risk regardless of age or name, because whatever protected its
 * creation already ran at that earlier, successful call.
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
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.existingProfile ?? null, error: null }) }) }),
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
  return app
}

describe('POST /setup — idempotent retry outlives the anti-hijack window', () => {
  it('returns the existing profile/tenant even when the account is more than 15 minutes old (a legitimate retry)', async () => {
    const app = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      existingProfile: { id: 'user-1', tenant_id: 'tenant-1', role: 'super_admin' },
      existingTenant: { id: 'tenant-1', name: 'Acme', slug: 'acme-1234' },
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'A Different Name Entirely', company_name: 'Whatever', },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.profile).toMatchObject({ id: 'user-1', tenant_id: 'tenant-1' })
    expect(body.tenant).toMatchObject({ id: 'tenant-1' })
  })

  it('still enforces the 15-minute window for a genuine CREATE attempt (no existing profile)', async () => {
    const app = buildApp({
      userCreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
      existingProfile: null,
    })

    const res = await app.inject({
      method: 'POST', url: '/setup',
      payload: { user_id: '11111111-1111-1111-1111-111111111111', full_name: 'Someone', company_name: 'New Co' },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('SETUP_WINDOW_EXPIRED')
  })

  it('still enforces the full_name match for a genuine CREATE attempt (no existing profile)', async () => {
    const app = buildApp({
      userCreatedAt: new Date().toISOString(),
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
