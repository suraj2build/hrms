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
  ENTITY_WORKFLOW_MAP,
  type WorkflowType,
  type EntityType,
} from './workflow-service.js'

// entity_type → workflow_type (deterministic; avoids a schema column). Shared with
// the read surface via ENTITY_WORKFLOW_MAP in workflow-service.
const ENTITY_TO_WORKFLOW: Record<EntityType, WorkflowType> = ENTITY_WORKFLOW_MAP

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
  amount?:          number        // entity amount (₹) — drives min_amount level filtering
}

interface ConfigLevel {
  id:                       string
  level:                    number
  approver_type:            'direct_manager' | 'hr_admin' | 'super_admin' | 'specific_role'
  specific_role:            string | null
  label:                    string
  auto_approve_after_hours: number | null
  min_amount:               number | null
  is_active:                boolean
}

/**
 * Levels that apply to an instance of this amount — a level with min_amount set is
 * only included when amount >= min_amount. Sorted by level. With no amount (time-off
 * entities) every level applies. This is what makes a Finance tier kick in only above
 * a configured ₹ threshold, with no amount hardcoded in code.
 */
function applicableLevels(config: ConfigLevel[], amount: number | undefined): ConfigLevel[] {
  // A NaN amount (e.g. a finance entity whose amount couldn't be resolved) must not
  // silently drop thresholded levels — treat it as "no amount" so the caller's
  // fail-closed guard (a configured chain with zero applicable levels) can fire.
  const amt = (amount != null && Number.isFinite(amount)) ? amount : undefined
  return config
    .filter(c => c.min_amount == null || (amt != null && amt >= Number(c.min_amount)))
    .sort((a, b) => a.level - b.level)
}

// ── Per-level approver resolution ────────────────────────────────────────────────

/**
 * Pure check: does a profile with `role` + `employeeId` satisfy the approver
 * requirement of `cfg` for `targetEmployeeId`? No self-approval / delegation logic —
 * those are layered on top in actorSatisfiesLevel (self only applies to the real
 * actor; a delegator standing in is allowed to be e.g. the manager).
 */
