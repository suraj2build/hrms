/**
 * NotificationService — approval event → notification dispatcher.
 *
 * Architecture (event-driven):
 *   Handlers are registered against the EventService bus.  When ApprovalService
 *   emits 'leave.approved', 'leave.rejected', etc., the corresponding handler
 *   here fires automatically and calls notifyApprovalDecision().
 *
 *   This keeps the notification concern fully decoupled from the approval flow:
 *   ApprovalService only knows about events — it has no direct dependency on
 *   this file.  Swapping out the notification provider only requires changes here.
 *
 * Fire-and-forget guarantee:
 *   Each handler wraps its work in try/catch so errors are swallowed.  A
 *   notification failure never surfaces to the approval caller.
 *
 * Registration:
 *   Call registerNotificationHandlers() once at server startup (see index.ts).
 *   The function is idempotent — calling it twice registers duplicate handlers,
 *   so call it exactly once.
 *
 * Extending:
 *   Replace the body of dispatch() with a real provider such as Resend (email),
 *   OneSignal (push), or Supabase Realtime (in-app).
 */

import type { SupabaseClient }                   from '@supabase/supabase-js'
import { eventService }                          from './event-service.js'
import type { ApprovalEventPayload,
              LeaveCancelledPayload }             from './event-service.js'
import { notify }                                from './notify.js'

// ── Notification payload ───────────────────────────────────────────────────────

export type ApprovalEventType =
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'regularisation_approved'
  | 'regularisation_rejected'

export interface ApprovalNotificationPayload {
  /** Discriminates the action that occurred */
  type:       ApprovalEventType
  tenantId:   string
  /** Employee who submitted the request (notification recipient) */
  employeeId: string
  /** Primary key of the leave_request or attendance_regularisation row */
  requestId:  string
  /** profiles.id of the person who approved/rejected */
  actorId:    string
  /** Optional metadata (dates, type names, etc.) for the message body */
  metadata?:  Record<string, unknown>
}

// ── Module-level state ─────────────────────────────────────────────────────────

// Supabase client injected at registration time (see registerNotificationHandlers).
let _supabase: SupabaseClient | null = null

// ── Internal helpers ───────────────────────────────────────────────────────────

const EVENT_LABEL: Record<ApprovalEventType, string> = {
  leave_approved:            'Leave request approved',
  leave_rejected:            'Leave request rejected',
  leave_cancelled:           'Leave request cancelled',
  regularisation_approved:   'Attendance correction approved',
  regularisation_rejected:   'Attendance correction rejected',
}

const INBOX_DETAILS: Record<ApprovalEventType, { entityType: string; actionRoute: string }> = {
  leave_approved:            { entityType: 'leave_request',               actionRoute: '/ess/leave'        },
  leave_rejected:            { entityType: 'leave_request',               actionRoute: '/ess/leave'        },
  leave_cancelled:           { entityType: 'leave_request',               actionRoute: '/ess/leave'        },
  regularisation_approved:   { entityType: 'attendance_regularisation',   actionRoute: '/ess/attendance'   },
  regularisation_rejected:   { entityType: 'attendance_regularisation',   actionRoute: '/ess/attendance'   },
}

function buildSummary(payload: ApprovalNotificationPayload): string {
  const m = payload.metadata ?? {}
  switch (payload.type) {
    case 'leave_approved':
    case 'leave_rejected': {
      const lt    = m.leave_type ? ` (${m.leave_type})` : ''
      const dates = m.from_date && m.to_date ? `: ${m.from_date} – ${m.to_date}` : ''
      const verb  = payload.type === 'leave_approved' ? 'approved' : 'rejected'
      return `Your leave request${lt}${dates} has been ${verb}.`
    }
    case 'leave_cancelled':
      return `Your leave request has been cancelled.`
    case 'regularisation_approved':
    case 'regularisation_rejected': {
      const date = m.date ? ` for ${m.date}` : ''
      const verb = payload.type === 'regularisation_approved' ? 'approved' : 'rejected'
      return `Your attendance correction${date} has been ${verb}.`
    }
    default:
      return EVENT_LABEL[payload.type]
  }
}

/**
 * Core dispatcher — writes an inbox_items row so the employee sees the decision
 * in their notification bell. Must never throw.
 *
 * Future channels (email, WhatsApp, push) can be added here alongside the
 * inbox write without changing any call sites.
 */
