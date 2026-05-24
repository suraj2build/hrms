/**
 * EventService — lightweight in-process event bus.
 *
 * Design principles:
 *  - Singleton: one shared instance across the entire API process.
 *  - Multiple handlers per event: stored as ordered arrays, all fire on emit.
 *  - Async-safe: each handler runs inside its own Promise chain so a slow or
 *    throwing handler never blocks emit() or other handlers.
 *  - Error isolation: an exception in one handler is caught, logged, and
 *    discarded — it does NOT propagate to the caller or other handlers.
 *  - Fire-and-forget: emit() is synchronous from the caller's perspective;
 *    it schedules handlers as microtasks and returns immediately.
 *  - Logging: every emission and every handler error is structured-logged.
 *
 * Typed event map (EventMap):
 *  Extend this interface to add new event names and their payload shapes.
 *  The generic helpers (emit / registerHandler) enforce payload types at
 *  compile time so callers cannot pass the wrong shape.
 *
 * Usage:
 *   // Register
 *   eventService.registerHandler('leave.approved', async (payload) => { ... })
 *
 *   // Emit (non-blocking)
 *   eventService.emit('leave.approved', { tenant_id, employee_id, ... })
 */

// ── Typed event map ────────────────────────────────────────────────────────────

/**
 * Approval event payload — shared by leave.approved, leave.rejected,
 * regularisation.approved, regularisation.rejected.
 */
export interface ApprovalEventPayload {
  /** Database tenant */
  tenant_id:      string
  /** Employee who made the request (recipient of the notification) */
  employee_id:    string
  /** Primary key of the leave_request or attendance_regularisation row */
  request_id:     string
  /** Discriminates the originating entity */
  type:           'leave' | 'regularisation'
  /** Number of days involved — leave only */
  computed_days?: number
  /** profiles.id of the person who approved/rejected */
  actor_id:       string
  // ── Optional notification metadata ──────────────────────────────────────────
  leave_type?:    string   // leave_types.name
  from_date?:     string   // YYYY-MM-DD
  to_date?:       string   // YYYY-MM-DD
  date?:          string   // YYYY-MM-DD (regularisation)
}

/** Roster CSV upload event payload */
export interface RosterUploadedPayload {
  tenant_id:      string
  rows_processed: number
  rows_failed:    number
}

/** Leave cancelled by employee payload */
export interface LeaveCancelledPayload {
  tenant_id:   string
  employee_id: string
  request_id:  string
  from_date:   string
  to_date:     string
  leave_type?: string
}

/**
 * Emitted by the AttendanceEngine whenever a row in attendance_daily
 * changes its status OR day_fraction.  Consumers (e.g. notification
 * handlers, payroll pre-checks) can subscribe without coupling to the
 * engine internals.
 */
export interface AttendanceUpdatedPayload {
  tenant_id:    string
  employee_id:  string
  /** YYYY-MM-DD */
  date:         string
  old_status:   string | null   // null when the row is brand-new
  new_status:   string
  day_fraction: number          // 0.0 | 0.5 | 1.0
}

/**
 * Master event map — maps event name → payload type.
 * Add new events here to get compile-time safety everywhere.
 */
export interface EventMap {
  'leave.approved':            ApprovalEventPayload
  'leave.rejected':            ApprovalEventPayload
  'leave.cancelled':           LeaveCancelledPayload
  'regularisation.approved':   ApprovalEventPayload
  'regularisation.rejected':   ApprovalEventPayload
  'roster.uploaded':           RosterUploadedPayload
  'attendance.updated':        AttendanceUpdatedPayload
}

// ── Internal types ─────────────────────────────────────────────────────────────

type EventName    = keyof EventMap
type Handler<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>

// ── EventService class ─────────────────────────────────────────────────────────

class EventService {
  /** Internal handler registry — one array per event name */
  private readonly handlers = new Map<EventName, Handler<EventName>[]>()

  /**
   * Register a handler for an event.
   * Multiple handlers may be registered for the same event; they all fire
   * in registration order on each emit.
   *
   * @param eventName  The event to subscribe to
   * @param handler    Sync or async callback
   */
  registerHandler<K extends EventName>(eventName: K, handler: Handler<K>): void {
    const list = this.handlers.get(eventName) ?? []
    list.push(handler as Handler<EventName>)
    this.handlers.set(eventName, list)

    console.log(JSON.stringify({
      level:   'debug',
      service: 'event',
      action:  'handler_registered',
      event:   eventName,
      total:   list.length,
    }))
  }

  /**
   * Emit an event and fire all registered handlers asynchronously.
   *
   * emit() returns immediately — handlers run as independent microtasks.
   * Errors thrown by individual handlers are caught and logged; they do NOT
   * propagate to the caller or abort remaining handlers.
   *
   * @param eventName  Name of the event
   * @param payload    Strongly-typed payload (enforced by EventMap)
   */
  emit<K extends EventName>(eventName: K, payload: EventMap[K]): void {
    // Structured log — useful for debugging without a real event broker
    console.log(JSON.stringify({
      level:   'info',
      service: 'event',
      action:  'emit',
      event:   eventName,
      payload,
    }))

    const list = this.handlers.get(eventName) ?? []

    if (list.length === 0) {
      console.log(JSON.stringify({
        level:   'debug',
        service: 'event',
        action:  'no_handlers',
        event:   eventName,
      }))
      return
    }

    // Fire each handler independently — one per microtask, each with its own
    // error boundary so a broken handler never stops the others.
    for (let i = 0; i < list.length; i++) {
      const handler      = list[i]
      const handlerIndex = i

      Promise.resolve()
        .then(() => handler(payload))
        .catch((err: unknown) => {
          console.error(JSON.stringify({
            level:   'error',
            service: 'event',
            action:  'handler_error',
            event:   eventName,
            handler: handlerIndex,
            error:   err instanceof Error ? err.message : String(err),
          }))
        })
    }
  }

  /** Return how many handlers are registered for an event (test utility). */
  handlerCount(eventName: EventName): number {
    return this.handlers.get(eventName)?.length ?? 0
  }
}

// ── Singleton export ───────────────────────────────────────────────────────────

/** The shared EventService instance. Import this everywhere. */
export const eventService = new EventService()
