/**
 * WorkflowService — multi-level approval workflow management.
 *
 * Architecture:
 *   • createInstance()  — called when a new request is submitted;
 *     reads approval_workflow_config to determine total_levels.
 *   • processAction()   — called when an approver acts (approve/reject);
 *     advances or closes the instance.
 *   • getInstanceForEntity() — lookup helper for routes.
 *   • getPendingForActor()   — return instances awaiting action by this user.
 *
 * The workflow config is optional per tenant.  If no config exists for a
 * workflow_type the instance starts (and ends) at level 1 with total_levels=1,
 * preserving backward-compat with the existing single-level approval flow.
 *
 * Error contract: all exported functions return { ok, value | error } — no throws.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Shared types ───────────────────────────────────────────────────────────────

export type WorkflowType   = 'leave' | 'correction' | 'regularisation' | 'overtime' | 'comp_off' | 'reimbursement' | 'loan' | 'advance'
export type EntityType     = 'leave_request' | 'attendance_correction' | 'attendance_regularisation' | 'overtime_request' | 'comp_off_request' | 'reimbursement_claim' | 'employee_loan' | 'advance_salary'
export type ApprovalAction = 'approved' | 'rejected' | 'escalated' | 'auto_approved'

export type WorkflowError =
  | { type: 'NOT_FOUND';    message: string }
  | { type: 'CONFLICT';     message: string }
  | { type: 'FORBIDDEN';    message: string }
  | { type: 'DB_ERROR';     message: string }

export type WorkflowResult<T> =
  | { ok: true;  value: T }
  | { ok: false; error: WorkflowError }

export interface WorkflowInstance {
  id:            string
  entity_type:   EntityType
  entity_id:     string
  total_levels:  number
  current_level: number
  final_approved: boolean | null
  created_at:    string
}

export interface ActionResult {
  instance_id:     string
  level:           number
  action:          ApprovalAction
  advanced_to:     number | null   // next level if approved and not final
  is_final:        boolean          // true when the chain is closed
  final_approved:  boolean | null
}

// ── createInstance ─────────────────────────────────────────────────────────────

/**
 * Create a new approval instance for a freshly submitted request.
 * Reads workflow config to determine total_levels; defaults to 1 if no config.
 */
export async function createWorkflowInstance(
  supabase:       SupabaseClient,
  tenantId:       string,
  workflowType:   WorkflowType,
  entityType:     EntityType,
  entityId:       string,
  submittedBy:    string,
  totalLevelsOverride?: number,
): Promise<WorkflowResult<WorkflowInstance>> {

  let totalLevels: number
  if (typeof totalLevelsOverride === 'number') {
    // Amount-aware caller (threshold routing) computed the applicable level count.
    totalLevels = Math.max(1, totalLevelsOverride)
  } else {
    // Count configured levels for this workflow type.
    const { count: levelCount } = await supabase
      .from('approval_workflow_config')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('workflow_type', workflowType)
      .eq('is_active', true)
    totalLevels = (levelCount ?? 0) > 0 ? (levelCount as number) : 1
  }

  const { data, error } = await supabase
    .from('approval_instances')
    .insert({
      tenant_id:     tenantId,
      entity_type:   entityType,
      entity_id:     entityId,
      submitted_by:  submittedBy,
      total_levels:  totalLevels,
      current_level: 1,
    })
    .select('id, entity_type, entity_id, total_levels, current_level, final_approved, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: { type: 'CONFLICT', message: 'Approval instance already exists for this request' } }
    }
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to create approval instance' } }
  }

  return { ok: true, value: data as WorkflowInstance }
}

// ── processAction ──────────────────────────────────────────────────────────────

/**
 * Process an approval action at the current level.
 *
 * Rules:
 *   • approve at non-final level → advance current_level + 1
 *   • approve at final level     → close with final_approved = true
 *   • reject at any level        → close with final_approved = false
 */
