/**
 * approval-orchestrator.ts — the multi-level gate in front of every live finalize.
 *
 * This is the bridge that makes the 053 approval engine (approval_workflow_config /
 * approval_instances / approval_actions) actually drive the live approval paths,
 * WITHOUT reimplementing the hardened finalize logic (balance deduction, accrual,
 * payroll) that lives in approval-service / ot-engine / comp-off.
 *
 * The contract is one question per action: "finalize now, advance a level, or error?"
 *
 *   gateApprove() →
 *     • no chain configured for this workflow_type → { finalize, authorized:false }
 *         the caller runs its EXISTING validateApprover + atomic finalize — i.e.
 *         byte-for-byte today's single-step behavior. Nothing changes for tenants
 *         that never configured a chain.
 *     • chain configured, current level is NOT final → { advanced }
 *         the action is recorded, the instance advances a level, and the ENTITY
 *         STAYS PENDING. The caller returns success without finalizing.
 *     • chain configured, current level IS final → { finalize, authorized:true }
 *         the per-level gate already authorized the actor, so the caller runs the
 *         atomic finalize but SKIPS its legacy validateApprover.
 *     • actor fails the per-level approver gate → { error }
 *
 *   gateReject() → reject always finalizes (any level may reject → entity REJECTED),
 *     but when a chain exists the action is recorded and the instance is closed.
 *
 * Backward-compat is the whole point: the gate short-circuits to legacy the instant
 * a tenant has zero active config rows for the workflow type.
 *
 * Error contract: returns a discriminated GateDecision — no throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createWorkflowInstance,
  getWorkflowInstance,
  getWorkflowConfig,
  type WorkflowType,
  type EntityType,
} from './workflow-service.js'

// ── entity_type → workflow_type (deterministic; avoids a schema column) ──────────
const ENTITY_TO_WORKFLOW: Partial<Record<EntityType, WorkflowType>> = {
  leave_request:             'leave',
  attendance_correction:     'correction',
  attendance_regularisation: 'regularisation',
  overtime_request:          'overtime',
  comp_off_request:          'comp_off',
}

// ── Decision contract ────────────────────────────────────────────────────────────
export type GateDecision =
  | { kind: 'finalize'; authorized: boolean }
  | { kind: 'advanced'; level: number; nextLevel: number; totalLevels: number }
  | { kind: 'error';    error: { type: 'FORBIDDEN' | 'CONFLICT' | 'DB_ERROR' | 'NOT_FOUND'; message: string } }

export interface GateInput {
  tenantId:         string
  entityType:       EntityType
  entityId:         string
  actorId:          string        // profiles.id of the approver
  actorRole:        string        // req.userRole
  targetEmployeeId: string        // employees.id the request belongs to
  comments?:        string | null
}

interface ConfigLevel {
  id:                       string
  level:                    number
  approver_type:            'direct_manager' | 'hr_admin' | 'super_admin' | 'specific_role'
  specific_role:            string | null
  label:                    string
  auto_approve_after_hours: number | null
  is_active:                boolean
}

// ── Per-level approver resolution ────────────────────────────────────────────────
/**
 * Does `actor` satisfy the approver requirement of `cfg` for `targetEmployeeId`?
 * Self-approval is always blocked regardless of level config.
 */
