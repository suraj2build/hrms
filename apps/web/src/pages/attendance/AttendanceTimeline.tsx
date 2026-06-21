/**
 * AttendanceTimeline — per-day forensics view (Phase 4 hardening)
 *
 * Aggregates every event that shaped a daily attendance record:
 *   raw punches → sessions → shift resolution → holiday/leave overlay
 *   → corrections → policy evaluations → full audit trail
 *
 * Phase 4 additions:
 *  • Event category filter bar (Punches / Sessions / Shift / Leave / Corrections / Policy / Status)
 *  • Severity filter (All / Warnings+Errors only)
 *  • "Anomalies only" toggle
 *  • Computation flow summary card showing data pipeline stages
 *  • Human-readable meta expansion (structured key-value, not raw JSON)
 *  • Inline AttendanceDiff in audit trail
 *  • Event count badges per category
 *  • Employee name + code display
 *
 * Route: /admin/attendance/forensics
 * Query params: employeeId, date
 */
import { useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, AlertTriangle, Clock, CheckCircle2, XCircle,
  Wifi, GitBranch, CalendarDays, ShieldCheck, ClipboardEdit,
  ClipboardCheck, Zap, Info, ChevronDown, ChevronUp,
  AlarmClock, User, Terminal, Filter, Eye, EyeOff,
  ArrowRight, Activity, Layers, ChevronsUpDown,
  Upload, RefreshCw,
} from 'lucide-react'
import { PageContainer }   from '@/components/layout/PageContainer'
import { PageHeader }      from '@/components/layout/PageHeader'
import { SectionCard }     from '@/components/layout/SectionCard'
import { Badge }           from '@/components/ui/badge'
import { Button }          from '@/components/ui/button'
import { Input }           from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { DateInput }       from '@/components/ui/date-input'
import { StatusChangePill } from '@/components/operational/AttendanceDiff'
import { api }             from '@/lib/api/client'
import { useAuthStore }    from '@/stores/authStore'
import { cn }              from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  time:         string | null
  type:         string
  label:        string
  detail:       string | null
  actor:        string | null
  severity:     'info' | 'success' | 'warning' | 'error' | 'neutral'
  source_badge?: string   // 'CSV Upload' | 'Biometric Device' | 'Manual Override' | etc.
  meta:         Record<string, unknown>
}

interface DailyRecord {
  id:                   string
  status:               string
  work_hours:           number
  late_minutes:         number
  overtime_minutes:     number
  is_payable:           boolean
  day_fraction:         number
  worked_on_holiday:    boolean
  worked_on_weekly_off: boolean
  computed_source?:     string   // 'engine' | 'manual' | 'leave_approval' | 'regularization'
}

interface EffectiveShift {
  id:            string
  name:          string
  code:          string | null
  start_time:    string
  end_time:      string
  grace_minutes: number
  source:        'roster' | 'standing'
}

interface ForensicsData {
  employee:            { id: string; name: string; code: string }
  date:                string
  // Provenance — which pipeline produced this data
  source_type:         'biometric' | 'csv_upload' | 'mixed' | 'none'
  computed_source:     string | null  // 'engine' | 'manual' | 'leave_approval' | 'regularization'
  daily_record:        DailyRecord | null
  effective_shift:     EffectiveShift | null
  holiday:             { id: string; name: string; holiday_type: string } | null
  is_weekly_off:       boolean
  // Pipeline A (biometric)
  raw_punches:         RawPunch[]
  processed_sessions:  ProcessedSession[]
  // Pipeline B (CSV upload)
  csv_punches:         CsvPunch[]
  leave_applications:  LeaveApp[]
  corrections:         Correction[]
  policy_evaluations:  PolicyEval[]
  audit_trail:         AuditEntry[]
  timeline:            TimelineEvent[]
}

interface RawPunch {
  id: string; device_id: string | null; punch_time: string; direction: string | null
}
interface CsvPunch {
  id: string; punched_at: string; direction: string | null; source: string
}
interface ProcessedSession {
  id: string; check_in: string; check_out: string | null; is_complete: boolean; work_minutes: number | null
}
interface LeaveApp {
  id: string; status: string; from_date: string; to_date: string; reason: string | null
  leave_types: { name: string; is_paid: boolean } | null
}
interface Correction {
  id: string; status: string; requested_check_in: string | null; requested_check_out: string | null
  reason: string | null; created_at: string; approved_at: string | null
}
interface PolicyEval {
  id: string; policy_name: string | null; policy_version: number | null
  resolved_via: string; eligible: boolean; eligibility_reason: string | null
  trigger_context: string; is_simulation: boolean; evaluated_at: string
  leave_types: { name: string } | null
}
interface AuditEntry {
  id: string; source: string; before_status: string | null; after_status: string
  created_at: string; changed_by: string | null; metadata: Record<string, unknown> | null
}

// ── Event categories ──────────────────────────────────────────────────────────

type EventCategory = 'all' | 'punches' | 'shift' | 'leave' | 'corrections' | 'policy' | 'status'

