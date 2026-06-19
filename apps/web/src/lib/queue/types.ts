/**
 * lib/queue/types.ts — Phase UX-7 Operational Queue Engine types
 */

export type QueueType =
  | 'missing_punch'
  | 'ot_verification'
  | 'shift_conflict'
  | 'leave_conflict'
  | 'payroll_blocker'
  | 'compliance_risk'
  | 'attendance_anomaly'
  | 'correction_pending'
  | 'regularisation_pending'
  | 'roster_gap'
  | 'biometric_failure'
  | 'duplicate_entry'

export type QueueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type QueueSection =
  | 'payroll_blocking'
  | 'needs_review'
  | 'missing_punches'
  | 'ot_verification'
  | 'shift_conflicts'
  | 'leave_conflicts'
  | 'compliance_risks'
  | 'safe_to_ignore'

export type QueueMode = 'daily_ops' | 'payroll_week' | 'audit_mode' | 'low_staffing'

export type BulkActionType = 'approve' | 'reject' | 'snooze' | 'escalate' | 'assign' | 'freeze'

export interface RelatedEntity {
  type: 'employee' | 'site' | 'shift' | 'roster' | 'payroll_period'
  id: string
  label: string
}

export interface OperationalQueueItem {
  id: string
  queue_type: QueueType
  severity: QueueSeverity
  section: QueueSection
  employee_id: string
  employee_name?: string
  site_id?: string
  site_name?: string
  title: string
  reason: string
  action_required: string
  due_at?: string
  payroll_blocking: boolean
  estimated_resolution_time: number   // minutes
  related_entities: RelatedEntity[]
  workflow_target: string             // route
  created_at: string
  source_event_id?: string
  // SLA
  sla_deadline?: string
  overdue: boolean
  // Grouping
  group_key?: string                  // e.g. "site:123" or "shift:morning"
  group_count?: number
  // state
  status: 'open' | 'snoozed' | 'dismissed' | 'resolved'
  snoozed_until?: string
}

export interface QueueGroup {
  key: string
  label: string
  items: OperationalQueueItem[]
  payroll_blocking_count: number
  can_bulk_action: boolean
  suggested_action?: string
  bulk_action_type?: BulkActionType
}

export interface QueueSLAMetrics {
  avg_resolution_time_mins: number
  overdue_count: number
  payroll_blockers_overdue: number
  site_responsiveness: Record<string, number>
}

export interface TodaysMissionData {
  blockers_remaining: number
  estimated_payroll_readiness: number   // 0–100
  actions_required_today: number
  urgent_sites: string[]
  sla_risks: string[]
  queue_mode: QueueMode
}

export interface QueueModeConfig {
  mode: QueueMode
  label: string
  description: string
  sectionOrder: QueueSection[]
  autoHideThreshold: QueueSeverity       // hide items below this severity
  boostPayrollBlocking: boolean
}

export interface SmartRecommendation {
  id: string
  text: string
  action_label: string
  action_type: BulkActionType
  affected_ids: string[]
  confidence: number   // 0–100
}

// Visual meta
export const SEVERITY_META: Record<QueueSeverity, {
  label: string; color: string; bg: string; border: string; dot: string
}> = {
  critical: { label: 'Critical', color: 'text-destructive',    bg: 'bg-destructive/10',     border: 'border-destructive/30',    dot: 'bg-destructive'    },
  high:     { label: 'High',     color: 'text-accent-coral', bg: 'bg-accent-coral/10',  border: 'border-accent-coral/30', dot: 'bg-accent-coral' },
  medium:   { label: 'Medium',   color: 'text-warning',  bg: 'bg-warning/10',   border: 'border-warning/30',  dot: 'bg-warning'  },
  low:      { label: 'Low',      color: 'text-info',   bg: 'bg-info/10',    border: 'border-info/30',   dot: 'bg-info'   },
  info:     { label: 'Info',     color: 'text-muted-foreground',  bg: 'bg-muted',   border: 'border-border',  dot: 'bg-muted'  },
} as const satisfies Record<QueueSeverity, { label: string; color: string; bg: string; border: string; dot: string }>

export const QUEUE_MODE_META: Record<QueueMode, QueueModeConfig> = {
  daily_ops: {
    mode: 'daily_ops', label: 'Daily Ops', description: 'Balanced view of all operational issues',
    sectionOrder: ['payroll_blocking','needs_review','missing_punches','ot_verification','shift_conflicts','leave_conflicts','compliance_risks','safe_to_ignore'],
    autoHideThreshold: 'info', boostPayrollBlocking: false,
  },
  payroll_week: {
    mode: 'payroll_week', label: 'Payroll Week', description: 'Payroll blockers elevated — deadline mode active',
    sectionOrder: ['payroll_blocking','ot_verification','needs_review','missing_punches','compliance_risks','shift_conflicts','leave_conflicts','safe_to_ignore'],
    autoHideThreshold: 'low', boostPayrollBlocking: true,
  },
  audit_mode: {
    mode: 'audit_mode', label: 'Audit Mode', description: 'All items shown including safe-to-ignore',
    sectionOrder: ['compliance_risks','payroll_blocking','needs_review','missing_punches','ot_verification','shift_conflicts','leave_conflicts','safe_to_ignore'],
    autoHideThreshold: 'info', boostPayrollBlocking: false,
  },
  low_staffing: {
    mode: 'low_staffing', label: 'Low Staffing', description: 'Roster gaps and shift conflicts prioritized',
    sectionOrder: ['shift_conflicts','payroll_blocking','needs_review','missing_punches','ot_verification','leave_conflicts','compliance_risks','safe_to_ignore'],
    autoHideThreshold: 'medium', boostPayrollBlocking: false,
  },
} as const satisfies Record<QueueMode, QueueModeConfig>

export const SECTION_META: Record<QueueSection, {
  label: string; icon_name: string; urgent: boolean; description: string
}> = {
  payroll_blocking: { label: 'Blocking Payroll',  icon_name: 'OctagonAlert',     urgent: true,  description: 'Critical items that must be resolved before payroll can run' },
  needs_review:     { label: 'Needs Review',      icon_name: 'ClipboardList',    urgent: true,  description: 'Items requiring human review before action' },
  missing_punches:  { label: 'Missing Punches',   icon_name: 'Clock',            urgent: false, description: 'Employees with incomplete punch records' },
  ot_verification:  { label: 'OT Verification',   icon_name: 'Timer',            urgent: false, description: 'Overtime hours awaiting verification' },
  shift_conflicts:  { label: 'Shift Conflicts',   icon_name: 'CalendarX',        urgent: false, description: 'Overlapping or unassigned shift assignments' },
  leave_conflicts:  { label: 'Leave Conflicts',   icon_name: 'CalendarMinus',    urgent: false, description: 'Leave requests conflicting with attendance' },
  compliance_risks: { label: 'Compliance Risks',  icon_name: 'ShieldAlert',      urgent: false, description: 'Regulatory or policy compliance concerns' },
  safe_to_ignore:   { label: 'Safe to Ignore',    icon_name: 'EyeOff',           urgent: false, description: 'Low-risk items — auto-resolved or informational only' },
} as const satisfies Record<QueueSection, { label: string; icon_name: string; urgent: boolean; description: string }>
