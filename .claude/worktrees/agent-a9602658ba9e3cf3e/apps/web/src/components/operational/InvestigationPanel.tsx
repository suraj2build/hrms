/**
 * InvestigationPanel
 *
 * Right-side slide-over panel for drilling into workforce metric anomalies.
 * Transforms any chart click in WorkforceAnalytics into an actionable list of
 * affected employees — each with severity indicators and direct navigation links.
 *
 * Usage:
 *   const [investigation, setInvestigation] = useState<DrillTarget | null>(null)
 *
 *   // Trigger from a Recharts onClick:
 *   <Line onClick={(data) => setInvestigation({ metric: 'absent', from, to, week: data.activePayload[0]?.payload.week, label: 'Absent Rate' })} />
 *
 *   <InvestigationPanel target={investigation} onClose={() => setInvestigation(null)} />
 */

import { useState }      from 'react'
import { useQuery }      from '@tanstack/react-query'
import { Link }          from 'react-router-dom'
import {
  AlertTriangle, CheckCircle2, Users,
  ExternalLink, Clock, TrendingDown,
  ChevronRight, Filter, X, Search,
} from 'lucide-react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  SheetDescription, SheetBody,
} from '@/components/ui/sheet'
import { Badge }   from '@/components/ui/badge'
import { Button }  from '@/components/ui/button'
import { api }     from '@/lib/api/client'
import { cn }      from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DrillMetric = 'absent' | 'late' | 'ot' | 'pressure' | 'reliability' | 'leave'
type Severity           = 'high' | 'medium' | 'low'

export interface DrillTarget {
  metric:  DrillMetric
  from:    string           // YYYY-MM-DD
  to:      string           // YYYY-MM-DD
  week?:   string           // YYYY-Wnn — narrows to a specific week
  label:   string           // Human-readable context, e.g. "Absent Rate · W04"
}

interface DrillEmployee {
  employee_id:   string
  employee_code: string
  name:          string
  department:    string | null
  metric_value:  number
  metric_label:  string
  severity:      Severity
  detail:        Record<string, number | string>
  investigation_links: {
    profile:    string
    attendance: string
  }
}

