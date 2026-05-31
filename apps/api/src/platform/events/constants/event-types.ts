/**
 * EventType — centralized event enum.
 *
 * RULES:
 *   - All event_type values live here. No scattered string literals.
 *   - No module-specific enums.
 *   - No duplicate names.
 *   - Format: domain.noun.verb (past tense where possible)
 */

export enum EventType {
  // ── Employee lifecycle ────────────────────────────────────────────────────
  EMPLOYEE_CREATED       = 'employee.created',
  EMPLOYEE_UPDATED       = 'employee.updated',
  EMPLOYEE_SEPARATED     = 'employee.separated',

  // ── Compensation ──────────────────────────────────────────────────────────
  COMPENSATION_REVISION_CREATED  = 'compensation.revision.created',
  COMPENSATION_REVISION_APPROVED = 'compensation.revision.approved',
  COMPENSATION_REVISION_REJECTED = 'compensation.revision.rejected',

  // ── Payroll ───────────────────────────────────────────────────────────────
  PAYROLL_RUN_CREATED  = 'payroll.run.created',
  PAYROLL_RUN_FINALIZED = 'payroll.run.finalized',

  // ── Leave ─────────────────────────────────────────────────────────────────
  LEAVE_REQUESTED = 'leave.requested',
  LEAVE_APPROVED  = 'leave.approved',
  LEAVE_REJECTED  = 'leave.rejected',
  LEAVE_CANCELLED = 'leave.cancelled',

  // ── Attendance ────────────────────────────────────────────────────────────
  ATTENDANCE_LOGGED  = 'attendance.logged',
  ATTENDANCE_LOCKED  = 'attendance.locked',

  // ── Compliance ────────────────────────────────────────────────────────────
  COMPLIANCE_FAILED = 'compliance.failed',

  // ── Incidents ─────────────────────────────────────────────────────────────
  INCIDENT_CREATED  = 'incident.created',
  INCIDENT_RESOLVED = 'incident.resolved',
  INCIDENT_ESCALATED = 'incident.escalated',

  // ── Governance ────────────────────────────────────────────────────────────
  GOVERNANCE_RULE_TRIGGERED = 'governance.rule.triggered',
  GOVERNANCE_ALERT_RAISED   = 'governance.alert.raised',

  // ── Trust & Verification ──────────────────────────────────────────────────
  EMPLOYEE_TRUST_EVALUATED     = 'employee.trust.evaluated',
  DUPLICATE_DETECTED           = 'duplicate.detected',
  VERIFICATION_COMPLETED       = 'verification.completed',
  REGULATORY_REVISION_INGESTED = 'regulatory.revision.ingested',
  REGULATORY_REVISION_APPROVED = 'regulatory.revision.approved',

  // ── Operations & Automation ───────────────────────────────────────────────────
  AUTOMATION_TRIGGERED       = 'automation.triggered',
  SLA_BREACH_DETECTED        = 'sla.breach.detected',
  HEALTH_SIGNAL_DEGRADED     = 'health.signal.degraded',
  SIMULATION_COMPLETED       = 'simulation.completed',
  SECURITY_SIGNAL_DETECTED   = 'security.signal.detected',
  HEATMAP_UPDATED            = 'heatmap.updated',

  // ── Fabric & Orchestration ────────────────────────────────────────────────────
  FABRIC_COMPOSITION_COMPUTED  = 'fabric.composition.computed',
  DECISION_NODE_RECORDED       = 'decision.node.recorded',
  ORCHESTRATION_STARTED        = 'orchestration.started',
  ORCHESTRATION_COMPLETED      = 'orchestration.completed',
  REPLAY_SESSION_COMPLETED     = 'replay.session.completed',
  KNOWLEDGE_ENTRY_REGISTERED   = 'knowledge.entry.registered',
  FABRIC_HEALTH_COMPUTED       = 'fabric.health.computed',
}

/** Module labels — used for grouping in observability */
export const MODULE = {
  EMPLOYEE:     'employee',
  COMPENSATION: 'compensation',
  PAYROLL:      'payroll',
  LEAVE:        'leave',
  ATTENDANCE:   'attendance',
  COMPLIANCE:   'compliance',
  INCIDENTS:    'incidents',
  GOVERNANCE:   'governance',
  SYSTEM:       'system',
} as const

export type ModuleKey = typeof MODULE[keyof typeof MODULE]
