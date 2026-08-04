/**
 * auth.ts helper tests — locks in the pure-function contracts the write-gate
 * and JWT verification depend on, so a future edit can't silently reopen
 * ISSUE-141 (tenant-licensing gate) or SYSCERT_AUDIT H11 (JWT timing attack).
 */

import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { isTenantBlocked, isExemptFromWriteGate, verifySupabaseJwt } from '../auth.js'

// ── isTenantBlocked ─────────────────────────────────────────────────────────

describe('isTenantBlocked', () => {
  it('does not block an active tenant', () => {
    expect(isTenantBlocked({ status: 'active', trial_ends_at: null })).toEqual({ blocked: false, trialExpired: false })
  })

  it('does not block a trial tenant whose trial has not ended', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect(isTenantBlocked({ status: 'trial', trial_ends_at: future })).toEqual({ blocked: false, trialExpired: false })
  })

  it('does not block a trial tenant with no trial_ends_at set', () => {
    expect(isTenantBlocked({ status: 'trial', trial_ends_at: null })).toEqual({ blocked: false, trialExpired: false })
  })

  it('blocks a trial tenant whose trial has ended', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isTenantBlocked({ status: 'trial', trial_ends_at: past })).toEqual({ blocked: true, trialExpired: true })
  })

  it.each(['suspended', 'expired', 'cancelled'])('blocks a %s tenant', (status) => {
    expect(isTenantBlocked({ status, trial_ends_at: null })).toEqual({ blocked: true, trialExpired: false })
  })

  it('a past trial_ends_at on a non-trial status does not trigger trialExpired', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isTenantBlocked({ status: 'active', trial_ends_at: past })).toEqual({ blocked: false, trialExpired: false })
  })
})

// ── isExemptFromWriteGate ────────────────────────────────────────────────────

describe('isExemptFromWriteGate', () => {
  it('exempts the exact /billing path', () => {
    expect(isExemptFromWriteGate('/billing')).toBe(true)
  })

  it('exempts /billing sub-paths', () => {
    expect(isExemptFromWriteGate('/billing/invoice')).toBe(true)
  })

  it('exempts the exact /support path', () => {
    expect(isExemptFromWriteGate('/support')).toBe(true)
  })

  it('exempts /support sub-paths', () => {
    expect(isExemptFromWriteGate('/support/tickets/42')).toBe(true)
  })

  it('strips the query string before matching', () => {
    expect(isExemptFromWriteGate('/billing?foo=bar')).toBe(true)
    expect(isExemptFromWriteGate('/employees?foo=bar')).toBe(false)
  })

  it('does NOT exempt a route that merely shares the /billing prefix', () => {
    expect(isExemptFromWriteGate('/billingHistory')).toBe(false)
    expect(isExemptFromWriteGate('/billing-something')).toBe(false)
  })

  it('does NOT exempt a route that merely shares the /support prefix', () => {
    expect(isExemptFromWriteGate('/supportRequests')).toBe(false)
  })

  it('does not exempt unrelated routes', () => {
    expect(isExemptFromWriteGate('/employees')).toBe(false)
  })
})

// ── verifySupabaseJwt ────────────────────────────────────────────────────────

const SECRET = 'test-secret'

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function makeToken(payload: Record<string, unknown>, secret: string = SECRET): string {
  const headerB64  = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payloadB64 = base64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url')
  return `${headerB64}.${payloadB64}.${sig}`
}

const validPayload = { sub: 'user-123', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }

describe('verifySupabaseJwt', () => {
  it('accepts a validly-signed, unexpired, correctly-audienced token', () => {
    const token = makeToken(validPayload)
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ sub: 'user-123' })
  })

  it('rejects a token signed with a different secret', () => {
    const token = makeToken(validPayload, 'wrong-secret')
    expect(verifySupabaseJwt(token, SECRET)).toBeNull()
  })

  it('rejects a token with a tampered payload', () => {
    const [headerB64, , sigB64] = makeToken(validPayload).split('.')
    const tamperedPayloadB64 = base64url(JSON.stringify({ ...validPayload, sub: 'attacker-999' }))
    const tampered = `${headerB64}.${tamperedPayloadB64}.${sigB64}`
    expect(verifySupabaseJwt(tampered, SECRET)).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = makeToken({ ...validPayload, exp: Math.floor(Date.now() / 1000) - 3600 })
    expect(verifySupabaseJwt(token, SECRET)).toBeNull()
  })

  it('accepts a token with no exp claim (exp is optional)', () => {
    const { exp: _exp, ...rest } = validPayload
    const token = makeToken(rest)
    expect(verifySupabaseJwt(token, SECRET)).toEqual({ sub: 'user-123' })
  })

  it('rejects a token missing sub', () => {
    const { sub: _sub, ...rest } = validPayload
    const token = makeToken(rest)
    expect(verifySupabaseJwt(token, SECRET)).toBeNull()
  })

  it('rejects a token with the wrong audience', () => {
    const token = makeToken({ ...validPayload, aud: 'anon' })
    expect(verifySupabaseJwt(token, SECRET)).toBeNull()
  })

  it('rejects a malformed token (wrong number of segments)', () => {
    expect(verifySupabaseJwt('not.a.valid.jwt.token', SECRET)).toBeNull()
    expect(verifySupabaseJwt('onlyonesegment', SECRET)).toBeNull()
  })

  it('rejects a token with invalid base64/JSON payload', () => {
    expect(verifySupabaseJwt('aGVhZGVy.not-valid-json!!!.sig', SECRET)).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(verifySupabaseJwt('', SECRET)).toBeNull()
  })
})
