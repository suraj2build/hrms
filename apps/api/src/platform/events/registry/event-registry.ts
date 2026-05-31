/**
 * EventRegistry — catalog of known event types with their metadata.
 * Used for validation, documentation, and observability grouping.
 */

import { EventType, MODULE } from '../constants/event-types.js'
import type { ModuleKey }    from '../constants/event-types.js'
import type { EventSeverity } from '../types/platform-event.js'

export interface EventRegistryEntry {
  event_type:    string
  module:        ModuleKey
  entity_type:   string
  default_severity: EventSeverity
  description:   string
}

const REGISTRY: EventRegistryEntry[] = [
  // Employee
  { event_type: EventType.EMPLOYEE_CREATED,       module: MODULE.EMPLOYEE,     entity_type: 'employee',             default_severity: 'info',    description: 'New employee record created' },
  { event_type: EventType.EMPLOYEE_UPDATED,       module: MODULE.EMPLOYEE,     entity_type: 'employee',             default_severity: 'info',    description: 'Employee record updated' },
  { event_type: EventType.EMPLOYEE_SEPARATED,     module: MODULE.EMPLOYEE,     entity_type: 'employee',             default_severity: 'warning', description: 'Employee separation recorded' },

  // Compensation
  { event_type: EventType.COMPENSATION_REVISION_CREATED,  module: MODULE.COMPENSATION, entity_type: 'compensation_revision', default_severity: 'info',    description: 'Compensation revision initiated' },
  { event_type: EventType.COMPENSATION_REVISION_APPROVED, module: MODULE.COMPENSATION, entity_type: 'compensation_revision', default_severity: 'info',    description: 'Compensation revision approved' },
  { event_type: EventType.COMPENSATION_REVISION_REJECTED, module: MODULE.COMPENSATION, entity_type: 'compensation_revision', default_severity: 'info',    description: 'Compensation revision rejected' },

  // Payroll
  { event_type: EventType.PAYROLL_RUN_CREATED,  module: MODULE.PAYROLL, entity_type: 'payroll_run', default_severity: 'info', description: 'Payroll run initiated' },
  { event_type: EventType.PAYROLL_RUN_FINALIZED, module: MODULE.PAYROLL, entity_type: 'payroll_run', default_severity: 'info', description: 'Payroll run finalized' },

  // Leave
  { event_type: EventType.LEAVE_REQUESTED, module: MODULE.LEAVE, entity_type: 'leave_request', default_severity: 'info', description: 'Leave request submitted' },
  { event_type: EventType.LEAVE_APPROVED,  module: MODULE.LEAVE, entity_type: 'leave_request', default_severity: 'info', description: 'Leave request approved' },
  { event_type: EventType.LEAVE_REJECTED,  module: MODULE.LEAVE, entity_type: 'leave_request', default_severity: 'info', description: 'Leave request rejected' },
  { event_type: EventType.LEAVE_CANCELLED, module: MODULE.LEAVE, entity_type: 'leave_request', default_severity: 'info', description: 'Leave request cancelled' },

  // Attendance
  { event_type: EventType.ATTENDANCE_LOGGED, module: MODULE.ATTENDANCE, entity_type: 'attendance_daily', default_severity: 'info',    description: 'Attendance recorded' },
  { event_type: EventType.ATTENDANCE_LOCKED, module: MODULE.ATTENDANCE, entity_type: 'payroll_run',      default_severity: 'warning', description: 'Attendance period locked for payroll' },

  // Compliance
  { event_type: EventType.COMPLIANCE_FAILED, module: MODULE.COMPLIANCE, entity_type: 'compliance_check', default_severity: 'high', description: 'Compliance check failed' },

  // Incidents
  { event_type: EventType.INCIDENT_CREATED,   module: MODULE.INCIDENTS, entity_type: 'operational_incident', default_severity: 'high',     description: 'Incident opened' },
  { event_type: EventType.INCIDENT_RESOLVED,  module: MODULE.INCIDENTS, entity_type: 'operational_incident', default_severity: 'info',     description: 'Incident resolved' },
  { event_type: EventType.INCIDENT_ESCALATED, module: MODULE.INCIDENTS, entity_type: 'operational_incident', default_severity: 'critical', description: 'Incident escalated' },

  // Governance
  { event_type: EventType.GOVERNANCE_RULE_TRIGGERED, module: MODULE.GOVERNANCE, entity_type: 'governance_rule', default_severity: 'warning', description: 'Governance rule triggered' },
  { event_type: EventType.GOVERNANCE_ALERT_RAISED,   module: MODULE.GOVERNANCE, entity_type: 'governance_rule', default_severity: 'high',    description: 'Governance alert raised' },
]

const INDEX = new Map<string, EventRegistryEntry>(REGISTRY.map(e => [e.event_type, e]))

export const eventRegistry = {
  all(): EventRegistryEntry[] { return REGISTRY },
  get(eventType: string): EventRegistryEntry | undefined { return INDEX.get(eventType) },
  isKnown(eventType: string): boolean { return INDEX.has(eventType) },
  forModule(module: ModuleKey): EventRegistryEntry[] { return REGISTRY.filter(e => e.module === module) },
}