const CATEGORY_DEFS: { id: EventCategory; label: string; icon: React.ComponentType<{ className?: string }>; types: string[] }[] = [
  { id: 'all',         label: 'All',        icon: Activity,      types: [] },
  // 'punches' covers BOTH biometric raw_punches AND csv_punches + sessions + recompute jobs
  { id: 'punches',     label: 'Punches',    icon: Wifi,          types: ['raw_punch', 'csv_punch', 'session_paired', 'recompute_job'] },
  { id: 'shift',       label: 'Shift',      icon: AlarmClock,    types: ['shift_resolved', 'computation_result'] },
  { id: 'leave',       label: 'Leave',      icon: CalendarDays,  types: ['holiday', 'weekly_off', 'leave_applied', 'leave_approved', 'leave_rejected'] },
  { id: 'corrections', label: 'Corrections',icon: ClipboardEdit, types: ['correction_requested', 'correction_approved', 'correction_rejected'] },
  { id: 'policy',      label: 'Policy',     icon: ShieldCheck,   types: ['policy_evaluated'] },
  { id: 'status',      label: 'Status',     icon: Zap,           types: ['status_change'] },
]


// ── Status badge map ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'; label: string }> = {
  present:    { variant: 'success',     label: 'Present' },
  late:       { variant: 'warning',     label: 'Late' },
  absent:     { variant: 'destructive', label: 'Absent' },
  half_day:   { variant: 'secondary',   label: 'Half Day' },
  leave:      { variant: 'outline',     label: 'On Leave' },
  holiday:    { variant: 'outline',     label: 'Holiday' },
  weekend:    { variant: 'outline',     label: 'Weekend' },
  weekly_off: { variant: 'outline',     label: 'Weekly Off' },
}

// ── Event type → icon ─────────────────────────────────────────────────────────

type SeverityColor = { dot: string; icon: string; bg: string; border: string }

const SEVERITY_COLORS: Record<TimelineEvent['severity'], SeverityColor> = {
  success: { dot: 'bg-success',                icon: 'text-success',                bg: 'bg-success/8',     border: 'border-success/20' },
  info:    { dot: 'bg-info',                   icon: 'text-info',                   bg: 'bg-info/8',        border: 'border-info/20' },
  warning: { dot: 'bg-warning',                icon: 'text-warning',                bg: 'bg-warning/8',     border: 'border-warning/20' },
  error:   { dot: 'bg-destructive',            icon: 'text-destructive',            bg: 'bg-destructive/8', border: 'border-destructive/20' },
  neutral: { dot: 'bg-muted-foreground/40',    icon: 'text-muted-foreground',       bg: 'bg-muted/30',      border: 'border-border/40' },
}

function eventIcon(type: string) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    raw_punch:            Wifi,
    csv_punch:            Upload,       // CSV upload pipeline punch
    session_paired:       Clock,
    recompute_job:        RefreshCw,    // CSV recompute job
    shift_resolved:       AlarmClock,
    holiday:              CalendarDays,
    weekly_off:           CalendarDays,
    computation_result:   Terminal,
    leave_applied:        ClipboardEdit,
    leave_approved:       CheckCircle2,
    leave_rejected:       XCircle,
    correction_requested: ClipboardEdit,
    correction_approved:  ClipboardCheck,
    correction_rejected:  XCircle,
    status_change:        Zap,
    policy_evaluated:     ShieldCheck,
  }
  return map[type] ?? Info
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return iso }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    if (isNaN(d.getTime())) return '—'
    const hr = String(d.getHours()).padStart(2,'0')
    const mn = String(d.getMinutes()).padStart(2,'0')
    return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
  } catch { return iso }
}

function fmtMinutes(m: number): string {
  if (m === 0) return '0m'
  const h = Math.floor(m / 60), min = m % 60
  if (h > 0 && min > 0) return `${h}h ${min}m`
  if (h > 0) return `${h}h`
  return `${min}m`
}

// ── Structured meta rendering ─────────────────────────────────────────────────

const META_LABELS: Record<string, string> = {
  shift_start:      'Shift Start',
  shift_end:        'Shift End',
  grace_minutes:    'Grace Period',
  work_minutes:     'Work Minutes',
  late_minutes:     'Late Minutes',
  overtime_minutes: 'Overtime',
  is_payable:       'Payable',
  day_fraction:     'Day Fraction',
  source:           'Source',
  direction:        'Direction',
  device_id:        'Device ID',
  policy_version:   'Policy Version',
  resolved_via:     'Resolved Via',
  trigger:          'Trigger',
  eligible:         'Eligible',
  reason:           'Reason',
  status:           'Status',
  before_status:    'Before Status',
  after_status:     'After Status',
  correction_type:  'Correction Type',
  holiday_name:     'Holiday',
  leave_type:       'Leave Type',
  run_id:           'Run ID',
}

function MetaTable({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (entries.length === 0) return null

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
      {entries.map(([key, val]) => (
        <div key={key} className="contents">
          <span className="text-muted-foreground font-medium whitespace-nowrap">
            {META_LABELS[key] ?? key.replace(/_/g, ' ')}
          </span>
          <span className={cn(
            'font-mono truncate',
            typeof val === 'boolean' ? (val ? 'text-success' : 'text-destructive') : 'text-foreground',
          )}>
            {typeof val === 'boolean'
              ? (val ? 'Yes' : 'No')
              : typeof val === 'object'
                ? JSON.stringify(val)
                : String(val)
            }
          </span>
        </div>
      ))}
    </div>
  )
}

// ── MetricPill ────────────────────────────────────────────────────────────────