export async function processWorkflowAction(
  supabase:   SupabaseClient,
  tenantId:   string,
  instanceId: string,
  actorId:    string,
  action:     ApprovalAction,
  comments?:  string,
): Promise<WorkflowResult<ActionResult>> {

  // Fetch instance
  const { data: inst, error: fetchErr } = await supabase
    .from('approval_instances')
    .select('id, current_level, total_levels, final_approved, tenant_id, submitted_by')
    .eq('id', instanceId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !inst) {
    return { ok: false, error: { type: 'NOT_FOUND', message: 'Approval instance not found' } }
  }

  const i = inst as { id: string; current_level: number; total_levels: number; final_approved: boolean | null; tenant_id: string; submitted_by: string | null }

  if (i.final_approved !== null) {
    return { ok: false, error: { type: 'CONFLICT', message: 'Approval instance is already closed' } }
  }

  // ── Actor-authority gate (C3) ──────────────────────────────────────────────
  // Previously this function recorded ANY actor's decision with no check that
  // they were entitled to approve. Enforce two invariants that hold regardless
  // of the (un-persisted) per-level config: the actor must hold an approver role,
  // and may not approve their own submission (segregation of duties). Per-level
  // approver_type matching (direct_manager / specific_role) is a follow-up tied
  // to persisting workflow_type on the instance.
  if (i.submitted_by && i.submitted_by === actorId) {
    return { ok: false, error: { type: 'FORBIDDEN', message: 'You cannot action your own request' } }
  }
  const { data: actor } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', actorId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const actorRole = (actor as { role?: string } | null)?.role
  if (!actorRole || !['manager', 'hr_admin', 'super_admin'].includes(actorRole)) {
    return { ok: false, error: { type: 'FORBIDDEN', message: 'You are not authorised to approve this request' } }
  }

  const isFinalLevel    = i.current_level >= i.total_levels
  const isApproval      = action === 'approved' || action === 'auto_approved'
  const isRejection     = action === 'rejected'
  const shouldClose     = isRejection || (isApproval && isFinalLevel)
  const finalApproved   = shouldClose ? (isApproval) : null
  const advancedTo      = (!shouldClose && isApproval) ? i.current_level + 1 : null

  // Write the action row
  const { error: actionErr } = await supabase
    .from('approval_actions')
    .insert({
      tenant_id:   tenantId,
      instance_id: instanceId,
      level:       i.current_level,
      action,
      actor_id:    actorId,
      comments:    comments ?? null,
    })

  if (actionErr) {
    return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to record approval action' } }
  }

  // Update the instance
  const updatePayload: Record<string, unknown> = {}
  if (shouldClose) {
    updatePayload.final_approved = finalApproved
    updatePayload.closed_at      = new Date().toISOString()
  } else if (advancedTo) {
    updatePayload.current_level  = advancedTo
  }

  if (Object.keys(updatePayload).length) {
    const { error: updateErr } = await supabase
      .from('approval_instances')
      .update(updatePayload)
      .eq('id', instanceId)
      .eq('tenant_id', tenantId)

    if (updateErr) {
      return { ok: false, error: { type: 'DB_ERROR', message: 'Failed to update approval instance' } }
    }
  }

  return {
    ok: true,
    value: {
      instance_id:    instanceId,
      level:          i.current_level,
      action,
      advanced_to:    advancedTo,
      is_final:       shouldClose,
      final_approved: shouldClose ? finalApproved : null,
    },
  }
}

// ── getInstanceForEntity ───────────────────────────────────────────────────────

