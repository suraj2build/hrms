/**
 * revokeEmployeeAuth — AF-001's actual revocation logic had NO direct unit
 * tests before this (SYSTEM_AUDIT_2026-10-14 continuation, per the user's
 * explicit push-back that mocked calls to it elsewhere don't prove it
 * itself works, including its failure and retry behavior).
 */
import { describe, it, expect, vi } from 'vitest'
import { revokeEmployeeAuth } from '../user-account-service.js'

const EMP_ID = 'emp-1'
const TENANT = 'tenant-1'
const PROFILE_ID = 'profile-1'

function buildSupabase(opts: {
  profile?: { id: string } | null
  profileUpdateError?: unknown
  authBanError?: unknown
}) {
  const profileUpdateSpy = vi.fn((_fields: Record<string, unknown>) => Promise.resolve({ data: null, error: opts.profileUpdateError ?? null }))
  const authBanSpy = vi.fn((_id: string, _fields: Record<string, unknown>) => Promise.resolve({ data: null, error: opts.authBanError ?? null }))
  const supabase = {
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.profile === undefined ? { id: PROFILE_ID } : opts.profile, error: null }),
            }),
          }),
        }),
        update: (fields: any) => ({
          eq: (_c1: string, _v1: string) => ({
            eq: (_c2: string, _v2: string) => profileUpdateSpy(fields),
          }),
        }),
      }
    },
    auth: { admin: { updateUserById: (id: string, fields: any) => authBanSpy(id, fields) } },
  }
  return { supabase: supabase as any, profileUpdateSpy, authBanSpy }
}

describe('revokeEmployeeAuth', () => {
  it('no linked profile: returns true with no auth call attempted (nothing to revoke)', async () => {
    const { supabase, authBanSpy } = buildSupabase({ profile: null })
    const result = await revokeEmployeeAuth(supabase, EMP_ID, TENANT)
    expect(result).toBe(true)
    expect(authBanSpy).not.toHaveBeenCalled()
  })

  it('happy path: deactivates the profile AND bans the auth user, returns true', async () => {
    const { supabase, profileUpdateSpy, authBanSpy } = buildSupabase({})
    const result = await revokeEmployeeAuth(supabase, EMP_ID, TENANT)

    expect(result).toBe(true)
    expect(profileUpdateSpy).toHaveBeenCalledWith({ is_active: false })
    expect(authBanSpy).toHaveBeenCalledWith(PROFILE_ID, { ban_duration: '876000h' })
  })

  it('FAILURE: profile deactivation fails — returns false, but still attempts the auth ban regardless (defense in depth, not an early return)', async () => {
    const { supabase, authBanSpy } = buildSupabase({ profileUpdateError: { message: 'db down' } })
    const log = { warn: vi.fn() }
    const result = await revokeEmployeeAuth(supabase, EMP_ID, TENANT, log)

    expect(result).toBe(false)
    expect(authBanSpy).toHaveBeenCalled() // not skipped just because the profile update failed
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: EMP_ID }),
      expect.stringContaining('profile deactivation failed'),
    )
  })

  it('FAILURE: auth ban fails — returns false even though the profile WAS deactivated (caller must not treat this as fully revoked)', async () => {
    const { supabase, profileUpdateSpy } = buildSupabase({ authBanError: { message: 'auth service unavailable' } })
    const log = { warn: vi.fn() }
    const result = await revokeEmployeeAuth(supabase, EMP_ID, TENANT, log)

    expect(result).toBe(false)
    expect(profileUpdateSpy).toHaveBeenCalledWith({ is_active: false }) // this half DID succeed
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: EMP_ID }),
      expect.stringContaining('auth ban failed'),
    )
  })

  it('FAILURE: both the profile update and the auth ban fail — returns false, both failures logged', async () => {
    const { supabase } = buildSupabase({ profileUpdateError: { message: 'db down' }, authBanError: { message: 'auth down' } })
    const log = { warn: vi.fn() }
    const result = await revokeEmployeeAuth(supabase, EMP_ID, TENANT, log)

    expect(result).toBe(false)
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('RETRY: a second call after the transient failure clears succeeds — the function is idempotent and safe to retry', async () => {
    const failing = buildSupabase({ authBanError: { message: 'transient' } })
    const firstResult = await revokeEmployeeAuth(failing.supabase, EMP_ID, TENANT, { warn: vi.fn() })
    expect(firstResult).toBe(false)

    // Same employee, retried against a client where the transient issue has cleared.
    const recovered = buildSupabase({})
    const secondResult = await revokeEmployeeAuth(recovered.supabase, EMP_ID, TENANT, { warn: vi.fn() })
    expect(secondResult).toBe(true)
    expect(recovered.profileUpdateSpy).toHaveBeenCalledWith({ is_active: false })
    expect(recovered.authBanSpy).toHaveBeenCalledWith(PROFILE_ID, { ban_duration: '876000h' })
  })

  it('RETRY: calling it again on an employee whose profile is already deactivated is a harmless no-op re-assertion, not an error', async () => {
    // Re-running the same is_active:false update and the same ban call is
    // idempotent at the DB/Auth-API level — there is no "already revoked"
    // error branch to trip, and a retry must not throw or behave differently
    // just because the prior call already succeeded.
    const { supabase } = buildSupabase({})
    const first  = await revokeEmployeeAuth(supabase, EMP_ID, TENANT)
    const second = await revokeEmployeeAuth(supabase, EMP_ID, TENANT)
    expect(first).toBe(true)
    expect(second).toBe(true)
  })
})
