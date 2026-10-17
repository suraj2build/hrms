/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 10+1 — gateApprove/gateReject used to
 * short-circuit straight to the legacy single-step path the instant a
 * workflow_type had zero active config rows (or zero levels applicable to
 * the entity's amount), WITHOUT first checking whether an existing
 * approval_instances row was already mid-chain for that entity. Deleting
 * or deactivating every level while an instance sat open (current_level=2,
 * final_approved=null) let the original, lower-level approver finalize the
 * entity through the legacy path, silently skipping the still-pending
 * higher level. These tests prove the fix: an open instance now fails the
 * action closed with CONFLICT instead of silently bypassing; the
 * untouched-by-a-chain / already-closed-instance cases still correctly
 * fall through to legacy (no regression for tenants that never configured
 * a chain, or whose chain finished normally).
 */
import { describe, it, expect, vi } from 'vitest'
import { gateApprove, gateReject } from '../approval-orchestrator.js'

const TENANT_ID = 'tenant-1'
const ENTITY_ID = 'leave-req-1'
const TARGET_EMP = 'emp-1'

function buildSupabase(opts: {
  config:   Array<Record<string, unknown>>
  instance: Record<string, unknown> | null
}) {
  return {
    from(table: string) {
      if (table === 'approval_workflow_config') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          order:  () => Promise.resolve({ data: opts.config, error: null }),
        }
        return chain
      }
      if (table === 'approval_instances') {
        const chain: any = {
          select:      () => chain,
          eq:          () => chain,
          maybeSingle: () => Promise.resolve({ data: opts.instance, error: null }),
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any
}

const baseInput = {
  tenantId:         TENANT_ID,
  entityType:       'leave_request' as const,
  entityId:         ENTITY_ID,
  actorId:          'actor-1',
  actorRole:        'manager',
  targetEmployeeId: TARGET_EMP,
}

describe('gateApprove — config deleted/deactivated mid-chain fails closed, not legacy-bypassed', () => {
  it('no config, no prior instance → legacy finalize (unchanged tenant-never-configured-a-chain behavior)', async () => {
    const supabase = buildSupabase({ config: [], instance: null })
    const result = await gateApprove(supabase, baseInput)
    expect(result).toEqual({ kind: 'finalize', authorized: false })
  })

  it('no config, but an OPEN instance exists mid-chain → CONFLICT, not legacy finalize', async () => {
    const supabase = buildSupabase({
      config: [],
      instance: { id: 'inst-1', total_levels: 2, current_level: 2, final_approved: null },
    })
    const result = await gateApprove(supabase, baseInput)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.type).toBe('CONFLICT')
      expect(result.error.message).toMatch(/approval chain in progress/i)
    }
  })

  it('no config, but the prior instance is already CLOSED → legacy finalize still allowed (no regression)', async () => {
    const supabase = buildSupabase({
      config: [],
      instance: { id: 'inst-1', total_levels: 2, current_level: 2, final_approved: true },
    })
    const result = await gateApprove(supabase, baseInput)
    expect(result).toEqual({ kind: 'finalize', authorized: false })
  })

  it('config exists but no level applies to this amount, with an OPEN instance → CONFLICT', async () => {
    const supabase = buildSupabase({
      config: [{ id: 'lvl-1', level: 1, approver_type: 'hr_admin', specific_role: null, label: 'HR', auto_approve_after_hours: null, min_amount: 500000, is_active: true }],
      instance: { id: 'inst-1', total_levels: 1, current_level: 1, final_approved: null },
    })
    const result = await gateApprove(supabase, { ...baseInput, amount: 100 })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.error.type).toBe('CONFLICT')
  })
})

describe('gateReject — same fail-closed guard, so a cleared-config reject cannot orphan an open instance unrecorded', () => {
  it('no config, no prior instance → legacy finalize (unchanged)', async () => {
    const supabase = buildSupabase({ config: [], instance: null })
    const result = await gateReject(supabase, baseInput)
    expect(result).toEqual({ kind: 'finalize', authorized: false })
  })

  it('no config, but an OPEN instance exists mid-chain → CONFLICT, not a silent legacy reject', async () => {
    const supabase = buildSupabase({
      config: [],
      instance: { id: 'inst-1', total_levels: 2, current_level: 1, final_approved: null },
    })
    const result = await gateReject(supabase, baseInput)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.error.type).toBe('CONFLICT')
  })
})