export async function getWorkflowInstance(
  supabase:   SupabaseClient,
  tenantId:   string,
  entityType: EntityType,
  entityId:   string,
): Promise<WorkflowInstance | null> {
  const { data } = await supabase
    .from('approval_instances')
    .select('id, entity_type, entity_id, total_levels, current_level, final_approved, created_at')
    .eq('tenant_id', tenantId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle()

  return (data as WorkflowInstance | null)
}

// ── getPendingForActor ─────────────────────────────────────────────────────────

/**
 * Returns approval instances where the actor is expected to act at the current level.
 * Simplified: returns all open instances for the tenant (RBAC filtering done in routes).
 */
export async function getPendingWorkflowInstances(
  supabase:   SupabaseClient,
  tenantId:   string,
  limit:      number = 50,
  offset:     number = 0,
): Promise<{ data: WorkflowInstance[]; total: number }> {
  const { data, count, error } = await supabase
    .from('approval_instances')
    .select('id, entity_type, entity_id, total_levels, current_level, final_approved, created_at, submitted_by', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('final_approved', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return { data: [], total: 0 }
  return { data: (data ?? []) as WorkflowInstance[], total: count ?? 0 }
}

// ── getWorkflowConfig ──────────────────────────────────────────────────────────

export async function getWorkflowConfig(
  supabase:     SupabaseClient,
  tenantId:     string,
  workflowType: WorkflowType,
) {
  const { data } = await supabase
    .from('approval_workflow_config')
    .select('id, level, approver_type, specific_role, label, auto_approve_after_hours, min_amount, is_active')
    .eq('tenant_id', tenantId)
    .eq('workflow_type', workflowType)
    .order('level', { ascending: true })

  return data ?? []
}

// ── entity_type → workflow_type (the canonical map, shared by the orchestrator) ──
export const ENTITY_WORKFLOW_MAP: Record<EntityType, WorkflowType> = {
  leave_request:             'leave',
  attendance_correction:     'correction',
  attendance_regularisation: 'regularisation',
  overtime_request:          'overtime',
  comp_off_request:          'comp_off',
  reimbursement_claim:       'reimbursement',
  employee_loan:             'loan',
  advance_salary:            'advance',
}

export interface ChainState {
  configured:     boolean
  workflow_type:  WorkflowType
  current_level:  number | null
  total_levels:   number | null
  final_approved: boolean | null
  levels:  Array<{ level: number; approver_type: string; specific_role: string | null; label: string }>
  actions: Array<{ level: number; action: string; actor_id: string; actor_name: string | null; comments: string | null; acted_at: string }>
}

/**
 * Read the full approval-chain state for one entity — for inbox/detail steppers.
 * `configured:false` means no active chain for this workflow type (the entity
 * follows the legacy single-step path); the UI should render the simple state.
 */
export async function getChainForEntity(
  supabase:   SupabaseClient,
  tenantId:   string,
  entityType: EntityType,
  entityId:   string,
): Promise<ChainState> {
  const workflowType = ENTITY_WORKFLOW_MAP[entityType]

  const cfg = (await getWorkflowConfig(supabase, tenantId, workflowType))
    .filter((c: any) => c.is_active)
  const levels = cfg.map((c: any) => ({
    level: c.level, approver_type: c.approver_type, specific_role: c.specific_role, label: c.label,
  }))

  const instance = await getWorkflowInstance(supabase, tenantId, entityType, entityId)

  let actions: ChainState['actions'] = []
  if (instance) {
    const { data } = await supabase
      .from('approval_actions')
      .select('level, action, actor_id, comments, acted_at, profiles(full_name)')
      .eq('instance_id', instance.id)
      .eq('tenant_id', tenantId)
      .order('acted_at', { ascending: true })
    actions = (data ?? []).map((a: any) => ({
      level: a.level, action: a.action, actor_id: a.actor_id,
      actor_name: a.profiles?.full_name ?? null, comments: a.comments, acted_at: a.acted_at,
    }))
  }

  return {
    configured:     levels.length > 0,
    workflow_type:  workflowType,
    current_level:  instance?.current_level  ?? (levels.length > 0 ? 1 : null),
    total_levels:   instance?.total_levels   ?? (levels.length > 0 ? levels.length : null),
    final_approved: instance?.final_approved ?? null,
    levels,
    actions,
  }
}