interface DrillResponse {
  metric:    DrillMetric
  range:     { from: string; to: string }
  week:      string | null
  filters:   { department_id: string | null; severity: string | null }
  employees: DrillEmployee[]
  summary:   {
    total:    number
    severity: { high: number; medium: number; low: number }
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const METRIC_META: Record<DrillMetric, {
  label:    string
  icon:     React.ComponentType<{ className?: string }>
  unit:     string
  higherIsBetter: boolean
}> = {
  absent:      { label: 'Absent',          icon: TrendingDown,   unit: '%',   higherIsBetter: false },
  late:        { label: 'Late',            icon: Clock,          unit: '%',   higherIsBetter: false },
  ot:          { label: 'Overtime',        icon: Clock,          unit: 'h',   higherIsBetter: false },
  pressure:    { label: 'Staffing Pressure', icon: AlertTriangle, unit: 'days', higherIsBetter: false },
  reliability: { label: 'Reliability',    icon: CheckCircle2,   unit: 'pts', higherIsBetter: true  },
  leave:       { label: 'Leave',           icon: TrendingDown,   unit: '%',   higherIsBetter: false },
}

const SEVERITY_BADGE: Record<Severity, 'destructive' | 'warning' | 'secondary'> = {
  high:   'destructive',
  medium: 'warning',
  low:    'secondary',
}

const SEVERITY_DOT: Record<Severity, string> = {
  high:   'bg-destructive',
  medium: 'bg-warning',
  low:    'bg-muted-foreground',
}

// ── InvestigationPanel ────────────────────────────────────────────────────────

interface InvestigationPanelProps {
  target:  DrillTarget | null
  onClose: () => void
}

export function InvestigationPanel({ target, onClose }: InvestigationPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('')

  const params = target
    ? new URLSearchParams({
        metric: target.metric,
        from:   target.from,
        to:     target.to,
        ...(target.week       ? { week: target.week }             : {}),
        ...(severityFilter    ? { severity: severityFilter }      : {}),
      }).toString()
    : ''

  const { data, isLoading, isError, refetch } = useQuery<DrillResponse>({
    queryKey: ['workforce-drill', target?.metric, target?.from, target?.to, target?.week, severityFilter],
    queryFn:  () => api.get(`/analytics/workforce/drill?${params}`),
    enabled:  !!target,
    staleTime: 120_000,
  })

  const meta = target ? METRIC_META[target.metric] : null

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="md">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <SheetHeader>
          <div className="flex items-center gap-2">
            {meta && <meta.icon className="h-4 w-4 text-muted-foreground" />}
            <SheetTitle>
              {target?.label ?? 'Investigation'}
            </SheetTitle>
          </div>
          <SheetDescription>
            {target && (
              <>
                {target.from} → {target.to}
                {target.week && <span className="ml-2 font-mono">{target.week}</span>}
              </>
            )}
          </SheetDescription>

          {/* Summary badges */}
          {data?.summary && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                <strong className="text-foreground">{data.summary.total}</strong> employees affected
              </span>
              {data.summary.severity.high > 0 && (
                <Badge variant="destructive" className="rounded-full text-[10px]">
                  {data.summary.severity.high} high
                </Badge>
              )}
              {data.summary.severity.medium > 0 && (
                <Badge variant="warning" className="rounded-full text-[10px]">
                  {data.summary.severity.medium} medium
                </Badge>
              )}
              {data.summary.severity.low > 0 && (
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  {data.summary.severity.low} low
                </Badge>
              )}
            </div>
          )}

          {/* Severity filter pills */}
          <div className="flex items-center gap-1.5 pt-1">
            <Filter className="h-3 w-3 text-muted-foreground" />
            {(['', 'high', 'medium', 'low'] as const).map(s => (
              <button
                key={s || 'all'}
                onClick={() => setSeverityFilter(s)}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                  severityFilter === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </SheetHeader>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <SheetBody>
          {isLoading && (
            <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30 animate-pulse" />
              <p className="text-sm">Loading investigation data…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <AlertTriangle className="h-8 w-8 text-destructive opacity-50" />
              <p className="text-sm">Failed to load data.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          {!isLoading && !isError && data?.employees.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 opacity-30" />
              <p className="text-sm font-medium text-foreground">No employees match</p>
              <p className="text-xs text-center">
                {severityFilter
                  ? `No ${severityFilter}-severity cases in this period.`
                  : 'No anomalies detected for this metric and period.'}
              </p>
              {severityFilter && (
                <Button size="sm" variant="ghost" onClick={() => setSeverityFilter('')}>
                  <X className="h-3 w-3 mr-1" /> Clear filter
                </Button>
              )}
            </div>
          )}

          {!isLoading && !isError && data && data.employees.length > 0 && (
            <div className="space-y-2">
              {data.employees.map((emp) => (
                <EmployeeInvestigationCard
                  key={emp.employee_id}
                  employee={emp}
                  metric={data.metric}
                  metaMeta={meta}
                />
              ))}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

// ── EmployeeInvestigationCard ─────────────────────────────────────────────────

// Current month helper for payroll investigation link
function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface EmployeeInvestigationCardProps {
  employee: DrillEmployee
  metric:   DrillMetric
  metaMeta: typeof METRIC_META[DrillMetric] | null
}

function EmployeeInvestigationCard({ employee: emp, metric }: EmployeeInvestigationCardProps) {
  const [expanded, setExpanded] = useState(false)

  const severityVariant = SEVERITY_BADGE[emp.severity]
  const severityDot     = SEVERITY_DOT[emp.severity]

  return (
    <div className={cn(
      'rounded-lg border border-border bg-card transition-colors',
      emp.severity === 'high' && 'border-destructive/30 bg-destructive/5',
      emp.severity === 'medium' && 'border-warning/30',
    )}>
      {/* Main row */}
      <div className="flex items-start gap-3 p-3">
        {/* Severity dot */}
        <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', severityDot)} />

        {/* Employee info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-foreground truncate">{emp.name}</p>
            <span className="text-[10px] font-mono text-muted-foreground">{emp.employee_code}</span>
            {emp.department && (
              <span className="text-[10px] text-muted-foreground">· {emp.department}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{emp.metric_label}</p>
        </div>

        {/* Severity badge + metric value */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <Badge variant={severityVariant} className="rounded-full text-[10px] capitalize">
            {emp.severity}
          </Badge>
          <span className={cn(
            'text-sm font-bold tabular-nums',
            metric === 'reliability'
              ? emp.metric_value >= 75 ? 'text-success' : emp.metric_value >= 60 ? 'text-warning' : 'text-destructive'
              : emp.severity === 'high' ? 'text-destructive' : emp.severity === 'medium' ? 'text-warning' : 'text-muted-foreground',
          )}>
            {typeof emp.metric_value === 'number' ? emp.metric_value.toFixed(metric === 'ot' ? 1 : 0) : emp.metric_value}
            {metric === 'absent' || metric === 'late' || metric === 'leave' ? '%' : ''}
            {metric === 'ot' ? 'h' : ''}
          </span>
        </div>
      </div>

      {/* Detail expansion */}
      {Object.keys(emp.detail).length > 0 && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-3 pb-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Details</span>
            <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          </button>

          {expanded && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(emp.detail).map(([key, val]) => (
                <div key={key} className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-medium text-foreground tabular-nums">{String(val)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Navigation footer */}
      <div className="flex items-center gap-2 px-3 pb-3 pt-0 flex-wrap">
        <Link
          to={emp.investigation_links.profile}
          className="flex items-center gap-1 text-[10px] text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Profile
        </Link>
        <span className="text-muted-foreground/40">·</span>
        <Link
          to={`/admin/attendance/forensics?employee_id=${emp.employee_id}`}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground hover:underline transition-colors"
        >
          Attendance
        </Link>
        <span className="text-muted-foreground/40">·</span>
        <Link
          to={`/admin/payroll/investigate?employee_id=${emp.employee_id}&month=${currentMonth()}`}
          className="flex items-center gap-1 text-[10px] text-warning hover:text-foreground hover:underline transition-colors font-medium"
        >
          <Search className="h-3 w-3" />
          Investigate Payroll
        </Link>
      </div>
    </div>
  )
}
