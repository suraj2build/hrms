/**
 * Attendance compliance rules — registered as side-effects on module import.
 *
 * Rules fire AFTER operations succeed (passive only).
 * Sprint 2: Governance Intelligence Layer.
 */

import { governanceRuleRegistry } from '../registry/governance-rule-registry.js'

// ── attendance.excessive-overtime ────────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'attendance.excessive-overtime',
  name:           'Excessive Overtime',
  description:    'Fires when attendance records show overtime hours exceeding the statutory weekly threshold.',
  category:       'attendance',
  jurisdiction:   'IN',
  severity:       'warning',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['attendance.locked'],
  conditions:     { weekly_ot_hours_threshold: 48 },
  actions:        [{ type: 'alert', severity: 'warning' }],
  replay_safe:    true,
  explainability_template: 'Attendance period contains excessive overtime hours relative to statutory weekly limits.',
  matches(event) {
    const otHours = (event.payload?.total_overtime_hours as number) ?? 0
    return otHours > 48
  },
  reason(event) {
    const otHours = (event.payload?.total_overtime_hours as number) ?? 0
    return `Attendance period shows ${otHours} overtime hours — exceeds statutory 48 hours/week threshold.`
  },
})

// ── attendance.regularization-spike ──────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'attendance.regularization-spike',
  name:           'Attendance Regularization Spike',
  description:    'Fires when an unusual number of attendance regularization requests are detected for a single employee or branch.',
  category:       'attendance',
  severity:       'high',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['attendance.regularisation.approved', 'attendance.logged'],
  conditions:     { correction_flag: true },
  actions:        [{ type: 'alert', severity: 'high' }, { type: 'score' }],
  replay_safe:    true,
  explainability_template: 'Elevated attendance corrections may indicate proxy behavior or systematic recording issues.',
  matches(event) {
    const isCorrection = event.payload?.correction === true
    const count = (event.payload?.correction_count as number) ?? 0
    return isCorrection && count > 5
  },
  reason(event) {
    const count = (event.payload?.correction_count as number) ?? 0
    return `Employee has ${count} attendance corrections — possible systematic irregularity detected.`
  },
})
