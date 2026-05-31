/**
 * Payroll compliance rules — registered as side-effects on module import.
 *
 * Rules fire AFTER operations succeed (passive only).
 * Sprint 2: Governance Intelligence Layer.
 */

import { governanceRuleRegistry } from '../registry/governance-rule-registry.js'

// ── payroll.pf-eligibility-mismatch ─────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'payroll.pf-eligibility-mismatch',
  name:           'PF Eligibility Mismatch',
  description:    'Fires when a compensation revision contains a CTC spike that may cross PF eligibility thresholds.',
  category:       'payroll',
  jurisdiction:   'IN',
  severity:       'high',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['compensation.revision.approved'],
  conditions:     { ctc_delta_pct_threshold: 30 },
  actions:        [{ type: 'alert', severity: 'high' }],
  replay_safe:    true,
  explainability_template: 'Compensation revision caused a significant CTC increase that may affect PF eligibility classification.',
  matches(event) {
    const delta = (event.payload?.delta_pct as number) ?? 0
    return delta > 30
  },
  reason(event) {
    const delta = (event.payload?.delta_pct as number) ?? 0
    return `CTC revision of ${delta.toFixed(1)}% may affect PF eligibility threshold (₹15,000/month ceiling).`
  },
})

// ── payroll.excessive-override ───────────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'payroll.excessive-override',
  name:           'Excessive Payroll Override',
  description:    'Fires when a payroll run finalization contains an unusually high number of manual overrides.',
  category:       'payroll',
  severity:       'warning',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['payroll.run.finalized'],
  conditions:     { override_count_threshold: 10 },
  actions:        [{ type: 'alert', severity: 'warning' }],
  replay_safe:    true,
  explainability_template: 'High number of manual overrides in a payroll run warrants audit review.',
  matches(event) {
    const overrides = (event.payload?.override_count as number) ?? 0
    return overrides > 10
  },
  reason(event) {
    const overrides = (event.payload?.override_count as number) ?? 0
    return `Payroll run contains ${overrides} manual overrides — exceeds normal threshold of 10.`
  },
})
