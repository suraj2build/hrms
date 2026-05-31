/**
 * Compensation compliance rules — registered as side-effects on module import.
 *
 * Rules fire AFTER operations succeed (passive only).
 * Sprint 2: Governance Intelligence Layer.
 */

import { governanceRuleRegistry } from '../registry/governance-rule-registry.js'

// ── compensation.revision-frequency ──────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'compensation.revision-frequency',
  name:           'Compensation Revision Frequency',
  description:    'Fires when an employee receives more compensation revisions than policy allows within a 12-month window.',
  category:       'payroll',
  severity:       'warning',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['compensation.revision.created'],
  conditions:     { max_revisions_per_year: 3 },
  actions:        [{ type: 'alert', severity: 'warning' }],
  replay_safe:    true,
  explainability_template: 'Employee has exceeded the recommended compensation revision frequency for the rolling 12-month window.',
  matches(event) {
    const revisionCount = (event.payload?.revisions_in_12m as number) ?? 0
    return revisionCount >= 3
  },
  reason(event) {
    const revisionCount = (event.payload?.revisions_in_12m as number) ?? 0
    return `Employee has ${revisionCount} compensation revisions in the last 12 months — exceeds policy limit of 3.`
  },
})

// ── compensation.spike-detection ─────────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'compensation.spike-detection',
  name:           'Compensation Spike Detection',
  description:    'Fires when an approved compensation revision contains an unusually large percentage increase.',
  category:       'payroll',
  severity:       'high',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['compensation.revision.approved'],
  conditions:     { delta_pct_threshold: 40 },
  actions:        [{ type: 'alert', severity: 'high' }, { type: 'score' }, { type: 'incident', incident_type: 'compensation_anomaly' }],
  replay_safe:    true,
  explainability_template: 'Compensation revision shows an unusually large percentage increase that warrants review.',
  matches(event) {
    const delta = (event.payload?.delta_pct as number) ?? 0
    return delta > 40
  },
  reason(event) {
    const delta = (event.payload?.delta_pct as number) ?? 0
    return `Compensation revision of ${delta.toFixed(1)}% exceeds normal spike threshold of 40% — review recommended.`
  },
})
