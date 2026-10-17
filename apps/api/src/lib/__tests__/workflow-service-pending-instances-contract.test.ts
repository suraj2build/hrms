/**
 * SYSTEM_AUDIT_2026-10-14 — getPendingWorkflowInstances() response-contract fix.
 *
 * ApprovalWorkflows.tsx (the only real caller of GET /approvals/workflows/instances)
 * renders `inst.status.replace(...)` and `inst.workflow_type.replace(...)`
 * UNCONDITIONALLY for every row in the "Open Workflow Instances" list, and gates
 * the approve/reject/escalate buttons on `inst.status === 'pending'`. The old
 * getPendingWorkflowInstances() query only ever returned
 * {id, entity_type, entity_id, total_levels, current_level, final_approved,
 * created_at, submitted_by} — no `status`, no `workflow_type` — so the moment
 * any instance was open, the page would throw rendering it, and even if it
 * hadn't, the action buttons could never appear (status was always undefined,
 * never 'pending'). These tests prove the fixed shape.
 */
import { describe, it, expect } from 'vitest'
import { getPendingWorkflowInstances } from '../workflow-service.js'

function buildSupabase(rows: any[], opts: { countError?: any } = {}) {
  return {
    from(table: string) {
      if (table !== 'approval_instances') throw new Error(`unexpected table ${table}`)
      const chain: any = {
        select: () => chain,
        eq:     () => chain,
        is:     () => chain,
        order:  () => chain,
        range:  () => Promise.resolve({
          data:  opts.countError ? null : rows,
          count: opts.countError ? null : rows.length,
          error: opts.countError ?? null,
        }),
      }
      return chain
    },
  }
}

describe('getPendingWorkflowInstances — response contract', () => {
  it('every returned row has status: "pending" (this query only ever selects open instances)', async () => {
    const supabase = buildSupabase([
      {
        id: 'inst-1', entity_type: 'leave_request', entity_id: 'leave-1',
        total_levels: 2, current_level: 1, final_approved: null,
        created_at: '2026-10-14T00:00:00Z', submitted_by: 'user-1',
        requester: { full_name: 'Asha Rao' },
      },
    ])
    const { data } = await getPendingWorkflowInstances(supabase as any, 'tenant-1')
    expect(data).toHaveLength(1)
    expect(data[0].status).toBe('pending')
  })

  it('workflow_type is derived from entity_type via the canonical map', async () => {
    const supabase = buildSupabase([
      {
        id: 'inst-2', entity_type: 'employee_loan', entity_id: 'loan-1',
        total_levels: 1, current_level: 1, final_approved: null,
        created_at: '2026-10-14T00:00:00Z', submitted_by: 'user-2',
        requester: { full_name: 'Vikram Singh' },
      },
    ])
    const { data } = await getPendingWorkflowInstances(supabase as any, 'tenant-1')
    expect(data[0].workflow_type).toBe('loan')
  })

  it('requester_name is resolved from the joined submitter profile, null when absent', async () => {
    const supabase = buildSupabase([
      {
        id: 'inst-3', entity_type: 'overtime_request', entity_id: 'ot-1',
        total_levels: 1, current_level: 1, final_approved: null,
        created_at: '2026-10-14T00:00:00Z', submitted_by: 'user-3',
        requester: null,
      },
    ])
    const { data } = await getPendingWorkflowInstances(supabase as any, 'tenant-1')
    expect(data[0].requester_name).toBeNull()
    expect(data[0].reference_id).toBe('ot-1')
  })

  it('still throws on a genuine query failure (unchanged fabricated-success guard)', async () => {
    const supabase = buildSupabase([], { countError: { message: 'connection reset' } })
    await expect(getPendingWorkflowInstances(supabase as any, 'tenant-1')).rejects.toThrow()
  })
})
