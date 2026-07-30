/**
 * LeavePolicySnapshotService
 *
 * Captures and retrieves immutable point-in-time policy state.
 *
 * CONTRACT (immutability):
 *   Once a snapshot is written it must NEVER be updated or deleted.
 *   The `is_immutable = true` flag is a soft marker — enforcement is
 *   at the application layer (never call UPDATE on leave_policy_snapshots).
 *
 * HOW TO USE:
 *   1. Before executing a governance action (leave request creation, accrual,
 *      carry-forward, etc.), call captureSnapshot().
 *   2. Attach the returned snapshotId to the ledger entry / leave_request row.
 *   3. For replay: call getSnapshot(snapshotId) to retrieve the exact policy
 *      state and reconstruct what the engine would have computed.
 *
 * Snapshot payload schema (policy_snapshot JSONB):
 *   {
 *     source_type:      'policy_rule' | 'legacy_policy' | 'default_policy'
 *     policy_id:        string | null        -- leave_policy_masters.id
 *     policy_rule_id:   string | null        -- leave_policy_rules.id
 *     leave_type_id:    string | null
 *     resolution_scope: string               -- employee | department | etc.
 *     engine_version:   string               -- 'v1'
 *     captured_at:      string               -- ISO timestamp
 *     fields:           Record<string, unknown>  -- full policy row columns
 *   }
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION }     from './leave-duration-engine.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type SnapshotSourceType =
  | 'policy_rule'
  | 'legacy_policy'
  | 'default_policy'

export type SnapshotTriggerEvent =
  | 'leave_request_creation'
  | 'accrual_execution'
  | 'carry_forward_execution'
  | 'lifecycle_release'
  | 'freeze_application'
  | 'settlement_recovery'
  | 'reconciliation_adjustment'
  | 'replay_reconstruction'
  | 'manual_capture'

export type ResolutionScope =
  | 'employee'
  | 'department'
  | 'work_location'
  | 'site'
  | 'default'
  | 'legacy'
  | 'builtin'

export interface SnapshotCaptureOpts {
  tenantId:             string
  employeeId:           string
  leaveTypeId?:         string
  /** The raw DB row (leave_policy_rules OR leave_policies) that was resolved */
  policyRow:            Record<string, unknown> | null
  /** Which table the row came from */
  sourceType:           SnapshotSourceType
  /** policy_master_id (if from leave_policy_rules path) */
  policyMasterId?:      string | null
  /** policy_rule_id (if from leave_policy_rules path) */
  policyRuleId?:        string | null
  resolutionScope:      ResolutionScope
  resolvedAsOf:         string     // YYYY-MM-DD
  triggerEvent:         SnapshotTriggerEvent
  triggerEntityId?:     string     // leave_request_id, job_log_id, etc.
  triggerEntityType?:   'leave_request' | 'job_log' | 'reconciliation_run' | 'manual' | 'rebuild_queue'
}

export interface PolicySnapshotRow {
  id:                       string
  tenant_id:                string
  source_type:              SnapshotSourceType
  policy_rule_id:           string | null
  policy_master_id:         string | null
  leave_type_id:            string | null
  resolved_for_employee_id: string
  resolved_as_of:           string
  resolution_scope:         ResolutionScope
  engine_version:           string
  trigger_event:            SnapshotTriggerEvent
  trigger_entity_id:        string | null
  trigger_entity_type:      string | null
  policy_snapshot:          Record<string, unknown>
  is_immutable:             boolean
  created_at:               string
}

// ── Payload builder ────────────────────────────────────────────────────────────

/**
 * Builds the JSONB payload stored in policy_snapshot.
 * Includes the full policy row plus metadata so replays are fully self-contained.
 */
