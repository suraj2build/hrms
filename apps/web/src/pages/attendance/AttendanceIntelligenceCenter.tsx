/**
 * AttendanceIntelligenceCenter — /admin/attendance/intelligence
 *
 * Phase 16 — Attendance Session Intelligence workspace.
 * Surfaces work-session data across 8 operational tabs:
 *   1. Live Sessions       — per-employee session list with state / source / locks
 *   2. Missing Punches     — missing IN/OUT detection, CSV export
 *   3. Cross-Midnight      — overnight session monitor with date-ownership display
 *   4. Anomalies           — severity-filtered anomaly cards with inline resolve
 *   5. Session Replay      — full punch→session→state explainability for any day
 *   6. Payroll Locks       — view locked sessions; warns against recalculation
 *   7. OT Heatmap          — per-employee calendar heatmap of overtime minutes
 *   8. Compliance Risks    — per-employee risk summaries with export
 *
 * Access: hr_admin / super_admin.
 */

import { useState, useMemo, useCallback }        from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Clock, Users, Lock, BarChart3,
  Shield, Zap, RefreshCw, Loader2, ChevronLeft, ChevronRight,
  X, Download, CheckCircle2, XCircle, Info, Eye, Moon,
} from 'lucide-react'
import { toast }           from 'sonner'

import { PageContainer }   from '@/components/layout/PageContainer'
import { SubTabs }         from '@/components/ui/SubTabs'
import { PageHeader }      from '@/components/layout/PageHeader'
import { SectionCard }     from '@/components/layout/SectionCard'
import { Button }          from '@/components/ui/button'
import { Badge }           from '@/components/ui/badge'
import { Input }           from '@/components/ui/input'
import { DateInput }       from '@/components/ui/date-input'
import { api }             from '@/lib/api/client'
import { cn }              from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface WorkSession {
  id: string
  employee_id: string
  employee_name?: string | null
  employee_code?: string | null
  attendance_date: string
  session_start: string
  session_end: string | null
  work_minutes: number | null
  overtime_minutes: number
  late_minutes: number
  early_exit_minutes: number
  source: string
  source_punch_ids: string[]
  shift_id: string | null
  is_cross_midnight: boolean
  approval_status: string
  payroll_locked: boolean
  payroll_locked_at: string | null
  compliance_flags: Record<string, unknown>
}

interface SessionAnomaly {
  id: string
  employee_id: string
  employee_name?: string | null
  employee_code?: string | null
  attendance_date: string
  anomaly_type: string
  severity: 'info' | 'warning' | 'critical'
  session_id: string | null
  detail: Record<string, unknown>
  resolved: boolean
  created_at: string
}

interface MissingPunchEntry {
  employee_id: string
  employee_name: string
  employee_code: string
  date: string
  in_punch: string | null
  out_punch: string | null
  source: string
}

interface DaySessionReport {
  employee_id: string
  date: string
  raw_punches: Array<{ id: string; punch_time: string; punch_type: string; source: string }>
  pairing_decisions: Array<{
    in_punch_id: string
    out_punch_id: string | null
    decision: string
    is_cross_midnight: boolean
  }>
  sessions: Array<{
    in_punch: { punch_time: string }
    out_punch: { punch_time: string } | null
    work_minutes: number | null
    is_complete: boolean
    is_cross_midnight: boolean
    attendance_date: string
  }>
  ownership_decision: {
    attendance_date: string
    payroll_month: string
    shift_name?: string
    is_cross_midnight: boolean
    ownership_source: string
  }
  anomalies: Array<{ anomaly_type: string; severity: string; detail: Record<string, unknown> }>
  attendance_state: string
  state_reason: string
  work_minutes_total: number
  overtime_minutes: number
  late_minutes: number
  early_exit_minutes: number
}

interface OtHeatmapRow {
  employee_id: string
  employee_name: string
  employee_code: string
  daily_ot: Record<string, number>   // date → OT minutes
  total_ot_minutes: number
}

interface Employee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
}

// ── Constants & Helpers ────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(m: string): string {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return iso.slice(11, 16) || '—'
  }
}

function fmtMins(m: number | null): string {
  if (m === null || m === undefined) return '—'
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h === 0) return `${min}m`
  if (min === 0) return `${h}h`
  return `${h}h ${min}m`
}

const ANOMALY_SEVERITY_COLOR: Record<string, string> = {
  info:     'text-blue-600 bg-blue-50 border-blue-200',
  warning:  'text-amber-600 bg-amber-50 border-amber-200',
  critical: 'text-red-600 bg-red-50 border-red-200',
}

