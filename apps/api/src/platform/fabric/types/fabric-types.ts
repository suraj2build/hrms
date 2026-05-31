/**
 * Fabric types — Sprint 5 Enterprise Orchestration Fabric.
 * Covers intelligence composition, decision graph, orchestration, replay, and knowledge.
 */
import type { ExplainabilityResult } from '../../ai/types/explainability.js'
import type { EventSeverity }        from '../../events/types/platform-event.js'

// ── Intelligence Composition ────────────────────────────────────────────────

export interface IntelligenceComposition {
  entity_id:           string
  entity_type:         string
  org_id:              string
  governance_score:    number    // 0–100, higher = better compliance
  trust_score:         number    // 0–100, higher = more trusted
  operational_health:  number    // 0–100, higher = healthier
  security_risk:       number    // 0–100, higher = riskier
  composite_risk:      number    // weighted aggregate risk (0–100)
  severity:            EventSeverity
  factors:             string[]
  computed_at:         string
  explainability?:     ExplainabilityResult
}

// ── Decision Graph ──────────────────────────────────────────────────────────

export type DecisionNodeType =
  | 'approval' | 'escalation' | 'override' | 'governance_eval'
  | 'automation_action' | 'trust_decision' | 'simulation' | 'sla_breach' | 'system'

export interface DecisionGraphNode {
  node_id:      string
  node_type:    DecisionNodeType
  entity_id:    string
  entity_type:  string
  org_id:       string
  description:  string
  timestamp:    string
  actor_id?:    string
  metadata?:    Record<string, unknown>
  explainability?: ExplainabilityResult
}

export type DecisionEdgeType = 'caused_by' | 'triggers' | 'correlates_with' | 'escalates_to' | 'resolves'

export interface DecisionGraphEdge {
  from_node_id: string
  to_node_id:   string
  edge_type:    DecisionEdgeType
  org_id:       string
  weight:       number        // 0.0–1.0
  created_at?:  string
}

// ── Orchestration ───────────────────────────────────────────────────────────

export type OrchestrationWorkflowType =
  | 'approval_coordination' | 'escalation_chain' | 'compliance_review'
  | 'trust_evaluation' | 'sla_monitoring' | 'simulation_run'

export interface OrchestrationStep {
  step_id:       string
  step_name:     string
  status:        'pending' | 'active' | 'completed' | 'skipped' | 'failed'
  started_at?:   string
  completed_at?: string
  result?:       Record<string, unknown>
}

export interface OrchestrationActivity {
  activity_id:    string
  org_id:         string
  workflow_type:  OrchestrationWorkflowType
  entity_id:      string
  entity_type:    string
  status:         'active' | 'completed' | 'cancelled'
  steps:          OrchestrationStep[]
  started_at:     string
  completed_at?:  string
  metadata?:      Record<string, unknown>
  explainability?: ExplainabilityResult
}

// ── Replay ──────────────────────────────────────────────────────────────────

export interface ReplaySession {
  id?:               string
  org_id:            string
  entity_id:         string
  entity_type:       string
  replay_from:       string     // ISO timestamp
  replay_to:         string     // ISO timestamp
  events_replayed:   number
  status:            'running' | 'completed' | 'failed'
  result_summary?:   Record<string, unknown>
  created_at?:       string
  created_by?:       string
}

// ── Knowledge ───────────────────────────────────────────────────────────────

export type KnowledgeDomain = 'governance' | 'compliance' | 'trust' | 'operations' | 'payroll' | 'attendance'

export interface KnowledgeEntry {
  key:            string       // unique identifier e.g. 'pf.threshold.2024'
  domain:         KnowledgeDomain
  title:          string
  content:        string       // human-readable explanation
  tags:           string[]
  effective_from: string       // ISO date
  effective_to?:  string
  source?:        string       // gazette reference, rule_id, etc.
}

// ── Control Plane ────────────────────────────────────────────────────────────

export interface FabricHealthSnapshot {
  org_id:               string
  overall_score:        number        // 0–100
  governance_health:    number
  trust_health:         number
  operational_health:   number
  security_health:      number
  active_orchestrations: number
  pending_slas:         number
  open_incidents:       number
  computed_at:          string
  explainability?:      ExplainabilityResult
}
