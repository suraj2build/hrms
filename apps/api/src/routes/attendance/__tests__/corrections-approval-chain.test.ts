/**
 * SYSTEM_AUDIT_2026-10-14 checkpoint 13 batch sweep — 'attendance_correction'
 * is a registered entity type (ENTITY_WORKFLOW_MAP → workflow_type
 * 'correction') with a real, reachable admin UI to configure a multi-level
 * chain for it (Settings → Approval Workflows → Corrections tab,
 * apps/web/src/pages/settings/ApprovalWorkflows.tsx), but
 * routes/attendance/corrections.ts never called gateApprove/gateReject at
 * all — every correction finalized in one step via the bespoke
 * authoriseApprover() helper (manager-or-HR), silently ignoring any
 * configured chain beyond its first level. This is a stronger version of
 * the bug class checkpoints 11-13 already fixed elsewhere: not a fallback
 * triggered by a missing identity or deleted config, but total
 * non-engagement of the orchestrator for this entity type.
 *
 * These tests prove the fix (mocked route tests; the real-Postgres +
 * real-HTTP proof against an actual persisted 2-level chain is Part C of
 * scripts/db/verify-approval-chain-bypass.mjs):
 * (1) a configured 2-level chain genuinely ADVANCES on the first approval
 *     (correction stays 'pending', not 'processing') and only finalizes on
 *     the second;
 * (2) a genuinely unconfigured workflow is completely unaffected — still
 *     the legacy single-step authoriseApprover path;
 * (3) reject finalizes immediately at any level (gateReject never returns
 *     'advanced').
 */
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import attendanceCorrectionsRoute from '../corrections.js'

const TENANT = 'tenant-1'
const CORR_ID = 'corr-1'
const EMP_ID = 'emp-1'
const MANAGER_ID = 'mgr-1'
const SUBMITTER_PROFILE_ID = 'submitter-profile-1'

const TWO_LEVEL_CONFIG = [
  { id: 'lvl-1', level: 1, approver_type: 'direct_manager', specific_role: null, label: 'Direct Manager', auto_approve_after_hours: null, min_amount: null, is_active: true },
  { id: 'lvl-2', level: 2, approver_type: 'hr_admin',        specific_role: null, label: 'HR Admin',        auto_approve_after_hours: null, min_amount: null, is_active: true },
]

