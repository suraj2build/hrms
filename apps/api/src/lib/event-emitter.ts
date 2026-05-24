/**
 * HR Event Emitter
 * Writes events to hr_events table and fans out notifications to relevant recipients.
 * Import and call emitEvent() from route handlers after successful mutations.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

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

// ── Main function ──────────────────────────────────────────────────────────

export async function emitEvent(opts: EmitEventOptions): Promise<void> {
  const {
    supabase, tenantId, eventType,
    payload = {}, actorId = null,
    targetType = null, targetId = null,
    notifications = [],
  } = opts

  // 1. Insert hr_event row
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
    // Non-fatal — log but don't throw (event bus failure shouldn't break core operations)
    console.error('[event-emitter] Failed to insert hr_event:', eventErr?.message)
    return
  }

  // 2. Fan out notifications (if any)
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
    console.error('[event-emitter] Failed to insert notifications:', notifErr?.message)
  }
}
