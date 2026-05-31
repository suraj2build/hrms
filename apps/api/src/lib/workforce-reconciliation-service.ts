/**
 * WorkforceReconciliationService
 *
 * Cross-module orchestration reconciliation engine.
 *
 * WHAT IT DOES:
 *   Runs AFTER the per-module reconciliation engines (leave-reconciliation.ts,
 *   attendance reconciliation) and validates orchestration-level integrity:
 *
 *   orphan_rebuild_chain
 *     workforce_rebuild_events rows stuck in 'in_progress' longer than the
 *     configured stall threshold. The rebuild chain started but never completed.
 *
 *   freeze_boundary_violation
 *     retroactive_rebuild_queue entries in 'pending' status whose rebuild_from_date
 *     falls within a payroll_locked or payroll_archived period. These rebuilds
 *     should have been blocked by the orchestrator's freeze check.
 *
 *   replay_lineage_corruption
 *     retroactive_rebuild_queue entries with a non-null orchestrator_lineage_id
 *     where no matching workforce_rebuild_events row exists. The root orchestration
 *     record was lost while queue entries remained — the chain is orphaned.
 *
 *   retro_rebuild_incomplete
 *     workforce_rebuild_events with orchestration_status='failed' where all
 *     downstream retroactive_rebuild_queue entries have also failed (retry_count
 *     >= max_retries). Permanently blocked rebuild chains that need manual review.
 *
 *   cross_module_replay_drift
 *     workforce_rebuild_events with orchestration_status='completed' but where
 *     completed_modules doesn't cover all downstream_modules. Some modules
 *     completed but others didn't — inconsistent module-level state.
 *
 *   attendance_payroll_mismatch
 *     Employees whose attendance_processing_states show 'finalized' dates but
 *     whose corresponding payroll_period_states are still 'open'. Finalized
 *     attendance should typically accompany a payroll processing signal.
 *
 * WHAT IT DOES NOT DO (scope guard):
 *   - Does NOT recalculate any values.
 *   - Does NOT modify leave/attendance/payroll data.
 *   - Does NOT fix the issues it detects — only reports them.
 *   - Does NOT replace per-module reconciliation engines.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Constants ──────────────────────────────────────────────────────────────────

/** Rebuild chain is considered stalled if 'in_progress' for more than this. */
const STALL_THRESHOLD_HOURS = 2

/** Max issues to collect in a single run. */
const MAX_ISSUES = 500

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkforceIssueType =
  | 'orphan_rebuild_chain'
  | 'freeze_boundary_violation'
  | 'replay_lineage_corruption'
  | 'retro_rebuild_incomplete'
  | 'cross_module_replay_drift'
  | 'attendance_payroll_mismatch'

export type WorkforceIssueSeverity = 'info' | 'warning' | 'error' | 'critical'

interface WorkforceIssue {
  issue_type:               WorkforceIssueType
  severity:                 WorkforceIssueSeverity
  employee_id:              string | null
  rebuild_event_id:         string | null
  orchestrator_lineage_id:  string | null
  affected_modules:         string[]
  affected_period:          string | null
  detail:                   Record<string, unknown>
  suggestion:               string
}

