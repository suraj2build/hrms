/**
 * correction-processor.ts
 *
 * Production-grade service layer for the attendance correction pipeline.
 *
 * This module owns ALL recompute logic so that route handlers remain thin
 * controllers (validate → authorise → schedule → respond).
 *
 * ── Why processing is async ────────────────────────────────────────────────────
 * The attendance engine touches attendance_daily, shift_roster, holiday_calendar,
 * and punch_logs in a single date recompute.  On busy tenants this takes
 * 200–800 ms.  Running it synchronously inside an HTTP handler would:
 *   a) Surface timeouts to the client on any DB pressure.
 *   b) Leave the row in an ambiguous state if the server crashes mid-flight,
 *      with no recovery path.
 * Moving to 'processing' first (committed before the HTTP response) makes every
 * failure observable and retryable without losing the approval record.
 *
 * ── Why 'processing' is a distinct status ─────────────────────────────────────
 * 'processing' is the only state where a recompute is legally in-flight.  Any
 * row that is NOT in 'processing' when the async worker polls will be aborted
 * (duplicate/stale guard).  This prevents:
 *   • Two workers recomputing the same correction simultaneously.
 *   • A retry applying corrections on top of an already-applied row.
 *
 * ── Why retries are manual (not automatic) ────────────────────────────────────
 * Automatic retries with backoff can silently re-apply corrections after an
 * operator has already resolved the underlying issue (e.g. by editing punch_logs
 * directly).  Manual HR-triggered retries give operators control and visibility
 * before each re-application.
 *
 * ── Why stale recovery exists (and why it only marks failed) ─────────────────
 * If a server process dies between setting 'processing' and completing the
 * recompute, the row is stuck indefinitely.  The recovery function detects rows
 * where processing_started_at is older than STALE_THRESHOLD_MS and marks them
 * failed so HR can investigate and explicitly retry.  Auto-retry is intentionally
 * NOT done here because the original correction data may have already been
 * partially applied to punch_logs — a blind auto-retry could duplicate punches.
 *
 * ── Why recompute must be idempotent ──────────────────────────────────────────
 * Punch_log rows are upserted (not inserted) using the unique constraint on
 * (tenant_id, employee_id, punched_at, direction).  recomputeRange itself
 * batch-upserts attendance_daily.  Re-running the same correction multiple times
 * is therefore safe and produces the same final state.
 */

import type { SupabaseClient }    from '@supabase/supabase-js'
import { recomputeRange }         from '../../lib/attendance-engine.js'
import { logAction }              from '../../lib/audit-service.js'

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of HR-triggered retries allowed per correction.
 * After this many failed attempts the correction is locked and requires
 * manual data investigation before further retries are allowed.
 * Step 7.
 */
export const MAX_RETRY_COUNT = 5

/**
 * Timeout for a single attendance recompute call.
 * If the engine does not resolve within this window the correction is marked
 * failed with failure_reason = 'Attendance recompute timeout' so it is visible
 * to HR and retryable.  Step 3.
 */
export const RECOMPUTE_TIMEOUT_MS = 30_000   // 30 seconds

/**
 * Age at which a 'processing' row is considered stale / hung.
 * Used by recoverStaleCorrectionProcessing.  Step 4.
 */
export const STALE_THRESHOLD_MS = 15 * 60 * 1_000   // 15 minutes

// ── Structured log event names — Step 8 ───────────────────────────────────────
// Kept as constants so search / alerting rules are easy to write.

const LOG_EVENTS = {
  PROCESSING_STARTED: 'attendance_correction_processing_started',
  APPLIED:            'attendance_correction_processing_applied',
  FAILED:             'attendance_correction_processing_failed',
  RETRY_REQUESTED:    'attendance_correction_retry_requested',
  STALE_RECOVERED:    'attendance_correction_stale_recovered',
} as const

// ── Types ──────────────────────────────────────────────────────────────────────

/** Minimal logger interface — compatible with fastify.log and console. */
export interface ProcessorLogger {
  info:  (data: Record<string, unknown>, msg: string) => void
  warn:  (data: Record<string, unknown>, msg: string) => void
  error: (data: Record<string, unknown>, msg: string) => void
}

export interface PunchRow {
  tenant_id:   string
  employee_id: string
  punched_at:  string
  direction:   'IN' | 'OUT'
  source:      string
  notes:       string
}

/**
 * Options accepted by processAttendanceCorrection.
 * Routes populate these after validating the HTTP request and authorising
 * the actor — the service does not repeat those checks.
 */
export interface ProcessCorrectionOptions {
  /** DB row id from attendance_corrections */
  correctionId:  string
  tenantId:      string
  /** User performing the action (approver or HR retrying) */
  actorUserId:   string
  /** Why this processing was triggered — recorded in audit and logs */
  trigger:       'approval' | 'retry'
  /** The employee whose attendance will be recomputed */
  employeeId:    string
  /** Date in YYYY-MM-DD — the attendance date being corrected */
  date:          string
  /**
   * Punch rows to upsert before recomputing.
   * Built by the route from corrected_in / corrected_out.
   * Empty array is valid (recompute without inserting new punches).
   */
  punchRows:     PunchRow[]
  supabase:      SupabaseClient
  log:           ProcessorLogger
}

