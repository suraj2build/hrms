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

import { eventService }                          from './event-service.js'
import type { ApprovalEventPayload,
              LeaveCancelledPayload }             from './event-service.js'

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

// ── Internal helpers ───────────────────────────────────────────────────────────

const EVENT_LABEL: Record<ApprovalEventType, string> = {
  leave_approved:            'Leave request approved',
  leave_rejected:            'Leave request rejected',
  leave_cancelled:           'Leave request cancelled',
  regularisation_approved:   'Attendance correction approved',
  regularisation_rejected:   'Attendance correction rejected',
}

/**
 * Core dispatch stub — replace with a real provider when ready.
 * Must never throw.
 */
async function dispatch(payload: ApprovalNotificationPayload): Promise<void> {
  // ── TODO: integrate real notification provider ──────────────────────────────
  //
  // Example with Resend (email):
  //   await resend.emails.send({
  //     from:    'noreply@yourhrms.com',
  //     to:      employeeEmail,
  //     subject: EVENT_LABEL[payload.type],
  //     html:    renderApprovalEmail(payload),
  //   })
  //
  // Example with Supabase Realtime (in-app):
  //   await supabase.channel('notifications').send({
  //     type: 'broadcast', event: payload.type, payload,
  //   })
  //
  // ───────────────────────────────────────────────────────────────────────────

  // Structured log — makes events observable even without a real provider
  console.log(JSON.stringify({
    level:       'info',
    service:     'notification',
    event:       payload.type,
    label:       EVENT_LABEL[payload.type],
    tenant_id:   payload.tenantId,
    employee_id: payload.employeeId,
    request_id:  payload.requestId,
    actor_id:    payload.actorId,
    ...(payload.metadata ?? {}),
  }))
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
export function registerNotificationHandlers(): void {
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