async function dispatch(payload: ApprovalNotificationPayload): Promise<void> {
  if (!_supabase) return   // supabase not yet injected; skip silently

  // inbox_items.recipient_id expects profiles.id, but the event carries
  // employees.id (the HR entity key). Resolve via profiles.employee_id.
  const { data: prof } = await _supabase
    .from('profiles')
    .select('id')
    .eq('employee_id', payload.employeeId)
    .eq('tenant_id',   payload.tenantId)
    .maybeSingle()

  if (!prof) {
    console.warn(JSON.stringify({ level: 'warn', service: 'notification', msg: 'profile_not_found', employeeId: payload.employeeId, tenantId: payload.tenantId, type: payload.type }))
    return
  }

  const details = INBOX_DETAILS[payload.type]

  await notify(_supabase, {
    tenantId:     payload.tenantId,
    recipientId:  (prof as any).id,
    senderId:     payload.actorId,
    item_type:    'approval_request',
    title:        EVENT_LABEL[payload.type],
    summary:      buildSummary(payload),
    severity:     'info',
    entity_type:  details.entityType,
    entity_id:    payload.requestId,
    action_route: details.actionRoute,
    action_label: 'View Request',
    metadata:     payload.metadata,
  })
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send an approval/rejection notification to the affected employee.
 * Fire-and-forget — awaited internally, errors swallowed.
 */
export async function notifyApprovalDecision(
  payload: ApprovalNotificationPayload,
): Promise<void> {
  try {
    await dispatch(payload)
  } catch {
    // Intentionally swallowed — notification failures must not block approvals.
  }
}

// ── Event handler registration ─────────────────────────────────────────────────

/**
 * Register all approval event handlers against the shared EventService.
 *
 * Call this ONCE at server startup (before the first request is handled).
 * After registration, whenever ApprovalService emits 'leave.approved' etc.,
 * the corresponding handler here fires and calls notifyApprovalDecision().
 *
 * Each handler is independently fire-and-forget:
 *   - Errors are caught inside notifyApprovalDecision() and swallowed.
 *   - A broken handler does not affect other handlers or the caller.
 */
export function registerNotificationHandlers(supabase: SupabaseClient): void {
  _supabase = supabase
  // ── leave.approved ──────────────────────────────────────────────────────────
  eventService.registerHandler('leave.approved', async (payload: ApprovalEventPayload) => {
    await notifyApprovalDecision({
      type:       'leave_approved',
      tenantId:   payload.tenant_id,
      employeeId: payload.employee_id,
      requestId:  payload.request_id,
      actorId:    payload.actor_id,
      metadata: {
        leave_type:    payload.leave_type,
        from_date:     payload.from_date,
        to_date:       payload.to_date,
        computed_days: payload.computed_days,
      },
    })
  })

  // ── leave.rejected ──────────────────────────────────────────────────────────
  eventService.registerHandler('leave.rejected', async (payload: ApprovalEventPayload) => {
    await notifyApprovalDecision({
      type:       'leave_rejected',
      tenantId:   payload.tenant_id,
      employeeId: payload.employee_id,
      requestId:  payload.request_id,
      actorId:    payload.actor_id,
      metadata: {
        leave_type: payload.leave_type,
        from_date:  payload.from_date,
        to_date:    payload.to_date,
      },
    })
  })

  // ── regularisation.approved ─────────────────────────────────────────────────
  eventService.registerHandler('regularisation.approved', async (payload: ApprovalEventPayload) => {
    await notifyApprovalDecision({
      type:       'regularisation_approved',
      tenantId:   payload.tenant_id,
      employeeId: payload.employee_id,
      requestId:  payload.request_id,
      actorId:    payload.actor_id,
      metadata:   { date: payload.date },
    })
  })

  // ── regularisation.rejected ─────────────────────────────────────────────────
  eventService.registerHandler('regularisation.rejected', async (payload: ApprovalEventPayload) => {
    await notifyApprovalDecision({
      type:       'regularisation_rejected',
      tenantId:   payload.tenant_id,
      employeeId: payload.employee_id,
      requestId:  payload.request_id,
      actorId:    payload.actor_id,
      metadata:   { date: payload.date },
    })
  })

  // ── leave.cancelled ──────────────────────────────────────────────────────────
  eventService.registerHandler('leave.cancelled', async (payload: LeaveCancelledPayload) => {
    await notifyApprovalDecision({
      type:       'leave_cancelled',
      tenantId:   payload.tenant_id,
      employeeId: payload.employee_id,
      requestId:  payload.request_id,
      actorId:    payload.employee_id,  // canceller is the employee themselves
      metadata: {
        leave_type: payload.leave_type,
        from_date:  payload.from_date,
        to_date:    payload.to_date,
      },
    })
  })

  console.log(JSON.stringify({
    level:   'info',
    service: 'notification',
    action:  'handlers_registered',
    events:  ['leave.approved', 'leave.rejected', 'leave.cancelled', 'regularisation.approved', 'regularisation.rejected'],
  }))
}
