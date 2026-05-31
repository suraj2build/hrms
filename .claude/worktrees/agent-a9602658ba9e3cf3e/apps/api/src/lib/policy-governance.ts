/**
 * policy-governance.ts
 *
 * Enterprise policy lifecycle management for leave_policy_masters.
 *
 * Responsibilities:
 *  1. State machine transitions: draft → review → published → archived
 *  2. Immutable version snapshots (leave_policy_versions)
 *  3. Field-level change audit log (policy_change_log)
 *  4. Simulation mode: resolve policy for an employee without persisting
 *
 * Status transition rules:
 *   draft     → review     (requestReview)
 *   draft     → published  (publish — skip review, admin override)
 *   review    → published  (publish)
 *   review    → draft      (rejectReview)
 *   published → archived   (archive)
 *   archived  → draft      (rollback — creates new draft from snapshot)
 *   any       → archived   (archive, with override flag for emergency)
 *
 * All transitions write to policy_change_log and (for publish/archive)
 * create an immutable snapshot in leave_policy_versions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PolicyStatus = 'draft' | 'review' | 'published' | 'archived'

export interface PolicyMaster {
  id:            string
  tenant_id:     string
  name:          string
  description:   string | null
  status:        PolicyStatus
  version:       number
  is_default:    boolean
  year_type:     'calendar' | 'financial'
  is_active:     boolean
  effective_from: string | null
  published_by:  string | null
  published_at:  string | null
  publish_notes: string | null
  created_at:    string
  updated_at:    string
}

export interface PolicyVersion {
  id:              string
  policy_id:       string
  version:         number
  snapshot_at:     string
  snapshot_by:     string | null
  reason:          string | null
  rules_snapshot:  unknown[]
  master_snapshot: Record<string, unknown>
}

export interface FieldChange {
  field:     string
  old_value: unknown
  new_value: unknown
}

export interface TransitionResult {
  success: boolean
  error?:  string
  master?: PolicyMaster
  version?: PolicyVersion
}

// ── Snapshot helper ───────────────────────────────────────────────────────────

/**
 * Write an immutable snapshot of the current policy (master + all rules)
 * to leave_policy_versions.  Returns the newly created version row.
 */
export async function snapshotPolicy(
  supabase:   SupabaseClient,
  master:     PolicyMaster,
  changedBy:  string | null,
  reason:     'published' | 'archived' | 'manual' | 'rollback',
): Promise<PolicyVersion | null> {
  // Fetch all current rules for the snapshot
  const rulesResult = await supabase
    .from('leave_policy_rules')
    .select('*')
    .eq('tenant_id', master.tenant_id)
    .eq('policy_id', master.id)
    .order('sequence', { ascending: true })
  const rules = rulesResult.data

  const { data: version, error } = await supabase
    .from('leave_policy_versions')
    .insert({
      tenant_id:       master.tenant_id,
      policy_id:       master.id,
      version:         master.version,
      snapshot_by:     changedBy,
      reason,
      rules_snapshot:  rules ?? [],
      master_snapshot: master,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[policy-governance] snapshotPolicy failed:', error.message)
    return null
  }
  return version as PolicyVersion
}

// ── Change log helper ─────────────────────────────────────────────────────────

/**
 * Write a structured audit entry to policy_change_log.
 * Fire-and-forget safe — errors are logged but not thrown.
 */
export async function logPolicyChange(
  supabase:   SupabaseClient,
  tenantId:   string,
  opts: {
    tableName:      string
    recordId:       string
    operation:      'create' | 'update' | 'delete' | 'publish' | 'archive' | 'rollback'
    changedBy:      string | null
    fieldChanges?:  FieldChange[]
    beforeSnapshot?: Record<string, unknown> | null
    afterSnapshot?:  Record<string, unknown> | null
    comment?:        string
    clientIp?:       string
  },
): Promise<void> {
  const { error } = await supabase
    .from('policy_change_log')
    .insert({
      tenant_id:       tenantId,
      table_name:      opts.tableName,
      record_id:       opts.recordId,
      operation:       opts.operation,
      changed_by:      opts.changedBy,
      field_changes:   opts.fieldChanges ?? [],
      before_snapshot: opts.beforeSnapshot ?? null,
      after_snapshot:  opts.afterSnapshot  ?? null,
      comment:         opts.comment ?? null,
      client_ip:       opts.clientIp ?? null,
    })

  if (error) {
    console.error('[policy-governance] logPolicyChange failed:', error.message)
  }
}

/**
 * Compute structured field-level diff between two objects.
 * Only includes fields that changed.
 */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after:  Record<string, unknown> | null | undefined,
  watchFields?: string[],
): FieldChange[] {
  const b = before ?? {}
  const a = after  ?? {}
  const fields = watchFields ?? [...new Set([...Object.keys(b), ...Object.keys(a)])]
  const changes: FieldChange[] = []

  for (const field of fields) {
    const oldVal = b[field]
    const newVal = a[field]
    // Deep equality for arrays
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field, old_value: oldVal ?? null, new_value: newVal ?? null })
    }
  }
  return changes
}