const ANOMALY_LABELS: Record<string, string> = {
  missing_punch:                'Missing Punch',
  excessive_ot:                 'Excessive OT',
  insufficient_rest:            'Insufficient Rest',
  double_shift:                 'Double Shift',
  unauthorized_source:          'Unauthorized Source',
  suspicious_timing:            'Suspicious Timing',
  excessive_consecutive_days:   'Consecutive Days',
  early_punch:                  'Early Punch',
  late_punch:                   'Late Punch',
  duplicate_punch:              'Duplicate Punch',
  cross_midnight_unresolved:    'Cross-Midnight Unresolved',
}

const STATE_STYLES: Record<string, string> = {
  PRESENT:           'bg-green-100 text-green-800',
  LATE:              'bg-yellow-100 text-yellow-800',
  HALF_DAY:          'bg-orange-100 text-orange-800',
  ABSENT:            'bg-red-100 text-red-800',
  HOLIDAY:           'bg-amber-100 text-amber-800',
  WEEKLY_OFF:        'bg-slate-100 text-slate-600',
  WORKED_ON_OFF:     'bg-violet-100 text-violet-800',
  WORKED_ON_HOLIDAY: 'bg-purple-100 text-purple-800',
  INCOMPLETE_PUNCH:  'bg-orange-100 text-orange-700',
  MANUAL_REVIEW:     'bg-rose-100 text-rose-800',
  AUTO_REGULARIZED:  'bg-teal-100 text-teal-700',
}

const SOURCE_ICON: Record<string, string> = {
  biometric: '🖐',
  mobile:    '📱',
  manual:    '✏️',
  kiosk:     '🖥',
  import:    '📥',
}

function srcIcon(source: string): string {
  return SOURCE_ICON[source] ?? '❓'
}

// ── Shared sub-components ──────────────────────────────────────────────────────