export interface StaleRow {
  id:                       string
  tenant_id:                string
  employee_id:              string
  date:                     string
  processing_started_at:    string
  retry_count:              number
}

// ── Internal: recompute with timeout — Step 3 ─────────────────────────────────

/**
 * Wraps recomputeRange in a hard timeout.
 * If the engine does not resolve within RECOMPUTE_TIMEOUT_MS, the returned
 * promise rejects with a standardised error message so the caller marks the
 * correction as failed.
 */
async function recomputeWithTimeout(
  supabase:    SupabaseClient,
  tenant_id:   string,
  employee_id: string,
  date:        string,
  changed_by:  string,
): Promise<void> {
  const timeoutErr = new Error('Attendance recompute timeout')

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(timeoutErr), RECOMPUTE_TIMEOUT_MS)
  })

  await Promise.race([
    recomputeRange(supabase, {
      tenant_id,
      employee_id,
      from_date:  date,
      to_date:    date,
      changed_by,
    }),
    timeoutPromise,
  ])
}

// ── Internal: non-fatal audit write ───────────────────────────────────────────

function fireAudit(
  supabase:    SupabaseClient,
  log:         ProcessorLogger,
  tenantId:    string,
  recordId:    string,
  performedBy: string,
  newData:     Record<string, unknown>,
) {
  logAction(supabase, {
    tenantId,
    tableName:   'attendance_corrections',
    recordId,
    action:      'UPDATE',
    performedBy,
    newData,
  }).catch((err: unknown) => {
    log.warn(
      { err, record_id: recordId },
      'correction-processor: audit_log insert failed (non-fatal)',
    )
  })
}

// ── processAttendanceCorrection — Steps 1, 2, 3, 8, 9 ────────────────────────

/**
 * Main correction recompute pipeline.
 *
 * Design contract:
 *   • The caller MUST have already set status = 'processing' in the DB.
 *   • This function re-validates that contract before touching any attendance
 *     data (idempotency guard — Step 2).
 *   • It runs entirely async; the caller fires it via setImmediate and returns
 *     the HTTP response before this function does any DB work.
 *   • It NEVER throws — all errors are caught, the correction is marked failed,
 *     and the error is logged with full context.
 */