function MetricPill({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center px-3 py-2 rounded-md text-center', highlight ? 'bg-primary/10' : 'bg-muted/40')}>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-bold mt-0.5', highlight ? 'text-primary' : 'text-foreground')}>{value}</span>
    </div>
  )
}

// ── ComputationFlow ───────────────────────────────────────────────────────────

// ── Source badge pill ─────────────────────────────────────────────────────────

const SOURCE_BADGE_COLORS: Record<string, string> = {
  'CSV Upload':        'bg-info/10 text-info border-info/30',
  'Biometric Device':  'bg-success/10 text-success border-success/30',
  'Manual Override':   'bg-warning/10 text-warning border-warning/30',
  'Leave Override':    'bg-accent/20 text-accent-foreground border-accent/30',
  'Correction':        'bg-primary/10 text-primary border-primary/30',
}

function SourceBadge({ badge }: { badge?: string }) {
  if (!badge) return null
  const cls = SOURCE_BADGE_COLORS[badge] ?? 'bg-muted text-muted-foreground border-border/40'
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0 rounded-full border flex-shrink-0', cls)}>
      {badge === 'CSV Upload'        && <Upload className="h-2 w-2" />}
      {badge === 'Biometric Device'  && <Wifi className="h-2 w-2" />}
      {badge === 'Manual Override'   && <User className="h-2 w-2" />}
      {badge === 'Correction'        && <ClipboardCheck className="h-2 w-2" />}
      {badge}
    </span>
  )
}

