/**
 * Operations intelligence types — Sprint 4.
 * Shared across health signals, automation, SLA, simulation, and security.
 */
import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { EventSeverity }        from '../../events/types/platform-event.js'

export type HealthDomain = 'payroll' | 'attendance' | 'governance' | 'trust' | 'approvals' | 'system'

export interface DomainHealthSignal {
  domain:          HealthDomain
  score:           number          // 0–100, higher = healthier
  severity:        'healthy' | 'warning' | 'critical'
  factors:         string[]
  computed_at:     string
  explainability?: ExplainabilityResult
}

export type AutomationActionType =
  | 'notification'
  | 'escalation'
  | 'reminder'
  | 'task_creation'
  | 'nudge'
  | 'sla_alert'
  | 'incident_creation'

export interface AutomationAction {
  type:             AutomationActionType
  target_entity_id: string
  target_type:      string
  message:          string
  severity:         EventSeverity
  metadata?:        Record<string, unknown>
}

export interface AutomationTrigger {
  trigger_id:   string
  name:         string
  description:  string
  event_types:  string[]    // which events trigger this
  enabled:      boolean
  safeguards:   string[]    // human-readable list of what this CANNOT do
  evaluate:     (event: import('../../events/types/platform-event.js').ResolvedPlatformEvent) => AutomationAction | null
}

export interface AutomationActivityRecord {
  trigger_id:    string
  trigger_name:  string
  action_type:   AutomationActionType
  entity_id:     string
  entity_type:   string
  tenant_id:        string
  message:       string
  severity:      EventSeverity
  fired_at:      string
  explainability?: ExplainabilityResult
}

export interface SlaDefinition {
  sla_id:        string
  name:          string
  entity_type:   string      // 'approval', 'incident', 'payroll_review', etc.
  threshold_hours: number
  severity_on_breach: EventSeverity
}

export interface SlaStatus {
  sla_id:        string
  entity_id:     string
  entity_type:   string
  tenant_id:        string
  started_at:    string
  due_at:        string
  breached:      boolean
  hours_elapsed: number
  hours_remaining: number
}

export interface SlaBreachEvent {
  sla_id:          string
  entity_id:       string
  entity_type:     string
  tenant_id:          string
  breach_severity: EventSeverity
  description:     string
  breached_at:     string
  explainability?: ExplainabilityResult
}

export type SimulationType = 'payroll_impact' | 'compliance_threshold' | 'workforce_overtime' | 'policy_change' | 'governance_drift_projection'

export interface SimulationRun {
  id?:              string
  tenant_id:           string
  simulation_type:  SimulationType
  label:            string
  input_params:     Record<string, unknown>
  result_summary:   SimulationResultSummary
  created_at?:      string
  created_by?:      string
}

export interface SimulationResultSummary {
  affected_count:   number
  estimated_impact: number    // monetary or percentage depending on type
  impact_unit:      string    // 'INR' | '%' | 'employees' | 'hours'
  risk_level:       EventSeverity
  key_findings:     string[]
  explainability?:  ExplainabilityResult
}

export type SecuritySignalType =
  | 'suspicious_admin_session'
  | 'excessive_override'
  | 'unusual_approval_velocity'
  | 'escalation_bypass'
  | 'abnormal_data_access'

export interface SecurityIntelligenceEvent {
  signal_type:   SecuritySignalType
  entity_id:     string
  entity_type:   string
  tenant_id:        string
  severity:      EventSeverity
  description:   string
  detected_at:   string
  metadata?:     Record<string, unknown>
  explainability?: ExplainabilityResult
}

export interface HeatmapCell {
  dimension_id:   string     // branch_id, dept_id, etc.
  dimension_label: string
  value:          number     // 0–100 (risk/anomaly intensity)
  severity:       EventSeverity
  event_count:    number
  period:         string     // YYYY-MM
}

export interface HeatmapSnapshot {
  domain:      HealthDomain
  period:      string
  cells:       HeatmapCell[]
  computed_at: string
}
