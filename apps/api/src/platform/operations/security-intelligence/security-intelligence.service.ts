/**
 * SecurityIntelligenceService — passive workforce security signal detection.
 * Observes event patterns for suspicious admin behavior, excessive overrides, etc.
 * PASSIVE ONLY — alerts and incidents only, never blocks operations.
 */
import type { SecurityIntelligenceEvent, SecuritySignalType } from '../types/operations-types.js'
import type { ResolvedPlatformEvent }                         from '../../events/types/platform-event.js'
import { explainabilityService }                              from '../../ai/services/explainability.service.js'

export class SecurityIntelligenceService {
  // Track per-actor event counts in a short rolling window
  private actorCounts: Map<string, { count: number; window_start: number }> = new Map()
  private readonly events: SecurityIntelligenceEvent[] = []

  /** Analyse an event for security signals. */
  analyse(event: ResolvedPlatformEvent): SecurityIntelligenceEvent | null {
    if (!event.actor_id) return null

    const windowMs = 5 * 60 * 1000  // 5-minute window
    const now = Date.now()
    const key = `${event.tenant_id}:${event.actor_id}:${event.event_type}`
    const existing = this.actorCounts.get(key)

    if (existing && (now - existing.window_start) < windowMs) {
      existing.count++
    } else {
      this.actorCounts.set(key, { count: 1, window_start: now })
    }

    const count = this.actorCounts.get(key)?.count ?? 1

    // Detect unusual approval velocity — Phase 6: raised from 10 to 15 to reduce false positives
    if ((event.event_type === 'leave.approved') && count > 15) {
      return this.buildSignal('unusual_approval_velocity', event, 'high',
        `Actor ${event.actor_id.slice(0, 8)} approved ${count} leave requests in 5 minutes`)
    }

    // Detect excessive compensation overrides — Phase 6: raised from 5 to 8
    if (event.event_type === 'compensation.revision.approved' && count > 8) {
      return this.buildSignal('excessive_override', event, 'high',
        `Actor ${event.actor_id.slice(0, 8)} approved ${count} compensation revisions in 5 minutes`)
    }

    // Detect repeated escalation bypass — Phase 6: raised from 3 to 5
    if (event.event_type === 'payroll.run.finalized' && count > 5) {
      return this.buildSignal('escalation_bypass', event, 'warning',
        `${count} payroll runs finalized by same actor in short window`)
    }

    return null
  }

  private buildSignal(type: SecuritySignalType, event: ResolvedPlatformEvent, severity: 'warning' | 'high' | 'critical', description: string): SecurityIntelligenceEvent {
    const signal: SecurityIntelligenceEvent = {
      signal_type:  type,
      entity_id:    event.actor_id!,
      entity_type:  'user',
      tenant_id:       event.tenant_id,
      severity,
      description,
      detected_at:  new Date().toISOString(),
      metadata:     { event_type: event.event_type, entity_id: event.entity_id },
      explainability: explainabilityService.explain({
        event_type:  `security.${type}`,
        entity_type: 'user',
        entity_id:   event.actor_id!,
        payload:     { signal: type, description },
        severity,
      }),
    }
    this.events.push(signal)
    return signal
  }

  getEvents(orgId?: string, limit = 50): SecurityIntelligenceEvent[] {
    const all = orgId ? this.events.filter(e => e.tenant_id === orgId) : this.events
    return all.slice(-limit)
  }

  clearWindow(): void { this.actorCounts.clear() }
}

export const securityIntelligenceService = new SecurityIntelligenceService()
