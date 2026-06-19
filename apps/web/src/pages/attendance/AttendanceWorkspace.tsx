/**
 * AttendanceWorkspace — /admin/attendance-workspace
 *
 * Consolidated attendance workspace aggregating live snapshot, sessions,
 * missing punches, OT, anomalies, regularisation approvals, and session replay
 * into a single 7-tab page.
 *
 * Access: hr_admin / super_admin
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Clock, Timer, Shield,
  CheckSquare, Eye, Loader2, ChevronLeft, ChevronRight,
  X, Download, CheckCircle2, XCircle, RefreshCw, Users,
  Info, BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { SubTabs }       from '@/components/ui/SubTabs'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttendanceStats {
  present:          number
  absent:           number
  late:             number
  wfh:              number
  on_leave:         number
  total:            number
  anomalies:        number
  missing_punches:  number
  pending_approvals: number
}

interface EmployeeStatus {
  employee_id:   string
  employee_name: string
  employee_code: string
  status:        string
  anomaly_risk:  number
}

interface WorkSession {
  id:                string
  employee_id:       string
  attendance_date:   string
  session_start:     string
  session_end:       string | null
  work_minutes:      number | null
  overtime_minutes:  number
  late_minutes:      number
  source:            string
  is_cross_midnight: boolean
  approval_status:   string
  payroll_locked:    boolean
  compliance_flags:  Record<string, unknown>
}

interface MissingPunchEntry {
  employee_id:   string
  employee_name: string
  employee_code: string
  date:          string
  in_punch:      string | null
  out_punch:     string | null
  source:        string
}

interface OtSummaryRow {
  employee_id:       string
  employee_name:     string
  employee_code:     string
  ot_minutes:        number
  approved_minutes:  number | null
  status:            string
}

interface SessionAnomaly {
  id:              string
  employee_id:     string
  employee_name?:  string | null
  employee_code?:  string | null
  attendance_date: string
  anomaly_type:    string
  severity:        'info' | 'warning' | 'critical'
  session_id:      string | null
  detail:          Record<string, unknown>
  resolved:        boolean
  created_at:      string
}

interface RegularisationRequest {
  id:                  string
  employee_id:         string
  employee_name:       string | null
  employee_code:       string | null
  date:                string
  reason:              string
  status:              string
  requested_check_in:  string | null
  requested_check_out: string | null
  created_at:          string
}

interface DaySessionReport {
  employee_id:     string
  date:            string
  raw_punches:     Array<{ id: string; punch_time: string; punch_type: string; source: string }>
  pairing_decisions: Array<{
    in_punch_id:      string
    out_punch_id:     string | null
    decision:         string
    is_cross_midnight: boolean
  }>
  sessions: Array<{
    in_punch:          { punch_time: string }
    out_punch:         { punch_time: string } | null
    work_minutes:      number | null
    is_complete:       boolean
    is_cross_midnight: boolean
    attendance_date:   string
  }>
  ownership_decision: {
    attendance_date:  string
    payroll_month:    string
    shift_name?:      string
    is_cross_midnight: boolean
    ownership_source: string
  }
  anomalies:        Array<{ anomaly_type: string; severity: string; detail: Record<string, unknown> }>
  attendance_state: string
  state_reason:     string
  work_minutes_total: number
  overtime_minutes: number
  late_minutes:     number
  early_exit_minutes: number
}

interface Employee {
  id:            string
  employee_code: string
  first_name:    string
  last_name:     string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMonth(m: string): string {
  const [_y, _mo] = m.split('-')
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

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
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
  info:     'text-info bg-info/10 border-info/30',
  warning:  'text-warning bg-warning/10 border-warning/30',
  critical: 'text-destructive bg-destructive/10 border-destructive/30',
}

const ANOMALY_LABELS: Record<string, string> = {
  missing_punch:              'Missing Punch',
  excessive_ot:               'Excessive OT',
  insufficient_rest:          'Insufficient Rest',
  double_shift:               'Double Shift',
  suspicious_timing:          'Suspicious Timing',
  excessive_consecutive_days: 'Consecutive Days',
  duplicate_punch:            'Duplicate Punch',
}

const STATE_STYLES: Record<string, string> = {
  PRESENT:           'bg-success/15 text-success',
  LATE:              'bg-warning/15 text-warning',
  ABSENT:            'bg-destructive/15 text-destructive',
  HOLIDAY:           'bg-warning/15 text-warning',
  WEEKLY_OFF:        'bg-muted text-muted-foreground',
  INCOMPLETE_PUNCH:  'bg-accent-coral/15 text-accent-coral',
  AUTO_REGULARIZED:  'bg-accent-teal/15 text-accent-teal',
}

// ── Shared Sub-components ──────────────────────────────────────────────────────

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="outline" className="h-8 w-8"
        onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm font-semibold min-w-[130px] text-center">{fmtMonth(month)}</span>
      <Button size="icon" variant="outline" className="h-8 w-8"
        onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

function CardSpinner() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

function TabEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Icon className="h-10 w-10 opacity-30" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs opacity-70">{description}</p>}
    </div>
  )
}

function EmpSearchDropdown({
  search,
  onSearch,
  employees,
  selectedId,
  onSelect,
  onClear,
}: {
  search: string
  onSearch: (v: string) => void
  employees: Employee[]
  selectedId: string
  onSelect: (id: string, label: string) => void
  onClear: () => void
}) {
  const filtered = useMemo(() => {
    if (!search) return employees
    const q = search.toLowerCase()
    return employees.filter(e =>
      e.first_name.toLowerCase().includes(q) ||
      e.last_name.toLowerCase().includes(q) ||
      e.employee_code.toLowerCase().includes(q),
    )
  }, [employees, search])

  const selected = employees.find(e => e.id === selectedId)

  return (
    <div className="relative flex-1 min-w-[220px] max-w-xs">
      <Input
        placeholder="Search employee…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        className="h-8 text-sm pr-8"
      />
      {search && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {search && filtered.length > 0 && !selected && (
        <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.slice(0, 20).map(e => (
            <button
              key={e.id}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              onClick={() => onSelect(e.id, `${e.first_name} ${e.last_name}`)}
            >
              <span className="font-medium">{e.first_name} {e.last_name}</span>
              <span className="text-muted-foreground ml-1.5">({e.employee_code})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── KPI Strip ──────────────────────────────────────────────────────────────────

function KpiStrip({ stats }: { stats: AttendanceStats | undefined }) {
  const items = [
    { label: 'Present Today',      value: stats?.present         ?? '—', color: 'text-success' },
    { label: 'Anomalies',          value: stats?.anomalies        ?? '—', color: 'text-destructive' },
    { label: 'Missing Punches',    value: stats?.missing_punches  ?? '—', color: 'text-warning' },
    { label: 'Pending Approvals',  value: stats?.pending_approvals ?? '—', color: 'text-info' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      {items.map(item => (
        <div key={item.label} className="rounded-xl border border-border bg-card p-3 text-center">
          <p className={cn('text-2xl font-bold', item.color)}>{item.value}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
        </div>
      ))}
    </div>
  )
}

// ── Tab: Live ──────────────────────────────────────────────────────────────────

function TabLive({ stats, statsLoading }: { stats: AttendanceStats | undefined; statsLoading: boolean }) {
  const { data: liveList, isLoading: listLoading } = useQuery<EmployeeStatus[]>({
    queryKey:  ['att-workspace-live-list'],
    queryFn:   () => api.get<{ data: EmployeeStatus[] }>('/attendance/live-status?limit=10').then(r => r.data),
    staleTime: 60_000,
  })

  const kpiItems = [
    { label: 'Present',   value: stats?.present  ?? 0, bg: 'bg-success/10',   text: 'text-success'  },
    { label: 'Absent',    value: stats?.absent   ?? 0, bg: 'bg-destructive/10',     text: 'text-destructive'    },
    { label: 'Late',      value: stats?.late     ?? 0, bg: 'bg-warning/10',  text: 'text-warning' },
    { label: 'WFH',       value: stats?.wfh      ?? 0, bg: 'bg-info/10',    text: 'text-info'   },
    { label: 'On Leave',  value: stats?.on_leave ?? 0, bg: 'bg-accent-violet/10',  text: 'text-accent-violet' },
    { label: 'Total',     value: stats?.total    ?? 0, bg: 'bg-muted/50',   text: 'text-foreground'  },
  ]

  return (
    <div className="space-y-4">
      {statsLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {kpiItems.map(k => (
            <div key={k.label} className={cn('rounded-xl border border-border p-3 text-center', k.bg)}>
              <p className={cn('text-2xl font-bold', k.text)}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{k.label}</p>
            </div>
          ))}
        </div>
      )}

      <SectionCard title="Top Anomaly-Risk Employees" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
        {listLoading ? (
          <CardSpinner />
        ) : !liveList?.length ? (
          <TabEmpty icon={Users} title="No live data available" />
        ) : (
          <div className="space-y-1">
            {liveList.map(emp => (
              <div key={emp.employee_id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/40 last:border-0 text-xs">
                <div className="min-w-0">
                  <span className="font-medium">{emp.employee_name}</span>
                  <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">({emp.employee_code})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] capitalize',
                      emp.status === 'PRESENT' ? 'text-success border-success/30 bg-success/10' :
                      emp.status === 'ABSENT'  ? 'text-destructive border-destructive/30 bg-destructive/10' :
                      emp.status === 'LATE'    ? 'text-warning border-warning/30 bg-warning/10' : '',
                    )}
                  >
                    {emp.status}
                  </Badge>
                  {emp.anomaly_risk > 0 && (
                    <span className="flex items-center gap-0.5 text-destructive font-semibold">
                      <AlertTriangle className="h-3 w-3" />
                      {emp.anomaly_risk}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Tab: Sessions ──────────────────────────────────────────────────────────────

function TabSessions({
  month, onMonthChange, employees,
}: {
  month: string; onMonthChange: (m: string) => void; employees: Employee[]
}) {
  const [empSearch, setEmpSearch] = useState('')
  const [empId, setEmpId]         = useState('')

  const { data: sessions, isLoading } = useQuery<WorkSession[]>({
    queryKey:  ['att-workspace-sessions', empId, month],
    queryFn:   () =>
      api.get<{ data: WorkSession[] }>(`/attendance/sessions?employeeId=${empId}&month=${month}`).then(r => r.data),
    enabled:   !!empId,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          <EmpSearchDropdown
            search={empSearch}
            onSearch={setEmpSearch}
            employees={employees}
            selectedId={empId}
            onSelect={(id, label) => { setEmpId(id); setEmpSearch(label) }}
            onClear={() => { setEmpSearch(''); setEmpId('') }}
          />
        </div>
      </SectionCard>

      {!empId ? (
        <SectionCard>
          <TabEmpty icon={Users} title="Select an employee to view sessions" />
        </SectionCard>
      ) : isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !sessions?.length ? (
        <SectionCard>
          <TabEmpty icon={Clock} title="No sessions found" description="No sessions for this employee and month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Date', 'In → Out', 'Duration', 'OT', 'Source', 'Status', 'Flags'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const flags = Object.keys(s.compliance_flags ?? {})
                  return (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{s.attendance_date}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium">{fmtTime(s.session_start)}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className={cn(s.session_end ? 'font-medium' : 'text-muted-foreground/50')}>
                          {fmtTime(s.session_end)}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtMins(s.work_minutes)}</td>
                      <td className="px-3 py-2 tabular-nums text-warning">
                        {s.overtime_minutes > 0 ? `+${fmtMins(s.overtime_minutes)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{s.source}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px] capitalize">{s.approval_status}</Badge>
                        {s.payroll_locked && (
                          <Badge className="ml-1 text-[10px] bg-muted text-muted-foreground border-border">Locked</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {flags.slice(0, 2).map(f => (
                            <Badge key={f} variant="outline" className="text-[9px] px-1">{f}</Badge>
                          ))}
                          {flags.length > 2 && (
                            <Badge variant="outline" className="text-[9px] px-1">+{flags.length - 2}</Badge>
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

function TabMissingPunches({ month, onMonthChange }: { month: string; onMonthChange: (m: string) => void }) {
  const { data: entries, isLoading } = useQuery<MissingPunchEntry[]>({
    queryKey:  ['att-workspace-missing', month],
    queryFn:   () =>
      api.get<{ data: MissingPunchEntry[] }>(`/attendance/sessions/missing-punches?month=${month}`).then(r => r.data),
    staleTime: 60_000,
  })

  function downloadCSV() {
    const rows = entries ?? []
    const header = ['Employee', 'Code', 'Date', 'IN Punch', 'OUT Punch', 'Source']
    const lines = rows.map(r =>
      [r.employee_name, r.employee_code, r.date, r.in_punch ?? '—', r.out_punch ?? '—', r.source].join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'missing-punches.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const missingIn  = useMemo(() => (entries ?? []).filter(e => !e.in_punch).length,  [entries])
  const missingOut = useMemo(() => (entries ?? []).filter(e => !e.out_punch).length, [entries])

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-destructive flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" />{missingIn} missing IN
            </span>
            <span className="text-xs font-semibold text-warning flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" />{missingOut} missing OUT
            </span>
            {(entries?.length ?? 0) > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={downloadCSV}>
                <Download className="h-3.5 w-3.5" />CSV
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !entries?.length ? (
        <SectionCard>
          <TabEmpty icon={CheckCircle2} title="No missing punches" description="All punches are complete for this month." />
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
                  <tr key={i}
                    className={cn(
                      'border-b border-border/50',
                      !e.in_punch ? 'bg-destructive/60' : !e.out_punch ? 'bg-warning/60' : '',
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{e.employee_name}</td>
                    <td className="px-3 py-2 text-muted-foreground font-mono">{e.employee_code}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{e.date}</td>
                    <td className="px-3 py-2">
                      {e.in_punch
                        ? <span className="text-success font-medium">{fmtTime(e.in_punch)}</span>
                        : <span className="text-destructive font-semibold flex items-center gap-1"><XCircle className="h-3 w-3" />Missing</span>}
                    </td>
                    <td className="px-3 py-2">
                      {e.out_punch
                        ? <span className="text-success font-medium">{fmtTime(e.out_punch)}</span>
                        : <span className="text-warning font-semibold flex items-center gap-1"><XCircle className="h-3 w-3" />Missing</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{e.source}</td>
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

// ── Tab: OT ────────────────────────────────────────────────────────────────────

function TabOT({ month, onMonthChange }: { month: string; onMonthChange: (m: string) => void }) {
  const { data: rows, isLoading } = useQuery<OtSummaryRow[]>({
    queryKey:  ['att-workspace-ot', month],
    queryFn:   () =>
      api.get<{ data: OtSummaryRow[] }>(`/overtime/summary?month=${month}`).then(r => r.data),
    staleTime: 60_000,
  })

  const totalOt = useMemo(
    () => (rows ?? []).reduce((acc, r) => acc + r.ot_minutes, 0),
    [rows],
  )

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthNav month={month} onChange={onMonthChange} />
          {(rows?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-warning" />
              <span className="text-sm font-semibold text-warning">
                Total OT: {fmtMins(totalOt)}
              </span>
              <Badge variant="secondary" className="text-xs">{rows?.length} employees</Badge>
            </div>
          )}
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !rows?.length ? (
        <SectionCard>
          <TabEmpty icon={Timer} title="No overtime records" description="No OT data for this month." />
        </SectionCard>
      ) : (
        <SectionCard noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Code', 'OT Minutes', 'Approved', 'Status'].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{r.employee_code}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-warning">{fmtMins(r.ot_minutes)}</td>
                    <td className="px-3 py-2 tabular-nums text-success">
                      {r.approved_minutes != null ? fmtMins(r.approved_minutes) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] capitalize',
                          r.status === 'APPROVED'  ? 'text-success border-success/30 bg-success/10' :
                          r.status === 'PENDING'   ? 'text-warning border-warning/30 bg-warning/10' :
                          r.status === 'REJECTED'  ? 'text-destructive border-destructive/30 bg-destructive/10' : '',
                        )}
                      >
                        {r.status}
                      </Badge>
                    </td>
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

function TabAnomalies() {
  const qc = useQueryClient()
  const [severity, setSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all')

  const { data: anomalies, isLoading } = useQuery<SessionAnomaly[]>({
    queryKey:  ['att-workspace-anomalies'],
    queryFn:   () =>
      api.get<{ data: SessionAnomaly[] }>('/attendance/anomalies').then(r => r.data),
    staleTime: 60_000,
  })

  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/work-session-anomalies/${id}/resolve`, {}),
    onSuccess: () => { toast.success('Anomaly resolved.'); qc.invalidateQueries({ queryKey: ['att-workspace-anomalies'] }) },
    onError: () => toast.error('Failed to resolve anomaly.'),
  })

  const filtered = useMemo(() => {
    const list = anomalies ?? []
    return severity === 'all' ? list : list.filter(a => a.severity === severity)
  }, [anomalies, severity])

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
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'all',      label: 'All',      count: (anomalies ?? []).length },
            { key: 'critical', label: 'Critical', count: counts.critical },
            { key: 'warning',  label: 'Warning',  count: counts.warning },
            { key: 'info',     label: 'Info',     count: counts.info },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setSeverity(f.key)}
              className={cn(
                'px-2.5 py-1 text-xs rounded-full border transition-colors',
                severity === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}{f.count > 0 && ` ${f.count}`}
            </button>
          ))}
        </div>
      </SectionCard>

      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !filtered.length ? (
        <SectionCard>
          <TabEmpty icon={Shield} title="No anomalies" description="No anomalies match the selected filter." />
        </SectionCard>
      ) : (
        <div className="space-y-2">
          {filtered.map(a => (
            <div
              key={a.id}
              className={cn(
                'rounded-lg border p-3 text-xs',
                ANOMALY_SEVERITY_COLOR[a.severity] ?? 'bg-muted border-border text-foreground',
                a.resolved && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('font-semibold', a.resolved && 'line-through')}>
                      {ANOMALY_LABELS[a.anomaly_type] ?? a.anomaly_type}
                    </span>
                    <Badge variant="outline" className={cn('text-[10px] capitalize border', ANOMALY_SEVERITY_COLOR[a.severity])}>
                      {a.severity}
                    </Badge>
                    {a.resolved && (
                      <Badge variant="outline" className="text-[10px] text-success border-success/30">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Resolved
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] opacity-80">
                    <span>Emp: {a.employee_code
                      ? <span className="font-medium">{a.employee_name} <span className="font-mono text-muted-foreground">· {a.employee_code}</span></span>
                      : <span className="font-mono">{a.employee_id.slice(0, 8)}…</span>}</span>
                    <span>Date: {a.attendance_date}</span>
                  </div>
                  {Object.keys(a.detail ?? {}).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.entries(a.detail).slice(0, 4).map(([k, v]) => (
                        <span key={k} className="text-[10px] opacity-70">
                          {k}: <span className="font-semibold">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {!a.resolved && (
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate(a.id)}>
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

// ── Tab: Approvals ─────────────────────────────────────────────────────────────

function TabApprovals() {
  const qc = useQueryClient()

  const { data: requests, isLoading } = useQuery<RegularisationRequest[]>({
    queryKey:  ['att-workspace-approvals'],
    queryFn:   () =>
      api.get<{ data: RegularisationRequest[] }>('/attendance/regularisation?status=pending').then(r => r.data),
    staleTime: 30_000,
  })

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: () => { toast.success('Request approved.'); qc.invalidateQueries({ queryKey: ['att-workspace-approvals'] }) },
    onError: () => toast.error('Failed to approve.'),
  })

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess: () => { toast.success('Request rejected.'); qc.invalidateQueries({ queryKey: ['att-workspace-approvals'] }) },
    onError: () => toast.error('Failed to reject.'),
  })

  return (
    <div className="space-y-4">
      {isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !requests?.length ? (
        <SectionCard>
          <TabEmpty
            icon={CheckSquare}
            title="No pending approvals"
            description="All regularisation requests have been processed."
          />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {requests.map(req => (
            <div key={req.id} className="rounded-lg border border-border bg-card p-4 text-xs space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{req.employee_name ?? 'Employee'}</span>
                    {req.employee_code && (
                      <span className="font-mono text-muted-foreground text-[10px]">{req.employee_code}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>Date: <span className="font-medium text-foreground">{req.date}</span></span>
                    {req.requested_check_in && (
                      <span>IN: <span className="font-medium text-foreground">{fmtTime(req.requested_check_in)}</span></span>
                    )}
                    {req.requested_check_out && (
                      <span>OUT: <span className="font-medium text-foreground">{fmtTime(req.requested_check_out)}</span></span>
                    )}
                  </div>
                  <p className="text-muted-foreground italic">"{req.reason}"</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 bg-success hover:bg-success/90"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => approve.mutate(req.id)}
                  >
                    <CheckCircle2 className="h-3 w-3" />Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={approve.isPending || reject.isPending}
                    onClick={() => reject.mutate(req.id)}
                  >
                    <XCircle className="h-3 w-3" />Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab: Replay ────────────────────────────────────────────────────────────────

function TabReplay({ employees }: { employees: Employee[] }) {
  const [empSearch,  setEmpSearch]  = useState('')
  const [empId,      setEmpId]      = useState('')
  const [replayDate, setReplayDate] = useState(todayIso)

  const { data: report, isLoading } = useQuery<DaySessionReport>({
    queryKey:  ['att-workspace-replay', empId, replayDate],
    queryFn:   () =>
      api.get<{ data: DaySessionReport }>(
        `/attendance/sessions/explain?employeeId=${empId}&date=${replayDate}`,
      ).then(r => r.data),
    enabled:   !!empId && !!replayDate,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center gap-3">
          <EmpSearchDropdown
            search={empSearch}
            onSearch={setEmpSearch}
            employees={employees}
            selectedId={empId}
            onSelect={(id, label) => { setEmpId(id); setEmpSearch(label) }}
            onClear={() => { setEmpSearch(''); setEmpId('') }}
          />
          <DateInput
            value={replayDate}
            onChange={setReplayDate}
            className="h-8 text-sm w-auto"
          />
        </div>
      </SectionCard>

      {!empId ? (
        <SectionCard>
          <TabEmpty icon={Eye} title="Select an employee and date to replay the session" />
        </SectionCard>
      ) : isLoading ? (
        <SectionCard><CardSpinner /></SectionCard>
      ) : !report ? (
        <SectionCard>
          <TabEmpty icon={Eye} title="No session data found" description="No data for this employee and date." />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {/* Raw Punches */}
          <SectionCard title="Raw Punches" icon={<Clock className="h-4 w-4 text-muted-foreground" />}>
            {report.raw_punches.length === 0 ? (
              <p className="text-xs text-muted-foreground">No punches recorded.</p>
            ) : (
              <div className="space-y-1">
                {report.raw_punches.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-1 border-b border-border/40 last:border-0">
                    <span className="font-semibold">{fmtTime(p.punch_time)}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        p.punch_type === 'IN' ? 'text-success border-success/30 bg-success/10' : 'text-destructive border-destructive/30 bg-destructive/10',
                      )}
                    >
                      {p.punch_type}
                    </Badge>
                    <span className="text-muted-foreground">{p.source}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Sessions Built */}
          <SectionCard title="Sessions Built" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-1.5">
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
                      s.is_complete ? 'text-success border-success/30 bg-success/10' : 'text-warning border-warning/30 bg-warning/10',
                    )}
                  >
                    {s.is_complete ? 'complete' : 'incomplete'}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Ownership */}
          <SectionCard title="Ownership Decision" icon={<Info className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {[
                { label: 'Attendance Date',  value: report.ownership_decision.attendance_date },
                { label: 'Payroll Month',    value: report.ownership_decision.payroll_month },
                { label: 'Shift',            value: report.ownership_decision.shift_name ?? '—' },
                { label: 'Cross-Midnight',   value: report.ownership_decision.is_cross_midnight ? 'Yes' : 'No' },
                { label: 'Ownership Source', value: report.ownership_decision.ownership_source },
              ].map(({ label, value }) => (
                <div key={label} className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Final State */}
          <SectionCard title="Final State" icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}>
            <div className="flex flex-wrap items-center gap-4">
              <span className={cn('px-3 py-1 rounded-full text-sm font-semibold', STATE_STYLES[report.attendance_state] ?? 'bg-muted text-foreground')}>
                {report.attendance_state}
              </span>
              <p className="text-xs text-muted-foreground">{report.state_reason}</p>
            </div>
          </SectionCard>

          {/* Day Summary */}
          <SectionCard title="Day Summary" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Work',  value: fmtMins(report.work_minutes_total) },
                { label: 'Overtime',    value: fmtMins(report.overtime_minutes) },
                { label: 'Late',        value: fmtMins(report.late_minutes) },
                { label: 'Early Exit',  value: fmtMins(report.early_exit_minutes) },
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

// ── Tab Definitions ────────────────────────────────────────────────────────────

type TabKey = 'live' | 'sessions' | 'missing' | 'ot' | 'anomalies' | 'approvals' | 'replay'

const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'live',      label: 'Live',             icon: Activity      },
  { key: 'sessions',  label: 'Sessions',         icon: Clock         },
  { key: 'missing',   label: 'Missing Punches',  icon: AlertTriangle },
  { key: 'ot',        label: 'OT',               icon: Timer         },
  { key: 'anomalies', label: 'Anomalies',        icon: Shield        },
  { key: 'approvals', label: 'Approvals',        icon: CheckSquare   },
  { key: 'replay',    label: 'Replay',           icon: Eye           },
]