async function profileSatisfiesLevel(
  supabase:         SupabaseClient,
  tenantId:         string,
  cfg:              ConfigLevel,
  role:             string | null,
  employeeId:       string | null,
  targetEmployeeId: string,
): Promise<boolean> {
  switch (cfg.approver_type) {
    case 'hr_admin':
      return !!role && ['hr_admin', 'super_admin'].includes(role)
    case 'super_admin':
      return role === 'super_admin'
    case 'specific_role':
      return !!cfg.specific_role && role === cfg.specific_role
    case 'direct_manager': {
      // HR admins may always stand in for the direct-manager level (escape hatch so
      // a missing/changed manager never deadlocks a chain).
      if (role && ['hr_admin', 'super_admin'].includes(role)) return true
      if (!employeeId) return false
      const { data: target } = await supabase
        .from('employees')
        .select('manager_id')
        .eq('id', targetEmployeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      return (target as { manager_id: string | null } | null)?.manager_id === employeeId
    }
    default:
      return false
  }
}

/**
 * Tokens a delegation's `entity_types` array may use to refer to this workflow.
 * The delegation UI stores loose values (leave_request / correction / overtime /
 * comp_off …) that don't cleanly match the engine's entity/workflow ids, so match
 * generously against any of them.
 */
function delegationTokens(entityType: EntityType, workflowType: WorkflowType): string[] {
  const base = [entityType as string, workflowType as string]
  if (workflowType === 'regularisation') base.push('correction', 'attendance_correction')
  return base
}

/**
 * Does `actor` satisfy the level — directly, or by an active delegation from
 * someone who would? Self-approval is always blocked for the real actor.
 */
async function actorSatisfiesLevel(
  supabase:         SupabaseClient,
  tenantId:         string,
  cfg:              ConfigLevel,
  actorId:          string,
  actorRole:        string,
  targetEmployeeId: string,
  entityType:       EntityType,
  workflowType:     WorkflowType,
): Promise<{ ok: true; viaDelegation?: boolean } | { ok: false; message: string }> {
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

  // Direct authority.
  if (await profileSatisfiesLevel(supabase, tenantId, cfg, actorRole, actorEmployeeId, targetEmployeeId)) {
    return { ok: true }
  }

  // Delegated authority: an active delegation to this actor, covering this workflow,
  // from a delegator who themselves satisfies the level.
  const nowIso = new Date().toISOString()
  const { data: delegations } = await supabase
    .from('approval_delegations')
    .select('delegator_id, entity_types, valid_from, valid_until, is_active')
    .eq('tenant_id', tenantId)
    .eq('delegate_id', actorId)
    .eq('is_active', true)
    .lte('valid_from', nowIso)
    .gte('valid_until', nowIso)

  const tokens = delegationTokens(entityType, workflowType)
  for (const d of (delegations ?? []) as any[]) {
    const ets: string[] = Array.isArray(d.entity_types) ? d.entity_types : []
    // An empty entity_types must NOT be treated as "covers everything" — that would
    // turn an unscoped delegation row into a blanket grant across all workflows.
    const covers = ets.length > 0 && ets.some((e) => tokens.includes(e))
    if (!covers) continue
    const { data: delegator } = await supabase
      .from('profiles')
      .select('role, employee_id')
      .eq('id', d.delegator_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const dRole = (delegator as { role: string | null } | null)?.role ?? null
    const dEmp  = (delegator as { employee_id: string | null } | null)?.employee_id ?? null
    // Segregation of duties: a delegation must never let the REQUESTER's own
    // request be approved — neither the actor (checked above) nor the delegator
    // may be the target employee.
    if (dEmp && dEmp === targetEmployeeId) continue
    if (await profileSatisfiesLevel(supabase, tenantId, cfg, dRole, dEmp, targetEmployeeId)) {
      return { ok: true, viaDelegation: true }
    }
  }

  // Tailored failure message by approver type.
  const msg =
    cfg.approver_type === 'hr_admin'      ? `Level ${cfg.level} requires an HR admin` :
    cfg.approver_type === 'super_admin'   ? `Level ${cfg.level} requires a super admin` :
    cfg.approver_type === 'specific_role' ? `Level ${cfg.level} requires role '${cfg.specific_role ?? '?'}'` :
    cfg.approver_type === 'direct_manager'? `Level ${cfg.level} requires the employee's direct manager` :
    `Level ${cfg.level} approver requirement not met`
  return { ok: false, message: msg }
}

// ── Lazy get-or-create of the instance ───────────────────────────────────────────
async function getOrCreateInstance(
  supabase:    SupabaseClient,
  tenantId:    string,
  workflowType: WorkflowType,
  entityType:  EntityType,
  entityId:    string,
  targetEmployeeId: string,
  totalLevels: number,
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
    supabase, tenantId, workflowType, entityType, entityId, submittedBy, totalLevels,
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
): Promise<{ ok: true } | { ok: false; type: 'CONFLICT' | 'DB_ERROR'; message: string }> {
  const patch: Record<string, unknown> = {}
  if (close) {
    patch.final_approved = finalApproved
    patch.closed_at      = new Date().toISOString()
  } else if (nextLevel) {
    patch.current_level = nextLevel
  }

  // Update the instance FIRST, folding the precondition (still open, still at
  // the level the caller read) into the WHERE clause and checking the
  // returned row — mirrors the fix already applied to the sibling
  // processWorkflowAction in workflow-service.ts. Previously the action row
  // was inserted before this unguarded update ran, so two concurrent actions
  // on the same instance (double-click/retry, or a genuine approve/reject
  // race between two authorized approvers) could both pass the caller's
  // earlier `final_approved !== null` read-time check, both insert an
  // approval_actions row (duplicate/contradictory audit trail), and both
  // blindly overwrite approval_instances — last write wins with no error,
  // leaving the chain's recorded outcome inconsistent with the actual
  // entity status. Only record the action once the transition is confirmed.
  if (Object.keys(patch).length) {
    const { data: updated, error: updErr } = await supabase
      .from('approval_instances')
      .update(patch)
      .eq('id', instanceId)
      .eq('tenant_id', tenantId)
      .is('final_approved', null)
      .eq('current_level', level)
      .select('id')
      .maybeSingle()

    if (updErr) return { ok: false, type: 'DB_ERROR', message: 'Failed to update approval instance' }
    if (!updated) return { ok: false, type: 'CONFLICT', message: 'This request was already actioned by another request' }
  }

  const { error: actionErr } = await supabase
    .from('approval_actions')
    .insert({ tenant_id: tenantId, instance_id: instanceId, level, action, actor_id: actorId, comments: comments ?? null })
  if (actionErr) return { ok: false, type: 'DB_ERROR', message: 'Failed to record approval action' }

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

  // Only the levels that apply to this amount form the chain (threshold routing).
  const applicable = applicableLevels(config, input.amount)
  if (applicable.length === 0) return { kind: 'finalize', authorized: false }  // amount below every level → legacy

  const instance = await getOrCreateInstance(
    supabase, input.tenantId, workflowType, input.entityType, input.entityId, input.targetEmployeeId,
    applicable.length,
  )
  if (!instance) return { kind: 'finalize', authorized: false }  // couldn't engage engine → legacy

  if (instance.final_approved !== null) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'This request is already closed' } }
  }

  // current_level indexes into the applicable chain (1-based). If it is out of
  // range, the chain config or amount changed after this instance was created —
  // fail CLOSED with a conflict rather than silently rebinding to the last level
  // (which could finalize against the wrong level's approver requirement).
  const cfg = applicable[instance.current_level - 1]
  if (!cfg) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'Approval chain configuration changed for this request — please refresh and retry.' } }
  }

  const auth = await actorSatisfiesLevel(
    supabase, input.tenantId, cfg, input.actorId, input.actorRole, input.targetEmployeeId,
    input.entityType, workflowType,
  )
  if (!auth.ok) return { kind: 'error', error: { type: 'FORBIDDEN', message: auth.message } }

  // Final-level detection uses the applicable chain length (authoritative now),
  // consistent with how cfg was resolved.
  const isFinalLevel = instance.current_level >= applicable.length

  if (isFinalLevel) {
    const rec = await recordAndAdvance(
      supabase, input.tenantId, instance.id, instance.current_level,
      'approved', input.actorId, input.comments, true, true, null,
    )
    if (!rec.ok) return { kind: 'error', error: { type: rec.type, message: rec.message } }
    return { kind: 'finalize', authorized: true }
  }

  // Intermediate approval → advance, keep entity PENDING.
  const nextLevel = instance.current_level + 1
  const rec = await recordAndAdvance(
    supabase, input.tenantId, instance.id, instance.current_level,
    'approved', input.actorId, input.comments, false, null, nextLevel,
  )
  if (!rec.ok) return { kind: 'error', error: { type: rec.type, message: rec.message } }
  return { kind: 'advanced', level: instance.current_level, nextLevel, totalLevels: applicable.length }
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

  const applicable = applicableLevels(config, input.amount)
  if (applicable.length === 0) return { kind: 'finalize', authorized: false }

  const instance = await getOrCreateInstance(
    supabase, input.tenantId, workflowType, input.entityType, input.entityId, input.targetEmployeeId,
    applicable.length,
  )
  if (!instance) return { kind: 'finalize', authorized: false }

  if (instance.final_approved !== null) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'This request is already closed' } }
  }

  const cfg = applicable[instance.current_level - 1]
  if (!cfg) {
    return { kind: 'error', error: { type: 'CONFLICT', message: 'Approval chain configuration changed for this request — please refresh and retry.' } }
  }

  const auth = await actorSatisfiesLevel(
    supabase, input.tenantId, cfg, input.actorId, input.actorRole, input.targetEmployeeId,
    input.entityType, workflowType,
  )
  if (!auth.ok) return { kind: 'error', error: { type: 'FORBIDDEN', message: auth.message } }

  const rec = await recordAndAdvance(
    supabase, input.tenantId, instance.id, instance.current_level,
    'rejected', input.actorId, input.comments, true, false, null,
  )
  if (!rec.ok) return { kind: 'error', error: { type: rec.type, message: rec.message } }
  return { kind: 'finalize', authorized: true }
}
