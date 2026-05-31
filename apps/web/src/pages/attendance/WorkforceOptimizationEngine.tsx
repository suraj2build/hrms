/**
 * WorkforceOptimizationEngine — /admin/workforce-optimization
 *
 * Workforce Optimization Engine dashboard for HR admins.
 * Surfaces fairness balance, consecutive shift violations, OT distribution,
 * rest gaps, shift overload, staffing hints, and optimization hints.
 *
 * Access: hr_admin / super_admin only.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Loader2, ShieldAlert,
  CheckCircle2, Users, Clock, BarChart2, Zap,
  CalendarRange, Lightbulb, Activity,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast }         from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Helpers ────────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function severityVariant(sev: string): 'destructive' | 'warning' | 'secondary' | 'success' {
  if (sev === 'critical' || sev === 'high') return 'destructive'
  if (sev === 'medium')                     return 'warning'
  if (sev === 'low')                        return 'secondary'
  return 'secondary'
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-destructive'
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface DateRange { from: string; to: string }

interface FairnessEmployee {
  employee_id:       string
  name:              string
  employee_code:     string
  ot_fairness:       number
  weekend_fairness:  number
  night_fairness:    number
  balance_score:     number
}

interface FairnessHint {
  id:             string
  severity:       string
  title:          string
  explanation:    string
  affected_dates: string[]
}

interface FairnessResponse {
  avg_ot_fairness:      number
  avg_weekend_fairness: number
  avg_night_fairness:   number
  violations_count:     number
  employees:            FairnessEmployee[]
  hints:                FairnessHint[]
}

interface ConsecutiveEmployee {
  employee_id:       string
  name:              string
  employee_code:     string
  max_consecutive:   number
  violation_dates:   string[]
  severity:          string
}

interface ConsecutiveResponse {
  violations: ConsecutiveEmployee[]
}

interface OtEmployee {
  employee_id:     string
  name:            string
  employee_code:   string
  ot_hours:        number
  vs_team_avg:     number
  fairness_score:  number
}

interface OtDistributionResponse {
  team_avg_ot_hours:    number
  max_ot_hours:         number
  concentration_index:  number
  employees:            OtEmployee[]
}

interface RestGapEntry {
  employee_id:    string
  name:           string
  employee_code:  string
  gap_hours:      number
  date1:          string
  date2:          string
  shift1:         string
  shift2:         string
}

interface RestGapResponse {
  gaps: RestGapEntry[]
}

interface OverloadEmployee {
  employee_id:    string
  name:           string
  employee_code:  string
  overload_days:  number
  excess_hours:   number
  affected_dates: string[]
}

interface OverloadResponse {
  employees: OverloadEmployee[]
}

interface StaffingHintRow {
  department:        string
  coverage_ratio:    number
  staffing_pressure: string
  understaffed:      boolean
  overstaffed:       boolean
}

interface StaffingHintsResponse {
  departments: StaffingHintRow[]
}

interface OptHint {
  id:              string
  hint_type:       string
  severity:        string
  title:           string
  explanation:     string
  metric_value:    number
  threshold_value: number
  payroll_impact:  number | null
  resolved:        boolean
}

interface HintsResponse {
  hints: OptHint[]
}

interface ComputeResult {
  employees_computed: number
  hints_generated:    number
}

// ── Small shared UI pieces ─────────────────────────────────────────────────────

function DateRangeInputs({
  value, onChange,
}: {
  value: DateRange
  onChange: (v: DateRange) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">From</span>
        <DateInput
          value={value.from}
          onChange={v => onChange({ ...value, from: v })}
          className="h-8 text-xs w-36"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">To</span>
        <DateInput
          value={value.to}
          onChange={v => onChange({ ...value, to: v })}
          className="h-8 text-xs w-36"
        />
      </div>
    </div>
  )
}

function SummaryCard({
  label, value, sub, colorCls,
}: {
  label: string; value: string | number; sub?: string; colorCls?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', colorCls ?? 'text-foreground')}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
      <CheckCircle2 className="h-7 w-7 opacity-30" />
      <p className="text-xs">{text}</p>
    </div>
  )
}

function TableHead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border">
        {cols.map(c => (
          <th key={c} className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

// ── Tab 1: Fairness Balance ────────────────────────────────────────────────────

function FairnessTab() {
  const [range, setRange] = useState<DateRange>({ from: monthStart(), to: today() })

  const { data, isLoading } = useQuery<FairnessResponse>({
    queryKey: ['woe-fairness', range],
    queryFn:  () => api.get(`/attendance/workforce-optimization/fairness-balance?from=${range.from}&to=${range.to}`),
    enabled:  !!range.from && !!range.to,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <DateRangeInputs value={range} onChange={setRange} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Avg OT Fairness"      value={`${(data.avg_ot_fairness ?? 0).toFixed(1)}%`}     colorCls={scoreColor(data.avg_ot_fairness ?? 0)} />
            <SummaryCard label="Avg Weekend Fairness" value={`${(data.avg_weekend_fairness ?? 0).toFixed(1)}%`} colorCls={scoreColor(data.avg_weekend_fairness ?? 0)} />
            <SummaryCard label="Avg Night Fairness"   value={`${(data.avg_night_fairness ?? 0).toFixed(1)}%`}   colorCls={scoreColor(data.avg_night_fairness ?? 0)} />
            <SummaryCard label="Violations"           value={data.violations_count}                       colorCls={data.violations_count > 0 ? 'text-destructive' : 'text-success'} />
          </div>

          {/* Employee table */}
          {data.employees.length === 0 ? (
            <EmptyState text="No fairness data for this period." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border mb-4">
              <table className="w-full text-xs">
                <TableHead cols={['Employee', 'OT Fairness', 'Weekend Fairness', 'Night Fairness', 'Balance Score', '']} />
                <tbody>
                  {data.employees.map(emp => (
                    <tr key={emp.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{emp.name}</span>
                        <span className="text-muted-foreground ml-1.5">#{emp.employee_code}</span>
                      </td>
                      <td className={cn('px-3 py-2 tabular-nums', scoreColor(emp.ot_fairness ?? 0))}>
                        {(emp.ot_fairness ?? 0).toFixed(1)}%
                      </td>
                      <td className={cn('px-3 py-2 tabular-nums', scoreColor(emp.weekend_fairness ?? 0))}>
                        {(emp.weekend_fairness ?? 0).toFixed(1)}%
                      </td>
                      <td className={cn('px-3 py-2 tabular-nums', scoreColor(emp.night_fairness ?? 0))}>
                        {(emp.night_fairness ?? 0).toFixed(1)}%
                      </td>
                      <td className={cn('px-3 py-2 tabular-nums font-semibold', scoreColor(emp.balance_score ?? 0))}>
                        {(emp.balance_score ?? 0).toFixed(1)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', emp.balance_score >= 80 ? 'bg-success' : emp.balance_score >= 60 ? 'bg-warning' : 'bg-destructive')}
                            style={{ width: `${Math.min(emp.balance_score, 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Hints */}
          {data.hints.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hints</p>
              {data.hints.map(hint => (
                <div key={hint.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={severityVariant(hint.severity) as any} className="rounded-full text-[10px]">
                      {hint.severity}
                    </Badge>
                    <span className="text-xs font-medium text-foreground">{hint.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{hint.explanation}</p>
                  {hint.affected_dates.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Affected: {hint.affected_dates.map(fmtDate).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState text="Select a date range to load fairness data." />
      )}
    </div>
  )
}

// ── Tab 2: Consecutive Shifts ──────────────────────────────────────────────────

function ConsecutiveTab() {
  const [range, setRange] = useState<DateRange>({ from: monthStart(), to: today() })

  const { data, isLoading } = useQuery<ConsecutiveResponse>({
    queryKey: ['woe-consecutive', range],
    queryFn:  () => api.get(`/attendance/workforce-optimization/consecutive-shifts?from=${range.from}&to=${range.to}`),
    enabled:  !!range.from && !!range.to,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <DateRangeInputs value={range} onChange={setRange} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (data?.violations ?? []).length === 0 ? (
        <EmptyState text="No consecutive shift violations in this period." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <TableHead cols={['Employee', 'Max Consecutive Days', 'Violation Dates', 'Severity']} />
            <tbody>
              {(data?.violations ?? []).map(v => (
                <tr key={v.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{v.name}</span>
                    <span className="text-muted-foreground ml-1.5">#{v.employee_code}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-destructive font-semibold">{v.max_consecutive}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {v.violation_dates.map(fmtDate).join(', ')}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={severityVariant(v.severity) as any} className="rounded-full text-[10px]">
                      {v.severity}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 3: OT Distribution ────────────────────────────────────────────────────

function OtDistributionTab() {
  const [range, setRange] = useState<DateRange>({ from: monthStart(), to: today() })

  const { data, isLoading } = useQuery<OtDistributionResponse>({
    queryKey: ['woe-ot-distribution', range],
    queryFn:  () => api.get(`/attendance/workforce-optimization/ot-distribution?from=${range.from}&to=${range.to}`),
    enabled:  !!range.from && !!range.to,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <DateRangeInputs value={range} onChange={setRange} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <SummaryCard label="Team Avg OT Hours"    value={`${(data.team_avg_ot_hours ?? 0).toFixed(1)}h`} />
            <SummaryCard label="Max OT Hours"         value={`${(data.max_ot_hours ?? 0).toFixed(1)}h`}     colorCls="text-warning" />
            <SummaryCard label="Concentration Index"  value={(data.concentration_index ?? 0).toFixed(2)}      colorCls={(data.concentration_index ?? 0) > 0.5 ? 'text-destructive' : 'text-success'} />
          </div>

          {data.employees.length === 0 ? (
            <EmptyState text="No OT distribution data for this period." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <TableHead cols={['Employee', 'OT Hours', 'vs Team Avg', 'Fairness Score']} />
                <tbody>
                  {data.employees.map(emp => (
                    <tr key={emp.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{emp.name}</span>
                        <span className="text-muted-foreground ml-1.5">#{emp.employee_code}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{(emp.ot_hours ?? 0).toFixed(1)}h</td>
                      <td className={cn('px-3 py-2 tabular-nums', (emp.vs_team_avg ?? 0) > 0 ? 'text-warning' : 'text-success')}>
                        {(emp.vs_team_avg ?? 0) > 0 ? '+' : ''}{(emp.vs_team_avg ?? 0).toFixed(1)}h
                      </td>
                      <td className={cn('px-3 py-2 tabular-nums font-medium', scoreColor(emp.fairness_score ?? 0))}>
                        {(emp.fairness_score ?? 0).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <EmptyState text="Select a date range to load OT distribution." />
      )}
    </div>
  )
}

// ── Tab 4: Rest Gaps ──────────────────────────────────────────────────────────

function RestGapsTab() {
  const [range, setRange] = useState<DateRange>({ from: monthStart(), to: today() })

  const { data, isLoading } = useQuery<RestGapResponse>({
    queryKey: ['woe-rest-gaps', range],
    queryFn:  () => api.get(`/attendance/workforce-optimization/rest-gaps?from=${range.from}&to=${range.to}`),
    enabled:  !!range.from && !!range.to,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <DateRangeInputs value={range} onChange={setRange} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (data?.gaps ?? []).length === 0 ? (
        <EmptyState text="No rest gap violations in this period." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <TableHead cols={['Employee', 'Gap Hours', 'Date 1', 'Date 2', 'Shift 1', 'Shift 2']} />
            <tbody>
              {(data?.gaps ?? []).map((g, i) => (
                <tr
                  key={i}
                  className={cn(
                    'border-b border-border/50 hover:bg-muted/20',
                    g.gap_hours < 8 && 'bg-destructive/5',
                  )}
                >
                  <td className="px-3 py-2">
                    <span className={cn('font-medium', g.gap_hours < 8 ? 'text-destructive' : 'text-foreground')}>
                      {g.name}
                    </span>
                    <span className="text-muted-foreground ml-1.5">#{g.employee_code}</span>
                  </td>
                  <td className={cn('px-3 py-2 tabular-nums font-semibold', (g.gap_hours ?? 0) < 8 ? 'text-destructive' : 'text-foreground')}>
                    {(g.gap_hours ?? 0).toFixed(1)}h
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(g.date1)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDate(g.date2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{g.shift1}</td>
                  <td className="px-3 py-2 text-muted-foreground">{g.shift2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 5: Shift Overload ─────────────────────────────────────────────────────

function ShiftOverloadTab() {
  const [range, setRange] = useState<DateRange>({ from: monthStart(), to: today() })

  const { data, isLoading } = useQuery<OverloadResponse>({
    queryKey: ['woe-shift-overload', range],
    queryFn:  () => api.get(`/attendance/workforce-optimization/shift-overload?from=${range.from}&to=${range.to}`),
    enabled:  !!range.from && !!range.to,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <DateRangeInputs value={range} onChange={setRange} />

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (data?.employees ?? []).length === 0 ? (
        <EmptyState text="No shift overload detected in this period." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <TableHead cols={['Employee', 'Overload Days', 'Excess Hours', 'Affected Dates']} />
            <tbody>
              {(data?.employees ?? []).map(emp => (
                <tr key={emp.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <span className="font-medium text-foreground">{emp.name}</span>
                    <span className="text-muted-foreground ml-1.5">#{emp.employee_code}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-destructive font-semibold">{emp.overload_days}</td>
                  <td className="px-3 py-2 tabular-nums text-warning">{(emp.excess_hours ?? 0).toFixed(1)}h</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate">
                    {emp.affected_dates.map(fmtDate).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 6: Staffing Hints ─────────────────────────────────────────────────────

function pressureVariant(p: string): 'destructive' | 'warning' | 'secondary' | 'success' {
  if (p === 'critical')  return 'destructive'
  if (p === 'high')      return 'warning'
  if (p === 'moderate')  return 'secondary'
  return 'success'
}

function StaffingHintsTab() {
  const [date, setDate] = useState<string>(today())

  const { data, isLoading } = useQuery<StaffingHintsResponse>({
    queryKey: ['woe-staffing-hints', date],
    queryFn:  () => api.get(`/attendance/workforce-optimization/staffing-hints?date=${date}`),
    enabled:  !!date,
    staleTime: 2 * 60_000,
  })

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">Date</span>
        <DateInput
          value={date}
          onChange={setDate}
          className="h-8 text-xs w-36"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (data?.departments ?? []).length === 0 ? (
        <EmptyState text="No staffing data for this date." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <TableHead cols={['Department', 'Coverage Ratio', 'Staffing Pressure', 'Understaffed?', 'Overstaffed?']} />
            <tbody>
              {(data?.departments ?? []).map((row, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-foreground">{row.department}</td>
                  <td className="px-3 py-2 tabular-nums">{((row.coverage_ratio ?? 0) * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <Badge variant={pressureVariant(row.staffing_pressure) as any} className="rounded-full text-[10px]">
                      {row.staffing_pressure}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {row.understaffed
                      ? <span className="text-destructive font-medium">Yes</span>
                      : <span className="text-muted-foreground">No</span>}
                  </td>
                  <td className="px-3 py-2">
                    {row.overstaffed
                      ? <span className="text-warning font-medium">Yes</span>
                      : <span className="text-muted-foreground">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Tab 7: Hints ──────────────────────────────────────────────────────────────

function HintsTab() {
  const qc = useQueryClient()
  const [severityFilter, setSeverityFilter] = useState<string>('all')
  const [showResolved,   setShowResolved]   = useState(false)

  const { data, isLoading } = useQuery<HintsResponse>({
    queryKey: ['woe-hints', showResolved],
    queryFn:  () => api.get(`/attendance/workforce-optimization/hints?resolved=${showResolved}`),
    staleTime: 2 * 60_000,
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/attendance/workforce-optimization/hints/${id}/resolve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['woe-hints'] })
      toast.success('Hint resolved')
    },
    onError: (e: Error) => toast.error('Failed to resolve hint', { description: e.message }),
  })

  const hints = (data?.hints ?? []).filter(h =>
    severityFilter === 'all' || h.severity === severityFilter
  )

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Severity</span>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            className="rounded"
          />
          Show resolved
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : hints.length === 0 ? (
        <EmptyState text="No hints matching the current filter." />
      ) : (
        <div className="space-y-2">
          {hints.map(hint => (
            <div key={hint.id} className="rounded-lg border border-border bg-card p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="rounded-full text-[10px]">{hint.hint_type}</Badge>
                  <Badge variant={severityVariant(hint.severity) as any} className="rounded-full text-[10px]">
                    {hint.severity}
                  </Badge>
                  {hint.resolved && (
                    <Badge variant="success" className="rounded-full text-[10px]">Resolved</Badge>
                  )}
                </div>
                {!hint.resolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 flex-shrink-0"
                    disabled={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate(hint.id)}
                  >
                    {resolveMutation.isPending && resolveMutation.variables === hint.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : 'Resolve'}
                  </Button>
                )}
              </div>

              <p className="text-xs font-medium text-foreground">{hint.title}</p>
              <p className="text-xs text-muted-foreground">{hint.explanation}</p>

              <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                <span>
                  Metric: <span className="font-mono text-foreground">{hint.metric_value}</span>
                  {' · '}Threshold: <span className="font-mono text-foreground">{hint.threshold_value}</span>
                </span>
                {hint.payroll_impact != null && (
                  <span className="text-warning font-medium">
                    Payroll impact: ₹{hint.payroll_impact.toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Compute Dialog ─────────────────────────────────────────────────────────────

function ComputeDialog({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [from, setFrom] = useState(monthStart())
  const [to,   setTo]   = useState(today())

  const computeMutation = useMutation({
    mutationFn: () =>
      api.post<ComputeResult>('/attendance/workforce-optimization/compute', { from, to }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['woe-fairness'] })
      qc.invalidateQueries({ queryKey: ['woe-consecutive'] })
      qc.invalidateQueries({ queryKey: ['woe-ot-distribution'] })
      qc.invalidateQueries({ queryKey: ['woe-rest-gaps'] })
      qc.invalidateQueries({ queryKey: ['woe-shift-overload'] })
      qc.invalidateQueries({ queryKey: ['woe-hints'] })
      toast.success('Optimization computed', { description: `Analysis complete for ${from} → ${to}` })
    },
    onError: (e: Error) => toast.error('Compute failed', { description: e.message }),
  })

  const result = computeMutation.data as ComputeResult | undefined

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { computeMutation.reset(); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Compute Optimization</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <DateInput value={from} onChange={setFrom} className="h-8 text-xs" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <DateInput value={to} onChange={setTo} className="h-8 text-xs" />
          </div>

          {result && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-xs">
              <p className="text-success font-medium">Computation complete</p>
              <p className="text-muted-foreground">Employees computed: <span className="text-foreground font-mono">{result.employees_computed}</span></p>
              <p className="text-muted-foreground">Hints generated: <span className="text-foreground font-mono">{result.hints_generated}</span></p>
            </div>
          )}

          {computeMutation.isError && (
            <p className="text-xs text-destructive">Computation failed. Please try again.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={computeMutation.isPending || !from || !to}
            onClick={() => computeMutation.mutate()}
          >
            {computeMutation.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Computing…</>
              : <><Zap className="h-3.5 w-3.5" /> Compute</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function WorkforceOptimizationEngine() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [computeOpen, setComputeOpen] = useState(false)

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Workforce Optimization" subtitle="Shift fairness, load balancing, and staffing intelligence" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Access restricted to HR admins</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Workforce Optimization"
        subtitle="Shift fairness, load balancing, and staffing intelligence"
        actions={
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setComputeOpen(true)}
          >
            <Zap className="h-3.5 w-3.5" />
            Compute
          </Button>
        }
      />

      <Tabs defaultValue="fairness">
        <TabsList className="flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="fairness"    className="text-xs gap-1.5"><BarChart2 className="h-3.5 w-3.5" />Fairness Balance</TabsTrigger>
          <TabsTrigger value="consecutive" className="text-xs gap-1.5"><CalendarRange className="h-3.5 w-3.5" />Consecutive Shifts</TabsTrigger>
          <TabsTrigger value="ot"          className="text-xs gap-1.5"><Clock className="h-3.5 w-3.5" />OT Distribution</TabsTrigger>
          <TabsTrigger value="rest"        className="text-xs gap-1.5"><Activity className="h-3.5 w-3.5" />Rest Gaps</TabsTrigger>
          <TabsTrigger value="overload"    className="text-xs gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Shift Overload</TabsTrigger>
          <TabsTrigger value="staffing"    className="text-xs gap-1.5"><Users className="h-3.5 w-3.5" />Staffing Hints</TabsTrigger>
          <TabsTrigger value="hints"       className="text-xs gap-1.5"><Lightbulb className="h-3.5 w-3.5" />Hints</TabsTrigger>
        </TabsList>

        <TabsContent value="fairness">
          <SectionCard title="Fairness Balance" icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}>
            <FairnessTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="consecutive">
          <SectionCard title="Consecutive Shifts" icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}>
            <ConsecutiveTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="ot">
          <SectionCard title="OT Distribution" icon={<Clock className="h-4 w-4 text-muted-foreground" />}>
            <OtDistributionTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="rest">
          <SectionCard title="Rest Gaps" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
            <RestGapsTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="overload">
          <SectionCard title="Shift Overload" icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}>
            <ShiftOverloadTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="staffing">
          <SectionCard title="Staffing Hints" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
            <StaffingHintsTab />
          </SectionCard>
        </TabsContent>

        <TabsContent value="hints">
          <SectionCard title="Optimization Hints" icon={<Lightbulb className="h-4 w-4 text-muted-foreground" />}>
            <HintsTab />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <ComputeDialog open={computeOpen} onClose={() => setComputeOpen(false)} />
    </PageContainer>
  )
}