function ComputationFlow({ data }: { data: ForensicsData }) {
  // Unified punch count across both pipelines
  const totalPunches   = data.raw_punches.length + (data.csv_punches?.length ?? 0)
  const isCsvPipeline  = data.source_type === 'csv_upload' || data.source_type === 'mixed'
  const isBiometric    = data.source_type === 'biometric'  || data.source_type === 'mixed'

  // Punch display — source-aware label
  let punchValue: string
  if (data.source_type === 'mixed') {
    punchValue = `${data.raw_punches.length} device + ${data.csv_punches.length} CSV`
  } else if (isCsvPipeline) {
    punchValue = `${data.csv_punches.length} CSV punches`
  } else {
    punchValue = `${data.raw_punches.length} device punches`
  }

  // Sessions are only from the biometric pipeline. CSV pipeline goes
  // punch → recomputeRange → attendance_daily without a sessions table.
  const sessionsLabel  = isCsvPipeline && !isBiometric ? 'via engine' : (
    data.processed_sessions.length > 0
      ? `${data.processed_sessions.length} (${data.processed_sessions.filter(s => !s.is_complete).length} incomplete)`
      : '0'
  )
  const sessionsOk     = isCsvPipeline && !isBiometric
    ? true
    : data.processed_sessions.length > 0 && data.processed_sessions.every(s => s.is_complete)

  // "Final Status" always shows correctly when daily_record exists —
  // NEVER shows "Not computed" when the row exists regardless of pipeline.
  const finalStatusValue = data.daily_record
    ? data.daily_record.status.replace(/_/g, ' ')
    : 'Not computed'

  const stages: { label: string; value: string; ok: boolean; dim?: boolean }[] = [
    {
      label: isCsvPipeline && !isBiometric ? 'Punch Source' : 'Raw Punches',
      value: punchValue,
      ok:    totalPunches > 0,
    },
    {
      label: isCsvPipeline && !isBiometric ? 'Engine Input' : 'Sessions',
      value: sessionsLabel,
      ok:    sessionsOk,
    },
    {
      label: 'Shift',
      value: data.effective_shift
        ? `${data.effective_shift.name} (${data.effective_shift.source === 'roster' ? 'roster' : 'standing'})`
        : 'Unassigned',
      ok: !!data.effective_shift,
    },
    {
      label: 'Leave / Holiday',
      value: data.holiday
        ? `Holiday: ${data.holiday.name}`
        : data.is_weekly_off
          ? 'Weekly Off'
          : data.leave_applications.some(la => la.status === 'approved')
            ? 'On Leave'
            : 'None',
      ok: true,
      dim: !data.holiday && !data.is_weekly_off && !data.leave_applications.some(la => la.status === 'approved'),
    },
    {
      label: 'Corrections',
      value: data.corrections.length > 0
        ? `${data.corrections.filter(c => c.status === 'approved').length}/${data.corrections.length} approved`
        : 'None',
      ok:  true,
      dim: data.corrections.length === 0,
    },
    {
      // Final Status is always "computable" if the daily_record exists.
      // The previous logic showed "Not computed" even when daily_record
      // existed for CSV-pipeline rows (because raw_punches was 0).
      label: 'Final Status',
      value: finalStatusValue,
      ok:    !!data.daily_record,
    },
  ]

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
      {stages.map((stage, i) => (
        <div key={stage.label} className="flex items-center">
          <div className={cn(
            'flex flex-col px-3 py-2.5 rounded-md text-center min-w-[100px] border',
            stage.dim  ? 'bg-muted/20 border-border/30'
            : stage.ok ? 'bg-success/8 border-success/20'
            :            'bg-destructive/8 border-destructive/20',
          )}>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">{stage.label}</span>
            <span className={cn(
              'text-[11px] font-semibold leading-tight',
              stage.dim  ? 'text-muted-foreground/50'
              : stage.ok ? 'text-success'
              :            'text-destructive',
            )}>{stage.value}</span>
          </div>
          {i < stages.length - 1 && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 mx-1 flex-shrink-0" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Timeline row ──────────────────────────────────────────────────────────────

function TimelineRow({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const colors  = SEVERITY_COLORS[event.severity]
  const Icon    = eventIcon(event.type)
  const hasMeta = Object.keys(event.meta).length > 0

  return (
    <div className="relative flex gap-3">
      {/* Vertical connector */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={cn('w-2.5 h-2.5 rounded-full ring-2 ring-background mt-1 flex-shrink-0', colors.dot)} />
        {!isLast && <div className="w-px flex-1 bg-border/40 mt-1" style={{ minHeight: '16px' }} />}
      </div>

      {/* Card */}
      <div className={cn(
        'flex-1 mb-3 rounded-md border overflow-hidden',
        colors.bg, colors.border,
      )}>
        <div className="flex items-start gap-2 p-2.5">
          <Icon className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', colors.icon)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <p className="text-xs font-medium text-foreground leading-snug">{event.label}</p>
                {event.source_badge && <SourceBadge badge={event.source_badge} />}
              </div>
              {event.time && (
                <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 font-mono">{fmtTime(event.time)}</span>
              )}
            </div>
            {event.detail && (
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{event.detail}</p>
            )}
            {event.actor && !['system', 'device'].includes(event.actor) && (
              <div className="flex items-center gap-1 mt-1">
                <User className="h-3 w-3 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground capitalize">{event.actor}</span>
              </div>
            )}
          </div>
          {hasMeta && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="p-1 rounded hover:bg-black/5 text-muted-foreground/50 hover:text-foreground flex-shrink-0"
              title={expanded ? 'Collapse details' : 'Expand details'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Structured meta expansion */}
        {expanded && hasMeta && (
          <div className="border-t border-inherit px-3 py-2 bg-black/5">
            <MetaTable meta={event.meta} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Event grouping helpers ────────────────────────────────────────────────────

interface EventGroup {
  type:   string
  events: TimelineEvent[]
}

function groupTimeline(events: TimelineEvent[]): EventGroup[] {
  const groups: EventGroup[] = []
  for (const ev of events) {
    const last = groups[groups.length - 1]
    if (last && last.type === ev.type) {
      last.events.push(ev)
    } else {
      groups.push({ type: ev.type, events: [ev] })
    }
  }
  return groups
}

function GroupedTimelineRow({ group, isLast }: { group: EventGroup; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)

  if (group.events.length === 1) {
    return <TimelineRow event={group.events[0]} isLast={isLast} />
  }

  // Multi-event group — show summary chip + expand toggle
  const warnCount = group.events.filter(e => e.severity === 'warning' || e.severity === 'error').length
  const Icon      = eventIcon(group.type)
  const colors    = SEVERITY_COLORS[warnCount > 0 ? (group.events.some(e => e.severity === 'error') ? 'error' : 'warning') : 'neutral']

  return (
    <div className="relative flex gap-3">
      {/* Vertical connector */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={cn('w-2.5 h-2.5 rounded-full ring-2 ring-background mt-1 flex-shrink-0', colors.dot)} />
        {(!isLast || expanded) && <div className="w-px flex-1 bg-border/40 mt-1" style={{ minHeight: '16px' }} />}
      </div>

      <div className="flex-1 mb-2">
        {/* Group header */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className={cn(
            'w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border text-left transition-colors',
            colors.bg, colors.border,
            'hover:opacity-90',
          )}
        >
          <div className="flex items-center gap-2">
            <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', colors.icon)} />
            <span className="text-xs font-medium text-foreground">
              {group.events[0].label.split('·')[0].trim()}
            </span>
            <span className={cn(
              'text-[10px] px-1.5 py-0 rounded-full font-semibold',
              colors.icon, 'bg-background/60',
            )}>
              ×{group.events.length}
            </span>
            {warnCount > 0 && (
              <span className="text-[10px] text-warning font-semibold flex-shrink-0">
                {warnCount} issue{warnCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        </button>

        {/* Expanded individual events */}
        {expanded && (
          <div className="mt-1 ml-2 space-y-0 border-l-2 border-border/30 pl-2">
            {group.events.map((ev, i) => (
              <TimelineRow key={i} event={ev} isLast={i === group.events.length - 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Severity summary bar ──────────────────────────────────────────────────────

function SeveritySummaryBar({
  events,
  activeFilter,
  onFilter,
}: {
  events:       TimelineEvent[]
  activeFilter: SeverityFilter
  onFilter:     (f: SeverityFilter) => void
}) {
  const counts = useMemo(() => ({
    error:   events.filter(e => e.severity === 'error').length,
    warning: events.filter(e => e.severity === 'warning').length,
    success: events.filter(e => e.severity === 'success').length,
    info:    events.filter(e => e.severity === 'info').length,
    neutral: events.filter(e => e.severity === 'neutral').length,
  }), [events])

  const total = events.length
  if (total === 0) return null

  return (
    <div className="flex items-center gap-3 mb-3 px-0.5">
      <span className="text-[10px] text-muted-foreground font-semibold flex-shrink-0">Severity:</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {([
          ['critical', '⚠ Critical', counts.error + counts.warning, 'text-destructive bg-destructive/10 border-destructive/20'],
          ['all',      '● All',       total, 'text-muted-foreground bg-muted/50 border-border/40'],
        ] as [SeverityFilter, string, number, string][]).map(([f, label, count]) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors',
              f === 'critical'
                ? 'text-destructive bg-destructive/10 border-destructive/20 hover:bg-destructive/20'
                : 'text-muted-foreground bg-muted/50 border-border/40 hover:bg-muted',
              activeFilter === f && (f === 'critical'
                ? 'ring-1 ring-destructive/40 font-semibold'
                : 'ring-1 ring-border font-semibold'),
            )}
          >
            {label}
            <span className="font-bold">{count}</span>
          </button>
        ))}
        {/* Individual severity pips (non-interactive, info only) */}
        {counts.error > 0 && (
          <span className="text-[10px] text-destructive flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />
            {counts.error}
          </span>
        )}
        {counts.warning > 0 && (
          <span className="text-[10px] text-warning flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
            {counts.warning}
          </span>
        )}
        {counts.success > 0 && (
          <span className="text-[10px] text-success flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            {counts.success}
          </span>
        )}
        {counts.info > 0 && (
          <span className="text-[10px] text-info flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-info inline-block" />
            {counts.info}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Category filter bar ───────────────────────────────────────────────────────

function CategoryFilterBar({
  events,
  active,
  onChange,
}: {
  events:   TimelineEvent[]
  active:   EventCategory
  onChange: (c: EventCategory) => void
}) {
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: events.length }
    for (const def of CATEGORY_DEFS) {
      if (def.id !== 'all') {
        m[def.id] = events.filter(e => def.types.includes(e.type)).length
      }
    }
    return m
  }, [events])

  return (
    <div className="flex flex-wrap gap-1.5 pb-2 border-b border-border/40 mb-3">
      {CATEGORY_DEFS.map(def => {
        const count = counts[def.id] ?? 0
        const isActive = active === def.id
        return (
          <button
            key={def.id}
            onClick={() => onChange(def.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            <def.icon className="h-3 w-3" />
            {def.label}
            {count > 0 && (
              <span className={cn(
                'rounded-full px-1.5 py-0 text-[9px] font-bold',
                isActive ? 'bg-white/20' : 'bg-background',
              )}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Severity filter ───────────────────────────────────────────────────────────

type SeverityFilter = 'all' | 'critical'

// ── Main page ─────────────────────────────────────────────────────────────────

export function AttendanceTimeline() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [searchParams, setSearchParams] = useSearchParams()
  const [empInput,  setEmpInput]  = useState(searchParams.get('employeeId') ?? '')
  // Default to the date from the URL param if present; otherwise empty string.
  // Do NOT default to today — if data is historical (e.g. 2025 uploads while
  // current date is 2026), defaulting to today produces "No events found" with
  // no indication of what went wrong.
  const [dateInput, setDateInput] = useState(searchParams.get('date') ?? '')
  const [applied, setApplied]     = useState({
    employeeId: searchParams.get('employeeId') ?? '',
    date:       searchParams.get('date') ?? '',
  })

  // Filter state
  const [catFilter,      setCatFilter]      = useState<EventCategory>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [anomaliesOnly,  setAnomaliesOnly]  = useState(false)
  const [groupMode,      setGroupMode]      = useState(false)

  function handleSearch() {
    if (!empInput.trim() || !dateInput) return
    setApplied({ employeeId: empInput.trim(), date: dateInput })
    setSearchParams({ employeeId: empInput.trim(), date: dateInput })
    // Reset filters on new search
    setCatFilter('all')
    setSeverityFilter('all')
    setAnomaliesOnly(false)
    setGroupMode(false)
  }

  const canQuery = !!applied.employeeId && !!applied.date

  const { data, isLoading, isError, error } = useQuery<ForensicsData>({
    queryKey:  ['attendance-forensics', applied.employeeId, applied.date],
    queryFn:   () => api.get(`/attendance/forensics/${applied.employeeId}/${applied.date}`),
    enabled:   canQuery && isAdmin,
    staleTime: 60_000,
  })

  // ── Filtered timeline ───────────────────────────────────────────────────────

  const filteredTimeline = useMemo(() => {
    if (!data) return []
    return data.timeline.filter(ev => {
      // Category filter
      if (catFilter !== 'all') {
        const def = CATEGORY_DEFS.find(d => d.id === catFilter)
        if (def && !def.types.includes(ev.type)) return false
      }
      // Severity filter
      if (severityFilter === 'critical' && ev.severity !== 'warning' && ev.severity !== 'error') return false
      // Anomalies only
      if (anomaliesOnly && ev.severity !== 'warning' && ev.severity !== 'error') return false
      return true
    })
  }, [data, catFilter, severityFilter, anomaliesOnly])

  const warnCount  = useMemo(() => data?.timeline?.filter(e => e.severity === 'warning' || e.severity === 'error').length ?? 0, [data])
  const statusInfo = data?.daily_record ? STATUS_BADGE[data.daily_record.status] : null

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Attendance Forensics" subtitle="Per-day event trace" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Access restricted</p>
            <p className="text-xs text-muted-foreground">HR Admin or Super Admin role required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Forensics"
        subtitle="Full event trace for a single employee on a specific date"
        breadcrumb={[
          { label: 'Attendance', href: '/admin/attendance' },
          { label: 'Forensics' },
        ]}
      />

      {/* ── Lookup ────────────────────────────────────────────────────────────── */}
      <SectionCard title="Lookup" icon={<Search className="h-4 w-4 text-muted-foreground" />}>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Employee</label>
            <EmployeeSelector
              value={empInput}
              onChange={v => setEmpInput(typeof v === 'string' ? v : (v[0] ?? ''))}
              placeholder="Search employee by name or code…"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <DateInput
              value={dateInput}
              onChange={setDateInput}
              className="h-8 text-xs w-40"
            />
          </div>
          <Button onClick={handleSearch} className="h-8 text-xs" disabled={!empInput.trim() || !dateInput}>
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Trace
          </Button>
        </div>
      </SectionCard>

      {/* ── Loading / Error ────────────────────────────────────────────────────── */}
      {isLoading && (
        <SectionCard>
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Loading forensics data…</p>
          </div>
        </SectionCard>
      )}

      {isError && (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <XCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-destructive font-medium">Failed to load forensics</p>
            <p className="text-xs text-muted-foreground">{(error as Error)?.message ?? 'Unknown error'}</p>
          </div>
        </SectionCard>
      )}

      {data && (
        <>
          {/* ── Computation Flow (Phase 4: data pipeline visualization) ──────── */}
          <SectionCard
            title="Computation Flow"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            description="Data pipeline from raw punches to final attendance status"
          >
            <ComputationFlow data={data} />
          </SectionCard>

          {/* ── Header: subject + daily metrics ──────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SectionCard title="Subject" icon={<User className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-2.5 text-sm">
                <div>
                  <p className="text-[10px] text-muted-foreground">Employee</p>
                  <p className="font-semibold">{data.employee.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{data.employee.code}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Date</p>
                  <p className="font-medium">{data.date}</p>
                </div>
                {statusInfo && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Final Status</p>
                    <Badge variant={statusInfo.variant} className="rounded-full capitalize text-xs">
                      {statusInfo.label}
                    </Badge>
                  </div>
                )}
                {/* Source pipeline badge */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Attendance Source</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(data.source_type === 'biometric' || data.source_type === 'mixed') && (
                      <SourceBadge badge="Biometric Device" />
                    )}
                    {(data.source_type === 'csv_upload' || data.source_type === 'mixed') && (
                      <SourceBadge badge="CSV Upload" />
                    )}
                    {data.source_type === 'none' && (
                      <span className="text-[10px] text-muted-foreground italic">No punch data found</span>
                    )}
                    {data.computed_source === 'manual' && <SourceBadge badge="Manual Override" />}
                    {data.computed_source === 'leave_approval' && <SourceBadge badge="Leave Override" />}
                    {data.computed_source === 'regularization' && <SourceBadge badge="Correction" />}
                  </div>
                </div>
                {!data.daily_record && (
                  <p className="text-xs text-muted-foreground italic">No daily record computed yet</p>
                )}
                {/* Cross-link to other pages */}
                <div className="pt-1 space-y-1 border-t border-border/40">
                  <Link
                    to={`/admin/attendance/anomalies?employeeId=${data.employee.id}`}
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    View anomalies
                  </Link>
                  <Link
                    to={`/admin/attendance/corrections?employeeId=${data.employee.id}`}
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
                  >
                    <ClipboardEdit className="h-3 w-3" />
                    View corrections
                  </Link>
                </div>
              </div>
            </SectionCard>

            {data.daily_record && (
              <SectionCard title="Daily Metrics" icon={<Clock className="h-4 w-4 text-muted-foreground" />} className="lg:col-span-2">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <MetricPill label="Work Hours"  value={`${data.daily_record.work_hours}h`}                             highlight />
                  <MetricPill label="Late"         value={fmtMinutes(data.daily_record.late_minutes)}                    />
                  <MetricPill label="Overtime"     value={fmtMinutes(data.daily_record.overtime_minutes)}                />
                  <MetricPill label="Day Fraction" value={data.daily_record.day_fraction}                                />
                  <MetricPill label="Payable"      value={data.daily_record.is_payable ? 'Yes' : 'No'}                  />
                  {/* Show total punches across both pipelines */}
                  <MetricPill
                    label={data.source_type === 'csv_upload' ? 'CSV Punches' : data.source_type === 'biometric' ? 'Device Punches' : 'Punches'}
                    value={data.raw_punches.length + (data.csv_punches?.length ?? 0)}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {data.daily_record.worked_on_holiday && (
                    <Badge variant="warning" className="rounded-full text-[10px]">Worked on Holiday</Badge>
                  )}
                  {data.daily_record.worked_on_weekly_off && (
                    <Badge variant="warning" className="rounded-full text-[10px]">Worked on Weekly-Off</Badge>
                  )}
                  {data.effective_shift && (
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      Shift: {data.effective_shift.name}
                      {data.effective_shift.source === 'roster' ? ' (roster override)' : ' (standing)'}
                    </Badge>
                  )}
                  {data.holiday && (
                    <Badge variant="outline" className="rounded-full text-[10px]">Holiday: {data.holiday.name}</Badge>
                  )}
                  {data.is_weekly_off && (
                    <Badge variant="secondary" className="rounded-full text-[10px]">Weekly-Off Day</Badge>
                  )}
                </div>
              </SectionCard>
            )}
          </div>

          {/* ── Main: timeline + detail panels ───────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

            {/* Timeline (left, wide) */}
            <div className="lg:col-span-3">
              <SectionCard
                title={`Event Timeline`}
                icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
                action={
                  <div className="flex items-center gap-1.5">
                    {/* Group similar toggle */}
                    <button
                      onClick={() => setGroupMode(v => !v)}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors border',
                        groupMode
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border/40 hover:bg-muted/70',
                      )}
                      title={groupMode ? 'Switch to flat view' : 'Group consecutive same-type events'}
                    >
                      <Layers className="h-3 w-3" />
                      {groupMode ? 'Grouped' : 'Group'}
                    </button>
                    {/* Anomalies toggle */}
                    {warnCount > 0 && (
                      <button
                        onClick={() => setAnomaliesOnly(v => !v)}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors border',
                          anomaliesOnly
                            ? 'bg-warning text-warning-foreground border-warning'
                            : 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/20',
                        )}
                        title={anomaliesOnly ? 'Show all events' : 'Show warnings/errors only'}
                      >
                        {anomaliesOnly ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {warnCount} issues
                      </button>
                    )}
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {filteredTimeline.length}/{data.timeline.length}
                    </Badge>
                  </div>
                }
              >
                {/* Severity summary bar */}
                <SeveritySummaryBar
                  events={data.timeline}
                  activeFilter={severityFilter}
                  onFilter={f => { setSeverityFilter(f); setAnomaliesOnly(f === 'critical') }}
                />

                {/* Category filter bar */}
                <CategoryFilterBar
                  events={data.timeline}
                  active={catFilter}
                  onChange={c => { setCatFilter(c); setAnomaliesOnly(false) }}
                />

                {filteredTimeline.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2 text-center">
                    <Filter className="h-6 w-6 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">
                      {data.timeline.length === 0
                        ? 'No events found for this date.'
                        : 'No events match the current filter.'}
                    </p>
                    {data.timeline.length > 0 && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setCatFilter('all'); setAnomaliesOnly(false); setSeverityFilter('all') }}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="pt-1">
                    {groupMode
                      ? groupTimeline(filteredTimeline).map((group, i, arr) => (
                          <GroupedTimelineRow
                            key={i}
                            group={group}
                            isLast={i === arr.length - 1}
                          />
                        ))
                      : filteredTimeline.map((ev, i) => (
                          <TimelineRow key={i} event={ev} isLast={i === filteredTimeline.length - 1} />
                        ))
                    }
                    {/* Closing marker */}
                    <div className="flex items-center gap-2 ml-[5px]">
                      <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20 ring-2 ring-background" />
                      <span className="text-[10px] text-muted-foreground/40">
                        end of trace · {filteredTimeline.length} event{filteredTimeline.length !== 1 ? 's' : ''}
                        {filteredTimeline.length < data.timeline.length && ` (${data.timeline.length - filteredTimeline.length} filtered)`}
                        {groupMode && ` · grouped`}
                      </span>
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>

            {/* Data panels (right) */}
            <div className="lg:col-span-2 space-y-4">

              {/* Raw punches — biometric device (Pipeline A) */}
              <SectionCard
                title={`Device Punches (${data.raw_punches.length})`}
                icon={<Wifi className="h-4 w-4 text-muted-foreground" />}
              >
                {data.raw_punches.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No biometric device punches recorded.
                    {data.source_type === 'csv_upload' && ' Attendance sourced from CSV upload — see CSV Punches below.'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {data.raw_punches.map((p, i) => (
                      <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/60 text-[10px] w-4">#{i + 1}</span>
                          <span className="font-mono text-foreground">{fmtTime(p.punch_time)}</span>
                          {p.direction && (
                            <Badge
                              variant={p.direction === 'in' ? 'success' : 'secondary'}
                              className="text-[9px] rounded-full px-1.5 py-0"
                            >
                              {p.direction.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        {p.device_id && (
                          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[80px]" title={p.device_id}>{p.device_id}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* CSV punches — Pipeline B (always shown; non-empty = CSV upload source) */}
              <SectionCard
                title={`CSV Punches (${data.csv_punches?.length ?? 0})`}
                icon={<Upload className="h-4 w-4 text-muted-foreground" />}
              >
                {(data.csv_punches?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No CSV-uploaded punches for this date.
                    {data.source_type === 'biometric' && ' Attendance sourced from biometric device — see Device Punches above.'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {data.csv_punches.map((p, i) => (
                      <div key={p.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/60 text-[10px] w-4">#{i + 1}</span>
                          <span className="font-mono text-foreground">{fmtTime(p.punched_at)}</span>
                          {p.direction && (
                            <Badge
                              variant={p.direction === 'IN' ? 'success' : 'secondary'}
                              className="text-[9px] rounded-full px-1.5 py-0"
                            >
                              {p.direction}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-info font-medium flex items-center gap-0.5">
                          <Upload className="h-2.5 w-2.5" />
                          {p.source ?? 'csv_upload'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Processed sessions */}
              <SectionCard title={`Sessions (${data.processed_sessions.length})`} icon={<Clock className="h-4 w-4 text-muted-foreground" />}>
                {data.processed_sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No processed sessions.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.processed_sessions.map((s, i) => (
                      <div key={s.id} className={cn(
                        'text-xs p-2 rounded-md',
                        s.is_complete ? 'bg-muted/40' : 'bg-warning/10 border border-warning/20',
                      )}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-muted-foreground font-medium">Session #{i + 1}</span>
                          <div className="flex items-center gap-1.5">
                            {!s.is_complete && <Badge variant="warning" className="text-[9px] rounded-full px-1.5">Incomplete</Badge>}
                            {s.work_minutes != null && (
                              <span className="text-[10px] text-muted-foreground font-mono">{fmtMinutes(Math.round(s.work_minutes))}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <span className="text-muted-foreground">IN: <span className="font-mono text-foreground">{fmtTime(s.check_in)}</span></span>
                          <span className="text-muted-foreground">OUT: <span className={cn('font-mono', s.check_out ? 'text-foreground' : 'text-warning')}>
                            {s.check_out ? fmtTime(s.check_out) : '—'}
                          </span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Audit trail — with inline StatusChangePill diffs */}
              {data.audit_trail.length > 0 && (
                <SectionCard title={`Audit Trail (${data.audit_trail.length})`} icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}>
                  <div className="space-y-2">
                    {data.audit_trail.map(a => (
                      <div key={a.id} className="text-xs p-2 rounded-md bg-muted/30 border border-border/40">
                        {/* Status diff — human-readable */}
                        <div className="flex items-center justify-between mb-1">
                          <StatusChangePill before={a.before_status} after={a.after_status} />
                          <Badge variant="outline" className="text-[9px] rounded-full capitalize">{a.source}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{fmtDateTime(a.created_at)}</span>
                          {a.changed_by && <span className="italic">by {a.changed_by}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* Corrections */}
              {data.corrections.length > 0 && (
                <SectionCard title={`Corrections (${data.corrections.length})`} icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}>
                  {data.corrections.map(c => (
                    <div key={c.id} className="text-xs p-2 rounded-md bg-muted/40 mb-1.5 last:mb-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <Badge
                          variant={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'destructive' : 'warning'}
                          className="text-[9px] rounded-full capitalize"
                        >
                          {c.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                      </div>
                      {c.reason && <p className="text-muted-foreground mt-0.5 leading-snug">{c.reason}</p>}
                      <div className="flex gap-3 mt-1 font-mono">
                        {c.requested_check_in  && <span>IN: {fmtTime(c.requested_check_in)}</span>}
                        {c.requested_check_out && <span>OUT: {fmtTime(c.requested_check_out)}</span>}
                      </div>
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* Leave applications */}
              {data.leave_applications.length > 0 && (
                <SectionCard title={`Leave (${data.leave_applications.length})`} icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}>
                  {data.leave_applications.map(la => (
                    <div key={la.id} className="text-xs p-2 rounded-md bg-muted/40 mb-1.5 last:mb-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-medium">{la.leave_types?.name ?? 'Unknown type'}</span>
                        <Badge
                          variant={la.status === 'approved' ? 'success' : la.status === 'rejected' ? 'destructive' : 'warning'}
                          className="text-[9px] rounded-full capitalize"
                        >
                          {la.status}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{la.from_date} – {la.to_date}</p>
                      {la.leave_types?.is_paid !== undefined && (
                        <Badge variant={la.leave_types.is_paid ? 'success' : 'secondary'} className="text-[9px] rounded-full mt-1">
                          {la.leave_types.is_paid ? 'Paid' : 'Unpaid'}
                        </Badge>
                      )}
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* Policy evaluations */}
              {data.policy_evaluations.length > 0 && (
                <SectionCard title={`Policy Evaluations (${data.policy_evaluations.length})`} icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
                  {data.policy_evaluations.map(pe => (
                    <div key={pe.id} className={cn('text-xs p-2 rounded-md mb-1.5 last:mb-0', pe.is_simulation ? 'bg-warning/10 border border-warning/20' : 'bg-muted/40')}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-medium">
                          {pe.policy_name ?? 'No policy matched'}
                          {pe.policy_version != null && <span className="text-muted-foreground ml-1">v{pe.policy_version}</span>}
                        </span>
                        {pe.is_simulation && (
                          <Badge variant="warning" className="text-[9px] rounded-full">sim</Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground">
                        Via: <span className="font-medium capitalize">{pe.resolved_via.replace('_', ' ')}</span>
                        {' · '}Trigger: <span className="font-medium capitalize">{pe.trigger_context.replace('_', ' ')}</span>
                      </p>
                      {!pe.eligible && pe.eligibility_reason && (
                        <p className="text-destructive mt-0.5">{pe.eligibility_reason}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(pe.evaluated_at)}</p>
                    </div>
                  ))}
                </SectionCard>
              )}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!canQuery && !isLoading && !data && (
        <SectionCard>
          <div className="flex flex-col items-center py-12 gap-3 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">Enter an employee UUID and date to begin</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              The forensics trace shows every event that shaped the daily attendance record —
              from raw device punches through shift resolution, policy evaluation, to final status.
            </p>
          </div>
        </SectionCard>
      )}
    </PageContainer>
  )
}
