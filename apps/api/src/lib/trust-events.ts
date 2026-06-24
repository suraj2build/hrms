/**
 * trust-events.ts — typed emitters for all Trust Intelligence events.
 *
 * Keeps trust event emission logic in one place so callers never hand-roll
 * event shapes. Each function maps to exactly one entry in HrmsEventMap.
 *
 * dispatchTrustLifecycleEvent() also writes to onboarding_lifecycle_events
 * so trust signals appear in the employee's journey Timeline (O5.5 contract).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { eventBus }            from './event-bus.js'
import type { HrmsEventMap }   from './event-bus.js'

// ── Re-export so callers don't need to import from event-bus directly ─────────

export type TrustEventType =
  | 'trust.score.computed'
  | 'trust.verification.completed'
  | 'trust.verification.failed'
  | 'trust.risk.raised'
  | 'trust.risk.cleared'
  | 'trust.duplicate.detected'

// ── Individual typed emitters ─────────────────────────────────────────────────

export function emitTrustScoreComputed(
  payload: HrmsEventMap['trust.score.computed'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.score.computed', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

export function emitTrustVerificationCompleted(
  payload: HrmsEventMap['trust.verification.completed'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.verification.completed', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

export function emitTrustVerificationFailed(
  payload: HrmsEventMap['trust.verification.failed'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.verification.failed', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

export function emitTrustRiskRaised(
  payload: HrmsEventMap['trust.risk.raised'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.risk.raised', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

export function emitTrustRiskCleared(
  payload: HrmsEventMap['trust.risk.cleared'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.risk.cleared', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

export function emitTrustDuplicateDetected(
  payload: HrmsEventMap['trust.duplicate.detected'],
  correlationId?: string,
): void {
  eventBus.emit({ type: 'trust.duplicate.detected', tenantId: payload.tenantId, payload, correlationId: correlationId ?? 'system' })
}

// ── Timeline bridge (O5.5) ────────────────────────────────────────────────────
//
// Trust signals that are material to the employee journey are written to
// onboarding_lifecycle_events so they surface in LifecycleTimeline / fetchTimeline.
// This is a best-effort write: failures are logged but never rethrow.

export interface TrustLifecycleEventOpts {
  supabase:       SupabaseClient
  tenantId:       string
  employeeId:     string | null
  sessionId?:     string | null
  eventType:      TrustEventType
  title:          string
  description?:   string
  severity?:      'info' | 'success' | 'warning' | 'critical'
  payload?:       Record<string, unknown>
}

export async function dispatchTrustLifecycleEvent(opts: TrustLifecycleEventOpts): Promise<void> {
  if (!opts.employeeId && !opts.sessionId) return

  const category = deriveTrustCategory(opts.eventType)
  const severity  = opts.severity ?? deriveTrustSeverity(opts.eventType)

  const { error } = await opts.supabase.from('onboarding_lifecycle_events').insert({
    tenant_id:   opts.tenantId,
    employee_id: opts.employeeId,
    session_id:  opts.sessionId ?? null,
    event_type:  opts.eventType,
    title:       opts.title,
    detail:      opts.description ?? null,
    severity,
    occurred_at: new Date().toISOString(),
  })

  if (error) {
    console.warn('[trust-events] lifecycle write failed:', error.message)
  }
}

function deriveTrustCategory(eventType: TrustEventType): string {
  switch (eventType) {
    case 'trust.score.computed':         return 'system'
    case 'trust.verification.completed': return 'verification'
    case 'trust.verification.failed':    return 'exception'
    case 'trust.risk.raised':            return 'exception'
    case 'trust.risk.cleared':           return 'action'
    case 'trust.duplicate.detected':     return 'exception'
  }
}

function deriveTrustSeverity(eventType: TrustEventType): 'info' | 'success' | 'warning' | 'critical' {
  switch (eventType) {
    case 'trust.score.computed':         return 'info'
    case 'trust.verification.completed': return 'success'
    case 'trust.verification.failed':    return 'warning'
    case 'trust.risk.raised':            return 'warning'
    case 'trust.risk.cleared':           return 'info'
    case 'trust.duplicate.detected':     return 'critical'
  }
}
