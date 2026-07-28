/**
 * WorkforceOrchestrator
 *
 * The authoritative cross-system orchestration coordinator.
 *
 * WHAT IT DOES:
 *   Receives workforce governance events and coordinates the deterministic
 *   downstream rebuild sequence. It is the SINGLE entry-point for any action
 *   that must trigger cascading changes across modules.
 *
 *   For each event it:
 *   1. Checks payroll freeze constraints — defers or blocks if periods are locked.
 *   2. Generates a shared orchestrator_lineage_id for the entire rebuild chain.
 *   3. Creates a workforce_rebuild_events row (the chain's root record).
 *   4. Enqueues ordered retroactive_rebuild_queue entries with dependency_order
 *      and blocked_by_rebuild_id to enforce strict sequential execution.
 *   5. Optionally marks affected attendance dates as replay_pending.
 *   6. Records a workforce_event_timeline entry for audit trail.
 *   7. Returns the orchestration result with all IDs for the caller.
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT execute attendance recalculation.
 *   - Does NOT execute payroll recalculation.
 *   - Does NOT modify leave/attendance/payroll data directly.
 *   - Does NOT change any business logic in the existing engines.
 *   Existing engines remain authoritative for calculations.
 *   This orchestrator coordinates EXECUTION SEQUENCING only.
 *
 * REBUILD DEPENDENCY ORDER (always respected):
 *   1 — attendance       (prerequisite: corrected punch data)
 *   2 — leave_balance    (depends on attendance for LOP)
 *   3 — payroll          (depends on leave_balance for paid/unpaid days)
 *   4 — entitlement      (depends on payroll for statutory calcs)
 *   5 — reconciliation   (validates the full chain end-to-end)
 *
 * EVENT → MODULE MAPPING:
 *   leave_approved      → leave_balance(2) → payroll(3)
 *   leave_cancelled     → attendance(1) → leave_balance(2) → payroll(3)
 *   retro_leave_approved→ attendance(1) → leave_balance(2) → payroll(3) → reconciliation(5)
 *   attendance_corrected→ attendance(1) → leave_balance(2) → payroll(3)
 *   attendance_finalized→ [records event only; no rebuild queue needed]
 *   payroll_locked      → [records event + freeze; no rebuild queue]
 *   policy_changed      → leave_balance(2) → payroll(3) → reconciliation(5)
 */

import type { SupabaseClient }   from '@supabase/supabase-js'
import {
  enqueueRebuild,
  classifyRebuildScope,
  type RebuildQueueRow,
  type RebuildSourceEventType,
}                                from './retroactive-rebuild-orchestrator.js'
import {
  checkFreezeConstraint,
  transitionPayrollPeriod,
  type FreezeConstraintResult,
}                                from './payroll-freeze-service.js'
import {
  recordWorkforceEvent,
  type WorkforceEventType,
}                                from './workforce-event-timeline-service.js'
import {
  markDateRangeAsReplayPending,
}                                from './attendance-state-service.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type OrchestratorEventType =
  | 'leave_approved'
  | 'leave_cancelled'
  | 'retro_leave_approved'
  | 'attendance_corrected'
  | 'attendance_finalized'
  | 'payroll_locked'
  | 'policy_changed'

/** All fields needed to describe a workforce governance event to the orchestrator. */
export interface WorkforceEvent {
  tenantId:          string
  eventType:         OrchestratorEventType
  /** The source record that triggered this (leave_request.id, payroll_run.id, etc.) */
  sourceEventId:     string
  employeeId?:       string
  leaveTypeId?:      string
  /** Earliest date affected — used as rebuild_from_date and for freeze check */
  affectedFromDate:  string   // YYYY-MM-DD
  /** Latest date affected (null = open-ended) */
  affectedToDate?:   string   // YYYY-MM-DD
  triggeredBy?:      string   // profile/user ID
  /** Extra context stored in the timeline event payload */
  metadata?:         Record<string, unknown>
}

