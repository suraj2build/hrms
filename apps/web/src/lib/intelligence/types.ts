/**
 * types.ts — Decision Intelligence Engine Types (Phase UX-5)
 */

export type InsightCategory = 'attendance' | 'roster' | 'payroll' | 'compliance'

export type InsightType =
  | 'regularise_punches'        | 'approve_sessions'          | 'investigate_timing'
  | 'rebalance_shifts'           | 'reduce_fatigue'             | 'optimise_alternating_saturday'
  | 'resolve_payroll_blockers'   | 'detect_payroll_variance'    | 'payroll_drift_risk'
  | 'compliance_warning'         | 'consecutive_workday_breach' | 'ot_threshold_warning'

export type InsightSeverity  = 'critical' | 'high' | 'medium' | 'low'
export type ConfidenceLevel  = 'very_high' | 'high' | 'medium' | 'low'
export type InsightStatus    = 'pending' | 'actioned' | 'dismissed' | 'expired'

export type BulkActionType =
  | 'bulk_approve_attendance'
  | 'bulk_resolve_anomalies'
  | 'bulk_lock_payroll'
  | 'bulk_assign_shifts'
  | 'bulk_approve_leave'
  | 'bulk_regularise_punches'

export type PredictiveWarningType =
  | 'payroll_delay'
  | 'anomaly_surge'
  | 'coverage_risk'
  | 'fatigue_increasing'
  | 'compliance_breach_risk'
  | 'chronic_absenteeism_detected'

export type OptimizationInsightType =
  | 'chronic_absenteeism' | 'ot_hotspot' | 'shift_imbalance'
  | 'payroll_anomaly_trend' | 'fatigue_cluster'

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export interface AffectedEntity {
  id:        string
  name:      string
  type:      'employee' | 'site' | 'shift'
  metadata?: Record<string, unknown>
}

export interface ImpactEstimate {
  affectedCount:        number
  payrollImpact?:       number       // estimated monetary impact (positive = cost increase)
  complianceRisk?:      'high' | 'medium' | 'low'
  fatigueImpact?:       'high' | 'medium' | 'low'
  rollbackPossible:     boolean
  rollbackWindowHours?: number
}

export interface ConfidenceFactor {
  label:        string
  contribution: number     // 0-100
  description:  string
}

export interface ExplainabilityTrace {
  triggeringEventIds: string[]
  appliedRules:       string[]
  confidenceLogic:    string
  impactCalculation:  string
}

export interface DecisionInsight {
  id:                string
  type:              InsightType
  category:          InsightCategory
  severity:          InsightSeverity
  confidence:        number          // 0-100
  confidenceLevel:   ConfidenceLevel
  title:             string
  explanation:       string
  recommendedAction: string
  affectedEntities:  AffectedEntity[]
  impactEstimate:    ImpactEstimate
  sourceEventIds:    string[]
  createdAt:         string
  factors:           ConfidenceFactor[]
  explainability:    ExplainabilityTrace
  status:            InsightStatus
  actionLabel:       string
  actionType:        BulkActionType
  actionEndpoint:    string
  actionBody:        Record<string, unknown>
}

export interface BulkActionItem {
  id:                   string
  type:                 BulkActionType
  label:                string
  description:          string
  targetEntityIds:      string[]
  targetEventIds:       string[]
  estimatedImpact:      ImpactEstimate
  requiresConfirmation: boolean
  isReversible:         boolean
  endpoint:             string
  body:                 Record<string, unknown>
}

export interface BulkActionResult {
  actionId:      string
  actionType:    BulkActionType
  label:         string
  successCount:  number
  failureCount:  number
  failedIds:     string[]
  undoEndpoint?: string
  undoBody?:     Record<string, unknown>
  executedAt:    string
}

export interface UndoEntry {
  id:             string
  label:          string
  executedAt:     string
  undoEndpoint?:  string
  undoBody?:      Record<string, unknown>
  isReversible:   boolean
  affectedCount:  number
  expiresAt:      string   // ISO — undo window expires after 10 minutes
}

export interface OperationalScore {
  attendanceHealth:      number   // 0-100, higher = better
  payrollReadiness:      number   // 0-100
  complianceScore:       number   // 0-100
  fatigueRisk:           number   // 0-100, higher = worse
  operationalEfficiency: number   // 0-100
  overallScore:          number   // weighted average
  grade:                 ScoreGrade
  updatedAt:             string
  trend?:                'up' | 'down' | 'stable'
}

export interface PredictiveWarning {
  id:          string
  type:        PredictiveWarningType
  severity:    'critical' | 'high' | 'medium'
  title:       string
  description: string
  probability: number     // 0-100
  timeHorizon: string    // e.g. "tomorrow", "next 3 days"
  basis:       string[]  // list of reasons
}

export interface OptimizationInsight {
  id:               string
  type:             OptimizationInsightType
  title:            string
  metric:           number
  unit:             string
  trend:            'worsening' | 'improving' | 'stable'
  trendValue?:      number
  recommendation:   string
  affectedEntities: AffectedEntity[]
}

export interface DecisionEngineState {
  insights:             DecisionInsight[]
  score:                OperationalScore
  predictiveWarnings:   PredictiveWarning[]
  optimizationInsights: OptimizationInsight[]
  bulkActions:          BulkActionItem[]
  isLoading:            boolean
  dismissInsight:       (id: string) => void
  actionInsight:        (insight: DecisionInsight) => void
}

// ── Helper functions ──────────────────────────────────────────────────────────

export function toConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 90) return 'very_high'
  if (confidence >= 70) return 'high'
  if (confidence >= 50) return 'medium'
  return 'low'
}

export function scoreToGrade(score: number): ScoreGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export const INSIGHT_SEVERITY_META: Record<InsightSeverity, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: 'Critical', color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30' },
  high:     { label: 'High',     color: 'text-accent-coral',  bg: 'bg-accent-coral/10',  border: 'border-accent-coral/30' },
  medium:   { label: 'Medium',   color: 'text-warning',   bg: 'bg-warning/10',   border: 'border-warning/30' },
  low:      { label: 'Low',      color: 'text-info',    bg: 'bg-info/10',    border: 'border-info/30'  },
} as const satisfies Record<InsightSeverity, { label: string; color: string; bg: string; border: string }>

export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; color: string; bg: string }> = {
  very_high: { label: '90–100%', color: 'text-success',      bg: 'bg-success/10' },
  high:      { label: '70–89%',  color: 'text-info',         bg: 'bg-info/10'    },
  medium:    { label: '50–69%',  color: 'text-warning',        bg: 'bg-warning/10'   },
  low:       { label: '<50%',    color: 'text-muted-foreground', bg: 'bg-muted/50'       },
} as const satisfies Record<ConfidenceLevel, { label: string; color: string; bg: string }>

export const GRADE_META: Record<ScoreGrade, { color: string; bg: string }> = {
  A: { color: 'text-success', bg: 'bg-success/10' },
  B: { color: 'text-info',    bg: 'bg-info/10'    },
  C: { color: 'text-warning',   bg: 'bg-warning/10'   },
  D: { color: 'text-accent-coral',  bg: 'bg-accent-coral/10'  },
  F: { color: 'text-destructive', bg: 'bg-destructive/10' },
} as const satisfies Record<ScoreGrade, { color: string; bg: string }>