async function actorSatisfiesLevel(
  supabase:         SupabaseClient,
  tenantId:         string,
  cfg:              ConfigLevel,
  actorId:          string,
  actorRole:        string,
  targetEmployeeId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Resolve the actor's own employee record (for self-approval + manager checks).
  const { data: actorProfile } = await supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', actorId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const actorEmployeeId = (actorProfile as { employee_id: string | null } | null)?.employee_id ?? null

  // Self-approval guard (segregation of duties) — applies at every level.
  if (actorEmployeeId && actorEmployeeId === targetEmployeeId) {
    return { ok: false, message: 'You cannot approve your own request' }
  }

  switch (cfg.approver_type) {
    case 'hr_admin':
      return ['hr_admin', 'super_admin'].includes(actorRole)
        ? { ok: true }
        : { ok: false, message: `Level ${cfg.level} requires an HR admin` }

    case 'super_admin':
      return actorRole === 'super_admin'
        ? { ok: true }
        : { ok: false, message: `Level ${cfg.level} requires a super admin` }

    case 'specific_role':
      return cfg.specific_role && actorRole === cfg.specific_role
        ? { ok: true }
        : { ok: false, message: `Level ${cfg.level} requires role '${cfg.specific_role ?? '?'}'` }

    case 'direct_manager': {
      if (!actorEmployeeId) {
        return { ok: false, message: `Level ${cfg.level} requires the direct manager, but you have no linked employee record` }
      }
      const { data: target } = await supabase
        .from('employees')
        .select('manager_id')
        .eq('id', targetEmployeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const managerId = (target as { manager_id: string | null } | null)?.manager_id ?? null
      // HR admins may always stand in for the direct-manager level (escape hatch
      // so a missing/changed manager never deadlocks a chain).
      if (managerId === actorEmployeeId || ['hr_admin', 'super_admin'].includes(actorRole)) {
        return { ok: true }
      }
      return { ok: false, message: `Level ${cfg.level} requires the employee's direct manager` }
    }

    default:
      return { ok: false, message: `Unknown approver type for level ${cfg.level}` }
  }
}

// ── Lazy get-or-create of the instance ───────────────────────────────────────────
async function getOrCreateInstance(
  supabase:    SupabaseClient,
  tenantId:    string,
  workflowType: WorkflowType,
  entityType:  EntityType,
  entityId:    string,
  targetEmployeeId: string,
) {
  const existing = await getWorkflowInstance(supabase, tenantId, entityType, entityId)
  if (existing) return existing

  // submitted_by is NOT NULL (FK profiles). The request belongs to the target
  // employee, so resolve their login profile. Fall back to any tenant profile is
  // unsafe — instead, if the employee has no profile we still create with the
  // employee's profile when present; otherwise the create is skipped by returning null.
  const { data: subProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', targetEmployeeId)
    .maybeSingle()
  const submittedBy = (subProfile as { id: string } | null)?.id ?? null
  if (!submittedBy) return null  // can't satisfy NOT NULL — treat as no-instance (legacy)

  const created = await createWorkflowInstance(
    supabase, tenantId, workflowType, entityType, entityId, submittedBy,
  )
  if (created.ok) return created.value

  // Lost a create race → re-fetch the winner.
  if (created.error.type === 'CONFLICT') {
    return await getWorkflowInstance(supabase, tenantId, entityType, entityId)
  }
  return null
}

// ── Record an action + advance/close the instance ────────────────────────────────
async function recordAndAdvance(
  supabase:   SupabaseClient,
  tenantId:   string,
  instanceId: string,
  level:      number,
  action:     'approved' | 'rejected',
  actorId:    string,
  comments:   string | null | undefined,
  close:      boolean,
  finalApproved: boolean | null,
  nextLevel:  number | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error: actionErr } = await supabase
    .from('approval_actions')
    .insert({ tenant_id: tenantId, instance_id: instanceId, level, action, actor_id: actorId, comments: comments ?? null })
  if (actionErr) return { ok: false, message: 'Failed to record approval action' }

  const patch: Record<string, unknown> = {}
  if (close) {
    patch.final_approved = finalApproved
    patch.closed_at      = new Date().toISOString()
  } else if (nextLevel) {
    patch.current_level = nextLevel
  }
  if (Object.keys(patch).length) {
    const { error: updErr } = await supabase
      .from('approval_instances')
      .update(patch)
      .eq('id', instanceId)
      .eq('tenant_id', tenantId)
    if (updErr) return { ok: false, message: 'Failed to update approval instance' }
  }
  return { ok: true }
}

// ── gateApprove ──────────────────────────────────────────────────────────────────
/**
 * Decide whether an approve action finalizes the entity, advances a level, or is
 * rejected by the per-level gate. See the module header for the full contract.
 */
export async function gateApprove(supabase: SupabaseClient, input: GateInput): Promise<GateDecision> {
  const workflowType = ENTITY_TO_WORKFLOW[input.entityType]
  if (!workflowType) return { kind: 'finalize', authorized: false }  // unmapped → legacy

  const config = (await getWorkflowConfig(supabase, input.tenantId, workflowType))
    .filter((c: any) => c.is_active) as ConfigLevel[]

  // No chain configured → legacy single-step (caller runs its own validateApprover).
  if (config.length === 0) return { kind: 'finalize', authorized: false }

  const instance = await getOrCreateInstance(
    supabase, input.tenantId, workflowType, input.entityType, input.entityId, input.targetEmployeeId,
  )
  if (!instance) return { kind: 'finalize', authorized: false }  // couldn't engage engine → legacy

  if (instance.final_approved !== null) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'This request is already closed' } }
  }

  // Resolve the config row for the current level.
  const cfg = config.find(c => c.level === instance.current_level)
    ?? config.slice().sort((a, b) => b.level - a.level)[0]  // safety: highest configured level

  const auth = await actorSatisfiesLevel(
    supabase, input.tenantId, cfg, input.actorId, input.actorRole, input.targetEmployeeId,
  )
  if (!auth.ok) return { kind: 'error', error: { type: 'FORBIDDEN', message: auth.message } }

  const isFinalLevel = instance.current_level >= instance.total_levels

  if (isFinalLevel) {
    const rec = await recordAndAdvance(
      supabase, input.tenantId, instance.id, instance.current_level,
      'approved', input.actorId, input.comments, true, true, null,
    )
    if (!rec.ok) return { kind: 'error', error: { type: 'DB_ERROR', message: rec.message } }
    return { kind: 'finalize', authorized: true }
  }

  // Intermediate approval → advance, keep entity PENDING.
  const nextLevel = instance.current_level + 1
  const rec = await recordAndAdvance(
    supabase, input.tenantId, instance.id, instance.current_level,
    'approved', input.actorId, input.comments, false, null, nextLevel,
  )
  if (!rec.ok) return { kind: 'error', error: { type: 'DB_ERROR', message: rec.message } }
  return { kind: 'advanced', level: instance.current_level, nextLevel, totalLevels: instance.total_levels }
}