/** Reusable month navigator */
function MonthNav({
  month,
  onChange,
}: {
  month: string
  onChange: (m: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8"
        onClick={() => onChange(addMonths(month, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-semibold min-w-[130px] text-center">{fmtMonth(month)}</span>
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8"
        onClick={() => onChange(addMonths(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** Spinner centred in a SectionCard */
function CardSpinner() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

/** Generic empty state */
function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Icon className="h-10 w-10 opacity-30" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

// ── Tab: Live Sessions ─────────────────────────────────────────────────────────

function TabSessions({
  month,
  onMonthChange,
  employeeId,
  empSearch,
  onEmpSearch,
  employees,
  onSelectEmployee,
}: {
  month: string
  onMonthChange: (m: string) => void
  employeeId: string
  empSearch: string
  onEmpSearch: (v: string) => void
  employees: Employee[]
  onSelectEmployee: (id: string) => void
}) {
  const { data: sessions, isLoading } = useQuery<WorkSession[]>({
    queryKey:  ['att-sessions', employeeId, month],
    queryFn:   () =>
      api
        .get<{ data: WorkSession[] }>(
          `/attendance/sessions?employeeId=${employeeId}&month=${month}`,
        )
        .then(r => r.data),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    if (!empSearch) return employees
    const q = empSearch.toLowerCase()
    return employees.filter(
      e =>
        e.first_name.toLowerCase().includes(q) ||
        e.last_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q),
    )
  }, [employees, empSearch])

  const selectedEmp = employees.find(e => e.id === employeeId)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3">
          <MonthNav month={month} onChange={onMonthChange} />

          {/* Employee search */}
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Input
              placeholder="Search employee…"
              value={empSearch}
              onChange={e => onEmpSearch(e.target.value)}
              className="h-8 text-sm pr-8"
            />
            {empSearch && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => onEmpSearch('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Dropdown */}
            {empSearch && filtered.length > 0 && !selectedEmp && (
              <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filtered.slice(0, 20).map(e => (
                  <button
                    key={e.id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                    onClick={() => {
                      onSelectEmployee(e.id)
                      onEmpSearch(`${e.first_name} ${e.last_name}`)
                    }}
                  >
                    <span className="font-medium">{e.first_name} {e.last_name}</span>
                    <span className="text-muted-foreground ml-1.5">({e.employee_code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedEmp && (
            <Badge variant="secondary" className="text-xs gap-1">
              {selectedEmp.first_name} {selectedEmp.last_name}
              <button onClick={() => { onSelectEmployee(''); onEmpSearch('') }}>
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          )}
        </div>
      </SectionCard>

      {/* Content */}
      {!employeeId ? (
        <SectionCard>
          <EmptyState icon={Users} text="Select an employee to view their sessions." />
        </SectionCard>
      ) : isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !sessions?.length ? (
        <SectionCard>
          <EmptyState icon={Clock} text="No sessions found for this employee and month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Date', 'Session', 'Duration', 'Source', 'Shift', 'Approval', 'Flags'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const flagKeys = Object.keys(s.compliance_flags ?? {})
                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {s.attendance_date}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{fmtTime(s.session_start)}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className={cn(s.session_end ? 'font-medium' : 'text-muted-foreground/50')}>
                          {fmtTime(s.session_end)}
                        </span>
                        {s.is_cross_midnight && (
                          <Badge className="ml-1.5 text-[10px] bg-primary/15 text-primary border-primary/30">
                            <Moon className="h-2.5 w-2.5 mr-0.5" />+1
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        <span className="font-medium">{fmtMins(s.work_minutes)}</span>
                        {s.overtime_minutes > 0 && (
                          <span className="text-warning ml-1.5 text-[10px]">+{fmtMins(s.overtime_minutes)} OT</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-base" title={s.source}>
                        {srcIcon(s.source)}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {s.shift_id ? (
                          <span className="text-[11px]">shift assigned</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/50">no shift</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {s.approval_status}
                        </Badge>
                        {s.payroll_locked && (
                          <Badge className="ml-1 text-[10px] bg-muted text-muted-foreground border-border">
                            <Lock className="h-2.5 w-2.5 mr-0.5" />Locked
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {flagKeys.slice(0, 3).map(flag => (
                            <Badge key={flag} variant="outline" className="text-[9px] px-1 py-0">
                              {flag}
                            </Badge>
                          ))}
                          {flagKeys.length > 3 && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              +{flagKeys.length - 3}
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Tab: Missing Punches ───────────────────────────────────────────────────────

function exportMissingPunchesCSV(rows: MissingPunchEntry[]) {
  const headers = ['Employee', 'Code', 'Date', 'IN Punch', 'OUT Punch', 'Source']
  const lines = rows.map(r =>
    [r.employee_name, r.employee_code, r.date, r.in_punch ?? '—', r.out_punch ?? '—', r.source].join(','),
  )
  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `missing-punches.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function TabMissingPunches({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const { data: entries, isLoading } = useQuery<MissingPunchEntry[]>({
    queryKey:  ['att-missing-punches', month],
    queryFn:   () =>
      api
        .get<{ data: MissingPunchEntry[] }>(`/attendance/sessions/missing-punches?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  const missingIn  = useMemo(() => (entries ?? []).filter(e => !e.in_punch).length,  [entries])
  const missingOut = useMemo(() => (entries ?? []).filter(e => !e.out_punch).length, [entries])

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-xs font-semibold text-destructive">{missingIn} missing IN</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-warning" />
              <span className="text-xs font-semibold text-warning">{missingOut} missing OUT</span>
            </div>
            {(entries?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={() => exportMissingPunchesCSV(entries ?? [])}
              >
                <Download className="h-3.5 w-3.5" />Export CSV
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !entries?.length ? (
        <SectionCard>
          <EmptyState icon={CheckCircle2} text="No missing punches detected for this month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Code', 'Date', 'IN Punch', 'OUT Punch', 'Source'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'border-b border-border/50',
                      !e.in_punch  ? 'bg-destructive/10' : !e.out_punch ? 'bg-warning/10' : '',
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{e.employee_name}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono">{e.employee_code}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{e.date}</td>
                    <td className="px-3 py-2">
                      {e.in_punch ? (
                        <span className="text-success font-medium">{fmtTime(e.in_punch)}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive font-semibold">
                          <XCircle className="h-3 w-3" />Missing
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.out_punch ? (
                        <span className="text-success font-medium">{fmtTime(e.out_punch)}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-warning font-semibold">
                          <XCircle className="h-3 w-3" />Missing
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-base" title={e.source}>{srcIcon(e.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Tab: Cross-Midnight Monitor ───────────────────────────────────────────────

function TabCrossMidnight({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const { data: sessions, isLoading } = useQuery<WorkSession[]>({
    queryKey:  ['att-cross-midnight', month],
    queryFn:   () =>
      api
        .get<{ data: WorkSession[] }>(`/attendance/sessions/cross-midnight?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          {sessions && (
            <Badge variant="secondary" className="text-xs">
              <Moon className="h-3 w-3 mr-1" />
              {sessions.length} overnight session{sessions.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !sessions?.length ? (
        <SectionCard>
          <EmptyState icon={Moon} text="No cross-midnight sessions found for this month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Business Date', 'Start (prev day)', 'End (current day)', 'Duration', 'Source'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">
                        {s.employee_code
                          ? <>{s.employee_name} <span className="font-mono">· {s.employee_code}</span></>
                          : <span className="font-mono">{s.employee_id.slice(0, 8)}…</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Moon className="h-3 w-3 text-primary" />
                        <span className="font-semibold text-primary">{s.attendance_date}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Business Date: {s.attendance_date}</p>
                    </td>
                    <td className="px-3 py-2 font-medium">{fmtTime(s.session_start)}</td>
                    <td className="px-3 py-2 font-medium">
                      {fmtTime(s.session_end)}
                      {!s.session_end && (
                        <Badge variant="outline" className="ml-1 text-[10px]">open</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium">{fmtMins(s.work_minutes)}</td>
                    <td className="px-3 py-2 text-base" title={s.source}>{srcIcon(s.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Tab: Anomalies ─────────────────────────────────────────────────────────────

function TabAnomalies({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const qc = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all')

  const { data: anomalies, isLoading } = useQuery<SessionAnomaly[]>({
    queryKey:  ['att-anomalies', month],
    queryFn:   () =>
      api
        .get<{ data: SessionAnomaly[] }>(`/work-session-anomalies?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/work-session-anomalies/${id}/resolve`, {}),
    onSuccess: () => {
      toast.success('Anomaly resolved.')
      qc.invalidateQueries({ queryKey: ['att-anomalies', month] })
    },
    onError: () => toast.error('Failed to resolve anomaly.'),
  })

  const filtered = useMemo(() => {
    const list = anomalies ?? []
    if (severityFilter === 'all') return list
    return list.filter(a => a.severity === severityFilter)
  }, [anomalies, severityFilter])

  const counts = useMemo(() => {
    const list = anomalies ?? []
    return {
      critical: list.filter(a => a.severity === 'critical').length,
      warning:  list.filter(a => a.severity === 'warning').length,
      info:     list.filter(a => a.severity === 'info').length,
    }
  }, [anomalies])

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: 'all',      label: 'All',      count: (anomalies ?? []).length },
                { key: 'critical', label: 'Critical', count: counts.critical },
                { key: 'warning',  label: 'Warning',  count: counts.warning },
                { key: 'info',     label: 'Info',     count: counts.info },
              ] as const
            ).map(f => (
              <button
                key={f.key}
                onClick={() => setSeverityFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full border transition-colors',
                  severityFilter === f.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label} {f.count > 0 && <span className="ml-0.5 font-semibold">{f.count}</span>}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !filtered.length ? (
        <SectionCard>
          <EmptyState icon={Shield} text="No anomalies found for the selected filter." />
        </SectionCard>
      ) : (
        <div className="space-y-2">
          {filtered.map(a => (
            <div
              key={a.id}
              className={cn(
                'rounded-lg border p-3 text-xs',
                ANOMALY_SEVERITY_COLOR[a.severity] ?? 'text-foreground bg-muted border-border',
                a.resolved && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('font-semibold', a.resolved && 'line-through')}>
                      {ANOMALY_LABELS[a.anomaly_type] ?? a.anomaly_type}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] capitalize border', ANOMALY_SEVERITY_COLOR[a.severity])}
                    >
                      {a.severity}
                    </Badge>
                    {a.resolved && (
                      <Badge variant="outline" className="text-[10px] text-success border-success/30">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Resolved
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] opacity-80">
                    <span>Employee: {a.employee_code
                      ? <span className="font-medium">{a.employee_name} <span className="font-mono text-muted-foreground">· {a.employee_code}</span></span>
                      : <span className="font-mono">{a.employee_id.slice(0, 8)}…</span>}</span>
                    <span>Date: {a.attendance_date}</span>
                    {a.session_id && <span>Session: <span className="font-mono">{a.session_id.slice(0, 8)}…</span></span>}
                  </div>
                  {Object.keys(a.detail ?? {}).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.entries(a.detail).slice(0, 5).map(([k, v]) => (
                        <span key={k} className="text-[10px] opacity-70">
                          {k}: <span className="font-semibold">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!a.resolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate(a.id)}
                  >
                    {resolve.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Resolve'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab: Session Replay ────────────────────────────────────────────────────────

function TabReplay({
  employeeId,
  empSearch,
  onEmpSearch,
  employees,
  onSelectEmployee,
  replayDate,
  onReplayDate,
}: {
  employeeId: string
  empSearch: string
  onEmpSearch: (v: string) => void
  employees: Employee[]
  onSelectEmployee: (id: string) => void
  replayDate: string
  onReplayDate: (d: string) => void
}) {
  const { data: report, isLoading } = useQuery<DaySessionReport>({
    queryKey:  ['att-replay', employeeId, replayDate],
    queryFn:   () =>
      api
        .get<{ data: DaySessionReport }>(
          `/attendance/sessions/explain?employeeId=${employeeId}&date=${replayDate}`,
        )
        .then(r => r.data),
    enabled:   !!employeeId && !!replayDate,
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    if (!empSearch) return employees
    const q = empSearch.toLowerCase()
    return employees.filter(
      e =>
        e.first_name.toLowerCase().includes(q) ||
        e.last_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q),
    )
  }, [employees, empSearch])

  const selectedEmp = employees.find(e => e.id === employeeId)

  return (
    <div className="space-y-4">
      {/* Controls */}
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3">
          {/* Employee search */}
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Input
              placeholder="Search employee…"
              value={empSearch}
              onChange={e => onEmpSearch(e.target.value)}
              className="h-8 text-sm pr-8"
            />
            {empSearch && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => onEmpSearch('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {empSearch && filtered.length > 0 && !selectedEmp && (
              <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filtered.slice(0, 20).map(e => (
                  <button
                    key={e.id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                    onClick={() => {
                      onSelectEmployee(e.id)
                      onEmpSearch(`${e.first_name} ${e.last_name}`)
                    }}
                  >
                    <span className="font-medium">{e.first_name} {e.last_name}</span>
                    <span className="text-muted-foreground ml-1.5">({e.employee_code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedEmp && (
            <Badge variant="secondary" className="text-xs gap-1">
              {selectedEmp.first_name} {selectedEmp.last_name}
              <button onClick={() => { onSelectEmployee(''); onEmpSearch('') }}>
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          )}

          <DateInput
            value={replayDate}
            onChange={onReplayDate}
            className="h-8 text-sm w-auto"
          />
        </div>
      </SectionCard>

      {!employeeId ? (
        <SectionCard>
          <EmptyState icon={Eye} text="Select an employee and date to replay the session." />
        </SectionCard>
      ) : isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !report ? (
        <SectionCard>
          <EmptyState icon={Eye} text="No session data found for this employee and date." />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {/* a) Raw Punches */}
          <SectionCard title="Raw Punches" icon={<Clock className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-1">
              {report.raw_punches.map((p, i) => (
                <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-border/40 last:border-0">
                  <span className="font-mono text-muted-foreground text-[10px]">{p.id.slice(0, 8)}…</span>
                  <span className="font-semibold">{fmtTime(p.punch_time)}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      p.punch_type === 'IN'
                        ? 'text-green-700 border-green-200 bg-green-50'
                        : 'text-red-700 border-red-200 bg-red-50',
                    )}
                  >
                    {p.punch_type}
                  </Badge>
                  <span className="text-base" title={p.source}>{srcIcon(p.source)}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* b) Pairing Decisions */}
          <SectionCard title="Pairing Decisions" icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {report.pairing_decisions.map((pd, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <span className="font-mono text-success text-[10px]">{pd.in_punch_id.slice(0, 8)}…</span>
                  <span className="text-muted-foreground">→</span>
                  {pd.out_punch_id ? (
                    <span className="font-mono text-destructive text-[10px]">{pd.out_punch_id.slice(0, 8)}…</span>
                  ) : (
                    <span className="text-muted-foreground/50 text-[10px]">unpaired</span>
                  )}
                  <span className="text-muted-foreground ml-2">{pd.decision}</span>
                  {pd.is_cross_midnight && (
                    <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30 ml-auto">
                      <Moon className="h-2.5 w-2.5 mr-0.5" />cross-midnight
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* c) Ownership Decision */}
          <SectionCard title="Ownership Decision" icon={<Info className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {[
                { label: 'Attendance Date',   value: report.ownership_decision.attendance_date },
                { label: 'Payroll Month',     value: report.ownership_decision.payroll_month },
                { label: 'Shift',             value: report.ownership_decision.shift_name ?? '—' },
                { label: 'Cross-Midnight',    value: report.ownership_decision.is_cross_midnight ? 'Yes' : 'No' },
                { label: 'Ownership Source',  value: report.ownership_decision.ownership_source },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* d) Sessions Built */}
          <SectionCard title="Sessions Built" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {report.sessions.map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 text-xs py-1.5 border-b border-border/40 last:border-0">
                  <span className="font-medium">{fmtTime(s.in_punch.punch_time)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className={cn('font-medium', s.out_punch ? '' : 'text-muted-foreground/50')}>
                    {s.out_punch ? fmtTime(s.out_punch.punch_time) : '(open)'}
                  </span>
                  <span className="tabular-nums">{fmtMins(s.work_minutes)}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px]',
                      s.is_complete
                        ? 'text-green-700 border-green-200 bg-green-50'
                        : 'text-amber-700 border-amber-200 bg-amber-50',
                    )}
                  >
                    {s.is_complete ? 'complete' : 'incomplete'}
                  </Badge>
                  {s.is_cross_midnight && (
                    <Badge className="text-[10px] bg-primary/15 text-primary border-primary/30">
                      <Moon className="h-2.5 w-2.5 mr-0.5" />+1
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* e) Anomalies Detected */}
          {report.anomalies.length > 0 && (
            <SectionCard title="Anomalies Detected" icon={<Shield className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-1.5">
                {report.anomalies.map((a, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                      ANOMALY_SEVERITY_COLOR[a.severity] ?? 'text-foreground bg-muted border-border',
                    )}
                  >
                    <span className="font-semibold capitalize">{a.severity}</span>
                    <span>{ANOMALY_LABELS[a.anomaly_type] ?? a.anomaly_type}</span>
                    {Object.keys(a.detail ?? {}).length > 0 && (
                      <span className="ml-auto text-[10px] opacity-70">
                        {Object.entries(a.detail)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* f) Final State */}
          <SectionCard title="Final State" icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}>
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={cn(
                  'px-3 py-1 rounded-full text-sm font-semibold',
                  STATE_STYLES[report.attendance_state] ?? 'bg-muted text-foreground',
                )}
              >
                {report.attendance_state}
              </span>
              <p className="text-xs text-muted-foreground">{report.state_reason}</p>
            </div>
          </SectionCard>

          {/* g) Summary */}
          <SectionCard title="Day Summary" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Work',   value: fmtMins(report.work_minutes_total) },
                { label: 'Overtime',     value: fmtMins(report.overtime_minutes) },
                { label: 'Late',         value: fmtMins(report.late_minutes) },
                { label: 'Early Exit',   value: fmtMins(report.early_exit_minutes) },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-sm font-bold">{value}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}

// ── Tab: Payroll Locks ─────────────────────────────────────────────────────────

function TabLocks({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const { data: locks, isLoading } = useQuery<WorkSession[]>({
    queryKey:  ['att-locks', month],
    queryFn:   () =>
      api
        .get<{ data: WorkSession[] }>(`/attendance/sessions/locks?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          {locks && (
            <Badge variant="secondary" className="text-xs">
              <Lock className="h-3 w-3 mr-1" />
              {locks.length} locked session{locks.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </SectionCard>

      {/* Warning banner */}
      <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Payroll-locked sessions cannot be recalculated. Contact payroll admin to unlock.</span>
      </div>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !locks?.length ? (
        <SectionCard>
          <EmptyState icon={Lock} text="No payroll-locked sessions for this month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Date', 'Locked At', 'Source'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locks.map(s => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground text-[11px]">
                      {s.employee_code
                        ? <>{s.employee_name} <span className="font-mono">· {s.employee_code}</span></>
                        : <span className="font-mono">{s.employee_id.slice(0, 8)}…</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{s.attendance_date}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                        <span>{s.payroll_locked_at ? fmtTime(s.payroll_locked_at) : '—'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-base" title={s.source}>{srcIcon(s.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  )
}

// ── Tab: OT Heatmap ────────────────────────────────────────────────────────────

function otHeatColor(minutes: number): string {
  if (minutes === 0)       return 'bg-muted/40 text-muted-foreground/40'
  if (minutes <= 60)       return 'bg-amber-100 text-amber-700'
  if (minutes <= 120)      return 'bg-amber-300 text-amber-800'
  return 'bg-red-300 text-red-800'
}

function buildCalendarDays(month: string): string[] {
  const [y, mo] = month.split('-').map(Number)
  const days: string[] = []
  const daysInMonth = new Date(y, mo, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(`${month}-${String(d).padStart(2, '0')}`)
  }
  return days
}

function TabOtHeatmap({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const { data: rows, isLoading } = useQuery<OtHeatmapRow[]>({
    queryKey:  ['att-ot-heatmap', month],
    queryFn:   () =>
      api
        .get<{ data: OtHeatmapRow[] }>(`/attendance/sessions/ot-heatmap?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  const calDays = useMemo(() => buildCalendarDays(month), [month])

  // Build week columns: pad first week
  const { paddedDays, firstDow } = useMemo(() => {
    if (!calDays.length) return { paddedDays: [], firstDow: 0 }
    const [y, mo, dd] = calDays[0].split('-').map(Number)
    const dow = new Date(y, mo - 1, dd).getDay()
    return { paddedDays: calDays, firstDow: dow }
  }, [calDays])

  const topEarners = useMemo(
    () =>
      [...(rows ?? [])]
        .sort((a, b) => b.total_ot_minutes - a.total_ot_minutes)
        .slice(0, 5),
    [rows],
  )

  return (
    <div className="space-y-4">
      <SectionCard>
        <MonthNav month={month} onChange={onMonthChange} />
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !rows?.length ? (
        <SectionCard>
          <EmptyState icon={BarChart3} text="No overtime data available for this month." />
        </SectionCard>
      ) : (
        <>
          {/* Top OT earners */}
          <SectionCard title="Top OT Earners" icon={<Zap className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {topEarners.map(r => {
                const pct = Math.min(100, Math.round((r.total_ot_minutes / (topEarners[0]?.total_ot_minutes || 1)) * 100))
                return (
                  <div key={r.employee_id} className="flex items-center gap-3 text-xs">
                    <div className="min-w-0 w-36 shrink-0">
                      <p className="font-medium truncate">{r.employee_name}</p>
                      <p className="text-[10px] text-muted-foreground">{r.employee_code}</p>
                    </div>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', r.total_ot_minutes > 480 ? 'bg-destructive' : r.total_ot_minutes > 240 ? 'bg-warning' : 'bg-warning/70')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="tabular-nums font-semibold text-warning shrink-0">
                      {fmtMins(r.total_ot_minutes)}
                    </span>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          {/* Per-employee heatmap grids */}
          {rows.map(row => (
            <SectionCard
              key={row.employee_id}
              title={`${row.employee_name} (${row.employee_code})`}
              description={`Total OT: ${fmtMins(row.total_ot_minutes)}`}
              icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
            >
              {/* Calendar grid */}
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {DAYS.map(d => (
                      <div key={d} className="text-[9px] text-center text-muted-foreground font-semibold py-0.5">
                        {d}
                      </div>
                    ))}
                  </div>
                  {/* Calendar cells — padded */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {Array.from({ length: firstDow }).map((_, i) => (
                      <div key={`pad-${i}`} className="h-8 rounded" />
                    ))}
                    {paddedDays.map(date => {
                      const ot = row.daily_ot[date] ?? 0
                      return (
                        <div
                          key={date}
                          title={`${date}: ${fmtMins(ot)} OT`}
                          className={cn(
                            'h-8 rounded flex items-center justify-center text-[9px] font-semibold transition-colors cursor-default',
                            otHeatColor(ot),
                          )}
                        >
                          {ot > 0 ? fmtMins(ot) : date.slice(8)}
                        </div>
                      )
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                    {[
                      { cls: 'bg-muted/40',  label: 'No OT' },
                      { cls: 'bg-amber-100', label: '1–60m' },
                      { cls: 'bg-amber-300', label: '1–2h' },
                      { cls: 'bg-red-300',   label: '2h+' },
                    ].map(({ cls, label }) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className={cn('h-2.5 w-2.5 rounded-sm', cls)} />
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}
        </>
      )}
    </div>
  )
}

// ── Tab: Compliance Risks ──────────────────────────────────────────────────────

type ComplianceRiskEntry = {
  employee_id: string
  employee_name: string
  risks: SessionAnomaly[]
}

function exportComplianceRisksCSV(entries: ComplianceRiskEntry[]) {
  const headers = ['Employee', 'Anomaly Type', 'Severity', 'Date', 'Detail']
  const lines: string[] = []
  for (const e of entries) {
    for (const r of e.risks) {
      lines.push(
        [
          e.employee_name,
          ANOMALY_LABELS[r.anomaly_type] ?? r.anomaly_type,
          r.severity,
          r.attendance_date,
          Object.entries(r.detail ?? {})
            .slice(0, 3)
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        ].join(','),
      )
    }
  }
  const csv = [headers.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `compliance-risks.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function TabCompliance({
  month,
  onMonthChange,
}: {
  month: string
  onMonthChange: (m: string) => void
}) {
  const { data: entries, isLoading } = useQuery<ComplianceRiskEntry[]>({
    queryKey:  ['att-compliance-risks', month],
    queryFn:   () =>
      api
        .get<{ data: ComplianceRiskEntry[] }>(`/attendance/sessions/compliance-risks?month=${month}`)
        .then(r => r.data),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          {(entries?.length ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => exportComplianceRisksCSV(entries ?? [])}
            >
              <Download className="h-3.5 w-3.5" />Export Risks
            </Button>
          )}
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !entries?.length ? (
        <SectionCard>
          <EmptyState icon={Zap} text="No compliance risks detected for this month." />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => {
            const hasCritical = entry.risks.some(r => r.severity === 'critical')
            return (
              <div
                key={entry.employee_id}
                className={cn(
                  'rounded-lg border p-4 space-y-2',
                  hasCritical ? 'border-red-300 bg-red-50/40' : 'border-border bg-card',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{entry.employee_name}</p>
                  <div className="flex items-center gap-1.5">
                    {hasCritical && (
                      <Badge className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">
                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Critical
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {entry.risks.length} risk{entry.risks.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {entry.risks.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs',
                        ANOMALY_SEVERITY_COLOR[r.severity] ?? 'bg-muted border-border text-foreground',
                      )}
                    >
                      <span className="font-semibold capitalize">{r.severity}</span>
                      <span>{ANOMALY_LABELS[r.anomaly_type] ?? r.anomaly_type}</span>
                      <span className="ml-auto text-[10px] opacity-70 font-mono">{r.attendance_date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tab definitions ────────────────────────────────────────────────────────────

type TabKey =
  | 'sessions'
  | 'missing'
  | 'cross-midnight'
  | 'anomalies'
  | 'replay'
  | 'locks'
  | 'ot-heatmap'
  | 'compliance'

const TAB_LIST: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'sessions',      label: 'Live Sessions',    icon: Activity     },
  { key: 'missing',       label: 'Missing Punches',  icon: AlertTriangle },
  { key: 'cross-midnight',label: 'Cross-Midnight',   icon: Moon         },
  { key: 'anomalies',     label: 'Anomalies',        icon: Shield       },
  { key: 'replay',        label: 'Session Replay',   icon: Eye          },
  { key: 'locks',         label: 'Payroll Locks',    icon: Lock         },
  { key: 'ot-heatmap',    label: 'OT Heatmap',       icon: BarChart3    },
  { key: 'compliance',    label: 'Compliance Risks', icon: Zap          },
]

// ── Main Component ─────────────────────────────────────────────────────────────

export function AttendanceIntelligenceCenter() {
  const qc = useQueryClient()

  // ── State ────────────────────────────────────────────────────────────────────
  const [month,       setMonth]       = useState<string>(todayMonth)
  const [activeTab,   setActiveTab]   = useState<TabKey>('sessions')
  const [employeeId,  setEmployeeId]  = useState<string>('')
  const [empSearch,   setEmpSearch]   = useState<string>('')
  const [replayDate,  setReplayDate]  = useState<string>(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

  // Shared replay emp search (separate from sessions emp search)
  const [replayEmpSearch, setReplayEmpSearch] = useState<string>('')
  const [replayEmpId,     setReplayEmpId]     = useState<string>('')

  // ── Employees query (shared) ─────────────────────────────────────────────────
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey:  ['employees-options'],
    queryFn:   () =>
      api.get<{ data: Employee[] }>('/employees/options').then(r => r.data),
    staleTime: 60_000,
  })

  // ── Callbacks ────────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['att-sessions'] })
    qc.invalidateQueries({ queryKey: ['att-missing-punches'] })
    qc.invalidateQueries({ queryKey: ['att-cross-midnight'] })
    qc.invalidateQueries({ queryKey: ['att-anomalies'] })
    qc.invalidateQueries({ queryKey: ['att-replay'] })
    qc.invalidateQueries({ queryKey: ['att-locks'] })
    qc.invalidateQueries({ queryKey: ['att-ot-heatmap'] })
    qc.invalidateQueries({ queryKey: ['att-compliance-risks'] })
    toast.success('Data refreshed.')
  }, [qc])

  const handleSelectEmployee = useCallback((id: string) => {
    setEmployeeId(id)
  }, [])

  const handleSelectReplayEmployee = useCallback((id: string) => {
    setReplayEmpId(id)
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Intelligence Center"
        subtitle="Phase 16 — Session intelligence, anomaly detection, and compliance monitoring"
        actions={
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        }
      />

      {/* ── Tab bar ── */}
      <SubTabs<TabKey>
        tabs={TAB_LIST.map(t => ({ id: t.key, label: t.label, icon: t.icon }))}
        value={activeTab}
        onChange={setActiveTab}
        className="flex-wrap"
      />

      {/* ── Tab content ── */}

      {activeTab === 'sessions' && (
        <TabSessions
          month={month}
          onMonthChange={setMonth}
          employeeId={employeeId}
          empSearch={empSearch}
          onEmpSearch={setEmpSearch}
          employees={employees}
          onSelectEmployee={handleSelectEmployee}
        />
      )}

      {activeTab === 'missing' && (
        <TabMissingPunches month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'cross-midnight' && (
        <TabCrossMidnight month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'anomalies' && (
        <TabAnomalies month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'replay' && (
        <TabReplay
          employeeId={replayEmpId}
          empSearch={replayEmpSearch}
          onEmpSearch={setReplayEmpSearch}
          employees={employees}
          onSelectEmployee={handleSelectReplayEmployee}
          replayDate={replayDate}
          onReplayDate={setReplayDate}
        />
      )}

      {activeTab === 'locks' && (
        <TabLocks month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'ot-heatmap' && (
        <TabOtHeatmap month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'compliance' && (
        <TabCompliance month={month} onMonthChange={setMonth} />
      )}
    </PageContainer>
  )
}
