/**
 * WorkforceEventTimelineService
 *
 * Persistence layer for the unified workforce governance event timeline.
 *
 * WHAT IT DOES:
 *   Records and retrieves write-once governance events from the
 *   `workforce_event_timeline` table. Every cross-module workforce governance
 *   action (leave approval, attendance rebuild, payroll lock, etc.) is recorded
 *   here so the full chronological history is available in one place.
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT execute any governance actions.
 *   - Does NOT modify leave/attendance/payroll data.
 *   - Does NOT drive any business logic.
 *   - This service is write-once persistence + read-only queries ONLY.
 *
 * IMMUTABILITY:
 *   Timeline entries are NEVER updated or deleted once written.
 *   The table has no `updated_at` column — intentional.
 *
 * USAGE:
 *   1. The WorkforceOrchestrator calls recordWorkforceEvent() after each
 *      governance action it coordinates.
 *   2. The HR admin views call getEmployeeTimeline() / getTimelineByLineage()
 *      for audit trail display.
 *   3. The reconciliation service uses getTimelineForRebuild() to validate
 *      rebuild chain completeness.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkforceEventType =
  | 'leave_approved'
  | 'leave_cancelled'
  | 'retro_leave_approved'
  | 'attendance_rebuild'
  | 'attendance_finalized'
  | 'attendance_correction'
  | 'payroll_lock'
  | 'payroll_unlock'
  | 'payroll_archived'
  | 'entitlement_release'
  | 'freeze_application'
  | 'carry_forward'
  | 'reconciliation_repair'
  | 'scheduler_replay'
  | 'policy_change'
  | 'balance_correction'
  | 'retroactive_rebuild_queued'
  | 'retroactive_rebuild_completed'

export type WorkforceSourceModule =
  | 'leave'
  | 'attendance'
  | 'payroll'
  | 'entitlement'
  | 'reconciliation'
  | 'scheduler'
  | 'orchestrator'

export interface WorkforceTimelineEvent {
  id:                       string
  tenant_id:                string
  employee_id:              string | null
  event_type:               WorkforceEventType
  event_date:               string          // YYYY-MM-DD
  source_module:            WorkforceSourceModule
  source_entity_id:         string | null
  source_entity_type:       string | null
  orchestrator_lineage_id:  string | null
  rebuild_event_id:         string | null
  payload:                  Record<string, unknown>
  replay_reference_id:      string | null
  replay_generation:        number
  created_by:               string | null
  created_at:               string
}

export interface RecordEventOpts {
  tenantId:                 string
  employeeId?:              string
  eventType:                WorkforceEventType
  eventDate:                string          // YYYY-MM-DD
  sourceModule:             WorkforceSourceModule
  sourceEntityId?:          string
  sourceEntityType?:        string
  orchestratorLineageId?:   string
  rebuildEventId?:          string
  payload?:                 Record<string, unknown>
  replayReferenceId?:       string
  replayGeneration?:        number
  createdBy?:               string
}

// ── Core service functions ─────────────────────────────────────────────────────

/**
 * Record an immutable workforce governance event.
 *
 * Non-fatal: failures are logged but never propagate — governance actions must
 * never be blocked by timeline write failures.
 *
 * Returns the new event ID, or null on failure.
 */
export async function recordWorkforceEvent(
  supabase: SupabaseClient,
  opts:     RecordEventOpts,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('workforce_event_timeline')
      .insert({
        tenant_id:                opts.tenantId,
        employee_id:              opts.employeeId              ?? null,
        event_type:               opts.eventType,
        event_date:               opts.eventDate,
        source_module:            opts.sourceModule,
        source_entity_id:         opts.sourceEntityId          ?? null,
        source_entity_type:       opts.sourceEntityType        ?? null,
        orchestrator_lineage_id:  opts.orchestratorLineageId   ?? null,
        rebuild_event_id:         opts.rebuildEventId          ?? null,
        payload:                  opts.payload                 ?? {},
        replay_reference_id:      opts.replayReferenceId       ?? null,
        replay_generation:        opts.replayGeneration        ?? 1,
        created_by:               opts.createdBy               ?? null,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.warn('[workforce-event-timeline] record failed:', error?.message)
      return null
    }

    return (data as { id: string }).id
  } catch (err) {
    console.warn('[workforce-event-timeline] record exception:', (err as Error).message)
    return null
  }
}

/**
 * Retrieve the full governance event timeline for an employee.
 * Returns events newest-first (sorted by event_date DESC, created_at DESC).
 */
export async function getEmployeeTimeline(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  fromDate?:   string,   // YYYY-MM-DD — if provided, only events on or after
  toDate?:     string,   // YYYY-MM-DD — if provided, only events on or before
  limit        = 50,
): Promise<WorkforceTimelineEvent[]> {
  let query = supabase
    .from('workforce_event_timeline')
    .select('*')
    .eq('tenant_id',  tenantId)
    .eq('employee_id', employeeId)

  if (fromDate) query = query.gte('event_date', fromDate)
  if (toDate)   query = query.lte('event_date', toDate)

  const { data } = await query
    .order('event_date',  { ascending: false })
    .order('created_at',  { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as WorkforceTimelineEvent[]
}

/**
 * Retrieve all timeline events associated with a specific rebuild chain.
 * Used by the reconciliation service to verify chain completeness.
 */
export async function getTimelineForRebuild(
  supabase:         SupabaseClient,
  tenantId:         string,
  rebuildEventId:   string,
): Promise<WorkforceTimelineEvent[]> {
  const data = await fetchAllRows<WorkforceTimelineEvent>((from, to) =>
    supabase
      .from('workforce_event_timeline')
      .select('*')
      .eq('tenant_id',       tenantId)
      .eq('rebuild_event_id', rebuildEventId)
      .order('created_at',   { ascending: true })
      .range(from, to) as any,
  )

  return data
}

/**
 * Retrieve all timeline events sharing an orchestration lineage ID.
 * Returns the full cross-module event trace for one orchestrated rebuild chain.
 */
export async function getTimelineByLineage(
  supabase:   SupabaseClient,
  tenantId:   string,
  lineageId:  string,
): Promise<WorkforceTimelineEvent[]> {
  const data = await fetchAllRows<WorkforceTimelineEvent>((from, to) =>
    supabase
      .from('workforce_event_timeline')
      .select('*')
      .eq('tenant_id',                tenantId)
      .eq('orchestrator_lineage_id',  lineageId)
      .order('created_at',            { ascending: true })
      .range(from, to) as any,
  )

  return data
}

/**
 * Count timeline events by type for a tenant in a date range.
 * Used by the scheduler status dashboard and reconciliation reports.
 */
export async function getTimelineEventCounts(
  supabase:   SupabaseClient,
  tenantId:   string,
  fromDate:   string,
  toDate:     string,
): Promise<Record<WorkforceEventType, number>> {
  const data = await fetchAllRows<{ event_type: string }>((from, to) =>
    supabase
      .from('workforce_event_timeline')
      .select('event_type')
      .eq('tenant_id',  tenantId)
      .gte('event_date', fromDate)
      .lte('event_date', toDate)
      .range(from, to) as any,
  )

  const counts: Record<string, number> = {}
  for (const row of data) {
    counts[row.event_type] = (counts[row.event_type] ?? 0) + 1
  }
  return counts as Record<WorkforceEventType, number>
}
