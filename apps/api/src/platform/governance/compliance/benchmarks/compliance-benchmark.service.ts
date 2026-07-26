/**
 * ComplianceBenchmarkService — statutory threshold registry and validator.
 *
 * Provides Indian jurisdiction compliance benchmarks for PF, ESI, wages, OT.
 * validate() is non-blocking and observational only — never mutates operational data.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { EventSeverity }       from '../../../events/types/platform-event.js'
import type { ExplainabilityResult } from '../../../ai/types/explainability.js'

export type BenchmarkType =
  | 'pf_threshold'
  | 'esi_threshold'
  | 'minimum_wage'
  | 'overtime_threshold'
  | 'policy_compliance'
  | 'leave_policy'
  | 'compensation_revision_frequency'

export interface ComplianceBenchmark {
  type:           BenchmarkType
  label:          string
  threshold:      number
  unit:           string
  jurisdiction?:  string
  effective_from: string
  effective_to?:  string
  /**
   * 'ceiling' (default): value must be <= threshold to comply (PF/ESI wage
   * caps, OT hour limits). 'floor': value must be >= threshold to comply
   * (minimum wage) — without this, validate()'s single `value <= threshold`
   * check would report paying BELOW minimum wage as compliant and paying
   * above it as a violation.
   */
  direction?:     'ceiling' | 'floor'
}

export interface ComplianceValidationResult {
  compliant:           boolean
  severity:            EventSeverity
  violations:          string[]
  affected_entities?:  string[]
  explainability?:     ExplainabilityResult
}

/** Built-in statutory benchmarks (Indian jurisdiction defaults). */
const DEFAULT_BENCHMARKS: ComplianceBenchmark[] = [
  {
    type:           'pf_threshold',
    label:          'PF Basic Wage Ceiling',
    threshold:      15000,
    unit:           'INR/month',
    jurisdiction:   'IN',
    effective_from: '2014-09-01',
  },
  {
    type:           'esi_threshold',
    label:          'ESI Gross Wage Ceiling',
    threshold:      21000,
    unit:           'INR/month',
    jurisdiction:   'IN',
    effective_from: '2017-01-01',
  },
  {
    type:           'minimum_wage',
    label:          'Central Minimum Wage',
    threshold:      178,
    unit:           'INR/day',
    jurisdiction:   'IN',
    effective_from: '2024-10-01',
    direction:      'floor',
  },
  {
    type:           'overtime_threshold',
    label:          'Weekly OT Limit',
    threshold:      48,
    unit:           'hours/week',
    effective_from: '2024-01-01',
  },
  {
    type:           'compensation_revision_frequency',
    label:          'Max Revisions / 12m',
    threshold:      3,
    unit:           'revisions',
    effective_from: '2024-01-01',
  },
]

export class ComplianceBenchmarkService {
  private benchmarks: ComplianceBenchmark[] = [...DEFAULT_BENCHMARKS]

  /** Register a custom benchmark. */
  registerBenchmark(b: ComplianceBenchmark): void {
    this.benchmarks.push(b)
  }

  /** Get all benchmarks active on the given ISO date (default: today). */
  getActiveBenchmarks(asOf?: string): ComplianceBenchmark[] {
    const date = asOf ?? new Date().toISOString().slice(0, 10)
    return this.benchmarks.filter(b => {
      if (b.effective_from > date) return false
      if (b.effective_to && b.effective_to < date) return false
      return true
    })
  }

  /**
   * Look up a benchmark by type and optional jurisdiction.
   * Jurisdiction-specific benchmarks take priority over generic ones.
   */
  getBenchmark(type: BenchmarkType, jurisdiction?: string): ComplianceBenchmark | undefined {
    const active = this.getActiveBenchmarks()
    if (jurisdiction) {
      const specific = active.find(b => b.type === type && b.jurisdiction === jurisdiction)
      if (specific) return specific
    }
    return active.find(b => b.type === type && !b.jurisdiction)
      ?? active.find(b => b.type === type)
  }

  /**
   * Validate a value against a named benchmark.
   * Non-blocking — returns a result, never throws.
   */
  validate(
    type:     BenchmarkType,
    value:    number,
    context?: { entity_id?: string; jurisdiction?: string },
  ): ComplianceValidationResult {
    const bench = this.getBenchmark(type, context?.jurisdiction)
    if (!bench) {
      return { compliant: true, severity: 'info', violations: [] }
    }
    const isFloor = bench.direction === 'floor'
    const compliant = isFloor ? value >= bench.threshold : value <= bench.threshold
    const violation = compliant
      ? []
      : [isFloor
          ? `${bench.label}: ${value} ${bench.unit} is below the minimum threshold ${bench.threshold} ${bench.unit}`
          : `${bench.label}: ${value} ${bench.unit} exceeds threshold ${bench.threshold} ${bench.unit}`]
    return {
      compliant,
      severity:          compliant ? 'info' : 'warning',
      violations:        violation,
      affected_entities: context?.entity_id ? [context.entity_id] : undefined,
    }
  }
}

/** Singleton benchmark service. */
export const complianceBenchmarkService = new ComplianceBenchmarkService()