// ── Main Export ────────────────────────────────────────────────────────────────

export function AttendanceWorkspace() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('live')
  const [month,     setMonth]     = useState<string>(todayMonth)

  const { data: stats, isLoading: statsLoading } = useQuery<AttendanceStats>({
    queryKey:  ['att-workspace-stats'],
    queryFn:   () =>
      api.get<{
        active_period_summary?: {
          present?: number
          absent?: number
          late?: number
          wfh?: number
          on_leave?: number
          total?: number
        }
        unresolved_anomalies?: number
        overnight_issues?: number
        pending_corrections?: number
      }>('/attendance/stats').then((r) => ({
        // Present/absent/late counts live inside active_period_summary
        present:           r?.active_period_summary?.present          ?? 0,
        absent:            r?.active_period_summary?.absent           ?? 0,
        late:              r?.active_period_summary?.late             ?? 0,
        wfh:               r?.active_period_summary?.wfh              ?? 0,
        on_leave:          r?.active_period_summary?.on_leave         ?? 0,
        total:             r?.active_period_summary?.total            ?? 0,
        // Operational counts are top-level fields
        anomalies:         r?.unresolved_anomalies                    ?? 0,
        missing_punches:   r?.overnight_issues                        ?? 0,
        pending_approvals: r?.pending_corrections                     ?? 0,
      } as AttendanceStats)),
    staleTime: 60_000,
  })

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey:  ['employees-options'],
    queryFn:   () => api.get<{ data: Employee[] }>('/employees/options').then(r => r.data),
    staleTime: 5 * 60_000,
  })

  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ['att-workspace'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-stats'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-live-list'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-sessions'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-missing'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-ot'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-anomalies'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-approvals'] })
    qc.invalidateQueries({ queryKey: ['att-workspace-replay'] })
    toast.success('Data refreshed.')
  }

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Workspace"
        subtitle="Consolidated attendance management — live snapshot, sessions, OT, anomalies, and approvals"
        actions={
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        }
      />

      {/* KPI strip — always shown */}
      <KpiStrip stats={stats} />

      {/* Tab bar */}
      <SubTabs<TabKey>
        tabs={TABS.map(t => ({ id: t.key, label: t.label, icon: t.icon }))}
        value={activeTab}
        onChange={setActiveTab}
        className="mb-4 flex-wrap"
      />

      {/* Tab content */}
      {activeTab === 'live' && (
        <TabLive stats={stats} statsLoading={statsLoading} />
      )}

      {activeTab === 'sessions' && (
        <TabSessions month={month} onMonthChange={setMonth} employees={employees} />
      )}

      {activeTab === 'missing' && (
        <TabMissingPunches month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'ot' && (
        <TabOT month={month} onMonthChange={setMonth} />
      )}

      {activeTab === 'anomalies' && (
        <TabAnomalies />
      )}

      {activeTab === 'approvals' && (
        <TabApprovals />
      )}

      {activeTab === 'replay' && (
        <TabReplay employees={employees} />
      )}
    </PageContainer>
  )
}
