/**
 * ComplianceScoreService — computes compliance health scores from violations.
 *
 * Score: 0–100. Higher = better compliance.
 * Deductions applied per violation severity.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { EventSeverity } from '../../../events/types/platform-event.js'

export interface ComplianceScore {
  tenant_id:     string
  module:     string
  score:      number                        // 0–100, higher = better compliance
  grade:      'A' | 'B' | 'C' | 'D' | 'F'
  violations: number
  period:     string                        // YYYY-MM
  computed_at: string
}

export class ComplianceScoreService {
  /** Score deductions per violation severity. */
  private readonly deductions: Record<EventSeverity, number> = {
    info:     0,
    warning:  5,
    high:     15,
    critical: 30,
  }

  /** Compute a score from a list of violations. */
  computeScore(violations: Array<{ severity: EventSeverity }>): number {
    const total = violations.reduce(
      (acc, v) => acc - (this.deductions[v.severity] ?? 0),
      100,
    )
    return Math.max(0, total)
  }

  /** Convert a numeric score to a letter grade. */
  gradeScore(score: number): ComplianceScore['grade'] {
    if (score >= 90) return 'A'
    if (score >= 75) return 'B'
    if (score >= 60) return 'C'
    if (score >= 45) return 'D'
    return 'F'
  }
}

/** Singleton compliance score service. */
export const complianceScoreService = new ComplianceScoreService()