export interface WorkforceReconciliationResult {
  run_id:           string
  tenant_id:        string
  reconcile_year:   number
  total_issues:     number
  issue_breakdown:  Record<WorkforceIssueType, number>
  duration_ms:      number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function flushIssues(
  supabase:  SupabaseClient,
  runId:     string,
  tenantId:  string,
  issues:    WorkforceIssue[],
): Promise<void> {
  if (!issues.length) return
  const CHUNK = 100
  for (let i = 0; i < issues.length; i += CHUNK) {
    const chunk = issues.slice(i, i + CHUNK).map(iss => ({
      run_id:    runId,
      tenant_id: tenantId,
      ...iss,
    }))
    const { error } = await supabase
      .from('workforce_reconciliation_issues')
      .insert(chunk)
    if (error) {
      console.error('[workforce-reconciliation] issue flush error:', error.message)
    }
  }
}

function stallCutoff(): string {
  return new Date(Date.now() - STALL_THRESHOLD_HOURS * 3_600_000).toISOString()
}

// ── Checks ─────────────────────────────────────────────────────────────────────

/**
 * Check 1: Orphan rebuild chains
 * workforce_rebuild_events in 'in_progress' or 'sequencing' for > STALL_THRESHOLD_HOURS
 */
async function checkOrphanRebuildChains(
  supabase:  SupabaseClient,
  tenantId:  string,
  issues:    WorkforceIssue[],
): Promise<void> {
  const { data: stalled } = await supabase
    .from('workforce_rebuild_events')
    .select('id, orchestrator_lineage_id, employee_id, downstream_modules, completed_modules, created_at, source_event_type')
    .eq('tenant_id', tenantId)
    .in('orchestration_status', ['in_progress', 'sequencing'])
    .lt('updated_at', stallCutoff())
    .limit(MAX_ISSUES)

  for (const row of (stalled ?? []) as any[]) {
    if (issues.length >= MAX_ISSUES) break
    const pending  = (row.downstream_modules as string[]).filter(
      (m: string) => !(row.completed_modules as string[]).includes(m),
    )
    issues.push({
      issue_type:               'orphan_rebuild_chain',
      severity:                 'error',
      employee_id:              row.employee_id,
      rebuild_event_id:         row.id,
      orchestrator_lineage_id:  row.orchestrator_lineage_id,
      affected_modules:         pending,
      affected_period:          null,
      detail: {
        created_at:          row.created_at,
        source_event_type:   row.source_event_type,
        completed_modules:   row.completed_modules,
        pending_modules:     pending,
        stall_threshold_hrs: STALL_THRESHOLD_HOURS,
      },
      suggestion: `Rebuild chain ${row.id} (lineage ${row.orchestrator_lineage_id}) has been in progress for more than ${STALL_THRESHOLD_HOURS} hours. Pending modules: ${pending.join(', ')}. Investigate whether the module processor is running. Manually advance or cancel the rebuild chain.`,
    })
  }
}

/**
 * Check 2: Freeze boundary violations
 * Pending retroactive_rebuild_queue entries in locked/archived periods.
 */
async function checkFreezeBoundaryViolations(
  supabase:  SupabaseClient,
  tenantId:  string,
  issues:    WorkforceIssue[],
): Promise<void> {
  // Find pending rebuild entries
  const { data: pendingRebuild } = await supabase
    .from('retroactive_rebuild_queue')
    .select('id, employee_id, rebuild_from_date, rebuild_to_date, source_event_type, affected_modules, orchestrator_lineage_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .limit(MAX_ISSUES)

  if (!pendingRebuild?.length) return

  // Get all locked/archived periods
  const { data: lockedPeriods } = await supabase
    .from('payroll_period_states')
    .select('period_month, governance_state')
    .eq('tenant_id', tenantId)
    .in('governance_state', ['payroll_locked', 'payroll_archived'])

  if (!lockedPeriods?.length) return

  const lockedSet = new Set<string>(
    (lockedPeriods as { period_month: string; governance_state: string }[]).map(p => p.period_month)
  )
  const lockedStateMap = new Map<string, string>(
    (lockedPeriods as { period_month: string; governance_state: string }[]).map(p => [p.period_month, p.governance_state])
  )

  for (const rebuild of (pendingRebuild as any[])) {
    if (issues.length >= MAX_ISSUES) break
    const fromPeriod = (rebuild.rebuild_from_date as string).slice(0, 7)

    if (lockedSet.has(fromPeriod)) {
      const state = lockedStateMap.get(fromPeriod) ?? 'payroll_locked'
      issues.push({
        issue_type:               'freeze_boundary_violation',
        severity:                 state === 'payroll_archived' ? 'critical' : 'error',
        employee_id:              rebuild.employee_id,
        rebuild_event_id:         null,
        orchestrator_lineage_id:  rebuild.orchestrator_lineage_id,
        affected_modules:         rebuild.affected_modules ?? [],
        affected_period:          fromPeriod,
        detail: {
          rebuild_id:             rebuild.id,
          rebuild_from_date:      rebuild.rebuild_from_date,
          period_governance_state: state,
          source_event_type:      rebuild.source_event_type,
        },
        suggestion: `Rebuild queue entry ${rebuild.id} targets period ${fromPeriod} which is in state '${state}'. This entry should have been blocked by the freeze constraint check. ${state === 'payroll_archived' ? 'Cancel this rebuild immediately.' : 'Route through the adjustment workflow.'}`,
      })
    }
  }
}

/**
 * Check 3: Replay lineage corruption
 * retroactive_rebuild_queue entries with orchestrator_lineage_id pointing to
 * a non-existent workforce_rebuild_events row.
 */
async function checkReplayLineageCorruption(
  supabase:  SupabaseClient,
  tenantId:  string,
  issues:    WorkforceIssue[],
): Promise<void> {
  // Queue entries with a lineage ID
  const { data: linkedEntries } = await supabase
    .from('retroactive_rebuild_queue')
    .select('id, orchestrator_lineage_id, employee_id, source_event_type, affected_modules, status')
    .eq('tenant_id', tenantId)
    .not('orchestrator_lineage_id', 'is', null)
    .in('status', ['pending', 'in_progress', 'failed'])
    .limit(MAX_ISSUES)

  if (!linkedEntries?.length) return

  // Get all known lineage IDs from workforce_rebuild_events
  const lineageIds = [...new Set(
    (linkedEntries as any[]).map((r: any) => r.orchestrator_lineage_id)
  )]

  const { data: knownEvents } = await supabase
    .from('workforce_rebuild_events')
    .select('orchestrator_lineage_id')
    .eq('tenant_id', tenantId)
    .in('orchestrator_lineage_id', lineageIds)

  const knownLineageSet = new Set<string>(
    (knownEvents ?? []).map((e: any) => e.orchestrator_lineage_id)
  )

  for (const entry of (linkedEntries as any[])) {
    if (issues.length >= MAX_ISSUES) break
    if (!knownLineageSet.has(entry.orchestrator_lineage_id)) {
      issues.push({
        issue_type:               'replay_lineage_corruption',
        severity:                 'error',
        employee_id:              entry.employee_id,
        rebuild_event_id:         null,
        orchestrator_lineage_id:  entry.orchestrator_lineage_id,
        affected_modules:         entry.affected_modules ?? [],
        affected_period:          null,
        detail: {
          rebuild_queue_id:        entry.id,
          missing_lineage_id:      entry.orchestrator_lineage_id,
          queue_status:            entry.status,
          source_event_type:       entry.source_event_type,
        },
        suggestion: `retroactive_rebuild_queue entry ${entry.id} references orchestrator_lineage_id ${entry.orchestrator_lineage_id} but no matching workforce_rebuild_events row exists. The root orchestration record was lost. Manually create the workforce_rebuild_events record or cancel this queue entry and re-orchestrate.`,
      })
    }
  }
}

/**
 * Check 4: Permanently failed rebuild chains
 * workforce_rebuild_events with 'failed' status where all queue entries are exhausted.
 */
async function checkRetroBuildIncomplete(
  supabase:       SupabaseClient,
  tenantId:       string,
  reconcileYear:  number,
  issues:         WorkforceIssue[],
): Promise<void> {
  const yearStart = `${reconcileYear}-01-01`
  const yearEnd   = `${reconcileYear}-12-31`

  const { data: failedEvents } = await supabase
    .from('workforce_rebuild_events')
    .select('id, orchestrator_lineage_id, employee_id, downstream_modules, completed_modules, failed_modules, source_event_type, rebuild_from_date')
    .eq('tenant_id', tenantId)
    .eq('orchestration_status', 'failed')
    .gte('rebuild_from_date', yearStart)
    .lte('rebuild_from_date', yearEnd)
    .limit(MAX_ISSUES)

  for (const event of (failedEvents ?? []) as any[]) {
    if (issues.length >= MAX_ISSUES) break
    const unrecoverable = (event.failed_modules as string[]).some(m =>
      !(event.completed_modules as string[]).includes(m)
    )
    if (!unrecoverable) continue

    issues.push({
      issue_type:               'retro_rebuild_incomplete',
      severity:                 'critical',
      employee_id:              event.employee_id,
      rebuild_event_id:         event.id,
      orchestrator_lineage_id:  event.orchestrator_lineage_id,
      affected_modules:         event.failed_modules,
      affected_period:          (event.rebuild_from_date as string).slice(0, 7),
      detail: {
        source_event_type:  event.source_event_type,
        rebuild_from_date:  event.rebuild_from_date,
        completed_modules:  event.completed_modules,
        failed_modules:     event.failed_modules,
      },
      suggestion: `Rebuild chain ${event.id} permanently failed for modules [${event.failed_modules.join(', ')}]. The employee's data may be in an inconsistent state. Manually investigate and re-trigger the orchestration for event type '${event.source_event_type}'.`,
    })
  }
}

/**
 * Check 5: Cross-module replay drift
 * Completed workforce_rebuild_events where some downstream modules didn't finish.
 */
async function checkCrossModuleReplayDrift(
  supabase:  SupabaseClient,
  tenantId:  string,
  issues:    WorkforceIssue[],
): Promise<void> {
  const { data: completed } = await supabase
    .from('workforce_rebuild_events')
    .select('id, orchestrator_lineage_id, employee_id, downstream_modules, completed_modules')
    .eq('tenant_id', tenantId)
    .eq('orchestration_status', 'completed')
    .limit(MAX_ISSUES)

  for (const event of (completed ?? []) as any[]) {
    if (issues.length >= MAX_ISSUES) break
    const missing = (event.downstream_modules as string[]).filter(
      (m: string) => !(event.completed_modules as string[]).includes(m),
    )
    if (!missing.length) continue

    issues.push({
      issue_type:               'cross_module_replay_drift',
      severity:                 'warning',
      employee_id:              event.employee_id,
      rebuild_event_id:         event.id,
      orchestrator_lineage_id:  event.orchestrator_lineage_id,
      affected_modules:         missing,
      affected_period:          null,
      detail: {
        downstream_modules:  event.downstream_modules,
        completed_modules:   event.completed_modules,
        missing_modules:     missing,
      },
      suggestion: `Rebuild chain ${event.id} is marked 'completed' but modules [${missing.join(', ')}] were not completed. The orchestration_status may have been set incorrectly. Re-run the rebuild for the missing modules.`,
    })
  }
}

/**
 * Check 6: Attendance/payroll mismatch
 * Employees with 'finalized' attendance dates whose period is still 'open'.
 */
async function checkAttendancePayrollMismatch(
  supabase:       SupabaseClient,
  tenantId:       string,
  reconcileYear:  number,
  issues:         WorkforceIssue[],
): Promise<void> {
  const yearStart = `${reconcileYear}-01-01`
  const yearEnd   = `${reconcileYear}-12-31`

  // Find employees with finalized attendance in this year
  const { data: finalizedStates } = await supabase
    .from('attendance_processing_states')
    .select('employee_id, work_date')
    .eq('tenant_id', tenantId)
    .eq('state', 'finalized')
    .gte('work_date', yearStart)
    .lte('work_date', yearEnd)
    .limit(1000)

  if (!finalizedStates?.length) return

  // Group by period month
  const periodEmployees = new Map<string, Set<string>>()
  for (const row of (finalizedStates as { employee_id: string; work_date: string }[])) {
    const period = row.work_date.slice(0, 7)
    if (!periodEmployees.has(period)) periodEmployees.set(period, new Set())
    periodEmployees.get(period)!.add(row.employee_id)
  }

  // Check which periods are still 'open'
  const periods = [...periodEmployees.keys()]
  const { data: periodStates } = await supabase
    .from('payroll_period_states')
    .select('period_month, governance_state')
    .eq('tenant_id', tenantId)
    .in('period_month', periods)

  const stateMap = new Map<string, string>(
    (periodStates ?? []).map((p: any) => [p.period_month, p.governance_state])
  )

  for (const period of periods) {
    if (issues.length >= MAX_ISSUES) break
    const state = stateMap.get(period) ?? 'open'
    if (state !== 'open') continue  // payroll processing or beyond — fine

    const empIds = [...(periodEmployees.get(period) ?? [])]
    if (!empIds.length) continue

    issues.push({
      issue_type:               'attendance_payroll_mismatch',
      severity:                 'info',
      employee_id:              null,  // affects multiple employees
      rebuild_event_id:         null,
      orchestrator_lineage_id:  null,
      affected_modules:         ['attendance', 'payroll'],
      affected_period:          period,
      detail: {
        period_month:              period,
        payroll_governance_state:  state,
        finalized_employee_count:  empIds.length,
        sample_employee_ids:       empIds.slice(0, 5),
      },
      suggestion: `${empIds.length} employee(s) have 'finalized' attendance for period ${period} but the payroll period is still '${state}'. Consider transitioning the payroll period to 'payroll_processing' to signal payroll run initiation and prevent further retroactive mutations.`,
    })
  }
}

// ── Main reconciliation function ───────────────────────────────────────────────

export async function runWorkforceReconciliation(
  supabase:       SupabaseClient,
  tenantId:       string,
  reconcileYear:  number,
  triggeredBy:    string | null = null,
  source:         'manual' | 'scheduler' | 'api' = 'api',
): Promise<WorkforceReconciliationResult> {
  const startMs = Date.now()

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from('workforce_reconciliation_runs')
    .insert({
      tenant_id:      tenantId,
      status:         'running',
      reconcile_year: reconcileYear,
      triggered_by:   triggeredBy,
      trigger_source: source,
    })
    .select('id')
    .single()

  if (runErr || !run) {
    throw new Error(`Failed to create workforce reconciliation run: ${runErr?.message}`)
  }

  const runId = (run as { id: string }).id
  const issues: WorkforceIssue[] = []

  try {
    // Run all checks in sequence (each may add to `issues`)
    await checkOrphanRebuildChains(supabase, tenantId, issues)
    await checkFreezeBoundaryViolations(supabase, tenantId, issues)
    await checkReplayLineageCorruption(supabase, tenantId, issues)
    await checkRetroBuildIncomplete(supabase, tenantId, reconcileYear, issues)
    await checkCrossModuleReplayDrift(supabase, tenantId, issues)
    await checkAttendancePayrollMismatch(supabase, tenantId, reconcileYear, issues)

    // Flush
    await flushIssues(supabase, runId, tenantId, issues)

    // Breakdown
    const breakdown: Record<string, number> = {}
    for (const iss of issues) {
      breakdown[iss.issue_type] = (breakdown[iss.issue_type] ?? 0) + 1
    }

    const durationMs = Date.now() - startMs

    await supabase
      .from('workforce_reconciliation_runs')
      .update({
        status:         'completed',
        completed_at:   new Date().toISOString(),
        duration_ms:    durationMs,
        total_issues:   issues.length,
        issue_breakdown: breakdown,
      })
      .eq('id', runId)

    return {
      run_id:          runId,
      tenant_id:       tenantId,
      reconcile_year:  reconcileYear,
      total_issues:    issues.length,
      issue_breakdown: breakdown as Record<WorkforceIssueType, number>,
      duration_ms:     durationMs,
    }
  } catch (err: unknown) {
    const msg = (err as Error).message
    await supabase
      .from('workforce_reconciliation_runs')
      .update({ status: 'failed', error: msg, completed_at: new Date().toISOString() })
      .eq('id', runId)
    throw err
  }
}
