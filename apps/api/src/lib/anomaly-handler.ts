/**
 * anomaly-handler.ts
 *
 * Listens to 'attendance.updated' events emitted by the AttendanceEngine and,
 * for each new/persisted anomaly on the affected employee + date, dispatches
 * notifications to:
 *   1. The employee (self-notification)
 *   2. The employee's current reporting manager (if one is configured)
 *
 * Architecture:
 *   - Registers a handler on the shared EventService bus.
 *   - Reads anomalies from attendance_anomalies (already synced by the engine).
 *   - Resolves the manager via the current job_history row.
 *   - Calls dispatchAnomalyNotification() for each recipient.
 *   - Fully fire-and-forget: errors are caught and logged; they never propagate
 *     back to the engine or the HTTP caller.
 *
 * Extending notifications:
 *   Replace the body of dispatchAnomalyNotification() with a real provider
 *   (Resend, Supabase Realtime, OneSignal, Slack webhook, etc.).
 *
 * Registration:
 *   Call registerAnomalyHandlers(supabase) ONCE at server startup, AFTER the
 *   Supabase plugin has been registered so the client is ready.
 *   Calling it twice registers duplicate handlers — call it exactly once.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventService }        from './event-service.js'
import type { AttendanceUpdatedPayload } from './event-service.js'
import { notify }              from './notify.js'

// ── Notification types ─────────────────────────────────────────────────────────

export type AnomalyNotificationType = 'missing_out' | 'no_punch' | 'late' | 'excessive_hours'

export interface AnomalyNotificationPayload {
  /** Who is being notified */
  recipientRole:  'employee' | 'manager'
  /** Employee UUID of the notification recipient */
  recipientId:    string
  /** Employee UUID of the person whose attendance triggered the anomaly */
  employeeId:     string
  tenantId:       string
  date:           string   // YYYY-MM-DD
  type:           AnomalyNotificationType
  severity:       'low' | 'medium' | 'high'
  message:        string
}

// ── Readable labels ────────────────────────────────────────────────────────────

const ANOMALY_LABEL: Record<AnomalyNotificationType, string> = {
  missing_out:      'Missing OUT punch',
  no_punch:         'No punch recorded',
  late:             'Late arrival',
  excessive_hours:  'Excessive hours logged',
}

// ── Core dispatch ─────────────────────────────────────────────────────────────

/**
 * Dispatch one anomaly notification to one recipient via the inbox.
 * Inserts an inbox_items row so the recipient sees it in their notification bell.
 * Must never throw — errors are swallowed to keep the handler fire-and-forget.
 */
