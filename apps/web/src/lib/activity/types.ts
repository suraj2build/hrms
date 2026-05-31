/**
 * types.ts — Unified Operational Activity Engine Types
 * Phase UX-4
 *
 * Single source of truth for all activity stream types, filter shapes,
 * chart data primitives, and visual-helper constants used across the
 * Workforce Activity Graph & Unified Operations Timeline feature.
 */

// ── Domain enumerations ───────────────────────────────────────────────────────

export type EventType =
  | 'attendance_anomaly' | 'missing_punch'    | 'late_arrival'      | 'early_departure'
  | 'approval_pending'   | 'approval_approved' | 'approval_rejected'
  | 'roster_change'      | 'shift_assigned'    | 'shift_unassigned'
  | 'payroll_lock'       | 'payroll_blocker'   | 'payroll_processed'
  | 'leave_approval'     | 'leave_rejection'   | 'leave_pending'
  | 'fatigue_risk'       | 'ot_spike'          | 'compliance_alert'
  | 'workflow_action'    | 'system_event'

export type EventSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type EventStatus    = 'open' | 'resolved' | 'escalated' | 'pending' | 'dismissed'
export type WorkspaceCtx   = 'attendance' | 'roster' | 'payroll' | 'workforce' | 'compliance' | 'leave' | 'system'

// ── Shared sub-shapes ─────────────────────────────────────────────────────────

/** A navigable CTA attached to an event. */
export interface ActionLink {
  label:    string
  route:    string
  variant?: 'default' | 'destructive' | 'outline'
}

/** Audit record of a single field change on an entity. */
export interface EventChange {
  field:     string
  oldValue:  unknown
  newValue:  unknown
  changedBy: string
  changedAt: string
  reason?:   string
}

// ── Core event shape ──────────────────────────────────────────────────────────

/** Normalised operational event as consumed by all UX-4 components. */
export interface OperationalActivityEvent {
  id:            string
  type:          EventType
  severity:      EventSeverity
  timestamp:     string          // ISO-8601
  employeeId?:   string
  employeeName?: string
  siteId?:       string
  siteName?:     string
  workspace:     WorkspaceCtx
  title:         string
  description?:  string
  actionLinks?:  ActionLink[]
  status:        EventStatus
  metadata?:     Record<string, unknown>
  change?:       EventChange
}

// ── Filter / query shapes ─────────────────────────────────────────────────────

/** All filterable dimensions for the activity stream. */
export interface EventFilters {
  employeeId?: string
  siteId?:     string
  severity?:   EventSeverity[]
  workspace?:  WorkspaceCtx[]
  status?:     EventStatus[]
  search?:     string
  dateFrom?:   string   // YYYY-MM-DD inclusive
  dateTo?:     string   // YYYY-MM-DD inclusive
  types?:      EventType[]
}

// ── Hook return shape ─────────────────────────────────────────────────────────

/** Value returned by `useActivityStream`. */
export interface ActivityStreamState {
  /** Filtered subset of allEvents based on current filters. */
  events:      OperationalActivityEvent[]
  /** Full unfiltered event list from the last fetch. */
  allEvents:   OperationalActivityEvent[]
  isLoading:   boolean
  lastUpdated: Date | null
  /** Force an immediate re-fetch. */
  refresh:     () => void
}

// ── Chart / analytics primitives ─────────────────────────────────────────────

/** Generic {label, value} data point for bar/line charts, with optional breakdown. */
export interface ActivityDataPoint {
  label:  string
  value:  number
  extra?: Record<string, number>
}

/** Single cell in a heatmap grid. */
export interface HeatmapCell {
  row:    string
  col:    string
  value:  number
  label?: string
}

/** Daily operational summary surfaced in the digest banner. */
export interface OperationalDigest {
  attendancePct:      number
  unresolvedRisks:    number
  pendingApprovals:   number
  payrollBlockers:    number
  complianceWarnings: number
  date:               string   // YYYY-MM-DD
}

/** Item that has exceeded its SLA and requires escalation attention. */
export interface EscalatedItem {
  id:            string
  type:          'missing_punch' | 'payroll_blocker' | 'fatigue_risk' | 'compliance_alert'
  employeeId?:   string
  employeeName?: string
  /** ISO timestamp of when the item became overdue. */
  since:         string
  hoursOpen:     number
  severity:      EventSeverity
  title:         string
  actionRoute:   string
}

// ── Visual helpers ────────────────────────────────────────────────────────────

/** Tailwind + hex colour tokens keyed by EventSeverity. */
export const SEVERITY_COLORS = {
  critical: { bg: 'bg-destructive/10', text: 'text-destructive',      border: 'border-destructive/30', dot: 'bg-destructive',      bar: '#ef4444' },
  high:     { bg: 'bg-orange-500/10',  text: 'text-orange-600',       border: 'border-orange-500/30',  dot: 'bg-orange-500',       bar: '#f97316' },
  medium:   { bg: 'bg-amber-500/10',   text: 'text-amber-600',        border: 'border-amber-500/30',   dot: 'bg-amber-500',        bar: '#f59e0b' },
  low:      { bg: 'bg-blue-500/10',    text: 'text-blue-600',         border: 'border-blue-500/30',    dot: 'bg-blue-500',         bar: '#3b82f6' },
  info:     { bg: 'bg-muted/50',       text: 'text-muted-foreground', border: 'border-border',         dot: 'bg-muted-foreground', bar: '#94a3b8' },
} as const satisfies Record<EventSeverity, { bg: string; text: string; border: string; dot: string; bar: string }>

/** Display label + colour token keyed by EventStatus. */
export const STATUS_META = {
  open:      { label: 'Open',      color: 'text-destructive'      },
  resolved:  { label: 'Resolved',  color: 'text-success'          },
  escalated: { label: 'Escalated', color: 'text-orange-600'       },
  pending:   { label: 'Pending',   color: 'text-amber-600'        },
  dismissed: { label: 'Dismissed', color: 'text-muted-foreground' },
} as const satisfies Record<EventStatus, { label: string; color: string }>

/** Display label + Tailwind colour/bg tokens keyed by WorkspaceCtx. */
export const WORKSPACE_META: Record<WorkspaceCtx, { label: string; color: string; bg: string }> = {
  attendance:  { label: 'Attendance',  color: 'text-blue-600',         bg: 'bg-blue-500/10'   },
  roster:      { label: 'Roster',      color: 'text-purple-600',       bg: 'bg-purple-500/10' },
  payroll:     { label: 'Payroll',     color: 'text-emerald-600',      bg: 'bg-emerald-500/10'},
  workforce:   { label: 'Workforce',   color: 'text-orange-600',       bg: 'bg-orange-500/10' },
  compliance:  { label: 'Compliance',  color: 'text-red-600',          bg: 'bg-red-500/10'    },
  leave:       { label: 'Leave',       color: 'text-indigo-600',       bg: 'bg-indigo-500/10' },
  system:      { label: 'System',      color: 'text-muted-foreground', bg: 'bg-muted/50'      },
}
