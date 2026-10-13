import { describe, it, expect, vi } from 'vitest'
import { blockIfPilotTenant } from '../pilot-guard.js'

function fakeReply() {
  const reply: any = { code: vi.fn(() => reply), send: vi.fn(() => reply) }
  return reply
}

function supabaseReturning(data: { is_pilot: boolean } | null, error: unknown = null) {
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data, error }) }
  return { from: () => chain }
}

describe('blockIfPilotTenant', () => {
  it('blocks (403) and returns true for a verified pilot tenant', async () => {
    const supabase = supabaseReturning({ is_pilot: true })
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(true)
    expect(reply.code).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error:   'PILOT_TENANT_RESTRICTED',
      message: expect.stringContaining('Finalizing a payroll run'),
    }))
  })

  it('allows (no response sent) for a verified, non-pilot tenant', async () => {
    const supabase = supabaseReturning({ is_pilot: false })
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(false)
    expect(reply.code).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })

  // ── Fail-CLOSED cases (round 12 correction) ───────────────────────────────
  // A financial-action gate must never treat "couldn't verify the tenant's
  // pilot status" as equivalent to "verified not a pilot" — that would let a
  // pilot tenant's restricted action through on exactly the kind of
  // transient failure these cases simulate. The correct response is a
  // temporary 503 and NO write performed, never a silent 200 and never a
  // permanent 403 (which would wrongly block a real tenant's real action on
  // a one-off glitch, not just a true pilot tenant).

  it('blocks (503, no write) on a query error — never silently allows a financial write when the tenant cannot be verified', async () => {
    const supabase = supabaseReturning(null, { message: 'connection reset' })
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(true)
    expect(reply.code).toHaveBeenCalledWith(503)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PILOT_STATUS_CHECK_UNAVAILABLE',
    }))
  })

  it('blocks (503, no write) when the client throws synchronously — e.g. a network timeout', async () => {
    const supabase = { from(table: string) { throw new Error(`unexpected table: ${table}`) } }
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(true)
    expect(reply.code).toHaveBeenCalledWith(503)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PILOT_STATUS_CHECK_UNAVAILABLE',
    }))
  })

  it('blocks (503, no write) when no tenant row is found (maybeSingle returns null data, no error)', async () => {
    const supabase = supabaseReturning(null, null)
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(true)
    expect(reply.code).toHaveBeenCalledWith(503)
  })

  it('an async rejection from the lookup also fails closed (503), not an uncaught rejection', async () => {
    const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.reject(new Error('timeout')) }
    const supabase = { from: () => chain }
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(true)
    expect(reply.code).toHaveBeenCalledWith(503)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      error: 'PILOT_STATUS_CHECK_UNAVAILABLE',
    }))
  })
})