// ── gateReject ───────────────────────────────────────────────────────────────────
/**
 * Reject always finalizes the entity (any level may reject). When a chain exists,
 * record the rejection action and close the instance; otherwise pure legacy.
 */
export async function gateReject(supabase: SupabaseClient, input: GateInput): Promise<GateDecision> {
  const workflowType = ENTITY_TO_WORKFLOW[input.entityType]
  if (!workflowType) return { kind: 'finalize', authorized: false }

  const config = (await getWorkflowConfig(supabase, input.tenantId, workflowType))
    .filter((c: any) => c.is_active) as ConfigLevel[]
  if (config.length === 0) return { kind: 'finalize', authorized: false }

  const instance = await getOrCreateInstance(
    supabase, input.tenantId, workflowType, input.entityType, input.entityId, input.targetEmployeeId,
  )
  if (!instance) return { kind: 'finalize', authorized: false }

  if (instance.final_approved !== null) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'This request is already closed' } }
  }

  const cfg = config.find(c => c.level === instance.current_level)
    ?? config.slice().sort((a, b) => b.level - a.level)[0]

  const auth = await actorSatisfiesLevel(
    supabase, input.tenantId, cfg, input.actorId, input.actorRole, input.targetEmployeeId,
  )
  if (!auth.ok) return { kind: 'error', error: { type: 'FORBIDDEN', message: auth.message } }

  const rec = await recordAndAdvance(
    supabase, input.tenantId, instance.id, instance.current_level,
    'rejected', input.actorId, input.comments, true, false, null,
  )
  if (!rec.ok) return { kind: 'error', error: { type: 'DB_ERROR', message: rec.message } }
  return { kind: 'finalize', authorized: true }
}
