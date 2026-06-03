/**
 * Admin Control Center  — /admin/control-center
 *
 * Primary admin home. Exception-first operational visibility.
 * Layout matches enterprise design spec (screenshot reference).
 *
 * Data sources — all real endpoints, no fake analytics:
 *   GET /system/operational-health      → System Health, Workforce Snapshot, Reconciliation, Scheduler
 *   GET /attendance/exceptions/summary  → Exceptions feed
 *   GET /system/scheduler-health        → Scheduler rows
 *   GET /attendance/reconciliation/open → Reconciliation issues
 *   GET /system/event-governance/log    → Operations Timeline
 *   GET /analytics/dashboard            → Workforce KPIs
 *   GET /attendance/anomalies           → Anomaly count
 *   GET /attendance/corrections         → Corrections count
 *   GET /attendance/regularisation/pending → Pending approvals
 *   GET /attendance/process/last        → Last processing run
 *   GET /attendance/muster              → Absent trend
 */

import { useMemo }              from 'react'
import { useNavigate }          from 'react-router-dom'
import { useQuery }             from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, XCircle,
  Zap, RefreshCw, AlertCircle,
  Database, Users,
  Radio,
  ExternalLink, GitMerge, Lock,
  ArrowUpRight, Inbox,
  UserCheck, UserPlus, UserX, Play, CheckSquare,
  CalendarCheck, FileSearch, ClipboardList, ArrowRight,
  Activity, BarChart3, TrendingUp, ChevronRight,
} from 'lucide-react'
import { InsightChart, EmptyWorkspaceState } from '@/components/dashboard'
import { OperationalTable } from '@/components/dashboard/primitives'
import type { OpsTableColumn } from '@/components/dashboard/primitives'
import type { DashboardStats }  from '@/types'
import { cn }      from '@/lib/utils'
import { api }     from '@/lib/api/client'
import { Button }  from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OperationalHealthData {
  timestamp:          string
  overall_health:     'healthy' | 'degraded' | 'critical' | string
  attendance_freshness: {
    health:                    string
    total_active_employees:    number
    employees_with_data:       number
    employees_stale:           number
    employees_missing:         number
    unprocessed_raw_logs:      number
    oldest_unprocessed_hours:  number | null
    hours_since_last_run:      number | null
    last_processing_run_at:    string | null
  }
  reconciliation: {
    attendance: { critical: number; error: number; warning: number; info: number; total: number }
    leave:      { critical: number; error: number; warning: number; info: number; total: number }
  }
  scheduler: {
    health:     string
    heartbeats: Array<{
      scheduler_name:    string
      status:            string
      tick_count:        number
      last_error:        string | null
      age_seconds:       number | null
      is_stale:          boolean
    }>
  }
  durable_queue: {
    pending?: number
    running?: number
    dead?:    number
    error?:   string
  }
  payroll: {
    current_month: string
    current_run: {
      id: string; status: string
      employee_count: number
      total_gross: number; total_net: number
      finalized_at: string | null; created_at: string
    } | null
    prev_month: string
    prev_run: { id: string; status: string; finalized_at: string | null } | null
  }
  platform: { status: string; uptime_seconds: number }
}

interface ExceptionSummary {
  total:       number
  open:        number
  by_severity: Record<string, number>
  by_category: Record<string, number>
}

interface SchedulerRow {
  scheduler_name:    string
  last_heartbeat_at: string | null
  status:            string
  tick_count:        number
  is_stale:          boolean
  age_seconds:       number | null
  last_error?:       string | null
}

interface ReconciliationIssue {
  id:          string
  issue_type:  string
  severity:    string
  description: string
  created_at:  string
  resolved:    boolean
}

interface EventLogEntry {
  id:         string
  event_type: string
  created_at: string
  status?:    string
  metadata:   Record<string, unknown>
}

interface AnomalyResp     { total?: number; data?: unknown[] }
interface CorrectionsResp { total?: number; data?: unknown[] }
interface RegularisationItem {
  id: string; employee_name?: string; employee_code?: string
  date: string; reason: string; status: string; created_at: string
}
interface MusterDay      { date: string; status: string | null; work_hours: number }
interface MusterEmployee { employee_id: string; name: string; days: MusterDay[] }
interface MusterResp     { month: string; employees: MusterEmployee[] }
interface LastRun {
  id: string; status: string; completed_at: string | null; started_at: string
  processed_count: number; error_message: string | null; duration_ms: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 60)    return `${seconds}s ago`
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function fmtINR(val: number): string {
  if (!val) return '—'
  if (val >= 1_00_00_000) return `₹${(val / 1_00_00_000).toFixed(1)} Cr`
  if (val >= 1_00_000)    return `₹${(val / 1_00_000).toFixed(1)} L`
  return `₹${val.toLocaleString('en-IN')}`
}

function fmtDate(s: string) {
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}
function fmtDateTime(s: string) {
  const d = new Date(s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}
function monthRange() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const from = new Date(y, m, 1).toISOString().slice(0, 10)
  const to   = new Date(y, m + 1, 0).toISOString().slice(0, 10)
  return { from, to, label: now.toLocaleString('default', { month: 'long', year: 'numeric' }) }
}

const SCHEDULER_LABELS: Record<string, string> = {
  leave_scheduler:       'Leave Engine',
  attendance_scheduler:  'Attendance sync',
  payroll_scheduler:     'Payroll reconcile',
  carry_forward:         'Carry Forward Engine',
  event_grant:           'Event Grant Engine',
  reconciliation:        'Compliance audit',
  accrual:               'Accrual Engine',
}
function schedulerLabel(name: string): string {
  return SCHEDULER_LABELS[name] ?? name.replace(/_/g, ' ')
}

// ── Mini UI primitives ────────────────────────────────────────────────────────