export interface OrchestrationResult {
  orchestratorLineageId:  string
  rebuildEventId:         string
  enqueuedRebuildIds:     string[]
  freezeConstraint:       FreezeConstraintResult
  timelineEventId:        string | null
  /** Outcome summary */
  status:
    | 'orchestrated'           // rebuild chain enqueued successfully
    | 'deferred_processing'    // queued but execution deferred (period in processing)
    | 'blocked_locked'         // payroll locked — adjustment workflow required
    | 'blocked_archived'       // payroll archived — audit only
    | 'no_rebuild_needed'      // event type doesn't require downstream rebuilds
}

// ── Module → rebuild metadata mapping ─────────────────────────────────────────

/**
 * For each event type, return the ordered list of:
 *   { module, dependencyOrder, sourceEventType, rebuildStage }
 *
 * The list is already in execution order. The orchestrator creates one
 * retroactive_rebuild_queue entry per step, chained via blocked_by_rebuild_id.
 */
interface RebuildStep {
  sourceEventType: RebuildSourceEventType
  rebuildStage:    'attendance' | 'leave_balance' | 'payroll' | 'entitlement' | 'reconciliation'
  dependencyOrder: number
  /** Which RebuildModules this step covers (passed to enqueueRebuild) */
  modules:         ('attendance' | 'leave_balance' | 'payroll')[]
}

function getRebuildStepsForEvent(eventType: OrchestratorEventType): RebuildStep[] {
  switch (eventType) {
    case 'leave_approved':
      return [
        { sourceEventType: 'leave_approved',  rebuildStage: 'leave_balance', dependencyOrder: 2, modules: ['leave_balance'] },
        { sourceEventType: 'leave_approved',  rebuildStage: 'payroll',       dependencyOrder: 3, modules: ['payroll'] },
      ]

    case 'leave_cancelled':
      return [
        { sourceEventType: 'leave_cancelled', rebuildStage: 'attendance',    dependencyOrder: 1, modules: ['attendance'] },
        { sourceEventType: 'leave_cancelled', rebuildStage: 'leave_balance', dependencyOrder: 2, modules: ['leave_balance'] },
        { sourceEventType: 'leave_cancelled', rebuildStage: 'payroll',       dependencyOrder: 3, modules: ['payroll'] },
      ]

    case 'retro_leave_approved':
      return [
        { sourceEventType: 'leave_approved',  rebuildStage: 'attendance',    dependencyOrder: 1, modules: ['attendance'] },
        { sourceEventType: 'leave_approved',  rebuildStage: 'leave_balance', dependencyOrder: 2, modules: ['leave_balance'] },
        { sourceEventType: 'leave_approved',  rebuildStage: 'payroll',       dependencyOrder: 3, modules: ['payroll'] },
        // reconciliation runs last as a validation step — uses policy_change as trigger type
        { sourceEventType: 'replay_requested', rebuildStage: 'reconciliation', dependencyOrder: 5, modules: ['leave_balance', 'payroll'] },
      ]

    case 'attendance_corrected':
      return [
        { sourceEventType: 'attendance_correction', rebuildStage: 'attendance',    dependencyOrder: 1, modules: ['attendance'] },
        { sourceEventType: 'attendance_correction', rebuildStage: 'leave_balance', dependencyOrder: 2, modules: ['leave_balance'] },
        { sourceEventType: 'attendance_correction', rebuildStage: 'payroll',       dependencyOrder: 3, modules: ['payroll'] },
      ]

    case 'policy_changed':
      return [
        { sourceEventType: 'policy_change', rebuildStage: 'leave_balance', dependencyOrder: 2, modules: ['leave_balance'] },
        { sourceEventType: 'policy_change', rebuildStage: 'payroll',       dependencyOrder: 3, modules: ['payroll'] },
        { sourceEventType: 'policy_change', rebuildStage: 'reconciliation', dependencyOrder: 5, modules: ['leave_balance', 'payroll'] },
      ]

    case 'attendance_finalized':
    case 'payroll_locked':
      // These events are recorded in the timeline but do not generate rebuild entries
      return []
  }
}

// ── Workforce rebuild event management ────────────────────────────────────────