async function dispatchAnomalyNotification(
  supabase: SupabaseClient,
  payload:  AnomalyNotificationPayload,
): Promise<void> {
  const severityMap: Record<string, 'info' | 'warning' | 'error'> = {
    high:   'error',
    medium: 'warning',
    low:    'info',
  }

  await notify(supabase, {
    tenantId:     payload.tenantId,
    recipientId:  payload.recipientId,
    item_type:    'incident_alert',
    title:        `Attendance Alert: ${ANOMALY_LABEL[payload.type] ?? payload.type}`,
    summary:      payload.message,
    severity:     severityMap[payload.severity] ?? 'info',
    entity_type:  'attendance_anomalies',
    action_route: '/attendance',
    metadata: {
      anomaly_type:   payload.type,
      employee_id:    payload.employeeId,
      date:           payload.date,
      recipient_role: payload.recipientRole,
    },
  })
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

interface AnomalyRow {
  type:     string
  severity: string
  message:  string
}

/**
 * Fetch unresolved anomalies for an employee on a specific date.
 * Returns only anomalies that haven't been resolved yet.
 */
async function fetchUnresolvedAnomalies(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  date:       string,
): Promise<AnomalyRow[]> {
  const { data, error } = await supabase
    .from('attendance_anomalies')
    .select('type, severity, message')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .eq('resolved', false)

  if (error) {
    console.warn(JSON.stringify({
      level:       'warn',
      service:     'anomaly-handler',
      action:      'fetch_anomalies_failed',
      tenant_id:   tenantId,
      employee_id: employeeId,
      date,
      error:       error.message,
    }))
    return []
  }

  return ((data ?? []) as Array<{ type: string; severity: string; message: string }>)
}

/**
 * Resolve the current reporting manager's employee_id for a given employee.
 * Returns null if no current job_history row or no manager assigned.
 */
async function fetchManagerEmployeeId(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('job_history')
    .select('manager_id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('is_current', true)
    .maybeSingle()

  return (data as { manager_id: string | null } | null)?.manager_id ?? null
}

// ── Main handler logic ─────────────────────────────────────────────────────────

/**
 * Process an 'attendance.updated' event — fetch anomalies and notify
 * the employee and their manager for each unresolved anomaly.
 *
 * Fire-and-forget internally: all errors are caught and logged.
 */
async function handleAttendanceUpdated(
  supabase: SupabaseClient,
  payload:  AttendanceUpdatedPayload,
): Promise<void> {
  const { tenant_id, employee_id, date } = payload

  // Fetch anomalies + manager in parallel
  const [anomalies, managerEmployeeId] = await Promise.all([
    fetchUnresolvedAnomalies(supabase, tenant_id, employee_id, date),
    fetchManagerEmployeeId(supabase, tenant_id, employee_id),
  ])

  if (anomalies.length === 0) return   // nothing to notify

  // Dispatch one notification per anomaly, per recipient (employee + manager)
  const notifyPs: Promise<void>[] = []

  for (const anomaly of anomalies) {
    const type     = anomaly.type as AnomalyNotificationType
    const severity = anomaly.severity as 'low' | 'medium' | 'high'
    const message  = anomaly.message

    // Notify the employee themselves
    notifyPs.push(
      dispatchAnomalyNotification(supabase, {
        recipientRole: 'employee',
        recipientId:   employee_id,
        employeeId:    employee_id,
        tenantId:      tenant_id,
        date,
        type,
        severity,
        message,
      }),
    )

    // Notify the manager (if one is configured)
    if (managerEmployeeId) {
      notifyPs.push(
        dispatchAnomalyNotification(supabase, {
          recipientRole: 'manager',
          recipientId:   managerEmployeeId,
          employeeId:    employee_id,
          tenantId:      tenant_id,
          date,
          type,
          severity,
          message,
        }),
      )
    }
  }

  // Wait for all dispatches — individual failures are swallowed by
  // dispatchAnomalyNotification so allSettled is not strictly needed,
  // but we use it to guarantee all attempts complete before logging.
  await Promise.allSettled(notifyPs)
}

// ── Registration ───────────────────────────────────────────────────────────────

/**
 * Register the attendance anomaly event handler against the shared EventService.
 *
 * Call this ONCE at server startup, after the Supabase plugin has been
 * registered so the service-role client is available.  The supabase client
 * is captured in the closure — it is the same instance for the lifetime of
 * the process.
 *
 * @param supabase  Service-role Supabase client (from fastify.supabase or equivalent)
 */
export function registerAnomalyHandlers(supabase: SupabaseClient): void {
  eventService.registerHandler('attendance.updated', async (payload: AttendanceUpdatedPayload) => {
    try {
      await handleAttendanceUpdated(supabase, payload)
    } catch (err) {
      // Swallow — notification failures must never surface to callers
      console.error(JSON.stringify({
        level:       'error',
        service:     'anomaly-handler',
        action:      'handler_error',
        tenant_id:   payload.tenant_id,
        employee_id: payload.employee_id,
        date:        payload.date,
        error:       err instanceof Error ? err.message : String(err),
      }))
    }
  })

  console.log(JSON.stringify({
    level:   'info',
    service: 'anomaly-handler',
    action:  'handlers_registered',
    events:  ['attendance.updated'],
  }))
}