/** Inline colored status dot + text pill */
function StatusPill({ label, status, sub }: { label: string; status: string; sub?: string }) {
  const isCrit = status === 'critical' || status === 'stale'
  const isDeg  = status === 'degraded' || status === 'unknown' || status === 'draft'
  const isOk   = status === 'healthy'  || status === 'clean'   || status === 'alive' || status === 'finalized'
  return (
    <div className={cn(
      'flex flex-col gap-0.5 rounded-lg px-3 py-2.5 border',
      isCrit ? 'bg-destructive/5 border-destructive/15' :
      isDeg  ? 'bg-warning/5 border-warning/15' :
      isOk   ? 'bg-success/5 border-success/15' :
               'bg-info/5 border-info/15',
    )}>
      <div className="flex items-center gap-1.5">
        <span className={cn(
          'h-1.5 w-1.5 rounded-full flex-shrink-0',
          isCrit ? 'bg-destructive' : isDeg ? 'bg-warning' : isOk ? 'bg-success' : 'bg-info',
        )} />
        <span className={cn(
          'text-[9.5px] font-bold uppercase tracking-widest',
          isCrit ? 'text-destructive' : isDeg ? 'text-warning' : isOk ? 'text-success' : 'text-info',
        )}>{label}</span>
      </div>
      {sub && <p className="text-[11px] font-semibold text-foreground/80 leading-none pl-3">{sub}</p>}
    </div>
  )
}

/** Scheduler status badge */
function SchedBadge({ status, isStale }: { status: string; isStale: boolean }) {
  const s = isStale ? 'stale' : (status?.toLowerCase() ?? 'idle')
  const cfg = {
    running: { cls: 'bg-success/10 text-success border-success/20', label: 'RUNNING' },
    queued:  { cls: 'bg-info/10 text-info border-info/20',           label: 'QUEUED' },
    idle:    { cls: 'bg-muted text-muted-foreground border-border',  label: 'IDLE' },
    alive:   { cls: 'bg-success/10 text-success border-success/20', label: 'ALIVE' },
    stale:   { cls: 'bg-destructive/10 text-destructive border-destructive/20', label: 'STALE' },
  }
  const c = cfg[s as keyof typeof cfg] ?? cfg.idle
  return (
    <span className={cn('inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border', c.cls)}>
      {c.label}
    </span>
  )
}

function ZoneSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  )
}

function ZoneError({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground justify-center">
      <AlertCircle className="h-3.5 w-3.5 text-destructive/60" />
      {message ?? 'Failed to load — will retry'}
    </div>
  )
}

/** Standard card with title + optional action */
function Card({ title, action, children, className, noPad }: {
  title?: string; action?: React.ReactNode; children: React.ReactNode
  className?: string; noPad?: boolean
}) {
  return (
    <div className={cn('rounded-2xl bg-card shadow-card flex flex-col', className)}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
          <p className="font-display text-[13.5px] font-bold text-foreground">{title}</p>
          {action}
        </div>
      )}
      <div className={cn('flex-1', !noPad && !title && 'p-4')}>{children}</div>
    </div>
  )
}

/**
 * KpiCard — next-gen stat tile with pastel icon container.
 * Matches the Daily-ADS / Rippling / Deel pattern:
 *   [icon box]  label
 *               BIG NUMBER
 *               sub / trend
 */
function KpiCard({
  label, value, icon: Icon,
  iconBg, iconColor,
  valueColor,
  sub, trend, trendPositive,
  onClick,
}: {
  label:          string
  value:          string | number
  icon:           React.ComponentType<{ className?: string }>
  iconBg:         string   // e.g. 'bg-teal-50'
  iconColor:      string   // e.g. 'text-teal-600'
  valueColor?:    string
  sub?:           string
  trend?:         string   // e.g. '+12%' or '↑ 3'
  trendPositive?: boolean  // true = green, false = red
  onClick?:       () => void
}) {
  return (
    <div
      className={cn(
        // Harmony KPI signature: 3px colored top-border + card surface
        'rounded-xl border border-border border-t-[3px] border-t-primary bg-card shadow-card p-5 flex flex-col gap-3',
        onClick && 'cursor-pointer hover:shadow-card-md transition-shadow',
      )}
      onClick={onClick}
    >
      {/* Icon container + optional trend badge */}
      <div className="flex items-start justify-between">
        <span className={cn('h-11 w-11 rounded-2xl flex items-center justify-center flex-shrink-0', iconBg)}>
          <Icon className={cn('h-5 w-5', iconColor)} />
        </span>
        {trend && (
          <span className={cn(
            'text-[9.5px] font-bold px-2 py-1 rounded-full tracking-wide',
            trendPositive === true  ? 'bg-success/10 text-success' :
            trendPositive === false ? 'bg-destructive/10 text-destructive' :
                                      'bg-muted text-muted-foreground',
          )}>
            {trend}
          </span>
        )}
      </div>
      {/* Metric */}
      <div>
        <p className="text-[9.5px] font-bold uppercase tracking-widest text-muted-foreground leading-none">
          {label}
        </p>
        <p className={cn(
          'font-display text-[2rem] font-black tabular-nums leading-none mt-2',
          valueColor ?? 'text-foreground',
        )}>
          {value ?? '—'}
        </p>
        {sub && (
          <p className="text-[11px] text-muted-foreground mt-1.5 leading-none">{sub}</p>
        )}
      </div>
    </div>
  )
}

const EVENT_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  payroll_finalized:   { icon: CheckCircle2,  color: 'text-success' },
  scheduler_restarted: { icon: RefreshCw,     color: 'text-info' },
  replay_completed:    { icon: GitMerge,      color: 'text-primary' },
  freeze_lifted:       { icon: Lock,          color: 'text-warning' },
  declaration_locked:  { icon: Lock,          color: 'text-muted-foreground' },
  proof_rejected:      { icon: XCircle,       color: 'text-destructive' },
  carry_forward:       { icon: ArrowUpRight,  color: 'text-success' },
  anomaly_detected:    { icon: AlertTriangle, color: 'text-warning' },
}

// ── ControlCenter ─────────────────────────────────────────────────────────────