async function createWorkforceRebuildEvent(
  supabase:               SupabaseClient,
  tenantId:               string,
  orchestratorLineageId:  string,
  event:                  WorkforceEvent,
  steps:                  RebuildStep[],
): Promise<string> {
  const downstreamModules = [...new Set(steps.flatMap(s => s.modules))]
  const scope = classifyRebuildScope(event.affectedFromDate, event.affectedToDate)

  const { data, error } = await supabase
    .from('workforce_rebuild_events')
    .insert({
      tenant_id:                tenantId,
      orchestrator_lineage_id:  orchestratorLineageId,
      source_event_id:          event.sourceEventId,
      source_event_type:        event.eventType,
      employee_id:              event.employeeId      ?? null,
      rebuild_from_date:        event.affectedFromDate,
      rebuild_to_date:          event.affectedToDate  ?? null,
      downstream_modules:       downstreamModules,
      rebuild_scope:            scope,
      orchestration_status:     'sequencing',
      created_by:               event.triggeredBy     ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create workforce rebuild event: ${error?.message}`)
  }

  return (data as { id: string }).id
}

async function updateRebuildEventStatus(
  supabase:        SupabaseClient,
  tenantId:        string,
  rebuildEventId:  string,
  status:          'initiated' | 'sequencing' | 'in_progress' | 'completed' | 'failed' | 'cancelled',
  safetyMarkers?:  Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('workforce_rebuild_events')
    .update({
      orchestration_status:   status,
      replay_safety_markers:  safetyMarkers ?? {},
      updated_at:             new Date().toISOString(),
    })
    .eq('id',        rebuildEventId)
    .eq('tenant_id', tenantId)
}

// ── Main orchestration function ────────────────────────────────────────────────

/**
 * Orchestrate a workforce governance event.
 *
 * This is the single authoritative entry-point for cross-module rebuild
 * coordination. Every governance action that triggers downstream cascades
 * should pass through here.
 *
 * The function is safe to call multiple times for the same event — the
 * underlying `enqueueRebuild()` calls are idempotent via their
 * idempotency_key mechanism.
 */
export async function orchestrateWorkforceEvent(
  supabase:  SupabaseClient,
  event:     WorkforceEvent,
): Promise<OrchestrationResult> {
  const tenantId              = event.tenantId
  const orchestratorLineageId = crypto.randomUUID()
  const steps                 = getRebuildStepsForEvent(event.eventType)

  // ── 1. Check payroll freeze constraint ────────────────────────────────────
  const freezeConstraint = await checkFreezeConstraint(
    supabase, tenantId, event.affectedFromDate, event.affectedToDate,
  )

  // ── 2. Handle payroll_locked event — record + freeze only ─────────────────
  if (event.eventType === 'payroll_locked') {
    const periodMonth = event.affectedFromDate.slice(0, 7)
    await transitionPayrollPeriod(
      supabase, tenantId, periodMonth, 'payroll_locked',
      event.triggeredBy, event.metadata?.notes as string | undefined,
    )

    const timelineEventId = await recordWorkforceEvent(supabase, {
      tenantId,
      employeeId:               event.employeeId,
      eventType:                'payroll_lock',
      eventDate:                event.affectedFromDate,
      sourceModule:             'payroll',
      sourceEntityId:           event.sourceEventId,
      orchestratorLineageId,
      payload:                  { period_month: periodMonth, ...event.metadata },
      createdBy:                event.triggeredBy,
    })

    // Create a minimal workforce_rebuild_events entry for the record
    const rebuildEventId = await createWorkforceRebuildEvent(
      supabase, tenantId, orchestratorLineageId, event, [],
    )
    await updateRebuildEventStatus(supabase, tenantId, rebuildEventId, 'completed')

    return {
      orchestratorLineageId,
      rebuildEventId,
      enqueuedRebuildIds: [],
      freezeConstraint,
      timelineEventId,
      status: 'no_rebuild_needed',
    }
  }

  // ── 3. Handle attendance_finalized — record only ──────────────────────────
  if (event.eventType === 'attendance_finalized') {
    const rebuildEventId = await createWorkforceRebuildEvent(
      supabase, tenantId, orchestratorLineageId, event, [],
    )
    await updateRebuildEventStatus(supabase, tenantId, rebuildEventId, 'completed')

    const timelineEventId = await recordWorkforceEvent(supabase, {
      tenantId,
      employeeId:               event.employeeId,
      eventType:                'attendance_finalized',
      eventDate:                event.affectedFromDate,
      sourceModule:             'attendance',
      sourceEntityId:           event.sourceEventId,
      orchestratorLineageId,
      payload:                  event.metadata ?? {},
      createdBy:                event.triggeredBy,
    })

    return {
      orchestratorLineageId,
      rebuildEventId,
      enqueuedRebuildIds: [],
      freezeConstraint,
      timelineEventId,
      status: 'no_rebuild_needed',
    }
  }

  // ── 4. Check freeze — block if locked/archived ────────────────────────────
  if (freezeConstraint.auditOnly) {
    // Create a record for traceability even though we're blocking
    const rebuildEventId = await createWorkforceRebuildEvent(
      supabase, tenantId, orchestratorLineageId, event, steps,
    )
    await updateRebuildEventStatus(supabase, tenantId, rebuildEventId, 'cancelled')

    const timelineEventId = await recordWorkforceEvent(supabase, {
      tenantId,
      employeeId:               event.employeeId,
      eventType:                'freeze_application',
      eventDate:                event.affectedFromDate,
      sourceModule:             'orchestrator',
      sourceEntityId:           event.sourceEventId,
      orchestratorLineageId,
      payload:                  { blocked_reason: 'payroll_archived', freeze_constraint: freezeConstraint, ...event.metadata },
      createdBy:                event.triggeredBy,
    })

    return {
      orchestratorLineageId,
      rebuildEventId,
      enqueuedRebuildIds: [],
      freezeConstraint,
      timelineEventId,
      status: 'blocked_archived',
    }
  }

  if (freezeConstraint.requiresAdjustmentWorkflow) {
    const rebuildEventId = await createWorkforceRebuildEvent(
      supabase, tenantId, orchestratorLineageId, event, steps,
    )
    await updateRebuildEventStatus(supabase, tenantId, rebuildEventId, 'cancelled')

    const timelineEventId = await recordWorkforceEvent(supabase, {
      tenantId,
      employeeId:               event.employeeId,
      eventType:                'freeze_application',
      eventDate:                event.affectedFromDate,
      sourceModule:             'orchestrator',
      sourceEntityId:           event.sourceEventId,
      orchestratorLineageId,
      payload:                  { blocked_reason: 'payroll_locked', freeze_constraint: freezeConstraint, ...event.metadata },
      createdBy:                event.triggeredBy,
    })

    return {
      orchestratorLineageId,
      rebuildEventId,
      enqueuedRebuildIds: [],
      freezeConstraint,
      timelineEventId,
      status: 'blocked_locked',
    }
  }

  // ── 5. Create workforce_rebuild_events root record ────────────────────────
  const rebuildEventId = await createWorkforceRebuildEvent(
    supabase, tenantId, orchestratorLineageId, event, steps,
  )

  // ── 6. Mark attendance dates as replay_pending (before enqueuing) ─────────
  if (event.employeeId && steps.some(s => s.rebuildStage === 'attendance')) {
    await markDateRangeAsReplayPending(
      supabase, tenantId, event.employeeId,
      event.affectedFromDate,
      event.affectedToDate ?? new Date().toISOString().slice(0, 10),
      orchestratorLineageId,
    )
  }

  // ── 7. Enqueue rebuild steps in dependency order ──────────────────────────
  const enqueuedRebuildIds: string[] = []
  const safetyMarkers: Record<string, unknown> = {}
  let previousRebuildId: string | undefined

  const scope = classifyRebuildScope(event.affectedFromDate, event.affectedToDate)

  for (const step of steps) {
    const idempotencyKey = `${orchestratorLineageId}|${step.rebuildStage}|${event.sourceEventId}`

    const { queued, row } = await enqueueRebuild(supabase, {
      tenantId,
      sourceEventType:          step.sourceEventType,
      sourceEventId:            event.sourceEventId,
      employeeId:               event.employeeId,
      leaveTypeId:              event.leaveTypeId,
      rebuildFromDate:          event.affectedFromDate,
      rebuildToDate:            event.affectedToDate,
      affectedModules:          step.modules,
      priority:                 freezeConstraint.queuedOnly ? 8 : 5,
      idempotencyKey,
      createdBy:                event.triggeredBy,
      // Phase 3 orchestration fields
      dependencyOrder:          step.dependencyOrder,
      orchestratorLineageId,
      blockedByRebuildId:       previousRebuildId,
      rebuildStage:             step.rebuildStage,
      rebuildScope:             scope,
    })

    enqueuedRebuildIds.push(row.id)
    safetyMarkers[step.rebuildStage] = {
      rebuild_id:     row.id,
      idempotency_key: idempotencyKey,
      queued_new:      queued,
    }

    // Chain: next step is blocked by this one
    previousRebuildId = row.id
  }

  // Update workforce_rebuild_events with queued status + safety markers
  await updateRebuildEventStatus(
    supabase, tenantId, rebuildEventId,
    freezeConstraint.queuedOnly ? 'initiated' : 'in_progress',
    safetyMarkers,
  )

  // ── 8. Record to workforce_event_timeline ────────────────────────────────
  const timelineEventType: WorkforceEventType =
    event.eventType === 'retro_leave_approved'   ? 'retro_leave_approved'          :
    event.eventType === 'leave_approved'         ? 'leave_approved'                :
    event.eventType === 'leave_cancelled'        ? 'leave_cancelled'               :
    event.eventType === 'attendance_corrected'   ? 'attendance_correction'         :
    event.eventType === 'policy_changed'         ? 'policy_change'                 :
    'retroactive_rebuild_queued'

  const timelineEventId = await recordWorkforceEvent(supabase, {
    tenantId,
    employeeId:               event.employeeId,
    eventType:                timelineEventType,
    eventDate:                event.affectedFromDate,
    sourceModule:             'orchestrator',
    sourceEntityId:           event.sourceEventId,
    orchestratorLineageId,
    rebuildEventId,
    payload: {
      steps_enqueued:     steps.length,
      enqueued_ids:       enqueuedRebuildIds,
      freeze_constraint:  freezeConstraint,
      queued_only:        freezeConstraint.queuedOnly,
      ...event.metadata,
    },
    createdBy: event.triggeredBy,
  })

  return {
    orchestratorLineageId,
    rebuildEventId,
    enqueuedRebuildIds,
    freezeConstraint,
    timelineEventId,
    status: freezeConstraint.queuedOnly ? 'deferred_processing' : 'orchestrated',
  }
}

// ── Rebuild chain progress management ─────────────────────────────────────────

/**
 * Mark a specific module step as completed within a rebuild chain.
 * Called by each module's processor after completing its rebuild.
 *
 * Advances the chain: checks if all downstream modules have completed,
 * and marks the workforce_rebuild_events row as completed if so.
 */
const REBUILD_STEP_UPDATE_ATTEMPTS = 5

export async function markRebuildStepCompleted(
  supabase:               SupabaseClient,
  tenantId:               string,
  orchestratorLineageId:  string,
  completedModule:        string,
): Promise<void> {
  // Read-modify-write on completed_modules is a lost-update race: two
  // module processors for the same lineage completing concurrently would
  // both read the same array and each write back a version missing the
  // other's module. Retry with updated_at as an optimistic-concurrency
  // token — the UPDATE only lands if no one else touched the row since we
  // read it; on conflict, re-read the (now newer) state and retry.
  for (let attempt = 0; attempt < REBUILD_STEP_UPDATE_ATTEMPTS; attempt++) {
    const { data: event } = await supabase
      .from('workforce_rebuild_events')
      .select('id, downstream_modules, completed_modules, failed_modules, updated_at')
      .eq('tenant_id',               tenantId)
      .eq('orchestrator_lineage_id', orchestratorLineageId)
      .maybeSingle()

    if (!event) return

    const row = event as {
      id:                string
      downstream_modules: string[]
      completed_modules:  string[]
      failed_modules:     string[]
      updated_at:         string
    }

    const newCompleted = [...new Set([...row.completed_modules, completedModule])]
    const allDone      = row.downstream_modules.every(m => newCompleted.includes(m))
    const hasFailed    = row.failed_modules.length > 0

    const { data: updated } = await supabase
      .from('workforce_rebuild_events')
      .update({
        completed_modules:    newCompleted,
        orchestration_status: allDone
          ? (hasFailed ? 'failed' : 'completed')
          : 'in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id',         row.id)
      .eq('tenant_id',  tenantId)
      .eq('updated_at', row.updated_at)
      .select('id')
      .maybeSingle()

    if (!updated) continue  // row changed concurrently — retry with fresh state

    // Record completion in timeline
    if (allDone) {
      await recordWorkforceEvent(supabase, {
        tenantId,
        eventType:              'retroactive_rebuild_completed',
        eventDate:              new Date().toISOString().slice(0, 10),
        sourceModule:           'orchestrator',
        orchestratorLineageId,
        rebuildEventId:         row.id,
        payload:                { completed_modules: newCompleted, failed_modules: row.failed_modules },
      })
    }
    return
  }
}

/**
 * Mark a specific module step as failed within a rebuild chain.
 */
export async function markRebuildStepFailed(
  supabase:               SupabaseClient,
  tenantId:               string,
  orchestratorLineageId:  string,
  failedModule:           string,
  errorMessage:           string,
): Promise<void> {
  // Same lost-update race as markRebuildStepCompleted above — retry with
  // updated_at as an optimistic-concurrency token.
  for (let attempt = 0; attempt < REBUILD_STEP_UPDATE_ATTEMPTS; attempt++) {
    const { data: event } = await supabase
      .from('workforce_rebuild_events')
      .select('id, failed_modules, updated_at')
      .eq('tenant_id',               tenantId)
      .eq('orchestrator_lineage_id', orchestratorLineageId)
      .maybeSingle()

    if (!event) return

    const row = event as { id: string; failed_modules: string[]; updated_at: string }
    const newFailed = [...new Set([...row.failed_modules, failedModule])]

    const { data: updated } = await supabase
      .from('workforce_rebuild_events')
      .update({
        failed_modules:       newFailed,
        orchestration_status: 'failed',
        updated_at:           new Date().toISOString(),
      })
      .eq('id',         row.id)
      .eq('tenant_id',  tenantId)
      .eq('updated_at', row.updated_at)
      .select('id')
      .maybeSingle()

    if (!updated) continue  // row changed concurrently — retry with fresh state
    return
  }
}

/**
 * Get the full orchestration chain for a given lineage ID.
 * Returns the rebuild event + all associated queue entries.
 */
export async function getOrchestrationChain(
  supabase:               SupabaseClient,
  tenantId:               string,
  orchestratorLineageId:  string,
): Promise<{
  rebuildEvent: Record<string, unknown> | null
  queueEntries: RebuildQueueRow[]
}> {
  const [evtRes, queueRes] = await Promise.all([
    supabase
      .from('workforce_rebuild_events')
      .select('*')
      .eq('tenant_id',               tenantId)
      .eq('orchestrator_lineage_id', orchestratorLineageId)
      .maybeSingle(),

    supabase
      .from('retroactive_rebuild_queue')
      .select('*')
      .eq('tenant_id',               tenantId)
      .eq('orchestrator_lineage_id', orchestratorLineageId)
      .order('dependency_order',     { ascending: true }),
  ])

  return {
    rebuildEvent:  evtRes.data  ? (evtRes.data  as unknown as Record<string, unknown>) : null,
    queueEntries:  (queueRes.data ?? []) as unknown as RebuildQueueRow[],
  }
}
