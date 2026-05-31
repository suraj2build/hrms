/**
 * Attendance Operations — single-scroll command center
 *
 * Layout:
 *  1. Processing Pipeline Strip — live status · last run summary · process action
 *  2. KPI Row — 7 compact chips (active_period_summary from read model)
 *  3. Two-column: Attention Queue & Today's Distribution | Processing Health & Quick Links
 *  4. Operational Timeline — last 8 audit events (7-day window, read-only)
 *  5. Collapsible: Team Attendance
 *  6. Collapsible: Bulk Upload
 *  7. Collapsible: Recompute Range
 *  8. Collapsible: Audit Log
 *  9. Run Details Dialog (preserved unchanged)
 *
 * All existing queries (5), mutations (3), state, helpers, and types are preserved.
 * Two additional read-only queries added: attendance-ops-stats, attendance-recent-activity.
 */

import { useState, useRef, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import {
  Clock, CheckCircle2, AlertTriangle, RefreshCw,
  Loader2, SearchX, WifiOff, Download,
  UploadCloud, FileText, X, Users, CalendarDays, ChevronLeft,
  ChevronRight, ChevronDown, Activity, TrendingUp, TrendingDown,
  ShieldCheck, ArrowRight, BarChart3, BookOpen, ClipboardCheck,
  Bug, ListFilter, Calendar, Eye, Database,
  Upload as UploadIcon, Info, Fingerprint,
} from 'lucide-react'
import { ContextualHint } from '@/components/operational/ContextualHint'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { FormField } from '@/components/forms/FormField'

import { Badge }   from '@/components/ui/badge'
import { Button }  from '@/components/ui/button'
import { Input }   from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'
import { ensureArray }  from '@/lib/array-utils'
import { formatMonthShort } from '@/lib/attendance/attendance-period-context'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'

interface ProcessResult {
  date:                    string
  processed_employees:     number
  attendance_logs_created: number
  daily_records_upserted:  number
  raw_logs_marked:         number
  skipped_codes:           string[]
  incomplete_sessions:     number
  run_id:                  string
}

interface ProcessStatus {
  is_running:       boolean
  started_at:       string | null
  started_by:       string | null
  lock_ttl_seconds: number | null
}

interface LastRun {
  id:               string
  date:             string
  processed_count:  number
  skipped_count:    number
  skipped_codes:    string[]
  incomplete_count: number
  raw_logs_marked:  number
  logs_created:     number
  daily_upserted:   number
  duration_ms:      number | null
  started_at:       string
  completed_at:     string | null
  error_message:    string | null
}

interface AuditLogRow {
  id:               string
  date:             string
  source:           string
  before_status:    string | null
  after_status:     string
  created_at:       string
  employee_name:    string | null
  employee_code:    string | null
  changed_by_name:  string | null
}

interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
  work_hours:    number
  late_minutes:  number
  check_in:      string | null
  check_out:     string | null
}

interface TeamDashboard {
  team_members:  TeamMember[]
  today_summary: {
    present:    number
    late:       number
    absent:     number
    leave:      number
    not_marked: number
    total:      number
  }
}

interface AttendanceOpsStats {
  unresolved_anomalies:    number
  pending_corrections:     number
  staffing_pressure:       number
  overnight_issues:        number
  confidence_warnings:     number
  recompute_backlog:       number
  payroll_continuity_gaps: number
  is_processing:           boolean
  /** YYYY-MM of the most recent month with attendance data */
  active_period_month?: string | null
  /**
   * Canonical attendance period summary — the ONLY source for all KPI widgets.
   *
   * Derived from buildActivePeriodSummary() via attendance-read-model.ts.
   * is_historical=true when active_month != current calendar month
   * (e.g., imported 2025 data viewed in 2026).
   * Null only on DB error.
   */
  active_period_summary?: {
    active_month:    string   // YYYY-MM
    is_historical:   boolean
    present:         number
    late:            number
    absent:          number
    half_day:        number
    leave:           number
    payable_days:    number
    lop_days:        number
    missing_punch:   number
    total_employees: number
  } | null
}

interface PipelineStats {
  // Pipeline A — Biometric / Device
  raw_log_count_30d:     number
  processing_runs_30d:   number
  last_batch_run_date:   string | null
  last_batch_ran_at:     string | null
  batch_employees_last:  number | null
  batch_last_error:      string | null
  // Pipeline B — CSV Upload Recompute
  punch_log_count_30d:   number
  csv_employees_30d:     number
  daily_rows_from_csv:   number
  csv_date_range:        { from: string; to: string } | null
  upload_count_30d:      number
  last_upload_at:        string | null
  // Source detection
  active_source:         'csv' | 'biometric' | 'hybrid' | 'none'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr()      { return new Date().toISOString().slice(0, 10) }
function monthStartStr() { return todayStr().slice(0, 7) + '-01' }

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number | null) {
  if (ms == null) return null
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const TEAM_STATUS_BADGE: Record<string, string> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  leave:      'secondary',
  half_day:   'secondary',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
  not_marked: 'outline',
}

const TEAM_STATUS_LABEL: Record<string, string> = {
  present:    'Present',
  late:       'Late',
  absent:     'Absent',
  leave:      'On Leave',
  half_day:   'Half Day',
  holiday:    'Holiday',
  weekend:    'Weekend',
  weekly_off: 'Weekly Off',
  not_marked: 'Not Marked',
}

// ── Upload tab — types + CSV helpers ─────────────────────────────────────────

const UPLOAD_REQUIRED_COLS = ['employee_code', 'date', 'in_time', 'out_time'] as const
const UPLOAD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UPLOAD_TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

interface UploadPreviewRow {
  line:     number
  fields:   Record<string, string>
  warnings: string[]
}
interface UploadFailedRow  { line: number; row: string; error: string }
interface UploadResult     { total_rows: number; success_rows: number; failed_rows: UploadFailedRow[] }

interface UploadedDateRange {
  from:             string   // YYYY-MM-DD
  to:               string   // YYYY-MM-DD
  employee_count:   number   // distinct employee_code values
}

function csvParseLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''; let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else { inQ = !inQ } }
    else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
    else { cur += ch }
  }
  fields.push(cur.trim())
  return fields
}

function uploadNormaliseTime(t: string) { return t.length === 5 ? `${t}:00` : t.slice(0, 8) }

function uploadValidateRow(fields: Record<string, string>): string[] {
  const w: string[] = []
  if (!fields.employee_code)              w.push('employee_code is empty')
  if (!fields.date)                       w.push('date is empty')
  else if (!UPLOAD_DATE_RE.test(fields.date)) w.push(`date "${fields.date}" must be YYYY-MM-DD`)
  if (!fields.in_time)                    w.push('in_time is empty')
  else if (!UPLOAD_TIME_RE.test(fields.in_time)) w.push(`in_time "${fields.in_time}" must be HH:MM[:SS]`)
  if (!fields.out_time)                   w.push('out_time is empty')
  else if (!UPLOAD_TIME_RE.test(fields.out_time)) w.push(`out_time "${fields.out_time}" must be HH:MM[:SS]`)
  if (!w.length && fields.in_time && fields.out_time) {
    if (uploadNormaliseTime(fields.in_time) >= uploadNormaliseTime(fields.out_time))
      w.push('in_time must be earlier than out_time')
  }
  return w
}

// ── Shared UX state components ───────────────────────────────────────────────

function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
      <Icon className="h-7 w-7 opacity-40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs text-center max-w-xs">{description}</p>}
    </div>
  )
}

// ── CollapsibleCard ──────────────────────────────────────────────────────────

