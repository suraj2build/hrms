/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 13 — a reviewer flagged a real bug
 * exposed while building checkpoint 12's real-Postgres approval-chain
 * script: getOrCreateInstance silently returned `null` whenever it could
 * not resolve the target employee's linked `profiles` row (no profile
 * ever linked, or since unlinked) to satisfy `approval_instances.
 * submitted_by` (NOT NULL). Both gateApprove and gateReject then treated
 * that `null` exactly like "no workflow configured" and fell straight to
 * the LEGACY single-step approval path — even though, by that point in
 * the function, config.length>0 and applicable.length>0 are ALREADY
 * confirmed, meaning a multi-level chain genuinely applies. A request
 * could silently skip every configured stage just because the submitting
 * employee's profile link was missing.
 *
 * These tests prove the fix: (1) a configured, applicable workflow with
 * unresolvable identity now fails CLOSED (CONFLICT), never legacy; (2)
 * the authorized-path `submittedByHint` (the entity's own already-
 * recorded submitter, e.g. leave_requests.requested_by) resolves the
 * instance directly without ever needing the employee→profile lookup;
 * (3) a genuinely unconfigured workflow is completely unaffected — still
 * legacy, exactly as before; (4) a non-identity DB error during instance
 * creation also fails closed, not legacy.
 */
import { describe, it, expect, vi } from 'vitest'
import { gateApprove, gateReject } from '../approval-orchestrator.js'

const TENANT_ID  = 'tenant-1'
const ENTITY_ID  = 'reg-1'
const TARGET_EMP = 'emp-1'
const ACTOR_ID   = 'actor-1'

const ONE_LEVEL_HR_CONFIG = [
  { id: 'lvl-1', level: 1, approver_type: 'hr_admin', specific_role: null, label: 'HR', auto_approve_after_hours: null, min_amount: null, is_active: true },
]

function buildSupabase(opts: {
  config:        Array<Record<string, unknown>>
  actorProfile?: { employee_id: string | null } | null
  targetProfile?: { id: string } | null | 'THROW'  // 'THROW' proves this lookup was never reached
  insertError?:  { code?: string; message: string }
  insertSpy?:    ReturnType<typeof vi.fn>
}) {
  const instanceRow = { id: 'inst-1', entity_type: 'attendance_regularisation', entity_id: ENTITY_ID, total_levels: 1, current_level: 1, final_approved: null, created_at: '2026-01-01' }

  return {
    from(table: string) {
      if (table === 'approval_workflow_config') {
        const chain: any = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: opts.config, error: null }) }
        return chain
      }
      if (table === 'approval_instances') {
        const selectChain: any = {
          select: () => selectChain,
          eq:     () => selectChain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }), // no existing instance
        }
        return {
          select: () => selectChain,
          insert: (row: any) => {
            opts.insertSpy?.(row)
            if (opts.insertError) return { select: () => ({ single: () => Promise.resolve({ data: null, error: opts.insertError }) }) }
            return { select: () => ({ single: () => Promise.resolve({ data: instanceRow, error: null }) }) }
          },
          update: () => {
            const updateChain: any = {
              eq: () => updateChain,
              is: () => updateChain,
              select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'inst-1' }, error: null }) }),
            }
            return updateChain
          },
        }
      }
      if (table === 'approval_actions') {
        return { insert: () => Promise.resolve({ data: null, error: null }) }
      }
      if (table === 'approval_delegations') {
        const chain: any = { select: () => chain, eq: () => chain, then: (resolve: any) => resolve({ data: [], error: null }) }
        return chain
      }
      if (table === 'profiles') {
        const cols: string[] = []
        const chain: any = {
          select: () => chain,
          eq: (c: string) => { cols.push(c); return chain },
          maybeSingle: () => {
            if (cols.includes('employee_id')) {
              if (opts.targetProfile === 'THROW') throw new Error('submittedBy-via-profile-lookup was reached despite a submittedByHint being provided')
              return Promise.resolve({ data: opts.targetProfile ?? null, error: null })
            }
            if (cols.includes('id')) {
              return Promise.resolve({ data: opts.actorProfile ?? { employee_id: null }, error: null })
            }
            return Promise.resolve({ data: null, error: null })
          },
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any
}

const baseInput = {
  tenantId:         TENANT_ID,
  entityType:       'attendance_regularisation' as const,
  entityId:         ENTITY_ID,
  actorId:          ACTOR_ID,
  actorRole:        'hr_admin',
  targetEmployeeId: TARGET_EMP,
}

describe('gateApprove — identity cannot be resolved, but a workflow IS configured and applicable', () => {
  it('fails CLOSED with CONFLICT, never silently falls to legacy finalize', async () => {
    const supabase = buildSupabase({ config: ONE_LEVEL_HR_CONFIG, targetProfile: null })
    const result = await gateApprove(supabase, baseInput) // no submittedByHint
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.error.type).toBe('CONFLICT')
      expect(result.error.message).toMatch(/no login profile is linked/i)
    }
  })

  it('gateReject has the same fail-closed guard', async () => {
    const supabase = buildSupabase({ config: ONE_LEVEL_HR_CONFIG, targetProfile: null })
    const result = await gateReject(supabase, baseInput)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.error.type).toBe('CONFLICT')
  })
})

describe('gateApprove — authorized-path submittedByHint resolves identity directly', () => {
  it('a caller-supplied submittedByHint lets the instance be created WITHOUT ever querying the employee→profile lookup', async () => {
    const insertSpy = vi.fn()
    const supabase = buildSupabase({ config: ONE_LEVEL_HR_CONFIG, targetProfile: 'THROW', insertSpy })
    const result = await gateApprove(supabase, { ...baseInput, submittedByHint: 'hint-profile-1' })
    // 1-level hr_admin chain, actor is hr_admin → immediately final.
    expect(result).toEqual({ kind: 'finalize', authorized: true })
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ submitted_by: 'hint-profile-1' }))
  })

  it('a null/absent submittedByHint falls back to the employee→profile lookup, unchanged from before', async () => {
    const supabase = buildSupabase({ config: ONE_LEVEL_HR_CONFIG, targetProfile: { id: 'resolved-via-lookup' } })
    const result = await gateApprove(supabase, { ...baseInput, submittedByHint: null })
    expect(result).toEqual({ kind: 'finalize', authorized: true })
  })
})

describe('gateApprove — genuinely unconfigured workflow is unaffected (legacy preserved)', () => {
  it('no active config at all → still legacy finalize, even with a submittedByHint provided', async () => {
    const supabase = buildSupabase({ config: [] })
    const result = await gateApprove(supabase, { ...baseInput, submittedByHint: 'hint-profile-1' })
    expect(result).toEqual({ kind: 'finalize', authorized: false })
  })
})

describe('gateApprove — a non-identity DB error during instance creation also fails closed', () => {
  it('an insert failure that is NOT the identity case still returns an error, not a silent legacy finalize', async () => {
    const supabase = buildSupabase({
      config: ONE_LEVEL_HR_CONFIG,
      insertError: { message: 'simulated transient DB failure' },
    })
    const result = await gateApprove(supabase, { ...baseInput, submittedByHint: 'hint-profile-1' })
    expect(result.kind).toBe('error')
    // createWorkflowInstance itself normalizes any non-23505 insert error to
    // this generic message (apps/api/src/lib/workflow-service.ts) — the
    // point under test is that it surfaces as an ERROR at all, not a
    // silent legacy finalize, not the exact wording.
    if (result.kind === 'error') {
      expect(result.error.type).toBe('DB_ERROR')
      expect(result.error.message).toMatch(/Failed to create approval instance/)
    }
  })
})
