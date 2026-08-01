/**
 * HR Event Emitter
 * Writes events to hr_events table and fans out notifications to relevant recipients.
 * Import and call emitEvent() from route handlers after successful mutations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { durableQueue }        from './durable-queue.js'
import { logger }              from './logger.js'

// ── Event type registry ────────────────────────────────────────────────────

export type HrEventType =
  | 'leave.approved'
  | 'leave.rejected'
  | 'leave.applied'
  | 'correction.applied'
  | 'correction.rejected'
  | 'correction.submitted'
  | 'shift.changed'
  | 'anomaly.detected'
  | 'payroll.locked'
  | 'payroll.unlocked'
  | 'payroll.finalized'
  | 'processing.failed'

export interface EmitEventOptions {
  supabase:    SupabaseClient
  tenantId:    string
  eventType:   HrEventType
  payload?:    Record<string, unknown>
  actorId?:    string | null
  targetType?: 'employee' | 'team' | 'all'
  targetId?:   string | null        // employee_id when targetType='employee'
  // Notification fan-out
  notifications?: NotificationSpec[]
}

export interface NotificationSpec {
  recipientId: string
  title:       string
  body:        string
  link?:       string
}

// ── Shared insert-and-fan-out logic ─────────────────────────────────────────
// Extracted so the durable-queue retry handler (registered in index.ts as
// 'emit-hr-event') can re-run exactly the same insert+fan-out, not just the
// hr_events insert — notifications.event_id is a NOT NULL FK to hr_events
// (migration 066_hr_events.sql), so the two can never be split into
// independently-retriable halves.
export interface InsertEventAndFanOutOpts {
  supabase:      SupabaseClient
  tenantId:      string
  eventType:     HrEventType
  payload:       Record<string, unknown>
  actorId:       string | null
  targetType:    'employee' | 'team' | 'all' | null
  targetId:      string | null
  notifications: NotificationSpec[]
}

export async function insertEventAndFanOut(opts: InsertEventAndFanOutOpts): Promise<void> {
  const { supabase, tenantId, eventType, payload, actorId, targetType, targetId, notifications } = opts

  const { data: event, error: eventErr } = await supabase
    .from('hr_events')
    .insert({
      tenant_id:   tenantId,
      event_type:  eventType,
      payload,
      actor_id:    actorId,
      target_type: targetType,
      target_id:   targetId,
    })
    .select('id')
    .single()

  if (eventErr || !event) {
    throw new Error(`Failed to insert hr_event: ${eventErr?.message ?? 'no row returned'}`)
  }

  if (notifications.length === 0) return

  const notifRows = notifications.map(n => ({
    tenant_id:    tenantId,
    recipient_id: n.recipientId,
    event_id:     event.id,
    title:        n.title,
    body:         n.body,
    link:         n.link ?? null,
  }))

  const { error: notifErr } = await supabase
    .from('notifications')
    .insert(notifRows)

  if (notifErr) {
    logger.error({ err: notifErr }, '[event-emitter] Failed to insert notifications')
  }
}

// ── Main function ──────────────────────────────────────────────────────────

export async function emitEvent(opts: EmitEventOptions): Promise<void> {
  const {
    supabase, tenantId, eventType,
    payload = {}, actorId = null,
    targetType = null, targetId = null,
    notifications = [],
  } = opts

  try {
    await insertEventAndFanOut({ supabase, tenantId, eventType, payload, actorId, targetType, targetId, notifications })
  } catch {
    // hr_events insert failed. A bare log-and-drop here would silently lose
    // the caller-supplied notification fan-out too (see InsertEventAndFanOutOpts
    // comment above) — instead, defer the whole emit to the durable queue's
    // own retry/backoff/dead-letter path (durable-queue.ts) via the
    // 'emit-hr-event' handler registered in index.ts, so a transient DB
    // hiccup gets a real second chance instead of a bare console line.
    await durableQueue.enqueue('emit-hr-event', {
      tenant_id:   tenantId,
      event_type:  eventType,
      payload,
      actor_id:    actorId,
      target_type: targetType,
      target_id:   targetId,
      notifications,
    }, { tenantId }).catch(enqueueErr => {
      logger.error({ err: enqueueErr }, '[event-emitter] Failed to enqueue retry for failed emit')
    })
  }
}
