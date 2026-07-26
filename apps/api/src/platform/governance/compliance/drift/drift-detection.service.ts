/**
 * DriftDetectionService — detects governance drift signals from event patterns.
 *
 * In-memory sliding-window counters (Sprint 2: simple counter approach).
 * Passive only — signals, never blocks.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { ResolvedPlatformEvent } from '../../../events/types/platform-event.js'
import type { EventSeverity }         from '../../../events/types/platform-event.js'
import type { ExplainabilityResult }  from '../../../ai/types/explainability.js'
import { explainabilityService }      from '../../../ai/services/explainability.service.js'

export type DriftSignal =
  | 'override_growth'
  | 'attendance_modification_spike'
  | 'approval_bypass'
  | 'escalation_frequency'
  | 'policy_inconsistency'
  | 'config_staleness'

export interface DriftDetectionResult {
  drift_detected:  boolean
  signal:          DriftSignal
  severity:        EventSeverity
  description:     string
  affected_module: string
  entity_id?:      string
  explainability?: ExplainabilityResult
}

const WINDOW_MS = 60 * 60 * 1000 // 1 hour

export class DriftDetectionService {
  /**
   * In-memory sliding-window timestamps keyed by `tenant_id:event_type`.
   * Previously a bare lifetime counter that only ever grew (no decay) — once
   * a tenant crossed a threshold once (e.g. its 6th payroll finalize ever),
   * every subsequent event of that type re-fired the same "drift" alert
   * forever, turning a spike detector into a permanent false-positive after
   * one crossing. Now only events within the last hour count toward the
   * threshold, matching the "sliding window" behavior the class doc claims.
   */
  private timestamps: Map<string, number[]> = new Map()

  private bump(key: string): number {
    const now = Date.now()
    const recent = (this.timestamps.get(key) ?? []).filter(t => now - t < WINDOW_MS)
    recent.push(now)
    this.timestamps.set(key, recent)
    return recent.length
  }

  /**
   * Analyse an incoming event for drift signals.
   * Returns a result if drift is detected, null otherwise.
   */
  analyse(event: ResolvedPlatformEvent): DriftDetectionResult | null {
    const orgKey = `${event.tenant_id}:${event.event_type}`
    const count = this.bump(orgKey)

    // Override growth: many payroll runs in short window
    if (event.event_type === 'payroll.run.finalized' && count > 5) {
      return this.buildResult(
        'override_growth', 'warning', 'payroll',
        'Elevated payroll run finalization frequency detected',
        event,
      )
    }

    // Regularization spike
    if (
      event.event_type === 'attendance.logged' &&
      event.payload?.correction === true &&
      count > 20
    ) {
      return this.buildResult(
        'attendance_modification_spike', 'high', 'attendance',
        'Attendance modification spike detected',
        event,
      )
    }

    // Compensation spike — Phase 6: require count >= 3 to reduce false positives
    if (event.event_type === 'compensation.revision.approved') {
      const delta = (event.payload?.delta_pct as number) ?? 0
      if (delta > 50 && count >= 3) {
        return this.buildResult(
          'policy_inconsistency', 'high', 'compensation',
          `Unusually large compensation revision: ${delta.toFixed(1)}% increase`,
          event,
        )
      }
    }

    return null
  }

  private buildResult(
    signal:      DriftSignal,
    severity:    EventSeverity,
    module:      string,
    description: string,
    event:       ResolvedPlatformEvent,
  ): DriftDetectionResult {
    return {
      drift_detected:  true,
      signal,
      severity,
      description,
      affected_module: module,
      entity_id:       event.entity_id,
      explainability:  explainabilityService.explain({
        event_type:  event.event_type,
        entity_type: event.entity_type,
        entity_id:   event.entity_id,
        payload:     event.payload,
        rule_name:   signal,
        severity,
      }),
    }
  }

  /** Reset all counters — used for testing or session resets. */
  resetCounters(): void {
    this.timestamps.clear()
  }
}

/** Singleton drift detection service. */
export const driftDetectionService = new DriftDetectionService()