export async function processAttendanceCorrection(
  opts: ProcessCorrectionOptions,
): Promise<void> {
  const {
    correctionId, tenantId, actorUserId, trigger,
    employeeId, date, punchRows, supabase, log,
  } = opts

  const workerStart = Date.now()

  // ── Step 8: structured log — processing started ────────────────────────────
  log.info(
    {
      event:         LOG_EVENTS.PROCESSING_STARTED,
      correction_id: correctionId,
      tenant_id:     tenantId,
      employee_id:   employeeId,
      date,
      trigger,
      actor_user_id: actorUserId,
    },
    'correction-processor: processing started',
  )

  // ── Step 2: Idempotency guard — re-fetch row status before any writes ──────
  //
  // Why we re-fetch:  Between the HTTP handler setting 'processing' and this
  // async worker running, another worker (duplicate request, manual DB edit,
  // stale recovery) may have already changed the status.  We treat anything
  // other than 'processing' as "someone else handled it" and abort silently.
  const { data: currentRow, error: fetchErr } = await supabase
    .from('attendance_corrections')
    .select('status, retry_count')
    .eq('id', correctionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !currentRow) {
    log.error(
      { event: LOG_EVENTS.FAILED, correction_id: correctionId, err: fetchErr },
      'correction-processor: cannot fetch row — aborting',
    )
    return
  }

  const row = currentRow as { status: string; retry_count: number }

  if (row.status !== 'processing') {
    // Another worker already handled this correction — abort without any writes.
    log.warn(
      {
        correction_id: correctionId,
        db_status:     row.status,
        trigger,
      },
      'correction-processor: row no longer in processing state — aborting (duplicate worker prevented)',
    )
    return
  }

  const currentRetryCount = row.retry_count

  // ── Upsert corrected punch rows ────────────────────────────────────────────
  if (punchRows.length > 0) {
    const { error: punchErr } = await supabase
      .from('attendance_punch_logs')
      .upsert(punchRows, {
        onConflict:       'tenant_id,employee_id,punched_at,direction',
        ignoreDuplicates: true,
      })

    if (punchErr) {
      // Non-fatal: recompute can still run using existing punch data.
      // Log the error so it is visible in operational monitoring.
      log.warn(
        {
          correction_id: correctionId,
          employee_id:   employeeId,
          date,
          err:           punchErr,
        },
        'correction-processor: punch_log upsert failed — proceeding to recompute with existing data',
      )
    }
  }

  // ── Step 3: Recompute with timeout ────────────────────────────────────────
  try {
    await recomputeWithTimeout(supabase, tenantId, employeeId, date, actorUserId)

    // ── Success ───────────────────────────────────────────────────────────
    const appliedAt  = new Date().toISOString()
    const durationMs = Date.now() - workerStart

    await supabase
      .from('attendance_corrections')
      .update({
        status:         'applied',
        applied_at:     appliedAt,
        failure_reason: null,    // clear any previous failure message
      })
      .eq('id', correctionId)
      .eq('tenant_id', tenantId)

    // ── Step 8: structured log — applied ──────────────────────────────────
    log.info(
      {
        event:         LOG_EVENTS.APPLIED,
        correction_id: correctionId,
        tenant_id:     tenantId,
        employee_id:   employeeId,
        date,
        trigger,
        retry_count:   currentRetryCount,
        duration_ms:   durationMs,
      },
      'correction-processor: attendance recompute applied successfully',
    )

    fireAudit(supabase, log, tenantId, correctionId, actorUserId, {
      event:       'correction.applied',
      employee_id: employeeId,
      date,
      applied_at:  appliedAt,
      trigger,
      duration_ms: durationMs,
    })
  } catch (engineErr) {
    // ── Failure: timeout or engine error ──────────────────────────────────
    //
    // IMPORTANT: approved_by and approved_at are intentionally NOT touched.
    // They must remain immutable so the audit trail preserves who approved
    // this correction even if recompute fails multiple times.
    const reason = engineErr instanceof Error
      ? engineErr.message
      : 'Attendance recompute failed with an unknown error'

    const nextRetryCount = currentRetryCount + 1
    const durationMs     = Date.now() - workerStart

    await supabase
      .from('attendance_corrections')
      .update({
        status:         'failed',
        failure_reason: reason,
        retry_count:    nextRetryCount,
      })
      .eq('id', correctionId)
      .eq('tenant_id', tenantId)

    // ── Step 8: structured log — failed ───────────────────────────────────
    log.error(
      {
        event:          LOG_EVENTS.FAILED,
        correction_id:  correctionId,
        tenant_id:      tenantId,
        employee_id:    employeeId,
        date,
        trigger,
        retry_count:    nextRetryCount,
        failure_reason: reason,
        duration_ms:    durationMs,
        err:            engineErr,
      },
      'correction-processor: recompute failed — correction marked failed, retryable by HR',
    )

    fireAudit(supabase, log, tenantId, correctionId, actorUserId, {
      event:          'correction.failed',
      employee_id:    employeeId,
      date,
      trigger,
      failure_reason: reason,
      retry_count:    nextRetryCount,
      duration_ms:    durationMs,
    })
  }
}

// ── recoverStaleCorrectionProcessing — Step 4 ─────────────────────────────────

/**
 * Finds corrections that have been stuck in 'processing' longer than
 * STALE_THRESHOLD_MS and marks them 'failed' so HR can investigate and retry.
 *
 * Why we only mark failed, not auto-retry:
 *   The server crash that caused the stale row may have partially written
 *   punch_logs.  Auto-retrying without inspection could double-apply punches
 *   or produce incorrect attendance.  Human verification before retry is the
 *   safe default.
 *
 * This function is intentionally tenant-scoped so it can be called per-tenant
 * from the operational endpoint without cross-tenant leakage.
 */
export async function recoverStaleCorrectionProcessing(
  supabase:  SupabaseClient,
  tenantId:  string,
  log:       ProcessorLogger,
): Promise<StaleRow[]> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

  // Fetch stale rows first so we can return them and log details
  const { data: staleRows, error: fetchErr } = await supabase
    .from('attendance_corrections')
    .select('id, tenant_id, employee_id, date, processing_started_at, retry_count')
    .eq('tenant_id', tenantId)
    .eq('status', 'processing')
    .lt('processing_started_at', cutoff)

  if (fetchErr) {
    log.error(
      { err: fetchErr, tenant_id: tenantId },
      'correction-processor: failed to fetch stale processing rows',
    )
    return []
  }

  const rows = (staleRows ?? []) as StaleRow[]
  if (!rows.length) return []

  const ids = rows.map((r) => r.id)

  // Mark all stale rows as failed atomically
  const { error: updateErr } = await supabase
    .from('attendance_corrections')
    .update({
      status:         'failed',
      failure_reason: 'Processing timeout recovery — server crash or worker termination detected',
    })
    .in('id', ids)
    .eq('tenant_id', tenantId)
    .eq('status', 'processing')   // extra guard: only update rows still in processing

  if (updateErr) {
    log.error(
      { err: updateErr, ids, tenant_id: tenantId },
      'correction-processor: failed to mark stale rows as failed',
    )
    return []
  }

  // ── Step 8: structured log — stale recovery ───────────────────────────────
  log.warn(
    {
      event:           LOG_EVENTS.STALE_RECOVERED,
      tenant_id:       tenantId,
      recovered_count: rows.length,
      correction_ids:  ids,
    },
    `correction-processor: ${rows.length} stale processing correction(s) recovered to failed`,
  )

  return rows
}