function buildApp(opts: {
  config: Array<Record<string, unknown>>
  correctionStatus?: string
  actorRole: string
  actorId: string
  existingInstanceLevel?: number // pre-seed an already-open instance at this level (simulates a prior level having already advanced it)
}) {
  const app = Fastify()
  app.decorate('authenticate', async (req: any) => {
    req.tenantId = TENANT
    req.userId   = opts.actorId
    req.userRole = opts.actorRole
  })

  const correctionRow: any = {
    id: CORR_ID, status: opts.correctionStatus ?? 'pending', employee_id: EMP_ID,
    date: '2101-06-01', corrected_in: '2101-06-01T09:00:00Z', corrected_out: '2101-06-01T18:00:00Z',
    submitted_by: SUBMITTER_PROFILE_ID,
  }
  let instanceRow: any = opts.existingInstanceLevel
    ? { id: 'inst-1', entity_type: 'attendance_correction', entity_id: CORR_ID, total_levels: TWO_LEVEL_CONFIG.length, current_level: opts.existingInstanceLevel, final_approved: null, created_at: '2101-01-01' }
    : null
  const instanceInsertSpy = vi.fn()

  const supabase = {
    from(table: string) {
      if (table === 'attendance_corrections') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          maybeSingle: () => Promise.resolve({ data: correctionRow, error: null }),
          update: (patch: any) => {
            const updateChain: any = {
              eq: () => updateChain,
              select: () => ({
                maybeSingle: () => {
                  if (correctionRow.status !== 'pending') return Promise.resolve({ data: null, error: null })
                  Object.assign(correctionRow, patch)
                  return Promise.resolve({ data: { id: CORR_ID }, error: null })
                },
                then: (resolve: any) => {
                  Object.assign(correctionRow, patch)
                  resolve({ data: [{ id: CORR_ID }], error: null })
                },
              }),
            }
            return updateChain
          },
        }
        return chain
      }
      if (table === 'attendance_period_locks') {
        const chain: any = { select: () => chain, eq: () => chain, in: () => chain, neq: () => Promise.resolve({ data: [], error: null }) }
        return chain
      }
      if (table === 'approval_workflow_config') {
        const chain: any = { select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: opts.config, error: null }) }
        return chain
      }
      if (table === 'approval_instances') {
        const selectChain: any = {
          select: () => selectChain,
          eq:     () => selectChain,
          maybeSingle: () => Promise.resolve({ data: instanceRow, error: null }),
        }
        return {
          select: () => selectChain,
          insert: (row: any) => {
            instanceInsertSpy(row)
            instanceRow = { id: 'inst-1', entity_type: row.entity_type, entity_id: row.entity_id, total_levels: row.total_levels, current_level: row.current_level, final_approved: null, created_at: '2101-01-01' }
            return { select: () => ({ single: () => Promise.resolve({ data: instanceRow, error: null }) }) }
          },
          update: (patch: any) => {
            const updateChain: any = {
              eq: () => updateChain,
              is: () => updateChain,
              select: () => ({
                maybeSingle: () => {
                  Object.assign(instanceRow, patch)
                  return Promise.resolve({ data: { id: 'inst-1' }, error: null })
                },
              }),
            }
            return updateChain
          },
        }
      }
      if (table === 'approval_actions') {
        return { insert: () => Promise.resolve({ data: null, error: null }) }
      }
      if (table === 'approval_delegations') {
        const chain: any = { select: () => chain, eq: () => chain, lte: () => chain, gte: () => Promise.resolve({ data: [], error: null }) }
        return chain
      }
      if (table === 'profiles') {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { employee_id: opts.actorId === MANAGER_ID ? MANAGER_ID : null }, error: null }) }
        return chain
      }
      if (table === 'employees') {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { manager_id: MANAGER_ID }, error: null }) }
        return chain
      }
      if (table === 'job_history') {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: { manager_id: MANAGER_ID }, error: null }) }
        return chain
      }
      if (table === 'audit_logs') {
        return { insert: () => Promise.resolve({ data: null, error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as any

  app.decorate('supabase', supabase)
  app.register(attendanceCorrectionsRoute)
  return { app, instanceInsertSpy, correctionRow, getInstance: () => instanceRow }
}

describe('POST /attendance/corrections/:id/approve — a configured chain now genuinely engages', () => {
  it('manager approval (level 1 of 2) only ADVANCES — correction stays pending, not processing', async () => {
    const { app, correctionRow, getInstance } = buildApp({ config: TWO_LEVEL_CONFIG, actorRole: 'manager', actorId: MANAGER_ID })
    const res = await app.inject({ method: 'POST', url: `/attendance/corrections/${CORR_ID}/approve`, headers: {}, payload: {} })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.status).toBe('pending')
    expect(body.message).toMatch(/level 2 of 2/i)
    // Before this fix this single approval would have flipped status straight to 'processing'.
    expect(correctionRow.status).toBe('pending')
    expect(getInstance()).toEqual(expect.objectContaining({ current_level: 2, total_levels: 2, final_approved: null }))
  })

  it('HR admin (level 2, the final level — simulating the manager having already advanced it) genuinely finalizes — correction moves to processing', async () => {
    const { app, correctionRow } = buildApp({ config: TWO_LEVEL_CONFIG, actorRole: 'hr_admin', actorId: 'hr-1', existingInstanceLevel: 2 })
    const res = await app.inject({ method: 'POST', url: `/attendance/corrections/${CORR_ID}/approve`, headers: {}, payload: {} })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.status).toBe('processing')
    expect(correctionRow.status).toBe('processing')
    expect(correctionRow.approved_by).toBe('hr-1')
  })

  it('a genuinely unconfigured workflow is completely unaffected — still the legacy single-step path', async () => {
    const { app, correctionRow } = buildApp({ config: [], actorRole: 'manager', actorId: MANAGER_ID })
    const res = await app.inject({ method: 'POST', url: `/attendance/corrections/${CORR_ID}/approve`, headers: {}, payload: {} })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.status).toBe('processing')
    expect(correctionRow.status).toBe('processing')
  })

  it('a manager who is NOT the direct manager and config is empty is still refused by the legacy authoriseApprover check', async () => {
    const { app } = buildApp({ config: [], actorRole: 'manager', actorId: 'some-other-manager' })
    const res = await app.inject({ method: 'POST', url: `/attendance/corrections/${CORR_ID}/approve`, headers: {}, payload: {} })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /attendance/corrections/:id/reject — always finalizes, at any level', () => {
  it('manager rejects at level 1 of a 2-level chain — finalizes immediately, never advances', async () => {
    const { app, correctionRow } = buildApp({ config: TWO_LEVEL_CONFIG, actorRole: 'manager', actorId: MANAGER_ID })
    const res = await app.inject({ method: 'POST', url: `/attendance/corrections/${CORR_ID}/reject`, headers: {}, payload: { rejection_reason: 'not genuine' } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data.status).toBe('rejected')
    expect(correctionRow.status).toBe('rejected')
  })
})