export function ControlCenter() {
  const nav = useNavigate()

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: opHealthRaw,
    isLoading: ohLoading,
    isError: ohError,
    dataUpdatedAt: ohUpdatedAt,
    refetch: refetchOH,
  } = useQuery<{ data: OperationalHealthData }>({
    queryKey:        ['control-center-operational-health'],
    queryFn:         () => api.get('/system/operational-health'),
    staleTime:       20_000,
    refetchInterval: 30_000,
  })

  const { data: excSummaryRaw, isLoading: excLoading, isError: excError } =
    useQuery<{ data: ExceptionSummary }>({
      queryKey:        ['control-center-exceptions-summary'],
      queryFn:         () => api.get('/attendance/exceptions/summary'),
      staleTime:       20_000,
      refetchInterval: 30_000,
    })

  const { data: schedulerRaw, isLoading: schLoading } =
    useQuery<{ data: SchedulerRow[]; stale_count: number; healthy: boolean }>({
      queryKey:        ['control-center-scheduler-health'],
      queryFn:         () => api.get('/system/scheduler-health'),
      staleTime:       30_000,
      refetchInterval: 60_000,
    })

  const { data: reconcRaw, isLoading: reconcLoading } =
    useQuery<{ data: ReconciliationIssue[]; total: number }>({
      queryKey:        ['control-center-reconciliation-open'],
      queryFn:         () => api.get('/attendance/reconciliation/open'),
      staleTime:       30_000,
      refetchInterval: 60_000,
    })

  const { data: eventLogRaw, isLoading: evLoading } =
    useQuery<{ data: EventLogEntry[]; total: number }>({
      queryKey:        ['control-center-event-log'],
      queryFn:         () => api.get('/system/event-governance/log?limit=20&offset=0'),
      staleTime:       30_000,
      refetchInterval: 60_000,
    })

  const { data: dashStats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn:  () => api.get('/analytics/dashboard'),
    staleTime: 5 * 60_000,
  })

  const { data: anomalyResp } = useQuery<AnomalyResp>({
    queryKey: ['anomaly-count'],
    queryFn:  () => api.get('/attendance/anomalies?resolved=false&limit=1'),
    staleTime: 2 * 60_000,
    refetchInterval: 30_000,
  })

  const { data: correctionsResp } = useQuery<CorrectionsResp>({
    queryKey: ['corrections-count'],
    queryFn:  () => api.get('/attendance/corrections?status=pending&limit=1'),
    staleTime: 2 * 60_000,
  })

  const { data: regResp } = useQuery<{ data: RegularisationItem[] }>({
    queryKey: ['reg-pending'],
    queryFn:  () => api.get('/attendance/regularisation/pending'),
    staleTime: 60_000,
  })

  const { data: lastRunResp } = useQuery<{ run: LastRun | null }>({
    queryKey: ['last-run-dash'],
    queryFn:  () => api.get('/attendance/process/last'),
    staleTime: 60_000,
  })

  const { from: mFrom } = monthRange()
  const musterMonth = mFrom.slice(0, 7)
  const { data: musterResp } = useQuery<MusterResp>({
    queryKey: ['muster-dash', musterMonth],
    queryFn:  () => api.get(`/attendance/muster?month=${musterMonth}`),
    staleTime: 5 * 60_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  const oh           = opHealthRaw?.data
  const excSummary   = excSummaryRaw?.data

  // Deduplicate by scheduler_name — API can occasionally return the same name
  // twice (e.g. both a legacy 'leave-scheduler' and 'leave_scheduler' row).
  // Keep the row with the highest tick_count (most recently active).
  const schedulers = useMemo(() => {
    const raw = schedulerRaw?.data ?? []
    const seen = new Map<string, SchedulerRow>()
    for (const s of raw) {
      const existing = seen.get(s.scheduler_name)
      if (!existing || s.tick_count > existing.tick_count) {
        seen.set(s.scheduler_name, s)
      }
    }
    return [...seen.values()]
  }, [schedulerRaw])
  const reconcIssues = reconcRaw?.data ?? []
  const eventLog     = eventLogRaw?.data ?? []

  const lastUpdated = useMemo(() =>
    ohUpdatedAt
      ? new Date(ohUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : '—',
    [ohUpdatedAt],
  )

  const overallHealth  = oh?.overall_health ?? 'unknown'
  const freshness      = oh?.attendance_freshness
  const payroll        = oh?.payroll
  const durable        = oh?.durable_queue
  const reconciliation = oh?.reconciliation

  const totalReconcIssues = (reconciliation?.attendance.total ?? 0) + (reconciliation?.leave.total ?? 0)
  const criticalIssues    = (reconciliation?.attendance.critical ?? 0)
    + (reconciliation?.leave.critical ?? 0)
    + (excSummary?.by_severity?.critical ?? 0)

  const payrollStatus = payroll?.current_run?.status ?? 'no_run'
  const payrollHealth = payrollStatus === 'finalized' ? 'healthy'
    : payrollStatus === 'locked'  ? 'degraded'
    : payrollStatus === 'error'   ? 'critical'
    : payrollStatus === 'no_run'  ? 'unknown' : 'degraded'

  // Exception rows
  const exceptionRows = useMemo(() => {
    const rows: Array<{ label: string; count: number; severity: 'critical' | 'high' | 'medium' | 'low'; module: string }> = []
    if ((durable?.dead ?? 0) > 0)
      rows.push({ label: 'Dead queue jobs need retry', count: durable!.dead!, severity: 'critical', module: 'Automation · Job Queue' })
    if ((reconciliation?.attendance.critical ?? 0) > 0)
      rows.push({ label: 'Critical attendance reconciliation failures', count: reconciliation!.attendance.critical, severity: 'critical', module: 'Attendance · Reconciliation' })
    if ((reconciliation?.leave.critical ?? 0) > 0)
      rows.push({ label: 'Critical leave reconciliation failures', count: reconciliation!.leave.critical, severity: 'critical', module: 'Leave · Reconciliation' })
    const staleSchedulers = schedulers.filter(s => s.is_stale)
    if (staleSchedulers.length > 0)
      rows.push({ label: `Stale scheduler${staleSchedulers.length > 1 ? 's' : ''} detected`, count: staleSchedulers.length, severity: 'high', module: `Platform · ${staleSchedulers.map(s => schedulerLabel(s.scheduler_name)).join(', ')}` })
    if ((freshness?.employees_stale ?? 0) > 0)
      rows.push({ label: 'Employees with stale attendance data', count: freshness!.employees_stale, severity: 'high', module: 'Attendance · Freshness' })
    if ((freshness?.employees_missing ?? 0) > 0)
      rows.push({ label: 'Employees with no attendance data', count: freshness!.employees_missing, severity: 'high', module: 'Attendance · Missing Data' })
    if ((reconciliation?.attendance.error ?? 0) > 0)
      rows.push({ label: 'Attendance reconciliation errors', count: reconciliation!.attendance.error, severity: 'medium', module: 'Attendance · Reconciliation' })
    if ((reconciliation?.leave.error ?? 0) > 0)
      rows.push({ label: 'Leave reconciliation errors', count: reconciliation!.leave.error, severity: 'medium', module: 'Leave · Reconciliation' })
    if ((excSummary?.by_severity?.critical ?? 0) > 0)
      rows.push({ label: 'Attendance exceptions (critical)', count: excSummary!.by_severity.critical, severity: 'critical', module: 'Attendance · Exceptions' })
    if ((excSummary?.by_severity?.high ?? 0) > 0)
      rows.push({ label: 'Attendance exceptions (high)', count: excSummary!.by_severity.high, severity: 'high', module: 'Attendance · Exceptions' })
    if ((freshness?.unprocessed_raw_logs ?? 0) > 50)
      rows.push({ label: 'Unprocessed raw attendance logs', count: freshness!.unprocessed_raw_logs, severity: 'medium', module: 'Attendance · Processing Queue' })
    return rows.sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] - { critical: 0, high: 1, medium: 2, low: 3 }[b.severity]))
  }, [durable, reconciliation, schedulers, freshness, excSummary])

  // Reconciliation modules
  const reconcModules = useMemo(() => [
    { label: 'Attendance ↔ Payroll',  count: (reconciliation?.attendance.critical ?? 0) + (reconciliation?.attendance.error ?? 0), status: (reconciliation?.attendance.critical ?? 0) > 0 ? 'critical' : (reconciliation?.attendance.error ?? 0) > 0 ? 'warning' : 'healthy' },
    { label: 'Leave ↔ Payroll',       count: (reconciliation?.leave.critical ?? 0) + (reconciliation?.leave.error ?? 0),           status: (reconciliation?.leave.critical ?? 0) > 0 ? 'critical' : (reconciliation?.leave.error ?? 0) > 0 ? 'warning' : 'healthy' },
    { label: 'Durable Queue',         count: durable?.dead ?? 0,                                                                    status: (durable?.dead ?? 0) > 0 ? 'critical' : 'healthy' },
    { label: 'Scheduler Heartbeats',  count: schedulers.filter(s => s.is_stale).length,                                            status: schedulers.some(s => s.is_stale) ? 'warning' : 'healthy' },
  ], [reconciliation, durable, schedulers])

  // Merged dashboard derived
  const today          = new Date().toISOString().slice(0, 10)
  const anomalyCount   = anomalyResp?.total ?? (Array.isArray(anomalyResp?.data)     ? anomalyResp!.data.length     : 0)
  const correctionsCount = correctionsResp?.total ?? (Array.isArray(correctionsResp?.data) ? correctionsResp!.data.length : 0)
  const regList        = regResp?.data ?? []
  const lastRun        = lastRunResp?.run ?? null
  const runFailed      = lastRun?.status === 'failed'
  const isStale        = (() => {
    if (!lastRun)                    return true
    if (lastRun.status === 'failed') return false
    return lastRun.started_at?.slice(0, 10) !== today
  })()

  const todayAbsent = (() => {
    const emps = musterResp?.employees ?? []
    return emps.filter(e => e.days.find(d => d.date === today)?.status === 'absent').length
  })()

  const absentTrend = (() => {
    const emps = musterResp?.employees ?? []
    if (!emps.length) return []
    const dayMap = new Map<string, number>()
    for (const emp of emps)
      for (const d of emp.days)
        if (d.status !== null)
          dayMap.set(d.date, (dayMap.get(d.date) ?? 0) + (d.status === 'absent' ? 1 : 0))
    return [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, absent]) => ({ date: date.slice(5), absent }))
  })()

  // Absent trend summary stats
  const absentAvg = absentTrend.length > 0
    ? (absentTrend.reduce((s, d) => s + d.absent, 0) / absentTrend.length).toFixed(1) : '—'
  const absentPeak = absentTrend.length > 0 ? Math.max(...absentTrend.map(d => d.absent)) : 0
  const absentTrendPct = (() => {
    const recent = absentTrend.slice(-7)
    const prev   = absentTrend.slice(-14, -7)
    if (recent.length < 3 || prev.length < 3) return null
    const rAvg = recent.reduce((s, d) => s + d.absent, 0) / recent.length
    const pAvg = prev.reduce((s, d) => s + d.absent, 0)  / prev.length
    if (pAvg === 0) return null
    const pct = ((rAvg - pAvg) / pAvg * 100)
    return (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%'
  })()

  // Escalated corrections
  const SLA_BREACH_DAYS = 2
  const escalatedRegList = regList.filter(r => {
    if (r.status !== 'pending') return false
    return (Date.now() - new Date(r.created_at).getTime()) / (1_000 * 60 * 60 * 24) >= SLA_BREACH_DAYS
  })
  type RegRow = Record<string, unknown> & { id: string; employee: string; date_display: string; reason: string; submitted: string; age_label: string }
  const regRows: RegRow[] = escalatedRegList.slice(0, 12).map(r => {
    const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1_000 * 60 * 60 * 24))
    return {
      id:           r.id,
      employee:     r.employee_name ? `${r.employee_name}${r.employee_code ? ` · ${r.employee_code}` : ''}` : 'Employee',
      date_display: fmtDate(r.date),
      reason:       r.reason.slice(0, 55) + (r.reason.length > 55 ? '…' : ''),
      submitted:    fmtDate(r.created_at),
      age_label:    ageDays === 1 ? '1 day' : `${ageDays} days`,
    }
  })
  const regColumns: OpsTableColumn[] = [
    { header: 'Employee',  key: 'employee',     className: 'min-w-[140px]' },
    { header: 'Date',      key: 'date_display', width: '80px' },
    { header: 'Reason',    key: 'reason',       className: 'text-muted-foreground' },
    { header: 'Submitted', key: 'submitted',    width: '70px', className: 'text-muted-foreground' },
    {
      header: 'Pending', key: 'age_label', width: '70px',
      render: row => (
        <span className="inline-flex items-center text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
          {row.age_label as string}
        </span>
      ),
    },
    {
      header: '', key: '_link', width: '80px', align: 'right' as const,
      render: () => (
        <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2 text-primary"
          onClick={(e) => { e.stopPropagation(); nav('/admin/attendance/regularisation') }}>
          Review →
        </Button>
      ),
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-background p-5 space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Control Center</h1>
          <p className="text-[11.5px] text-muted-foreground mt-0.5">
            Operational health · Last updated {lastUpdated}
            {oh && (
              <span className={cn(
                'ml-2 inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                overallHealth === 'critical' ? 'bg-destructive/10 text-destructive' :
                overallHealth === 'degraded' ? 'bg-warning/10 text-warning' :
                'bg-success/10 text-success',
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full',
                  overallHealth === 'critical' ? 'bg-destructive' :
                  overallHealth === 'degraded' ? 'bg-warning' : 'bg-success',
                )} />
                {overallHealth.toUpperCase()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground"
            onClick={() => refetchOH()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1.5"
            onClick={() => nav('/admin/employees/new')}>
            + Add Employee
          </Button>
        </div>
      </div>

      {/* ── ROW 1: System Health + Employee counters ─────────────────────── */}
      <div className="grid grid-cols-[1.6fr_1fr] gap-4">

        {/* System Health card */}
        <Card
          title="System Health"
          action={
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              LIVE · {lastUpdated}
            </span>
          }
        >
          {ohLoading ? <ZoneSkeleton rows={1} /> : (
            <div className="grid grid-cols-4 gap-2.5 p-1">
              <StatusPill
                label="WORKFORCE"
                status={freshness?.health ?? 'unknown'}
                sub={freshness
                  ? `${freshness.employees_with_data} / ${freshness.total_active_employees} active`
                  : '—'}
              />
              <StatusPill
                label="PAYROLL"
                status={payrollHealth === 'healthy' ? 'healthy' : payrollStatus === 'draft' ? 'draft' : payrollHealth}
                sub={payroll?.current_run?.status
                  ? payroll.current_run.status.charAt(0).toUpperCase() + payroll.current_run.status.slice(1)
                  : payroll?.current_month ?? '—'}
              />
              <StatusPill
                label="RECONCILIATION"
                status={criticalIssues > 0 ? 'critical' : totalReconcIssues > 0 ? 'degraded' : 'healthy'}
                sub={totalReconcIssues > 0 ? `${totalReconcIssues} issues` : 'All matched'}
              />
              <StatusPill
                label="AUTOMATION"
                status={schedulers.some(s => s.is_stale) ? 'degraded' : schedulers.length === 0 ? 'unknown' : 'healthy'}
                sub={schedulers.length > 0
                  ? `${schedulers.filter(s => !s.is_stale).length} / ${schedulers.length}`
                  : 'No heartbeats'}
              />
            </div>
          )}
        </Card>

        {/* Employee KPI tiles */}
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="Total Employees"
            value={dashStats?.total_employees ?? freshness?.total_active_employees ?? '—'}
            icon={Users}
            iconBg="bg-cyan-50"
            iconColor="text-cyan-600"
            sub="Workforce roster →"
            onClick={() => nav('/admin/employees')}
          />
          <KpiCard
            label="Active"
            value={dashStats?.active_employees ?? freshness?.employees_with_data ?? '—'}
            icon={UserCheck}
            iconBg="bg-emerald-50"
            iconColor="text-emerald-600"
            valueColor="text-emerald-700"
            sub={
              dashStats?.active_employees && dashStats?.total_employees
                ? `${Math.round((dashStats.active_employees / dashStats.total_employees) * 100)}% of total`
                : 'Synced'
            }
            trend={dashStats?.active_employees && dashStats?.total_employees ? `${Math.round((dashStats.active_employees / dashStats.total_employees) * 100)}%` : undefined}
            trendPositive={true}
          />
        </div>
      </div>

      {/* ── Executive Intelligence Banner ────────────────────────────────── */}
      <button
        className="w-full text-left rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/[0.03] to-transparent px-5 py-3.5 flex items-center gap-4 hover:border-primary/40 hover:from-primary/10 hover:via-primary/[0.06] transition-all duration-200 group"
        onClick={() => nav('/admin/executive')}
      >
        {/* Icon */}
        <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
          <BarChart3 className="h-4.5 w-4.5 text-primary" />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground leading-tight">Executive Intelligence Center</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            CEO &amp; CHRO strategic view · workforce, financial, compliance &amp; trend analytics
          </p>
        </div>

        {/* Right side: trend indicator + arrow */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-primary/60" />
            <span>6 strategic views</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-primary">
            <span>Open</span>
            <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>
      </button>

      {/* ── ROW 2: Processing Banner + Anomaly KPI ───────────────────────── */}
      <div className="grid grid-cols-[1.6fr_1fr] gap-4">

        {/* Processing banner */}
        <div className={cn(
          'rounded-2xl border px-5 py-4 flex items-center justify-between gap-4',
          runFailed ? 'bg-destructive/5 border-destructive/20' :
          isStale   ? 'bg-warning/5 border-warning/20' :
                      'bg-success/5 border-success/20',
        )}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={cn('h-4 w-4 mt-0.5 flex-shrink-0',
              runFailed ? 'text-destructive' : isStale ? 'text-warning' : 'text-success')} />
            <div>
              <p className={cn('text-[13px] font-semibold',
                runFailed ? 'text-destructive' : isStale ? 'text-warning' : 'text-success')}>
                {runFailed ? 'Last attendance processing run failed'
                 : isStale  ? 'Attendance not yet processed today'
                 : `Processed: ${lastRun?.processed_count ?? 0} employees`}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {lastRun
                  ? `${fmtDateTime(lastRun.started_at)}${lastRun.duration_ms ? ` · ${Math.round(lastRun.duration_ms / 1000)}s` : ''}`
                  : 'No runs recorded'}
                {regList.length > 0 && ` · ${regList.length} regularisations pending manager approval`}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className={cn('shrink-0 h-8 text-xs font-semibold px-4',
              runFailed ? 'bg-destructive hover:bg-destructive/90 text-white' :
              isStale   ? 'bg-warning hover:bg-warning/90 text-warning-foreground' :
                          'bg-success hover:bg-success/90 text-white')}
            onClick={() => nav('/admin/attendance/center')}
          >
            Process now →
          </Button>
        </div>

        {/* Pending Regularizations KPI — replaces raw anomaly count (non-actionable) */}
        <KpiCard
          label="Pending Regularisations"
          value={regList.length}
          icon={ClipboardList}
          iconBg={regList.length > 0 ? 'bg-violet-50' : 'bg-muted'}
          iconColor={regList.length > 0 ? 'text-violet-600' : 'text-muted-foreground'}
          valueColor={regList.length > 0 ? 'text-violet-700' : undefined}
          sub="Awaiting manager action"
          trend={regList.length > 0 ? `${regList.length} pending` : undefined}
          trendPositive={false}
          onClick={() => nav('/admin/attendance/regularisation')}
        />
      </div>

      {/* ── ROW 3: Exceptions + Scheduler (2-col) ────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Critical Exceptions */}
        <Card
          title="Critical Exceptions"
          action={
            <div className="flex items-center gap-2">
              {exceptionRows.filter(r => r.severity === 'critical').length > 0 && (
                <span className="text-[9.5px] font-bold bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">
                  {exceptionRows.filter(r => r.severity === 'critical').length} critical
                </span>
              )}
              <button
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                onClick={() => nav('/admin/attendance/center')}>
                All exceptions <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
          }
        >
          {(ohLoading || excLoading) && <ZoneSkeleton rows={4} />}
          {(ohError || excError) && !ohLoading && <ZoneError />}
          {!ohLoading && !excLoading && exceptionRows.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-success/40" />
              <p className="text-sm font-medium text-muted-foreground">No active exceptions</p>
              <p className="text-[11px] text-muted-foreground/60">All modules operating normally</p>
            </div>
          )}
          {!ohLoading && exceptionRows.length > 0 && (
            <div className="divide-y divide-border/40">
              {exceptionRows.map((row, i) => (
                <div key={i} className={cn(
                  'flex items-center gap-3 px-4 py-3 border-l-[3px]',
                  row.severity === 'critical' ? 'border-l-destructive bg-destructive/[0.02]' :
                  row.severity === 'high'     ? 'border-l-warning bg-warning/[0.02]' :
                  row.severity === 'medium'   ? 'border-l-info bg-info/[0.02]' :
                                                'border-l-muted-foreground/30',
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn(
                        'text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                        row.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                        row.severity === 'high'     ? 'bg-warning/10 text-warning' :
                        row.severity === 'medium'   ? 'bg-info/10 text-info' :
                                                       'bg-muted text-muted-foreground',
                      )}>{row.severity}</span>
                      <span className="text-[12.5px] font-semibold text-foreground leading-tight truncate">{row.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{row.module}</p>
                  </div>
                  <span className={cn(
                    'text-sm font-bold tabular-nums px-2.5 py-0.5 rounded-lg flex-shrink-0',
                    row.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                    row.severity === 'high'     ? 'bg-warning/10 text-warning' :
                    row.severity === 'medium'   ? 'bg-info/10 text-info' :
                                                   'bg-muted text-muted-foreground',
                  )}>{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Scheduler & Automation */}
        <Card
          title="Scheduler & Automation"
          action={
            <div className="flex items-center gap-2">
              {schedulerRaw && (
                <span className={cn(
                  'text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full',
                  schedulerRaw.healthy ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
                )}>
                  {schedulerRaw.stale_count > 0 ? `${schedulerRaw.stale_count} stale` : 'All healthy'}
                </span>
              )}
              <button
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                onClick={() => nav('/admin/system/observability')}>
                System <ExternalLink className="h-2.5 w-2.5" />
              </button>
            </div>
          }
        >
          {schLoading && <ZoneSkeleton rows={4} />}
          {!schLoading && schedulers.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Radio className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No heartbeats found</p>
              <p className="text-xs text-muted-foreground/60">Engines may not be running</p>
            </div>
          )}
          {!schLoading && schedulers.length > 0 && (
            <div className="divide-y divide-border/40">
              {/* Durable queue strip */}
              {durable && !durable.error && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground font-medium flex-1">Durable Queue</p>
                  <div className="flex items-center gap-3">
                    <span className="text-[10.5px]"><span className="text-info font-bold">{durable.pending ?? 0}</span> <span className="text-muted-foreground">pending</span></span>
                    <span className="text-[10.5px]"><span className="text-success font-bold">{durable.running ?? 0}</span> <span className="text-muted-foreground">running</span></span>
                    <span className="text-[10.5px]"><span className={cn('font-bold', (durable.dead ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground')}>{durable.dead ?? 0}</span> <span className="text-muted-foreground">dead</span></span>
                  </div>
                </div>
              )}
              {schedulers.map(s => (
                <div key={s.scheduler_name} className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  s.is_stale && 'bg-destructive/[0.02]',
                )}>
                  <SchedBadge status={s.status} isStale={s.is_stale} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] font-semibold text-foreground/90 truncate">{schedulerLabel(s.scheduler_name)}</p>
                    {s.status === 'running' && (
                      <div className="mt-1 h-1 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-success rounded-full animate-pulse" style={{ width: '65%' }} />
                      </div>
                    )}
                    {s.last_error && (
                      <p className="text-[10px] text-destructive truncate mt-0.5">{s.last_error}</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex-shrink-0">{fmtAge(s.age_seconds)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── ROW 4: Absent Trend + Quick Actions ──────────────────────────── */}
      <div className="grid grid-cols-[1.2fr_1fr] gap-4">

        {/* Absent Trend */}
        <Card
          title="Absent Trend"
          action={
            <button
              className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
              onClick={() => nav('/admin/attendance/muster')}>
              Muster roll <ExternalLink className="h-2.5 w-2.5" />
            </button>
          }
        >
          <div className="px-1">
            <p className="text-xs text-muted-foreground px-3 -mt-1 mb-2">Daily absent count · last 14 days</p>
            {absentTrend.length > 1 ? (
              <InsightChart type="bar" data={absentTrend} xKey="date"
                yKeys={[{ key: 'absent', label: 'Absent', color: 'chart4' }]} height={130} />
            ) : (
              <EmptyWorkspaceState context="custom" title="No trend data" />
            )}
            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-3 px-3 pb-2 pt-3 border-t border-border/40 mt-1">
              {[
                { key: 'AVG / DAY', val: absentAvg },
                { key: 'PEAK',      val: absentPeak > 0 ? String(absentPeak) : '—' },
                { key: 'TREND',     val: absentTrendPct ?? '—' },
                { key: 'UPTIME',    val: freshness?.hours_since_last_run != null ? `${freshness.hours_since_last_run.toFixed(0)}h` : '—' },
              ].map(s => (
                <div key={s.key} className="text-center">
                  <p className="text-[10.5px] font-bold uppercase tracking-widest text-muted-foreground/70">{s.key}</p>
                  <p className={cn(
                    'font-display text-[15px] font-bold mt-0.5',
                    s.key === 'TREND' && s.val.startsWith('+') ? 'text-destructive' :
                    s.key === 'TREND' && s.val.startsWith('-') ? 'text-success' : 'text-foreground',
                  )}>{s.val}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Quick Actions — dark card */}
        <div className="rounded-2xl bg-foreground text-background shadow-card-md flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <p className="font-display text-sm font-semibold text-background">Quick Actions</p>
            <span className="text-[9px] font-bold uppercase tracking-widest text-background/40">SHORTCUTS</span>
          </div>
          <div className="flex-1">
            {[
              { icon: Play,          label: 'Process Attendance',       href: '/admin/attendance/center',       badge: null },
              { icon: CheckSquare,   label: 'Review Regularisation',    href: '/admin/attendance/regularisation', badge: regList.length > 0 ? `${regList.length} pending` : null },
              { icon: CalendarCheck, label: 'Muster Roll',              href: '/admin/attendance/muster',       badge: null },
              { icon: FileSearch,    label: 'Leave Balances',           href: '/admin/leave/balances',          badge: null },
              { icon: UserCheck,     label: 'People Directory',         href: '/admin/employees',               badge: null },
              { icon: ClipboardList, label: 'Attendance Anomalies',     href: '/admin/attendance/anomalies',    badge: anomalyCount > 0 ? `${anomalyCount} open` : null },
            ].map(item => (
              <button
                key={item.href}
                className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] last:border-0 hover:bg-white/[0.05] transition-colors text-left group"
                onClick={() => nav(item.href)}
              >
                <item.icon className="h-3.5 w-3.5 text-background/50 flex-shrink-0 group-hover:text-background/80 transition-colors" />
                <span className="flex-1 text-[12.5px] font-medium text-background/80 group-hover:text-background transition-colors truncate">{item.label}</span>
                {item.badge && (
                  <span className="text-[9.5px] font-bold bg-warning/20 text-warning px-1.5 py-0.5 rounded-full flex-shrink-0">
                    {item.badge}
                  </span>
                )}
                <ArrowRight className="h-3 w-3 text-background/20 group-hover:text-background/50 transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROW 5: Reconciliation + New Joiners / Absent Today ───────────── */}
      <div className="grid grid-cols-[1.6fr_1fr] gap-4">

        {/* Reconciliation Health */}
        <Card
          title="Reconciliation Health"
          action={
            <span className={cn(
              'text-[9.5px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full',
              reconcModules.every(m => m.status === 'healthy')
                ? 'bg-success/10 text-success'
                : reconcModules.some(m => m.status === 'critical')
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-warning/10 text-warning',
            )}>
              {reconcModules.every(m => m.status === 'healthy') ? 'ALL MATCHED'
               : reconcModules.some(m => m.status === 'critical') ? 'ISSUES FOUND'
               : 'WARNINGS'}
            </span>
          }
        >
          {(ohLoading || reconcLoading) ? <ZoneSkeleton rows={4} /> : (
            <div className="divide-y divide-border/40">
              {reconcModules.map(mod => (
                <div key={mod.label} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className={cn('h-3.5 w-3.5 flex-shrink-0',
                      mod.status === 'critical' ? 'text-destructive' :
                      mod.status === 'warning'  ? 'text-warning' : 'text-success')} />
                    <span className="text-[12.5px] text-foreground/80 font-medium">{mod.label}</span>
                  </div>
                  {mod.count > 0 ? (
                    <span className={cn(
                      'text-[10.5px] font-bold px-2 py-0.5 rounded-full',
                      mod.status === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                    )}>
                      {mod.count} issues
                    </span>
                  ) : (
                    <span className="text-[10.5px] font-bold text-success">MATCHED</span>
                  )}
                </div>
              ))}
              {reconcIssues.length > 0 && (
                <div className="px-4 py-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Recent open issues</p>
                  {reconcIssues.slice(0, 3).map(issue => (
                    <div key={issue.id} className="flex items-center gap-2">
                      <span className={cn(
                        'text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded',
                        issue.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                        issue.severity === 'high'     ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground',
                      )}>{issue.severity}</span>
                      <span className="text-[11px] text-foreground/80 truncate">{issue.description ?? issue.issue_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* New Joiners + Absent Today */}
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            label="New Joiners"
            value={dashStats?.new_joiners_this_month ?? '—'}
            icon={UserPlus}
            iconBg="bg-sky-50"
            iconColor="text-sky-600"
            valueColor={(dashStats?.new_joiners_this_month ?? 0) > 0 ? 'text-sky-600' : undefined}
            sub="This month"
            trend={(dashStats?.new_joiners_this_month ?? 0) > 0 ? `+${dashStats!.new_joiners_this_month}` : undefined}
            trendPositive={true}
          />
          <KpiCard
            label="Absent Today"
            value={todayAbsent}
            icon={UserX}
            iconBg={todayAbsent > 0 ? 'bg-amber-50' : 'bg-muted'}
            iconColor={todayAbsent > 0 ? 'text-amber-600' : 'text-muted-foreground'}
            valueColor={todayAbsent > 0 ? 'text-amber-600' : undefined}
            sub="Real-time"
            trend={todayAbsent > 0 ? `${todayAbsent} out` : undefined}
            trendPositive={false}
            onClick={() => nav('/admin/attendance/muster')}
          />
        </div>
      </div>

      {/* ── ROW 6: Payroll footer bar ─────────────────────────────────────── */}
      {payroll && (
        <div className="rounded-2xl bg-card shadow-card px-5 py-3 flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Database className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Payroll</span>
          </div>
          <div className="w-px h-5 bg-border/60" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Current Period</span>
            <span className="text-xs font-bold text-foreground">{payroll.current_month}</span>
          </div>
          <div className="w-px h-5 bg-border/60" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className={cn('text-xs font-bold',
              payrollHealth === 'healthy' ? 'text-success' :
              payrollHealth === 'critical' ? 'text-destructive' : 'text-warning')}>
              {payroll.current_run?.status
                ? payroll.current_run.status.charAt(0).toUpperCase() + payroll.current_run.status.slice(1)
                : 'No run'}
            </span>
          </div>
          {payroll.current_run && (
            <>
              <div className="w-px h-5 bg-border/60" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Gross</span>
                <span className="text-xs font-bold text-foreground">{fmtINR(payroll.current_run.total_gross)}</span>
              </div>
              <div className="w-px h-5 bg-border/60" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Net</span>
                <span className="text-xs font-bold text-foreground">{fmtINR(payroll.current_run.total_net)}</span>
              </div>
              <div className="w-px h-5 bg-border/60" />
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Employees</span>
                <span className="text-xs font-bold text-foreground">{payroll.current_run.employee_count}</span>
              </div>
            </>
          )}
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 font-medium"
              onClick={() => nav('/admin/payroll/center')}>
              Payroll Center <ArrowUpRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* ── ROW 7: Bottom stats strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Corrections */}
        <KpiCard
          label="Corrections"
          value={correctionsCount}
          icon={CheckSquare}
          iconBg={correctionsCount > 0 ? 'bg-orange-50' : 'bg-emerald-50'}
          iconColor={correctionsCount > 0 ? 'text-orange-500' : 'text-emerald-600'}
          valueColor={correctionsCount > 0 ? 'text-orange-500' : undefined}
          sub="Today's edits"
          trend={correctionsCount > 0 ? `${correctionsCount} pending` : 'All clear'}
          trendPositive={correctionsCount === 0}
          onClick={() => nav('/admin/attendance/corrections')}
        />

        {/* Pending Approvals */}
        <KpiCard
          label="Pending Approvals"
          value={regList.length}
          icon={ClipboardList}
          iconBg={regList.length > 0 ? 'bg-violet-50' : 'bg-muted'}
          iconColor={regList.length > 0 ? 'text-violet-600' : 'text-muted-foreground'}
          valueColor={regList.length > 0 ? 'text-violet-600' : undefined}
          sub="Awaiting admin"
          trend={regList.length > 0 ? `${regList.length} waiting` : undefined}
          trendPositive={false}
          onClick={() => nav('/admin/attendance/regularisation')}
        />

        {/* Operations Timeline */}
        <div className="rounded-2xl bg-card shadow-card px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-display text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operations Timeline</p>
            <button
              className="text-xs text-primary font-semibold hover:underline"
              onClick={() => nav('/admin/system/event-governance')}>
              Full log →
            </button>
          </div>
          {evLoading ? (
            <div className="h-8 rounded bg-muted animate-pulse" />
          ) : eventLog.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Inbox className="h-3.5 w-3.5" /> No recent events
            </div>
          ) : (
            <div className="space-y-1.5">
              {eventLog.slice(0, 3).map(entry => {
                const meta  = EVENT_META[entry.event_type]
                const Icon  = meta?.icon ?? Activity
                const color = meta?.color ?? 'text-muted-foreground'
                const label = (entry.event_type ?? '').replace(/_/g, ' ')
                const time  = new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={entry.id} className="flex items-center gap-2">
                    <Icon className={cn('h-3 w-3 flex-shrink-0', color)} />
                    <span className="text-[11px] text-foreground/80 capitalize flex-1 truncate">{label}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">{time}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Escalated Corrections (SLA breached) — conditional ───────────── */}
      {escalatedRegList.length > 0 && (
        <div className="rounded-2xl bg-card shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
            <div>
              <p className="font-display text-sm font-semibold text-foreground">Escalated Corrections</p>
              <p className="text-xs text-muted-foreground mt-0.5">Manager SLA breached — pending ≥2 days</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
              onClick={() => nav('/admin/attendance/regularisation')}>
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <OperationalTable columns={regColumns} rows={regRows}
            rowKey={r => r.id as string}
            emptyText="No pending escalations" />
        </div>
      )}

    </div>
  )
}