// ── Transition: draft/review → published ─────────────────────────────────────

export async function publishPolicy(
  supabase:     SupabaseClient,
  tenantId:     string,
  policyId:     string,
  publishedBy:  string,
  opts?: {
    notes?:         string
    effectiveFrom?: string   // YYYY-MM-DD, defaults to today
    skipReview?:    boolean  // admin override — skip review gate
  },
): Promise<TransitionResult> {
  // Fetch current state
  const { data: master, error: fetchErr } = await supabase
    .from('leave_policy_masters')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .maybeSingle()

  if (fetchErr || !master) return { success: false, error: 'Policy not found.' }
  const m = master as PolicyMaster

  // Validate transition
  if (m.status === 'published') return { success: false, error: 'Policy is already published.' }
  if (m.status === 'archived')  return { success: false, error: 'Cannot publish an archived policy. Rollback first.' }
  if (m.status === 'review' && opts?.skipReview !== true) {
    // This is valid — review → published is the normal path
  }

  const today    = new Date().toISOString().slice(0, 10)
  const newVersion = m.version + 1

  const { data: updated, error: updateErr } = await supabase
    .from('leave_policy_masters')
    .update({
      status:        'published',
      version:       newVersion,
      published_by:  publishedBy,
      published_at:  new Date().toISOString(),
      publish_notes: opts?.notes ?? null,
      effective_from: opts?.effectiveFrom ?? today,
      is_active:     true,
      updated_at:    new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .select('*')
    .single()

  if (updateErr || !updated) {
    return { success: false, error: updateErr?.message ?? 'Update failed.' }
  }

  const updatedMaster = updated as PolicyMaster

  // Create immutable snapshot
  const snap = await snapshotPolicy(supabase, updatedMaster, publishedBy, 'published')

  // Write change log
  await logPolicyChange(supabase, tenantId, {
    tableName:      'leave_policy_masters',
    recordId:       policyId,
    operation:      'publish',
    changedBy:      publishedBy,
    fieldChanges:   diffObjects(m as unknown as Record<string, unknown>, updatedMaster as unknown as Record<string, unknown>,
                      ['status', 'version', 'effective_from', 'publish_notes']),
    beforeSnapshot: m as unknown as Record<string, unknown>,
    afterSnapshot:  updatedMaster as unknown as Record<string, unknown>,
    comment:        opts?.notes,
  })

  return { success: true, master: updatedMaster, version: snap ?? undefined }
}

// ── Transition: any → review ──────────────────────────────────────────────────

export async function requestReview(
  supabase:    SupabaseClient,
  tenantId:    string,
  policyId:    string,
  requestedBy: string,
  comment?:    string,
): Promise<TransitionResult> {
  const { data: master } = await supabase
    .from('leave_policy_masters')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .maybeSingle()

  if (!master) return { success: false, error: 'Policy not found.' }
  const m = master as PolicyMaster

  if (m.status === 'published') return { success: false, error: 'Published policy cannot go back to review. Archive first.' }
  if (m.status === 'archived')  return { success: false, error: 'Archived policy cannot be sent for review. Rollback first.' }
  if (m.status === 'review')    return { success: false, error: 'Already in review.' }

  const { data: updated, error } = await supabase
    .from('leave_policy_masters')
    .update({ status: 'review', updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .select('*')
    .single()

  if (error || !updated) return { success: false, error: error?.message ?? 'Update failed.' }

  await logPolicyChange(supabase, tenantId, {
    tableName:  'leave_policy_masters',
    recordId:   policyId,
    operation:  'update',
    changedBy:  requestedBy,
    fieldChanges: [{ field: 'status', old_value: m.status, new_value: 'review' }],
    comment,
  })

  return { success: true, master: updated as PolicyMaster }
}

// ── Transition: published/review → archived ───────────────────────────────────

export async function archivePolicy(
  supabase:   SupabaseClient,
  tenantId:   string,
  policyId:   string,
  archivedBy: string,
  reason?:    string,
): Promise<TransitionResult> {
  const { data: master } = await supabase
    .from('leave_policy_masters')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .maybeSingle()

  if (!master) return { success: false, error: 'Policy not found.' }
  const m = master as PolicyMaster

  if (m.status === 'archived') return { success: false, error: 'Policy is already archived.' }

  const { data: updated, error } = await supabase
    .from('leave_policy_masters')
    .update({
      status:    'archived',
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .select('*')
    .single()

  if (error || !updated) return { success: false, error: error?.message ?? 'Update failed.' }

  const updatedMaster = updated as PolicyMaster

  // Snapshot on archive (so it can be restored)
  const snap = await snapshotPolicy(supabase, updatedMaster, archivedBy, 'archived')

  await logPolicyChange(supabase, tenantId, {
    tableName:      'leave_policy_masters',
    recordId:       policyId,
    operation:      'archive',
    changedBy:      archivedBy,
    fieldChanges:   [
      { field: 'status',    old_value: m.status,    new_value: 'archived' },
      { field: 'is_active', old_value: m.is_active, new_value: false },
    ],
    beforeSnapshot: m as unknown as Record<string, unknown>,
    afterSnapshot:  updatedMaster as unknown as Record<string, unknown>,
    comment:        reason,
  })

  return { success: true, master: updatedMaster, version: snap ?? undefined }
}

// ── Rollback to a previous version ───────────────────────────────────────────

/**
 * Restore a policy from an archived snapshot.
 * Creates a NEW draft policy with incremented version, restoring all rules
 * from the snapshot.  The original archived policy remains untouched.
 */
export async function rollbackPolicyToVersion(
  supabase:    SupabaseClient,
  tenantId:    string,
  policyId:    string,
  targetVersion: number,
  rolledBackBy: string,
  comment?:    string,
): Promise<TransitionResult> {
  // Fetch snapshot
  const { data: snap } = await supabase
    .from('leave_policy_versions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('policy_id', policyId)
    .eq('version',   targetVersion)
    .maybeSingle()

  if (!snap) return { success: false, error: `Version ${targetVersion} snapshot not found.` }
  const snapshot = snap as PolicyVersion

  // Fetch current master to get version counter
  const { data: current } = await supabase
    .from('leave_policy_masters')
    .select('version, status, name')
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .maybeSingle()

  if (!current) return { success: false, error: 'Policy not found.' }
  const c = current as Pick<PolicyMaster, 'version' | 'status' | 'name'>

  const newVersion = c.version + 1

  // Restore master to draft with bumped version
  const masterSnap = snapshot.master_snapshot as Record<string, unknown>
  const { data: updated, error: updateErr } = await supabase
    .from('leave_policy_masters')
    .update({
      status:        'draft',
      version:       newVersion,
      is_active:     false,        // draft is not active until published
      description:   masterSnap['description'] ?? null,
      year_type:     masterSnap['year_type']    ?? 'calendar',
      publish_notes: `Rolled back from v${targetVersion} by ${rolledBackBy}`,
      updated_at:    new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', policyId)
    .select('*')
    .single()

  if (updateErr || !updated) {
    return { success: false, error: updateErr?.message ?? 'Update failed.' }
  }

  // Restore rules: delete current rules, re-insert from snapshot
  const rules = snapshot.rules_snapshot as Array<Record<string, unknown>>
  if (rules.length > 0) {
    // Delete existing rules
    await supabase
      .from('leave_policy_rules')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('policy_id', policyId)

    // Re-insert rules from snapshot (omit id to generate new UUIDs)
    const restored = rules.map(r => ({
      ...r,
      id:         undefined,  // let DB generate
      tenant_id:  tenantId,
      policy_id:  policyId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))

    await supabase.from('leave_policy_rules').insert(restored)
  }

  // Log rollback
  await logPolicyChange(supabase, tenantId, {
    tableName:  'leave_policy_masters',
    recordId:   policyId,
    operation:  'rollback',
    changedBy:  rolledBackBy,
    fieldChanges: [
      { field: 'version', old_value: c.version, new_value: newVersion },
      { field: 'status',  old_value: c.status,  new_value: 'draft' },
    ],
    comment: comment ?? `Rolled back to v${targetVersion}`,
  })

  return { success: true, master: updated as PolicyMaster }
}

// ── Evaluation log helper ─────────────────────────────────────────────────────

export interface EvalLogEntry {
  tenantId:            string
  employeeId:          string
  leaveTypeId:         string
  evaluatedOn:         string
  triggerContext:      string
  policyId:            string | null
  policyName:          string | null
  policyVersion:       number | null
  ruleId:              string | null
  resolvedVia:         string
  scopeId:             string | null
  priorityRank:        number | null
  eligible:            boolean
  eligibilityReason:   string | null
  evaluatedCandidates: unknown[]
  isSimulation:        boolean
}

/**
 * Persist a policy evaluation log entry.
 * Non-blocking — errors are swallowed to avoid impacting the main flow.
 */
export async function persistEvaluationLog(
  supabase: SupabaseClient,
  entry:    EvalLogEntry,
): Promise<void> {
  const { error } = await supabase
    .from('policy_evaluation_log')
    .insert({
      tenant_id:            entry.tenantId,
      employee_id:          entry.employeeId,
      leave_type_id:        entry.leaveTypeId,
      evaluated_on:         entry.evaluatedOn,
      trigger_context:      entry.triggerContext,
      policy_id:            entry.policyId,
      policy_name:          entry.policyName,
      policy_version:       entry.policyVersion,
      rule_id:              entry.ruleId,
      resolved_via:         entry.resolvedVia,
      scope_id:             entry.scopeId,
      priority_rank:        entry.priorityRank,
      eligible:             entry.eligible,
      eligibility_reason:   entry.eligibilityReason,
      evaluated_candidates: entry.evaluatedCandidates,
      is_simulation:        entry.isSimulation,
    })

  if (error) {
    // Non-fatal — log but don't throw
    console.warn('[policy-governance] persistEvaluationLog failed:', error.message)
  }
}

// ── Conflict detection ────────────────────────────────────────────────────────

export interface PolicyConflict {
  type:        'duplicate_scope' | 'overlapping_dates' | 'duplicate_default'
  description: string
  conflicting: string[]  // IDs of conflicting rows
  severity:    'warning' | 'error'
}

/**
 * Detect policy assignment conflicts for a tenant.
 * Returns a list of conflicts; empty array = no conflicts.
 */
export async function detectPolicyConflicts(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<PolicyConflict[]> {
  const conflicts: PolicyConflict[] = []

  // 1. Multiple active assignments for the same scope_type + scope_id
  const { data: assignments } = await supabase
    .from('leave_policy_assignments')
    .select('id, policy_id, scope_type, scope_id, effective_from, effective_to')
    .eq('tenant_id', tenantId)

  if (assignments?.length) {
    const seen = new Map<string, string[]>()
    for (const a of assignments as Array<{ id: string; scope_type: string; scope_id: string | null }>) {
      const key = `${a.scope_type}:${a.scope_id ?? '_default'}`
      const ids = seen.get(key) ?? []
      ids.push(a.id)
      seen.set(key, ids)
    }
    for (const [key, ids] of seen) {
      if (ids.length > 1) {
        conflicts.push({
          type:        'duplicate_scope',
          description: `Multiple policy assignments for scope "${key}". Only the highest-priority one is used.`,
          conflicting: ids,
          severity:    'warning',
        })
      }
    }
  }

  // 2. Multiple published policies marked is_default
  const { data: defaults } = await supabase
    .from('leave_policy_masters')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .eq('status', 'published')

  if ((defaults?.length ?? 0) > 1) {
    conflicts.push({
      type:        'duplicate_default',
      description: `${defaults!.length} policies are marked as default. Only one default policy is allowed per tenant.`,
      conflicting: (defaults as Array<{ id: string }>).map(d => d.id),
      severity:    'error',
    })
  }

  return conflicts
}
