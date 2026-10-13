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
  it('blocks (403) and returns true for a pilot tenant', async () => {
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

  it('allows (no response sent) for a real, non-pilot tenant', async () => {
    const supabase = supabaseReturning({ is_pilot: false })
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(false)
    expect(reply.code).not.toHaveBeenCalled()
    expect(reply.send).not.toHaveBeenCalled()
  })

  it('fails open (allows) on a query error — never blocks a real action on a transient DB failure', async () => {
    const supabase = supabaseReturning(null, { message: 'connection reset' })
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(false)
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('fails open (allows) when the client throws synchronously — e.g. a test double with no "tenants" table stubbed', async () => {
    const supabase = { from(table: string) { throw new Error(`unexpected table: ${table}`) } }
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(false)
    expect(reply.code).not.toHaveBeenCalled()
  })

  it('allows when no tenant row is found (maybeSingle returns null data, no error)', async () => {
    const supabase = supabaseReturning(null, null)
    const reply = fakeReply()

    const blocked = await blockIfPilotTenant(supabase, 'tenant-1', reply, 'Finalizing a payroll run')

    expect(blocked).toBe(false)
  })
})
