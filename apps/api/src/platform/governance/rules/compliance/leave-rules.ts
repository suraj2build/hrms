/**
 * Leave compliance rules — registered as side-effects on module import.
 *
 * Rules fire AFTER operations succeed (passive only).
 * Sprint 2: Governance Intelligence Layer.
 */

import { governanceRuleRegistry } from '../registry/governance-rule-registry.js'

// ── leave.policy-mismatch ────────────────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'leave.policy-mismatch',
  name:           'Leave Policy Mismatch',
  description:    'Fires when an approved leave does not conform to the active leave policy (type, balance, or carry-forward rules).',
  category:       'leave',
  severity:       'warning',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['leave.approved'],
  conditions:     { policy_mismatch: true },
  actions:        [{ type: 'alert', severity: 'warning' }],
  replay_safe:    true,
  explainability_template: 'Approved leave does not fully comply with the configured leave policy for this employee grade.',
  matches(event) {
    return event.payload?.policy_mismatch === true
  },
  reason(event) {
    const leaveType = (event.payload?.leave_type as string) ?? 'unknown'
    return `Leave approval for type "${leaveType}" contains a policy deviation — verify compliance before payroll.`
  },
})

// ── leave.abnormal-approval-pattern ──────────────────────────────────────────
governanceRuleRegistry.register({
  rule_id:        'leave.abnormal-approval-pattern',
  name:           'Abnormal Leave Approval Pattern',
  description:    'Fires when a leave is approved with unusual characteristics (self-approval, backdated, bulk same-day).',
  category:       'leave',
  severity:       'high',
  effective_from: '2024-01-01',
  effective_to:   undefined,
  enabled:        true,
  event_types:    ['leave.approved'],
  conditions:     { self_approved: true },
  actions:        [{ type: 'alert', severity: 'high' }, { type: 'score' }],
  replay_safe:    true,
  explainability_template: 'Leave approval pattern is abnormal — may indicate self-approval or approval bypass.',
  matches(event) {
    return (
      event.payload?.self_approved === true ||
      event.payload?.backdated === true
    )
  },
  reason(event) {
    if (event.payload?.self_approved === true) {
      return 'Leave was self-approved — violates separation-of-duty policy.'
    }
    return 'Leave was approved with backdated dates — requires audit review.'
  },
})