function CollapsibleCard({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
}: {
  title: string
  icon?: React.ReactNode
  action?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-border bg-card shadow-elev-1 overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-4 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {action && (
          <span
            className="flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {action}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </div>
      {open && (
        <div className="px-5 pb-5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── KpiChip — compact stat tile for the KPI row ───────────────────────────────

function KpiChip({
  label,
  value,
  colorClass,
  href,
  loading,
}: {
  label:      string
  value:      number | string
  colorClass: string
  href?:      string
  loading?:   boolean
}) {
  const inner = (
    <div className={cn(
      'flex flex-col gap-0.5 p-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors',
      href && 'cursor-pointer',
    )}>
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</span>
      {loading
        ? <span className="h-6 w-8 rounded bg-muted animate-pulse mt-0.5" />
        : <span className={cn('text-xl font-bold tabular-nums', colorClass)}>{value}</span>
      }
    </div>
  )

  if (href) {
    return <Link to={href}>{inner}</Link>
  }
  return inner
}

// ── Audit source badge variant ─────────────────────────────────────────────────

function auditSourceVariant(source: string): StatusVariant {
  if (source === 'system')         return 'outline'
  if (source === 'regularisation') return 'warning'
  if (source === 'leave')          return 'secondary'
  return 'outline'
}

// ── Main Component ────────────────────────────────────────────────────────────

export function Attendance() {
  const { profile } = useAuthStore()
  const navigate    = useNavigate()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const isManager   = ['super_admin', 'hr_admin', 'manager'].includes(profile?.role ?? '')
  const queryClient = useQueryClient()

  // ── Admin/process state ─────────────────────────────────────────────────────
  const [processDate,   setProcessDate]   = useState(todayStr())
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null)
  const [forceProcess,  setForceProcess]  = useState(false)
  const [alreadyProcessedWarn, setAlreadyProcessedWarn] = useState<string | null>(null)
  const [detailRunId,   setDetailRunId]   = useState<string | null>(null)
  const [isExporting,   setIsExporting]   = useState(false)

  // ── Recompute range state ────────────────────────────────────────────────────
  const [recomputeFrom,   setRecomputeFrom]   = useState(todayStr())
  const [recomputeTo,     setRecomputeTo]     = useState(todayStr())
  const [recomputeEmpId,  setRecomputeEmpId]  = useState('')
  const [recomputeResult, setRecomputeResult] = useState<{ employees_processed: number; rows_upserted: number; duration_ms: number } | null>(null)

  // ── Upload state ─────────────────────────────────────────────────────────────
  const uploadFileRef                           = useRef<HTMLInputElement>(null)
  const [uploadFileName,    setUploadFileName]  = useState<string | null>(null)
  const [uploadCsvText,     setUploadCsvText]   = useState<string | null>(null)
  const [uploadHeaders,     setUploadHeaders]   = useState<string[]>([])
  const [uploadMissingCols, setUploadMissingCols] = useState<string[]>([])
  const [uploadPreviewRows, setUploadPreviewRows] = useState<UploadPreviewRow[]>([])
  const [uploadTotalRows,    setUploadTotalRows]    = useState(0)
  const [uploadResult,       setUploadResult]       = useState<UploadResult | null>(null)
  const [uploadParseError,   setUploadParseError]   = useState<string | null>(null)
  const [uploadedDateRange,  setUploadedDateRange]  = useState<UploadedDateRange | null>(null)

  // ── Pipeline strip highlight ref ─────────────────────────────────────────────
  const lastRunRef        = useRef<HTMLDivElement>(null)
  const [lastRunHighlight, setLastRunHighlight] = useState(false)

  // ── Team state ───────────────────────────────────────────────────────────────
  const [teamDate,   setTeamDate]   = useState(todayStr())
  const [teamSearch, setTeamSearch] = useState('')

  // ── Audit log state ──────────────────────────────────────────────────────────
  const [logFrom,    setLogFrom]    = useState(monthStartStr())
  const [logTo,      setLogTo]      = useState(todayStr())
  const [logSource,  setLogSource]  = useState<'' | 'system' | 'regularisation' | 'leave'>('')
  const [logEmpId,   setLogEmpId]   = useState('')
  const [logApplied, setLogApplied] = useState({
    from:        monthStartStr(),
    to:          todayStr(),
    source:      '' as '' | 'system' | 'regularisation' | 'leave',
    employee_id: '',
  })

  // ── CSV download helper ───────────────────────────────────────────────────────
  const downloadCsv = useCallback(async (runId: string, date: string) => {
    setIsExporting(true)
    try {
      const response  = await api.getRaw(`/attendance/process/runs/${runId}/export`)
      const blob      = await response.blob()
      const url       = URL.createObjectURL(blob)
      const a         = document.createElement('a')
      a.href          = url
      a.download      = `attendance-${date}-${runId.slice(0, 8)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }, [])

  // ── Derived: is current teamDate outside the last uploaded range? ─────────────
  const isTeamDateOutsideUpload = useMemo(() => {
    if (!uploadedDateRange) return false
    return teamDate < uploadedDateRange.from || teamDate > uploadedDateRange.to
  }, [teamDate, uploadedDateRange])

  // ── Team date navigation ──────────────────────────────────────────────────────
  function teamPrevDay() {
    const d = new Date(`${teamDate}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    setTeamDate(d.toISOString().slice(0, 10))
  }
  function teamNextDay() {
    const d = new Date(`${teamDate}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    setTeamDate(d.toISOString().slice(0, 10))
  }

  // ── Upload handlers ───────────────────────────────────────────────────────────
  function handleDownloadSample() {
    api.getRaw('/attendance/sample-csv')
      .then((res) => res.blob())
      .then((blob) => {
        const url  = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url; link.download = 'attendance_upload_sample.csv'; link.click()
        URL.revokeObjectURL(url)
      })
      .catch(console.error)
  }

  const handleUploadFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadResult(null); setUploadParseError(null)

    const text  = await file.text()
    setUploadFileName(file.name); setUploadCsvText(text)

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setUploadParseError('The file must contain a header row and at least one data row.')
      setUploadHeaders([]); setUploadPreviewRows([]); setUploadMissingCols([]); setUploadTotalRows(0)
      return
    }

    const headerCols = csvParseLine(lines[0]).map((h) => h.toLowerCase().trim())
    setUploadHeaders(headerCols)
    const missing = UPLOAD_REQUIRED_COLS.filter((c) => !headerCols.includes(c))
    setUploadMissingCols(missing)

    const dataLines = lines.slice(1)
    setUploadTotalRows(dataLines.length)

    // ── Extract date range + unique employee count from ALL rows ──────────────
    const dateColIdx = headerCols.indexOf('date')
    const empColIdx  = headerCols.indexOf('employee_code')
    if (dateColIdx >= 0 && missing.length === 0) {
      const allDates: string[] = []
      const allEmployees = new Set<string>()
      for (const line of dataLines) {
        const cols = csvParseLine(line)
        const d    = cols[dateColIdx]?.trim()
        const emp  = cols[empColIdx]?.trim()
        if (d && UPLOAD_DATE_RE.test(d))  allDates.push(d)
        if (emp)                          allEmployees.add(emp)
      }
      if (allDates.length > 0) {
        allDates.sort()
        setUploadedDateRange({
          from:           allDates[0],
          to:             allDates[allDates.length - 1],
          employee_count: allEmployees.size,
        })
      } else {
        setUploadedDateRange(null)
      }
    } else {
      setUploadedDateRange(null)
    }

    const preview: UploadPreviewRow[] = []
    for (let i = 0; i < Math.min(20, dataLines.length); i++) {
      const fields = csvParseLine(dataLines[i])
      const rowMap: Record<string, string> = {}
      headerCols.forEach((col, idx) => { rowMap[col] = fields[idx] ?? '' })
      preview.push({ line: i + 2, fields: rowMap, warnings: missing.length > 0 ? [] : uploadValidateRow(rowMap) })
    }
    setUploadPreviewRows(preview)
    e.target.value = ''
  }, [])

  function handleUploadClear() {
    setUploadFileName(null); setUploadCsvText(null); setUploadHeaders([])
    setUploadMissingCols([]); setUploadPreviewRows([]); setUploadTotalRows(0)
    setUploadResult(null); setUploadParseError(null); setUploadedDateRange(null)
  }

  const uploadMutation = useMutation<UploadResult, Error, string>({
    mutationFn: (csv_content) => api.post<UploadResult>('/attendance/upload', { csv_content }),
    onSuccess:  (data) => {
      setUploadResult(data)
      // Refresh pipeline stats so CSV metrics card reflects the new upload
      queryClient.invalidateQueries({ queryKey: ['attendance-pipeline-stats'] })
      toast.success('Upload complete', { description: `${data.success_rows ?? 0} rows processed` })
    },
    onError: (e: Error) => toast.error('Upload failed', { description: e.message }),
  })

  // ── Queries ───────────────────────────────────────────────────────────────────

  // Processing status poll
  const { data: processStatus } = useQuery<ProcessStatus>({
    queryKey: ['attendance-process-status'],
    queryFn:  () => api.get<ProcessStatus>('/attendance/process/status'),
    enabled:  isAdmin,
    refetchInterval: (query) =>
      query.state.data?.is_running ? 4_000 : 15_000,
    staleTime: 3_000,
  })

  const isJobRunning = processStatus?.is_running ?? false

  const isStale = (() => {
    if (!processStatus?.is_running || !processStatus.started_at) return false
    const ageMs = Date.now() - Date.parse(processStatus.started_at)
    const ttlMs = (processStatus.lock_ttl_seconds ?? 900) * 1_000
    return ageMs > ttlMs
  })()

  // Last run
  const { data: lastRunData, refetch: refetchLastRun } = useQuery<{ run: LastRun | null }>({
    queryKey: ['attendance-last-run'],
    queryFn:  () => api.get<{ run: LastRun | null }>('/attendance/process/last'),
    enabled:  isAdmin,
    staleTime: 10_000,
  })
  const lastRun = lastRunData?.run ?? null

  // Run detail (lazy — only when detailRunId is set)
  const { data: runDetailData, isLoading: detailLoading } = useQuery<{ run: LastRun }>({
    queryKey: ['attendance-run-detail', detailRunId],
    queryFn:  () => api.get<{ run: LastRun }>(`/attendance/process/runs/${detailRunId}`),
    enabled:  !!detailRunId,
    staleTime: 60_000,
  })
  const detailRun = runDetailData?.run ?? null

  // Team dashboard
  const { data: teamData, isLoading: teamLoading } = useQuery<TeamDashboard>({
    queryKey: ['team-attendance', teamDate],
    queryFn:  () => api.get<TeamDashboard>(`/manager/dashboard?date=${teamDate}`),
    enabled:  isAdmin || isManager,
    staleTime: 60_000,
  })

  // Audit log (filtered — driven by logApplied state)
  const { data: auditData, isLoading: auditLoading } = useQuery<{ data: AuditLogRow[]; total: number }>({
    queryKey: ['attendance-audit-tab', logApplied],
    queryFn:  () => {
      const p = new URLSearchParams({ from: logApplied.from, to: logApplied.to })
      if (logApplied.source)      p.set('source',      logApplied.source)
      if (logApplied.employee_id) p.set('employee_id', logApplied.employee_id)
      return api.get<{ data: AuditLogRow[]; total: number }>(`/attendance/audit?${p}`)
    },
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  // Ops stats (for anomaly/correction counts in KPI row + attention queue)
  const { data: opsStats } = useQuery<AttendanceOpsStats>({
    queryKey: ['attendance-ops-stats'],
    queryFn:  () => api.get<AttendanceOpsStats>('/attendance/stats'),
    enabled:  isAdmin,
    staleTime: 30_000,
    retry: false,
  })

  // Pipeline stats (both CSV + biometric pipeline metrics)
  const { data: pipelineStats } = useQuery<PipelineStats>({
    queryKey: ['attendance-pipeline-stats'],
    queryFn:  () => api.get<PipelineStats>('/attendance/pipeline-stats'),
    enabled:  isAdmin,
    staleTime: 60_000,
    retry: false,
  })

  // Recent activity (7-day window, max 8 rows — for operational timeline)
  const { data: recentActivity } = useQuery<{ data: AuditLogRow[]; total: number }>({
    queryKey: ['attendance-recent-activity'],
    queryFn:  () => {
      const to   = todayStr()
      const from = (() => {
        const d = new Date(`${to}T12:00:00Z`)
        d.setUTCDate(d.getUTCDate() - 6)
        return d.toISOString().slice(0, 10)
      })()
      return api.get<{ data: AuditLogRow[]; total: number }>(
        `/attendance/audit?from=${from}&to=${to}&limit=8`,
      )
    },
    enabled:  isAdmin,
    staleTime: 60_000,
    retry: false,
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const processMutation = useMutation<ProcessResult, Error, { date: string; force: boolean }>({
    mutationFn: ({ date, force }) =>
      api.post<ProcessResult>('/attendance/process', { date, force }),
    onSuccess: (result) => {
      setProcessResult(result)
      setAlreadyProcessedWarn(null)
      queryClient.invalidateQueries({ queryKey: ['attendance-process-status'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      refetchLastRun().then(() => {
        setTimeout(() => {
          lastRunRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          setLastRunHighlight(true)
          setTimeout(() => setLastRunHighlight(false), 2_000)
        }, 150)
      })
    },
    onError: (err) => {
      const msg = err.message ?? ''
      if (msg.includes('already processed')) {
        setAlreadyProcessedWarn(msg)
      }
      toast.error('Processing failed', { description: msg || 'Unknown error' })
    },
  })

  const forceUnlockMutation = useMutation({
    mutationFn: () => api.post('/attendance/process/force-unlock', {}),
    onSuccess: () => {
      toast.success('Lock cleared', { description: 'Processing lock has been reset. You can now run attendance processing.' })
      queryClient.invalidateQueries({ queryKey: ['attendance-process-status'] })
    },
    onError: (e: Error) => toast.error('Could not clear lock', { description: e.message }),
  })

  const recomputeMutation = useMutation({
    mutationFn: (body: { from_date: string; to_date: string; employee_id?: string }) =>
      api.post<{ employees_processed: number; rows_upserted: number; duration_ms: number }>(
        '/attendance/recompute',
        body,
      ),
    onSuccess: (res) => {
      setRecomputeResult(res)
      queryClient.invalidateQueries({ queryKey: ['my-attendance'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-recent-activity'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-pipeline-stats'] })
      toast.success('Recompute complete', { description: `${res.employees_processed} employees · ${res.rows_upserted} rows updated` })
    },
    onError: (e: Error) => toast.error('Recompute failed', { description: e.message }),
  })

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filteredTeam = (teamData?.team_members ?? []).filter((m) =>
    teamSearch === '' ||
    m.name.toLowerCase().includes(teamSearch.toLowerCase()) ||
    m.employee_code.toLowerCase().includes(teamSearch.toLowerCase()),
  )

  const runHealth = (() => {
    if (!lastRun || lastRun.error_message) return null
    const total    = lastRun.processed_count + lastRun.skipped_count
    const skipRate = total > 0 ? lastRun.skipped_count / total : 0
    const incRate  = lastRun.processed_count > 0 ? lastRun.incomplete_count / lastRun.processed_count : 0
    let level: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (skipRate >= 0.20 || incRate >= 0.20) level = 'critical'
    else if (skipRate >= 0.05 || incRate >= 0.10) level = 'degraded'
    return { skipRate, incRate, level, skipPct: Math.round(skipRate * 100), incPct: Math.round(incRate * 100) }
  })()

  // ── Canonical attendance data source ────────────────────────────────────────
  // For HR admins: always use active_period_summary (from attendance-read-model.ts).
  //   This is the canonical source — it finds the most recent month with data and
  //   returns the full canonical month aggregate.  No date=today assumptions.
  // For managers/employees: use teamData (direct reports only, live day view).
  const todaySummary = isAdmin
    ? (opsStats?.active_period_summary ?? teamData?.today_summary)
    : teamData?.today_summary

  // Label for the KPI summary period — always the active month name (e.g. "May 2025")
  // Derives from attendance-period-context — no inline new Date() formatting
  const todaySummaryLabel = isAdmin && opsStats?.active_period_summary
    ? formatMonthShort(opsStats.active_period_summary.active_month)
    : formatMonthShort(new Date().toISOString().slice(0, 7))

  // ── Attention queue items ─────────────────────────────────────────────────────
  const attentionItems: Array<{
    id:         string
    icon:       React.ComponentType<{ className?: string }>
    label:      string
    count:      number
    href:       string
    variant:    'warning' | 'destructive' | 'info'
  }> = []

  if (opsStats) {
    if (opsStats.unresolved_anomalies > 0)
      attentionItems.push({ id: 'anomalies', icon: Bug, label: 'unresolved anomalies', count: opsStats.unresolved_anomalies, href: '/admin/attendance/anomalies', variant: 'warning' })
    if (opsStats.pending_corrections > 0)
      attentionItems.push({ id: 'corrections', icon: ClipboardCheck, label: 'pending corrections', count: opsStats.pending_corrections, href: '/admin/attendance/corrections', variant: 'info' })
    if (opsStats.recompute_backlog > 0)
      attentionItems.push({ id: 'backlog', icon: RefreshCw, label: 'recompute backlog', count: opsStats.recompute_backlog, href: '/admin/attendance/anomalies', variant: 'warning' })
  }
  if (isStale && isJobRunning)
    attentionItems.push({ id: 'stale', icon: AlertTriangle, label: 'stuck processing job (TTL expired)', count: 1, href: '#', variant: 'destructive' })

  // ── Refresh all ───────────────────────────────────────────────────────────────
  function handleRefreshAll() {
    queryClient.invalidateQueries({ queryKey: ['team-attendance'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-audit-tab'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-last-run'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-process-status'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-recent-activity'] })
    queryClient.invalidateQueries({ queryKey: ['attendance-pipeline-stats'] })
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageContainer>

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        title="Attendance Operations"
        subtitle={`Live command center · ${(() => { const _n = new Date(); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const _DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']; return `${_DOW[_n.getDay()]}, ${String(_n.getDate()).padStart(2,'0')}-${_M[_n.getMonth()]}-${_n.getFullYear()}` })()}`}
        actions={
          <Button size="sm" variant="ghost" onClick={handleRefreshAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        }
      />

      {/* ── 1. PIPELINE SOURCE BANNER (FIX 3 + FIX 7) ───────────────────────── */}
      {isAdmin && pipelineStats && (
        <div className={cn(
          'flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-lg border text-sm',
          pipelineStats.active_source === 'csv'       && 'bg-primary/5 border-primary/20',
          pipelineStats.active_source === 'biometric' && 'bg-success/5 border-success/20',
          pipelineStats.active_source === 'hybrid'    && 'bg-info/5 border-info/20',
          pipelineStats.active_source === 'none'      && 'bg-muted/50 border-border',
        )}>
          {/* Source label */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {pipelineStats.active_source === 'csv'       && <UploadIcon  className="h-4 w-4 text-primary" />}
            {pipelineStats.active_source === 'biometric' && <Fingerprint className="h-4 w-4 text-success" />}
            {pipelineStats.active_source === 'hybrid'    && <Database    className="h-4 w-4 text-info" />}
            {pipelineStats.active_source === 'none'      && <Info        className="h-4 w-4 text-muted-foreground" />}
            <div>
              <p className={cn(
                'text-xs font-semibold leading-none',
                pipelineStats.active_source === 'csv'       && 'text-primary',
                pipelineStats.active_source === 'biometric' && 'text-success',
                pipelineStats.active_source === 'hybrid'    && 'text-info',
                pipelineStats.active_source === 'none'      && 'text-muted-foreground',
              )}>
                {pipelineStats.active_source === 'csv'       && 'CSV ATTENDANCE PIPELINE ACTIVE'}
                {pipelineStats.active_source === 'biometric' && 'BIOMETRIC DEVICE PIPELINE ACTIVE'}
                {pipelineStats.active_source === 'hybrid'    && 'HYBRID PIPELINE ACTIVE'}
                {pipelineStats.active_source === 'none'      && 'NO ATTENDANCE DATA IN LAST 30 DAYS'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {pipelineStats.active_source === 'csv'
                  ? 'CSV uploads → attendance_punch_logs → recomputeRange → attendance_daily. Biometric/device processing is not currently configured.'
                  : pipelineStats.active_source === 'biometric'
                    ? 'Biometric devices → attendance_raw_logs → batch processor → attendance_daily. No CSV uploads in the last 30 days.'
                    : pipelineStats.active_source === 'hybrid'
                      ? 'Both CSV uploads and biometric devices are active. attendance_daily is populated from both sources.'
                      : 'Upload a CSV or connect biometric devices to start generating attendance records.'}
              </p>
            </div>
          </div>
          {/* Source chips */}
          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold',
              pipelineStats.punch_log_count_30d > 0
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground',
            )}>
              <UploadIcon className="h-2.5 w-2.5" />
              CSV: {pipelineStats.punch_log_count_30d > 0 ? `${pipelineStats.punch_log_count_30d} punches` : 'No data'}
            </span>
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold',
              pipelineStats.raw_log_count_30d > 0
                ? 'bg-success/15 text-success'
                : 'bg-muted text-muted-foreground',
            )}>
              <Fingerprint className="h-2.5 w-2.5" />
              Device: {pipelineStats.raw_log_count_30d > 0 ? `${pipelineStats.raw_log_count_30d} logs` : 'No data'}
            </span>
          </div>
        </div>
      )}

      {/* ── 1A. BIOMETRIC DEVICE PROCESSING (renamed FIX 6) ─────────────────── */}
      <div
        ref={lastRunRef}
        className={cn(
          'rounded-lg border border-border bg-card shadow-elev-1 p-4 transition-shadow duration-700',
          lastRunHighlight && 'ring-2 ring-primary/50 shadow-md shadow-primary/10',
        )}
      >
        {/* Section label */}
        <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-border/60">
          <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Batch Device Processing
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">
            attendance_raw_logs → batch processor → attendance_daily
          </span>
          {pipelineStats && pipelineStats.raw_log_count_30d === 0 && (
            <Badge variant="outline" className="ml-auto text-[10px] h-4 rounded-full text-muted-foreground">
              Not configured
            </Badge>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">

          {/* Status indicator */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {isJobRunning ? (
              <div className="flex items-center gap-2 text-warning">
                <Loader2 className="h-4 w-4 animate-spin" />
                <div>
                  <p className="text-xs font-semibold leading-none">PROCESSING</p>
                  {processStatus?.started_at && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      started {new Date(processStatus.started_at).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className={cn(
                  'h-2.5 w-2.5 rounded-full ring-2',
                  pipelineStats && pipelineStats.raw_log_count_30d > 0
                    ? 'bg-success ring-success/20'
                    : 'bg-muted-foreground/40 ring-muted-foreground/10',
                )} />
                <div>
                  <p className="text-xs font-semibold text-foreground leading-none">IDLE</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {pipelineStats && pipelineStats.raw_log_count_30d === 0
                      ? 'No device logs — CSV pipeline is active'
                      : 'Ready to process'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Vertical divider */}
          <div className="hidden sm:block w-px h-10 bg-border flex-shrink-0" />

          {/* Last run summary */}
          <div className="flex-1 min-w-0">
            {lastRun ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={lastRun.error_message ? 'destructive' : 'success'}
                  className="rounded-full text-[10px] flex-shrink-0"
                >
                  {lastRun.error_message ? 'Failed' : 'Success'}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">{lastRun.date}</span>
                {!lastRun.error_message && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {lastRun.processed_count} employees
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {lastRun.daily_upserted} rows
                    </span>
                  </>
                )}
                {lastRun.duration_ms != null && (
                  <span className="text-xs text-muted-foreground">
                    {fmtDuration(lastRun.duration_ms)}
                  </span>
                )}
                {lastRun.error_message && (
                  <span className="text-xs text-destructive truncate max-w-[200px]">
                    {lastRun.error_message}
                  </span>
                )}
                {lastRun.skipped_count > 0 && (
                  <span className="text-xs text-warning">
                    {lastRun.skipped_count} skipped
                  </span>
                )}
                {lastRun.incomplete_count > 0 && (
                  <span className="text-xs text-warning">
                    {lastRun.incomplete_count} incomplete
                  </span>
                )}
                <button
                  onClick={() => setDetailRunId(lastRun.id)}
                  className="text-xs text-primary hover:underline flex items-center gap-0.5 flex-shrink-0 ml-auto sm:ml-0"
                >
                  Details <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            ) : isAdmin ? (
              <p className="text-xs text-muted-foreground">
                No batch runs yet
                {pipelineStats && pipelineStats.raw_log_count_30d === 0 && (
                  <span className="text-primary ml-1">
                    — this tenant uses the CSV upload pipeline
                  </span>
                )}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Attendance processing status</p>
            )}
          </div>

          {/* Process action (admin only) */}
          {isAdmin && (
            <>
              <div className="hidden sm:block w-px h-10 bg-border flex-shrink-0" />
              <div className="flex items-center gap-2 flex-shrink-0">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-border accent-primary"
                    checked={forceProcess}
                    onChange={(e) => setForceProcess(e.target.checked)}
                  />
                  Force
                </label>
                <DateInput
                  value={processDate}
                  onChange={setProcessDate}
                  disabled={isJobRunning || processMutation.isPending}
                  className="h-8 text-xs w-36"
                />
                <Button
                  size="sm"
                  className="h-8 whitespace-nowrap"
                  disabled={isJobRunning || processMutation.isPending}
                  onClick={() => {
                    setProcessResult(null)
                    setAlreadyProcessedWarn(null)
                    processMutation.mutate({ date: processDate, force: forceProcess })
                  }}
                >
                  {(isJobRunning || processMutation.isPending)
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Running…</>
                    : <><RefreshCw className="h-3.5 w-3.5 mr-1" />Process</>
                  }
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 1B. CSV ATTENDANCE RECOMPUTE STRIP (FIX 1 + FIX 2 + FIX 6) ─────── */}
      {isAdmin && (
        <div className="rounded-lg border border-border bg-card shadow-elev-1 p-4">
          {/* Section label */}
          <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-border/60">
            <UploadIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              CSV Attendance Recompute
            </span>
            <span className="text-[10px] text-muted-foreground ml-1">
              CSV upload → attendance_punch_logs → recomputeRange → attendance_daily
            </span>
            {pipelineStats && pipelineStats.punch_log_count_30d > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] font-semibold text-primary">ACTIVE</span>
              </div>
            )}
          </div>

          {/* FIX 2 — CSV metrics grid */}
          {pipelineStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Punch rows uploaded */}
              <div className="p-3 rounded-md bg-muted/50 space-y-1">
                <p className="text-[10px] text-muted-foreground">Punch Rows (30d)</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  pipelineStats.punch_log_count_30d > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {(pipelineStats.punch_log_count_30d ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">from CSV uploads</p>
              </div>

              {/* Employees recomputed */}
              <div className="p-3 rounded-md bg-muted/50 space-y-1">
                <p className="text-[10px] text-muted-foreground">Employees (30d)</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  pipelineStats.csv_employees_30d > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {pipelineStats.csv_employees_30d}
                </p>
                <p className="text-[10px] text-muted-foreground">recomputed</p>
              </div>

              {/* attendance_daily rows */}
              <div className="p-3 rounded-md bg-muted/50 space-y-1">
                <p className="text-[10px] text-muted-foreground">Daily Rows</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  pipelineStats.daily_rows_from_csv > 0 ? 'text-success' : 'text-muted-foreground',
                )}>
                  {(pipelineStats.daily_rows_from_csv ?? 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">generated (all time)</p>
              </div>

              {/* Upload sessions */}
              <div className="p-3 rounded-md bg-muted/50 space-y-1">
                <p className="text-[10px] text-muted-foreground">Uploads (30d)</p>
                <p className={cn(
                  'text-xl font-bold tabular-nums',
                  pipelineStats.upload_count_30d > 0 ? 'text-foreground' : 'text-muted-foreground',
                )}>
                  {pipelineStats.upload_count_30d}
                </p>
                <p className="text-[10px] text-muted-foreground">completed sessions</p>
              </div>

              {/* Uploaded period */}
              <div className="p-3 rounded-md bg-muted/50 space-y-1 sm:col-span-2">
                <p className="text-[10px] text-muted-foreground">Uploaded Period</p>
                {pipelineStats.csv_date_range ? (
                  <>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {pipelineStats.csv_date_range.from}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      → {pipelineStats.csv_date_range.to}
                      {pipelineStats.last_upload_at && (
                        <span className="ml-2 text-muted-foreground/70">
                          · uploaded {(() => { const _d = new Date(pipelineStats.last_upload_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No uploads yet</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-md bg-muted/60 animate-pulse" />
              ))}
            </div>
          )}

          {/* No-data helper */}
          {pipelineStats && pipelineStats.punch_log_count_30d === 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-center">
              No CSV attendance data in the last 30 days. Use the{' '}
              <button
                className="text-primary underline"
                onClick={() => document.getElementById('bulk-upload-section')?.scrollIntoView({ behavior: 'smooth' })}
              >
                Bulk Upload
              </button>{' '}
              section below to upload attendance records.
            </p>
          )}
        </div>
      )}

      {/* ── Inline processing warnings ────────────────────────────────────────── */}

      {isAdmin && isJobRunning && isStale && (
        <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Processing appears stuck — the lock TTL has expired. Click{' '}
              <strong>Force Clear Lock</strong> to reset it immediately, or the next
              run will take over automatically.
            </span>
          </div>
          <button
            type="button"
            disabled={forceUnlockMutation.isPending}
            onClick={() => forceUnlockMutation.mutate()}
            className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded border border-destructive/40 bg-background hover:bg-destructive/5 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {forceUnlockMutation.isPending ? 'Clearing…' : 'Force Clear Lock'}
          </button>
        </div>
      )}

      {isAdmin && alreadyProcessedWarn && !forceProcess && (
        <div className="flex items-start gap-2 text-sm text-warning p-3 rounded-lg bg-warning/10 border border-warning/20">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            {alreadyProcessedWarn}{' '}
            <button type="button" className="underline font-medium" onClick={() => setForceProcess(true)}>
              Enable force override
            </button>
          </span>
        </div>
      )}

      {isAdmin && processMutation.isError && !alreadyProcessedWarn && (
        <div className="flex items-start justify-between gap-3 text-sm text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-2">
            <WifiOff className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>{processMutation.error?.message ?? 'Processing failed. Please try again.'}</span>
          </div>
          {processMutation.error?.message?.includes('already running') && (
            <button
              type="button"
              disabled={forceUnlockMutation.isPending}
              onClick={() => forceUnlockMutation.mutate()}
              className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded border border-destructive/40 bg-background hover:bg-destructive/5 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {forceUnlockMutation.isPending ? 'Clearing…' : 'Force Clear Lock'}
            </button>
          )}
        </div>
      )}

      {/* Process result success banner */}
      {isAdmin && processResult && (
        <div className="rounded-lg border border-success/30 bg-success/8 p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
            <span className="text-sm font-semibold text-success">Processing Complete</span>
            <span className="text-xs text-muted-foreground tabular-nums">{processResult.date}</span>
            <span className="text-xs text-muted-foreground">{processResult.processed_employees} employees</span>
            <span className="text-xs text-muted-foreground">{processResult.daily_records_upserted} daily rows updated</span>
            <span className="text-xs text-muted-foreground">{processResult.raw_logs_marked} raw logs marked</span>
            {processResult.incomplete_sessions > 0 && (
              <span className="text-xs text-warning flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {processResult.incomplete_sessions} incomplete sessions
              </span>
            )}
            {processResult.skipped_codes.length > 0 && (
              <span className="text-xs text-warning">
                {processResult.skipped_codes.length} skipped codes
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 w-7 p-0 flex-shrink-0"
              onClick={() => setProcessResult(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {processResult.skipped_codes.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground font-mono">
              Skipped: {processResult.skipped_codes.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* ── Active period context banner ──────────────────────────────────────── */}
      {/* Shown when attendance data is from a historical period (e.g., 2025 data
          viewed in 2026) so users know the KPIs are not live-today values.    */}
      {isAdmin && opsStats?.active_period_summary?.is_historical && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warning/20 bg-warning/5 text-xs">
          <CalendarDays className="h-3.5 w-3.5 text-warning flex-shrink-0" />
          <span className="text-muted-foreground">
            Showing active attendance period:{' '}
            <span className="font-semibold text-foreground">{todaySummaryLabel}</span>
            {' '}— no attendance data exists for today. All metrics reflect the most recent period with data.
          </span>
        </div>
      )}

      {/* ── 2. KPI ROW ─────────────────────────────────────────────────────────── */}
      {(isAdmin || isManager) && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {!opsStats && !teamLoading ? (
            Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-[62px] rounded-lg bg-muted/60 animate-pulse" />
            ))
          ) : todaySummary ? (
            <>
              {/* Period badge — always shown for admin views (month aggregate, not today) */}
              {isAdmin && (
                <div className="col-span-full flex items-center gap-1.5 text-[10px] text-muted-foreground pb-0.5">
                  <CalendarDays className="h-3 w-3 flex-shrink-0" />
                  <span>
                    Monthly aggregate ·{' '}
                    <span className="font-medium text-foreground">{todaySummaryLabel}</span>
                    {opsStats?.active_period_summary?.is_historical && (
                      <span className="ml-1 text-warning">(historical period)</span>
                    )}
                  </span>
                </div>
              )}
              <KpiChip label="Present"    value={todaySummary.present}    colorClass="text-success" />
              <KpiChip label="Late"       value={todaySummary.late}       colorClass="text-warning" />
              <KpiChip label="Absent"     value={todaySummary.absent}     colorClass="text-destructive" />
              <KpiChip label="On Leave"   value={(todaySummary as any).leave ?? (todaySummary as any).on_leave ?? 0} colorClass="text-info" />
              {/* Payable days always available from active_period_summary; not_marked for manager view */}
              {'payable_days' in todaySummary
                ? <KpiChip label="Payable Days" value={(todaySummary as any).payable_days} colorClass="text-success" />
                : <KpiChip label="Not Marked"   value={(todaySummary as any).not_marked ?? 0} colorClass="text-muted-foreground" />
              }
              <KpiChip
                label="Anomalies"
                value={opsStats?.unresolved_anomalies ?? '—'}
                colorClass={(opsStats?.unresolved_anomalies ?? 0) > 0 ? 'text-warning' : 'text-muted-foreground'}
                href={isAdmin ? '/admin/attendance/anomalies' : undefined}
              />
              <KpiChip
                label="Corrections"
                value={opsStats?.pending_corrections ?? '—'}
                colorClass={(opsStats?.pending_corrections ?? 0) > 0 ? 'text-info' : 'text-muted-foreground'}
                href={isAdmin ? '/admin/attendance/corrections' : undefined}
              />
            </>
          ) : null}
        </div>
      )}

      {/* ── 3. TWO-COLUMN: Attention Queue + Today's Distribution | Health + Links */}
      {(isAdmin || isManager) && todaySummary && (
        <div className="grid lg:grid-cols-3 gap-4">

          {/* LEFT: Attention Queue + Today's Distribution */}
          <div className="lg:col-span-2 space-y-4">

            {/* Attention Queue */}
            {isAdmin && (
              <SectionCard
                title="Attention Queue"
                icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
              >
                {attentionItems.length === 0 ? (
                  <div className="flex items-center gap-3 py-3 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    <span className="font-medium">All clear — no items require immediate attention</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {attentionItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => item.href !== '#' && navigate(item.href)}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                          item.href !== '#' && 'cursor-pointer hover:bg-accent/40',
                          item.variant === 'destructive' && 'bg-destructive/5 border border-destructive/20',
                          item.variant === 'warning'    && 'hover:bg-warning/5',
                          item.variant === 'info'       && 'hover:bg-info/5',
                        )}
                      >
                        <item.icon className={cn(
                          'h-4 w-4 flex-shrink-0',
                          item.variant === 'destructive' && 'text-destructive',
                          item.variant === 'warning'    && 'text-warning',
                          item.variant === 'info'       && 'text-info',
                        )} />
                        <span className="text-sm font-medium text-foreground tabular-nums">{item.count}</span>
                        <span className="text-sm text-muted-foreground flex-1">{item.label}</span>
                        {item.href !== '#' && (
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            )}

            {/* Attendance Distribution — always shows the active period month aggregate */}
            <SectionCard
              title={`${todaySummaryLabel} Distribution`}
              icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
              description={`Month total · ${todaySummaryLabel}${'total_employees' in todaySummary ? ` · ${(todaySummary as any).total_employees} employees` : ''}`}
            >
              {(() => {
                // Normalise field names: active_period_summary uses 'leave',
                // manager teamData.today_summary also uses 'leave'
                const leaveVal  = (todaySummary as any).leave ?? (todaySummary as any).on_leave ?? 0
                const totalBase = Math.max(
                  1,
                  todaySummary.present + todaySummary.late + todaySummary.absent + leaveVal,
                )
                const bars: Array<{ label: string; value: number; barClass: string }> = [
                  { label: 'Present',    value: todaySummary.present,    barClass: 'bg-success' },
                  { label: 'Late',       value: todaySummary.late,       barClass: 'bg-warning' },
                  { label: 'Absent',     value: todaySummary.absent,     barClass: 'bg-destructive' },
                  { label: 'On Leave',   value: leaveVal,                barClass: 'bg-info' },
                  'payable_days' in todaySummary
                    ? { label: 'Payable Days', value: (todaySummary as any).payable_days, barClass: 'bg-success/60' }
                    : { label: 'Not Marked',   value: (todaySummary as any).not_marked ?? 0, barClass: 'bg-muted-foreground/50' },
                ]
                return (
                  <div className="space-y-2.5 mt-1">
                    {bars.map(({ label, value, barClass }) => (
                      <div key={label} className="flex items-center gap-3 text-xs">
                        <span className="w-[76px] text-muted-foreground flex-shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', barClass)}
                            style={{ width: `${(value / totalBase) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-semibold text-foreground tabular-nums flex-shrink-0">{value}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </SectionCard>
          </div>

          {/* RIGHT: Processing Health + Quick Links */}
          <div className="space-y-4">

            {/* Processing Health (compact) — shows CSV pipeline when biometric not configured */}
            {isAdmin && (runHealth || (pipelineStats && pipelineStats.active_source === 'csv')) && (
              <SectionCard
                title={pipelineStats?.active_source === 'csv' ? 'CSV Pipeline Health' : 'Processing Health'}
                icon={<Activity className="h-4 w-4 text-muted-foreground" />}
                description={
                  pipelineStats?.active_source === 'csv'
                    ? pipelineStats.last_upload_at
                      ? `Last upload · ${(() => { const _d = new Date(pipelineStats.last_upload_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}`
                      : 'CSV upload pipeline'
                    : lastRun?.date ? `Based on run · ${lastRun.date}` : undefined
                }
              >
                {/* Biometric pipeline health view */}
                {runHealth && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold',
                        runHealth.level === 'healthy'  && 'bg-success/15 text-success',
                        runHealth.level === 'degraded' && 'bg-warning/15 text-warning',
                        runHealth.level === 'critical' && 'bg-destructive/15 text-destructive',
                      )}>
                        <ShieldCheck className="h-3 w-3" />
                        {runHealth.level === 'healthy'  && 'Healthy'}
                        {runHealth.level === 'degraded' && 'Degraded'}
                        {runHealth.level === 'critical' && 'Critical'}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-md bg-muted/50 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">Skip Rate</span>
                          {runHealth.skipPct > 0
                            ? <TrendingDown className="h-3 w-3 text-warning" />
                            : <TrendingUp   className="h-3 w-3 text-success" />}
                        </div>
                        <p className={cn(
                          'text-lg font-bold',
                          runHealth.skipPct === 0                           && 'text-success',
                          runHealth.skipPct >= 5 && runHealth.skipPct < 20 && 'text-warning',
                          runHealth.skipPct >= 20                           && 'text-destructive',
                        )}>
                          {runHealth.skipPct}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {lastRun?.skipped_count} of {(lastRun?.processed_count ?? 0) + (lastRun?.skipped_count ?? 0)} codes
                        </p>
                      </div>

                      <div className="p-2.5 rounded-md bg-muted/50 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">Incomplete</span>
                          {runHealth.incPct > 0
                            ? <AlertTriangle className="h-3 w-3 text-warning" />
                            : <CheckCircle2  className="h-3 w-3 text-success" />}
                        </div>
                        <p className={cn(
                          'text-lg font-bold',
                          runHealth.incPct === 0                            && 'text-success',
                          runHealth.incPct >= 10 && runHealth.incPct < 20  && 'text-warning',
                          runHealth.incPct >= 20                            && 'text-destructive',
                        )}>
                          {runHealth.incPct}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {lastRun?.incomplete_count} no OUT punch
                        </p>
                      </div>
                    </div>

                    {runHealth.level !== 'healthy' && (
                      <ContextualHint
                        id="run-health-degraded"
                        title={runHealth.level === 'critical' ? 'Action required' : 'Attention recommended'}
                        variant={runHealth.level === 'critical' ? 'warning' : 'info'}
                        inline
                        className="mt-3"
                      >
                        {runHealth.skipPct >= 5 && (
                          <>High skip rate means employee codes in biometric data don't match records. Check recently onboarded employees. </>
                        )}
                        {runHealth.incPct >= 10 && (
                          <>Employees with no OUT punch are marked present with estimated hours. Ask them to regularise.</>
                        )}
                      </ContextualHint>
                    )}
                  </>
                )}

                {/* CSV pipeline health view (shown when biometric not active) */}
                {!runHealth && pipelineStats && pipelineStats.active_source === 'csv' && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold',
                        pipelineStats.daily_rows_from_csv > 0
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning',
                      )}>
                        <ShieldCheck className="h-3 w-3" />
                        {pipelineStats.daily_rows_from_csv > 0 ? 'Healthy' : 'No data yet'}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-md bg-muted/50 space-y-1">
                        <p className="text-[10px] text-muted-foreground">Daily Rows</p>
                        <p className={cn(
                          'text-lg font-bold',
                          pipelineStats.daily_rows_from_csv > 0 ? 'text-success' : 'text-muted-foreground',
                        )}>
                          {(pipelineStats.daily_rows_from_csv ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">generated</p>
                      </div>
                      <div className="p-2.5 rounded-md bg-muted/50 space-y-1">
                        <p className="text-[10px] text-muted-foreground">Uploads</p>
                        <p className={cn(
                          'text-lg font-bold',
                          pipelineStats.upload_count_30d > 0 ? 'text-foreground' : 'text-muted-foreground',
                        )}>
                          {pipelineStats.upload_count_30d}
                        </p>
                        <p className="text-[10px] text-muted-foreground">last 30 days</p>
                      </div>
                    </div>

                    {pipelineStats.csv_date_range && (
                      <div className="mt-2 p-2 rounded-md bg-primary/5 border border-primary/15 text-xs">
                        <p className="text-[10px] text-muted-foreground mb-0.5">Uploaded period</p>
                        <p className="font-semibold text-foreground">
                          {pipelineStats.csv_date_range.from} → {pipelineStats.csv_date_range.to}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </SectionCard>
            )}

            {/* Quick Links Grid */}
            {isAdmin && (
              <SectionCard
                title="Navigate To"
                icon={<ArrowRight className="h-4 w-4 text-muted-foreground" />}
              >
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Muster Roll',    icon: BookOpen,       href: '/admin/attendance/muster' },
                    { label: 'Corrections',    icon: ClipboardCheck, href: '/admin/attendance/corrections' },
                    { label: 'Anomalies',      icon: Bug,            href: '/admin/attendance/anomalies' },
                    { label: 'Audit Log',      icon: ListFilter,     href: '/admin/attendance/audit' },
                    { label: 'Regularisation', icon: CalendarDays,   href: '/admin/attendance/regularisation' },
                    { label: 'Roster Planner', icon: BarChart3,      href: '/admin/attendance/roster-planner' },
                  ].map(({ label, icon: Icon, href }) => (
                    <Link
                      key={label}
                      to={href}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border hover:bg-accent/40 hover:border-primary/20 transition-colors text-xs font-medium text-foreground"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{label}</span>
                    </Link>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        </div>
      )}

      {/* ── 4. OPERATIONAL TIMELINE (FIX 4) ─────────────────────────────────── */}
      {isAdmin && (
        <SectionCard
          title="Recompute & Audit Activity"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          description={
            pipelineStats?.active_source === 'csv'
              ? 'Last 7 days — CSV uploads, recompute runs, corrections, leave approvals'
              : 'Last 7 days · latest 8 changes'
          }
        >
          {/* CSV pipeline activity summary (FIX 4 — shown when CSV is active) */}
          {pipelineStats && pipelineStats.active_source !== 'none' && pipelineStats.upload_count_30d > 0 && (
            <div className="flex items-center gap-3 flex-wrap mb-3 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs">
              <div className="flex items-center gap-1.5">
                <UploadIcon className="h-3 w-3 text-primary" />
                <span className="font-semibold text-foreground">{pipelineStats.upload_count_30d}</span>
                <span className="text-muted-foreground">uploads (30d)</span>
              </div>
              <div className="text-muted-foreground/60">·</div>
              <div className="flex items-center gap-1.5">
                <Database className="h-3 w-3 text-success" />
                <span className="font-semibold text-foreground">{(pipelineStats.daily_rows_from_csv ?? 0).toLocaleString()}</span>
                <span className="text-muted-foreground">daily rows generated</span>
              </div>
              {pipelineStats.csv_employees_30d > 0 && (
                <>
                  <div className="text-muted-foreground/60">·</div>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{pipelineStats.csv_employees_30d}</span>
                    <span className="text-muted-foreground">employees</span>
                  </div>
                </>
              )}
              {pipelineStats.csv_date_range && (
                <>
                  <div className="text-muted-foreground/60">·</div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {pipelineStats.csv_date_range.from} → {pipelineStats.csv_date_range.to}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {(() => {
            const rows = recentActivity?.data ?? []
            if (!rows.length) {
              return (
                <EmptyState
                  icon={Clock}
                  title="No recent audit events"
                  description={
                    pipelineStats?.active_source === 'csv'
                      ? 'Attendance changes will appear here after CSV uploads, corrections, or leave approvals.'
                      : 'Attendance changes will appear here after processing, corrections, or leave approvals.'
                  }
                />
              )
            }
            return (
              <div>
                {rows.map((row, idx) => (
                  <div
                    key={row.id}
                    className={cn(
                      'flex items-center gap-3 py-2.5 text-xs',
                      idx < rows.length - 1 && 'border-b border-border/50',
                    )}
                  >
                    <span className="w-[84px] text-muted-foreground tabular-nums flex-shrink-0">{row.date}</span>
                    <Badge
                      variant={auditSourceVariant(row.source)}
                      className="rounded-full text-[10px] capitalize flex-shrink-0"
                    >
                      {row.source}
                    </Badge>
                    <span className="flex-1 font-medium text-foreground truncate min-w-0">
                      {row.employee_name ?? '—'}
                      {row.employee_code && (
                        <span className="text-muted-foreground font-mono ml-1">#{row.employee_code}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-muted-foreground">
                      {/* Presentation-layer semantics: system recompute transitions from 'absent'
                          are not a real prior absence — they mean "no record existed yet". */}
                      <span>
                        {row.source === 'system' && row.before_status === 'absent'
                          ? 'system recompute'
                          : (row.before_status ?? '—')}
                      </span>
                      <span className="mx-1">→</span>
                      <span className="font-medium text-foreground">{row.after_status}</span>
                    </span>
                    <span className="w-[72px] text-right text-muted-foreground tabular-nums flex-shrink-0">
                      {new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )
          })()}
        </SectionCard>
      )}

      {/* ── 5. COLLAPSIBLE: Team Attendance ──────────────────────────────────── */}
      {(isAdmin || isManager) && (
        <div id="team-attendance-section">
        <CollapsibleCard
          title="Team Attendance"
          defaultOpen={false}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
        >
          {/* FIX 6 — Health banner: viewing different period than uploaded data */}
          {isTeamDateOutsideUpload && uploadedDateRange && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-warning/8 border border-warning/30 mb-3 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-warning">Viewing a different period than your uploaded data.</span>
                <span className="text-muted-foreground ml-1">
                  Uploaded attendance covers {uploadedDateRange.from} → {uploadedDateRange.to}.
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-2 text-[10px] text-primary flex-shrink-0"
                onClick={() => setTeamDate(uploadedDateRange.from)}
              >
                Jump to upload
              </Button>
            </div>
          )}

          {/* Date navigation + search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={teamPrevDay}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex flex-col items-center min-w-[150px]">
                <span className="text-sm font-medium text-foreground text-center">
                  {(() => { const _d = new Date(`${teamDate}T12:00:00Z`); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const _DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return isNaN(_d.getTime()) ? teamDate : `${_DOW[_d.getUTCDay()]}, ${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}` })()}
                </span>
                {/* FIX 3 — Context indicator */}
                {teamDate === todayStr() ? (
                  <span className="text-[10px] text-success font-medium">Today</span>
                ) : teamDate > todayStr() ? (
                  <span className="text-[10px] text-muted-foreground">Future date</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Historical data</span>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={teamNextDay}
                disabled={teamDate >= todayStr()}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* FIX 7 — Quick-switch buttons */}
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={teamDate === todayStr() ? 'secondary' : 'ghost'}
                className="h-6 px-2 text-[10px]"
                onClick={() => setTeamDate(todayStr())}
              >
                Today
              </Button>
              {uploadedDateRange && (
                <Button
                  size="sm"
                  variant={(teamDate >= uploadedDateRange.from && teamDate <= uploadedDateRange.to) ? 'secondary' : 'ghost'}
                  className="h-6 px-2 text-[10px] max-w-[160px] truncate"
                  onClick={() => setTeamDate(uploadedDateRange.from)}
                  title={`Uploaded period: ${uploadedDateRange.from} → ${uploadedDateRange.to}`}
                >
                  <Calendar className="h-2.5 w-2.5 mr-1" />
                  {uploadedDateRange.from === uploadedDateRange.to
                    ? uploadedDateRange.from
                    : `${uploadedDateRange.from.slice(5)} → ${uploadedDateRange.to.slice(5)}`}
                </Button>
              )}
            </div>

            <div className="flex-1 max-w-xs">
              <Input
                placeholder="Search by name or code…"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Team table */}
          {teamLoading ? (
            <LoadingState label="Loading team data…" />
          ) : !teamData || filteredTeam.length === 0 ? (
            /* FIX 4 — Smart empty state */
            <EmptyState
              icon={Users}
              title={teamSearch ? 'No members match your search' : 'No attendance data for this date'}
              description={
                teamSearch
                  ? 'Try a different name or code.'
                  : uploadedDateRange && (teamDate < uploadedDateRange.from || teamDate > uploadedDateRange.to)
                    ? `No records for ${teamDate}. Recent uploaded attendance exists for: ${uploadedDateRange.from} → ${uploadedDateRange.to}.`
                    : `No attendance records found for ${teamDate}. Upload a CSV or run the attendance processor to generate data.`
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Late'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTeam.map((member) => (
                    <tr
                      key={member.employee_id}
                      className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate('/admin/employees/' + member.employee_id)}
                    >
                      <td className="px-3 py-2">
                        <div>
                          <Link
                            to={`/admin/employees/${member.employee_id}`}
                            className="font-medium text-foreground hover:text-primary transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {member.name}
                          </Link>
                          <div className="text-[10px] text-muted-foreground font-mono">{member.employee_code}</div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={(TEAM_STATUS_BADGE[member.status] ?? 'outline') as StatusVariant}
                          className="rounded-full text-[10px] capitalize"
                        >
                          {TEAM_STATUS_LABEL[member.status] ?? member.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {fmtTime(member.check_in)}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {fmtTime(member.check_out)}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {member.work_hours > 0 ? `${member.work_hours}h` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {member.late_minutes > 0 ? (
                          <span className="text-warning">{member.late_minutes} min</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleCard>
        </div>
      )}

      {/* ── 6. COLLAPSIBLE: Bulk Upload ───────────────────────────────────────── */}
      {isAdmin && (
        <div id="bulk-upload-section">
        <CollapsibleCard
          title="Bulk Upload Attendance"
          defaultOpen={false}
          icon={<UploadCloud className="h-4 w-4 text-muted-foreground" />}
          action={
            <Button size="sm" variant="outline" onClick={handleDownloadSample}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Sample CSV
            </Button>
          }
        >
          {/* Hidden file input */}
          <input
            ref={uploadFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleUploadFileChange}
          />

          <p className="text-xs text-muted-foreground mb-4">
            Upload a CSV with employee punch-in/out data. Each row creates two punch records (IN + OUT) and triggers automatic recompute.
          </p>

          {/* File picker zone */}
          {!uploadFileName ? (
            <button
              type="button"
              onClick={() => uploadFileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-muted/30 py-8 text-center transition-colors hover:bg-muted/50 hover:border-primary/40"
            >
              <UploadCloud className="h-7 w-7 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Click to select a CSV file</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Columns required: <span className="font-mono">employee_code, date, in_time, out_time</span>
                </p>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
              <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{uploadFileName}</p>
                <p className="text-xs text-muted-foreground">
                  {uploadTotalRows} data row{uploadTotalRows !== 1 ? 's' : ''} detected
                </p>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={handleUploadClear}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Parse error */}
          {uploadParseError && (
            <div className="flex items-start gap-2 text-sm p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive mt-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{uploadParseError}</span>
            </div>
          )}

          {/* Missing column warning */}
          {uploadMissingCols.length > 0 && (
            <div className="flex items-start gap-2 text-sm p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive mt-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Missing required column{uploadMissingCols.length > 1 ? 's' : ''}:{' '}
                <span className="font-mono font-semibold">{uploadMissingCols.join(', ')}</span>
              </span>
            </div>
          )}

          {/* Column headers detected */}
          {uploadHeaders.length > 0 && uploadMissingCols.length === 0 && (
            <div className="flex flex-wrap gap-1.5 items-center mt-3">
              <span className="text-xs text-muted-foreground">Columns:</span>
              {uploadHeaders.map((h) => (
                <span
                  key={h}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    UPLOAD_REQUIRED_COLS.includes(h as typeof UPLOAD_REQUIRED_COLS[number])
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {h}
                </span>
              ))}
            </div>
          )}

          {/* Preview table */}
          {uploadPreviewRows.length > 0 && uploadMissingCols.length === 0 && (
            <div className="mt-4 rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-muted/30 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground">
                  Preview — first {uploadPreviewRows.length} of {uploadTotalRows} row{uploadTotalRows !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-12">#</th>
                      {uploadHeaders.map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-muted-foreground font-semibold font-mono">{h}</th>
                      ))}
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadPreviewRows.map((row) => (
                      <tr
                        key={row.line}
                        className={`border-b border-border/50 last:border-0 ${
                          row.warnings.length > 0 ? 'bg-destructive/5' : ''
                        }`}
                      >
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.line}</td>
                        {uploadHeaders.map((h) => (
                          <td key={h} className="px-3 py-2 font-mono text-foreground">
                            {row.fields[h] ?? <span className="text-muted-foreground italic">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {row.warnings.length === 0 ? (
                            <span className="text-success text-[10px] font-semibold">✓ OK</span>
                          ) : (
                            <span className="text-destructive text-[10px]" title={row.warnings.join('; ')}>
                              ✗ {row.warnings[0]}{row.warnings.length > 1 ? ` (+${row.warnings.length - 1})` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {uploadPreviewRows.filter((r) => r.warnings.length > 0).length > 0
                    ? `${uploadPreviewRows.filter((r) => r.warnings.length > 0).length} row(s) in preview have issues — the server will skip invalid rows.`
                    : 'Preview looks good. Click Upload to process all rows.'}
                </p>
                <Button
                  size="sm"
                  disabled={!uploadCsvText || uploadMissingCols.length > 0 || uploadMutation.isPending}
                  onClick={() => { setUploadResult(null); uploadMutation.mutate(uploadCsvText!) }}
                >
                  {uploadMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Uploading…</>
                    : <><UploadCloud className="h-3.5 w-3.5 mr-1.5" />Upload {uploadTotalRows} Row{uploadTotalRows !== 1 ? 's' : ''}</>
                  }
                </Button>
              </div>
            </div>
          )}

          {/* Upload mutation error */}
          {uploadMutation.isError && (
            <div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-md bg-destructive/10 border border-destructive/20 mt-3">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{uploadMutation.error?.message ?? 'Upload failed. Please try again.'}</span>
            </div>
          )}

          {/* Upload result summary */}
          {uploadResult && (
            <div className="mt-4 rounded-lg border border-success/30 bg-success/8 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm font-semibold text-success">Upload Complete</span>
              </div>

              {/* FIX 1 — Date range summary */}
              {uploadedDateRange && uploadResult.success_rows > 0 && (
                <div className="flex items-center gap-2 p-2.5 rounded-md bg-primary/8 border border-primary/20 mb-3">
                  <Calendar className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-primary">
                      Attendance uploaded for: {uploadedDateRange.from} → {uploadedDateRange.to}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      · {uploadedDateRange.employee_count} employee{uploadedDateRange.employee_count !== 1 ? 's' : ''}
                      · {uploadResult.success_rows} rows
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                {[
                  { label: 'Total Rows',  value: uploadResult.total_rows,        cls: 'text-foreground' },
                  { label: 'Succeeded',   value: uploadResult.success_rows,       cls: 'text-success' },
                  { label: 'Failed',      value: uploadResult.failed_rows.length, cls: uploadResult.failed_rows.length > 0 ? 'text-destructive' : 'text-muted-foreground' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="p-3 rounded-md bg-muted text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                  </div>
                ))}
              </div>

              {uploadResult.failed_rows.length > 0 && (
                <div className="rounded-md border border-destructive/20 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-12">Line</th>
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Error</th>
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Row Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.failed_rows.map((fr) => (
                        <tr key={fr.line} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{fr.line}</td>
                          <td className="px-3 py-2 text-destructive">{fr.error}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground truncate max-w-xs" title={fr.row}>{fr.row}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {uploadResult.success_rows > 0 && (
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted-foreground">
                    Attendance recompute triggered for all successfully uploaded rows.
                  </p>
                  {/* FIX 2 — Jump-To-Date CTA */}
                  {uploadedDateRange && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5 ml-3 flex-shrink-0"
                      onClick={() => {
                        setTeamDate(uploadedDateRange.from)
                        // Scroll to Team Attendance section smoothly
                        document.getElementById('team-attendance-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                    >
                      <Eye className="h-3 w-3" />
                      View Uploaded Attendance
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </CollapsibleCard>
        </div>
      )}

      {/* ── 7. COLLAPSIBLE: Recompute Range ──────────────────────────────────── */}
      {isAdmin && (
        <CollapsibleCard
          title="Recompute Attendance Range"
          defaultOpen={false}
          icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
        >
          <ContextualHint
            id="process-attendance-hint"
            title="When to process attendance"
            variant="tip"
            dismissible
          >
            Run daily after biometric punches have synced. The processor reads unprocessed raw logs,
            pairs check-in/out sessions, and upserts attendance_daily rows with computed status.
            Use <strong>Recompute Range</strong> below to fix historical data without running a full process job.
          </ContextualHint>

          <div className="space-y-3 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="From Date" htmlFor="rc-from" required>
                <DateInput
                  id="rc-from"
                  value={recomputeFrom}
                  onChange={setRecomputeFrom}
                  max={recomputeTo}
                />
              </FormField>
              <FormField label="To Date" htmlFor="rc-to" required>
                <DateInput
                  id="rc-to"
                  value={recomputeTo}
                  onChange={setRecomputeTo}
                  min={recomputeFrom}
                />
              </FormField>
              <FormField label="Employee ID (optional)" htmlFor="rc-emp">
                <Input
                  id="rc-emp"
                  value={recomputeEmpId}
                  onChange={(e) => setRecomputeEmpId(e.target.value)}
                  placeholder="UUID — leave blank for all"
                />
              </FormField>
            </div>

            <Button
              size="sm"
              disabled={recomputeMutation.isPending}
              onClick={() => {
                setRecomputeResult(null)
                recomputeMutation.mutate({
                  from_date:   recomputeFrom,
                  to_date:     recomputeTo,
                  ...(recomputeEmpId ? { employee_id: recomputeEmpId } : {}),
                })
              }}
            >
              {recomputeMutation.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Recomputing…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Recompute</>
              )}
            </Button>

            {recomputeMutation.isError && (
              <p className="text-xs text-destructive">{recomputeMutation.error?.message}</p>
            )}

            {recomputeResult && (
              <div className="flex items-center gap-4 text-sm p-3 rounded-md bg-success/10 border border-success/20 text-success">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>
                  Recomputed <strong>{recomputeResult.employees_processed}</strong> employee(s) ·{' '}
                  <strong>{recomputeResult.rows_upserted}</strong> daily rows updated ·{' '}
                  {recomputeResult.duration_ms}ms
                </span>
              </div>
            )}
          </div>
        </CollapsibleCard>
      )}

      {/* ── 8. COLLAPSIBLE: Audit Log ─────────────────────────────────────────── */}
      {isAdmin && (
        <CollapsibleCard
          title={`Audit Log${auditData ? ` (${auditData.total})` : ''}`}
          defaultOpen={false}
          icon={<ListFilter className="h-4 w-4 text-muted-foreground" />}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setLogApplied({
                  from:        logFrom,
                  to:          logTo,
                  source:      logSource,
                  employee_id: logEmpId,
                })
              }
            >
              Apply Filters
            </Button>
          }
        >
          {/* Filter row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <FormField label="From" htmlFor="log-from">
              <DateInput
                id="log-from"
                value={logFrom}
                onChange={setLogFrom}
              />
            </FormField>
            <FormField label="To" htmlFor="log-to">
              <DateInput
                id="log-to"
                value={logTo}
                onChange={setLogTo}
              />
            </FormField>
            <FormField label="Employee ID" htmlFor="log-emp-id">
              <Input
                id="log-emp-id"
                placeholder="UUID (optional)"
                value={logEmpId}
                onChange={(e) => setLogEmpId(e.target.value)}
              />
            </FormField>
            <FormField label="Source" htmlFor="log-source">
              <select
                id="log-source"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                value={logSource}
                onChange={(e) => setLogSource(e.target.value as '' | 'system' | 'regularisation' | 'leave')}
              >
                <option value="">All</option>
                <option value="system">System</option>
                <option value="regularisation">Regularisation</option>
                <option value="leave">Leave</option>
              </select>
            </FormField>
          </div>

          {/* Audit table */}
          {auditLoading ? (
            <LoadingState label="Loading audit logs…" />
          ) : !auditData || ensureArray(auditData.data).length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No audit logs found"
              description="Try adjusting your filters and clicking Apply Filters."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['Date', 'Employee', 'Source', 'Before → After', 'Changed At'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ensureArray<AuditLogRow>(auditData?.data).map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-foreground font-medium tabular-nums">{row.date}</td>
                      <td className="px-4 py-3">
                        {row.employee_name ? (
                          <div>
                            <span className="text-foreground font-medium">{row.employee_name}</span>
                            {row.employee_code && (
                              <div className="text-[10px] text-muted-foreground font-mono">{row.employee_code}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={auditSourceVariant(row.source)} className="rounded-full text-[10px] capitalize">
                          {row.source}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-muted-foreground">{row.before_status ?? '—'}</span>
                        <span className="mx-1.5 text-muted-foreground">→</span>
                        <span className="text-foreground font-medium">{row.after_status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                        <div>{(() => { const _d = new Date(row.created_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })()}</div>
                        <div className="text-[10px]">{new Date(row.created_at).toLocaleTimeString()}</div>
                        {row.changed_by_name && (
                          <div className="text-[10px] text-muted-foreground/70">{row.changed_by_name}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleCard>
      )}

      {/* ── 9. RUN DETAILS DIALOG (preserved unchanged) ──────────────────────── */}
      <Dialog open={!!detailRunId} onOpenChange={(open) => { if (!open) setDetailRunId(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Details</DialogTitle>
            <DialogDescription>
              {detailRun
                ? `${detailRun.date} · run ${detailRun.id.slice(0, 8)}…`
                : 'Loading run details…'}
            </DialogDescription>
          </DialogHeader>

          {detailLoading && <LoadingState label="Fetching run details…" />}

          {detailRun && !detailLoading && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3">
                <Badge
                  variant={detailRun.error_message ? 'destructive' : 'success'}
                  className="rounded-full text-xs"
                >
                  {detailRun.error_message ? 'Failed' : 'Success'}
                </Badge>
                {detailRun.duration_ms != null && (
                  <span className="text-xs text-muted-foreground">
                    {fmtDuration(detailRun.duration_ms)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Employees processed', value: detailRun.processed_count },
                  { label: 'Log rows created',    value: detailRun.logs_created },
                  { label: 'Daily rows upserted', value: detailRun.daily_upserted },
                  { label: 'Raw logs marked',     value: detailRun.raw_logs_marked },
                  { label: 'Skipped codes',       value: detailRun.skipped_count },
                  { label: 'Incomplete sessions', value: detailRun.incomplete_count },
                ].map(({ label, value }) => (
                  <div key={label} className="p-2 rounded-md bg-muted">
                    <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
                    <p className="font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {(detailRun.skipped_codes ?? []).length > 0 && (
                <div className="p-3 rounded-md bg-muted border border-border">
                  <p className="text-xs font-semibold text-warning mb-1">
                    Skipped employee codes — raw logs kept for retry:
                  </p>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {detailRun.skipped_codes.join(', ')}
                  </p>
                </div>
              )}

              {detailRun.error_message && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive font-mono break-all">
                  {detailRun.error_message}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border">
                <p>Started: {new Date(detailRun.started_at).toLocaleString()}</p>
                {detailRun.completed_at && (
                  <p>Completed: {new Date(detailRun.completed_at).toLocaleString()}</p>
                )}
              </div>

              <div className="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={isExporting}
                  onClick={() => downloadCsv(detailRun.id, detailRun.date)}
                >
                  {isExporting
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Exporting…</>
                    : <><Download className="h-3.5 w-3.5 mr-1.5" />Export CSV</>
                  }
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </PageContainer>
  )
}