export function buildSnapshotPayload(
  sourceType:      SnapshotSourceType,
  policyRow:       Record<string, unknown> | null,
  resolutionScope: ResolutionScope,
  policyRuleId?:   string | null,
  policyMasterId?: string | null,
): Record<string, unknown> {
  return {
    source_type:      sourceType,
    policy_rule_id:   policyRuleId   ?? null,
    policy_master_id: policyMasterId ?? null,
    resolution_scope: resolutionScope,
    engine_version:   ENGINE_VERSION,
    captured_at:      new Date().toISOString(),
    // Full policy row — all columns preserved for replay
    fields:           policyRow ?? { note: 'DEFAULT_POLICY — no configuration found' },
  }
}

// ── Core service functions ─────────────────────────────────────────────────────

/**
 * Capture an immutable policy snapshot for a governance action.
 *
 * Should be called BEFORE writing the main governance record (leave_request,
 * ledger entry, etc.) so the snapshot_id can be attached to the main record.
 *
 * Returns the snapshot_id, or null if the insert failed (non-fatal — callers
 * should still proceed; governance actions must not be blocked by snapshot failures).
 */
export async function captureSnapshot(
  supabase: SupabaseClient,
  opts:     SnapshotCaptureOpts,
): Promise<string | null> {
  try {
    const payload = buildSnapshotPayload(
      opts.sourceType,
      opts.policyRow,
      opts.resolutionScope,
      opts.policyRuleId,
      opts.policyMasterId,
    )

    const { data, error } = await supabase
      .from('leave_policy_snapshots')
      .insert({
        tenant_id:                opts.tenantId,
        source_type:              opts.sourceType,
        policy_rule_id:           opts.policyRuleId      ?? null,
        policy_master_id:         opts.policyMasterId    ?? null,
        leave_type_id:            opts.leaveTypeId       ?? null,
        resolved_for_employee_id: opts.employeeId,
        resolved_as_of:           opts.resolvedAsOf,
        resolution_scope:         opts.resolutionScope,
        engine_version:           ENGINE_VERSION,
        trigger_event:            opts.triggerEvent,
        trigger_entity_id:        opts.triggerEntityId   ?? null,
        trigger_entity_type:      opts.triggerEntityType ?? null,
        policy_snapshot:          payload,
        is_immutable:             true,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.warn('[leave-policy-snapshot] capture failed:', error?.message)
      return null
    }

    return (data as { id: string }).id
  } catch (err) {
    console.warn('[leave-policy-snapshot] capture exception:', (err as Error).message)
    return null
  }
}

/**
 * Retrieve a snapshot by ID.
 */
export async function getSnapshot(
  supabase:    SupabaseClient,
  tenantId:    string,
  snapshotId:  string,
): Promise<PolicySnapshotRow | null> {
  const { data, error } = await supabase
    .from('leave_policy_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) console.warn('[leave-policy-snapshot] getSnapshot query failed:', error.message)
  if (error || !data) return null
  return data as unknown as PolicySnapshotRow
}

/**
 * Retrieve the policy snapshot attached to a leave request.
 */
export async function getSnapshotForRequest(
  supabase:       SupabaseClient,
  tenantId:       string,
  leaveRequestId: string,
): Promise<PolicySnapshotRow | null> {
  const { data: req, error } = await supabase
    .from('leave_requests')
    .select('policy_snapshot_id')
    .eq('id', leaveRequestId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) console.warn('[leave-policy-snapshot] getSnapshotForRequest lookup failed:', error.message)

  const snapshotId = (req as { policy_snapshot_id: string | null } | null)?.policy_snapshot_id
  if (!snapshotId) return null

  return getSnapshot(supabase, tenantId, snapshotId)
}

/**
 * Retrieve the most recent snapshot for an employee + leave type,
 * captured on or before `asOf`.
 *
 * Used by the replay engine to reconstruct "what policy governed this employee
 * on this date" without requiring the caller to know the snapshot_id.
 */
export async function findLatestSnapshotAsOf(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  asOf:         string,  // YYYY-MM-DD
): Promise<PolicySnapshotRow | null> {
  const { data, error } = await supabase
    .from('leave_policy_snapshots')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('resolved_for_employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .lte('resolved_as_of', asOf)
    .order('resolved_as_of', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) console.warn('[leave-policy-snapshot] findLatestSnapshotAsOf query failed:', error.message)
  if (error || !data) return null
  return data as unknown as PolicySnapshotRow
}

/**
 * List all snapshots for an employee + leave type (audit trail).
 * Returns newest first.
 */
export async function listSnapshotsForEmployee(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  limit        = 20,
): Promise<PolicySnapshotRow[]> {
  const { data, error } = await supabase
    .from('leave_policy_snapshots')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('resolved_for_employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .order('resolved_as_of', { ascending: false })
    .limit(limit)

  if (error) console.warn('[leave-policy-snapshot] listSnapshotsForEmployee query failed:', error.message)
  return (data ?? []) as unknown as PolicySnapshotRow[]
}

// ── Helpers for common capture patterns ────────────────────────────────────────

/**
 * Convenience: capture a snapshot from a resolved leave_policy_rules row.
 * The row must have been fetched with a join to leave_policy_masters.
 */
export async function captureRuleSnapshot(
  supabase:     SupabaseClient,
  tenantId:     string,
  employeeId:   string,
  leaveTypeId:  string,
  rule:         Record<string, unknown>,
  scope:        ResolutionScope,
  asOf:         string,
  trigger:      SnapshotTriggerEvent,
  triggerEntityId?:   string,
  triggerEntityType?: 'leave_request' | 'job_log' | 'reconciliation_run' | 'manual' | 'rebuild_queue',
): Promise<string | null> {
  return captureSnapshot(supabase, {
    tenantId,
    employeeId,
    leaveTypeId,
    policyRow:        rule,
    sourceType:       'policy_rule',
    policyRuleId:     rule.id        as string | undefined,
    policyMasterId:   (rule.leave_policy_masters as { id?: string } | null)?.id ?? rule.policy_id as string | undefined,
    resolutionScope:  scope,
    resolvedAsOf:     asOf,
    triggerEvent:     trigger,
    triggerEntityId,
    triggerEntityType,
  })
}

/**
 * Convenience: capture a snapshot from a resolved leave_policies (legacy) row.
 */
export async function captureLegacySnapshot(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  legacyRow:   Record<string, unknown>,
  asOf:        string,
  trigger:     SnapshotTriggerEvent,
  triggerEntityId?:   string,
  triggerEntityType?: 'leave_request' | 'job_log' | 'reconciliation_run' | 'manual' | 'rebuild_queue',
): Promise<string | null> {
  return captureSnapshot(supabase, {
    tenantId,
    employeeId,
    leaveTypeId,
    policyRow:       legacyRow,
    sourceType:      'legacy_policy',
    resolutionScope: 'legacy',
    resolvedAsOf:    asOf,
    triggerEvent:    trigger,
    triggerEntityId,
    triggerEntityType,
  })
}

/**
 * Convenience: capture a snapshot for the built-in DEFAULT_POLICY
 * (no configuration found for this employee + leave type).
 */
export async function captureDefaultSnapshot(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  asOf:        string,
  trigger:     SnapshotTriggerEvent,
  triggerEntityId?:   string,
  triggerEntityType?: 'leave_request' | 'job_log' | 'reconciliation_run' | 'manual' | 'rebuild_queue',
): Promise<string | null> {
  return captureSnapshot(supabase, {
    tenantId,
    employeeId,
    leaveTypeId,
    policyRow:       null,    // signals DEFAULT_POLICY — buildSnapshotPayload handles this
    sourceType:      'default_policy',
    resolutionScope: 'builtin',
    resolvedAsOf:    asOf,
    triggerEvent:    trigger,
    triggerEntityId,
    triggerEntityType,
  })
}
