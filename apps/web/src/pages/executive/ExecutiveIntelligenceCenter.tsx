/**
 * Executive Intelligence Center — /admin/executive
 *
 * Read-only strategic intelligence for CEO / CHRO / Enterprise Admin.
 * No operational actions. No approvals. No workflow execution.
 * All data derives from existing SSOT modules.
 *
 * 6 tabs:
 *   CEO View      — headcount, payroll cost, attention items, narrative
 *   CHRO View     — workforce distribution, leave, compensation, trust
 *   Workforce     — headcount trends, dept breakdown, type/gender analysis
 *   Financial     — payroll cost trends, dept cost, revision impact
 *   Compliance    — incidents, exceptions, trust risks, governance alerts
 *   Trends        — 6-month strategic trends (attendance, leave, payroll)
 */

import { useState, useMemo }           from 'react'
import { useQuery }                    from '@tanstack/react-query'
import {
  TrendingUp, Minus,
  Users, DollarSign, ShieldCheck,
  AlertTriangle, CheckCircle2, BarChart3,
  Activity, Brain, RefreshCw,
  Loader2, AlertCircle, ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api }            from '@/lib/api/client'
import { cn }             from '@/lib/utils'

// ── Local types (match API response shapes) ───────────────────────────────────

interface CeoSnapshot {
  employee_count:        number
  joiners_30d:           number
  exits_30d:             number
  net_headcount_change:  number
  attendance_rate:       number
  absence_rate:          number
  payroll_cost_current:  number
  payroll_net_current:   number
  payroll_headcount:     number
  payroll_month:         string
  avg_cost_per_employee: number
  open_exceptions:       number
  open_incidents:        number
  pending_revisions:     number
  total_attention_items: number
  narrative:             string
  generated_at:          string
  period:                { from: string; to: string }
}

interface ChroSnapshot {
  employee_count:               number
  employment_type_distribution: Record<string, number>
  gender_distribution:          Record<string, number>
  dept_distribution:            Record<string, number>
  attendance_rate:              number
  absence_rate:                 number
  leave_applied:                number
  leave_approved:               number
  leave_pending:                number
  total_days_taken:             number
  leave_utilization_pct:        number
  pending_revisions:            number
  approved_revisions:           number
  pending_revisions_by_type:    Record<string, number>
  trust_high_risk:              number
  trust_verified:               number
  trust_total:                  number
  trust_verification_pct:       number
  narrative:                    string
  generated_at:                 string
}

interface WorkforceData {
  employee_count:              number
  monthly_trends:              Array<{ month: string; joiners: number; exits: number; net: number }>
  dept_distribution:           Array<{ dept: string; count: number; pct: number }>
  employment_type_distribution: Array<{ type: string; count: number; pct: number }>
  gender_distribution:         Record<string, number>
  total_joiners_period:        number
  total_exits_period:          number
}

interface FinancialData {
  payroll_current_gross:    number
  payroll_current_net:      number
  payroll_current_headcount: number
  payroll_current_month:    string
  payroll_mom_change:       number
  payroll_cost_trend:       Array<{ month: string; total_gross: number; total_net: number; employee_count: number; avg_cost_per_head: number }>
  total_revision_delta:     number
  avg_revision_pct:         number
  revisions_by_type:        Record<string, number>
  approved_revisions_count: number
  dept_cost_breakdown:      Array<{ dept: string; headcount: number; total_gross: number; total_net: number; ot_cost: number }>
}

interface ComplianceData {
  open_incidents:        number
  critical_incidents:    number
  total_incidents_30d:   number
  open_exceptions:       number
  sla_breached_30d:      number
  total_exceptions_30d:  number
  sla_breach_rate:       number
  trust_high_risk:       number
  trust_medium_risk:     number
  trust_at_risk:         number
  trust_total:           number
  trust_verified:        number
  trust_verification_pct: number
  gov_total_30d:         number
  gov_by_severity:       Record<string, number>
  open_duplicates:       number
  compliance_risk_score: number
  risk_status:           'low' | 'medium' | 'high'
}

interface TrendsData {
  months:      Array<{
    month:                 string
    attendance_rate:       number
    leave_days_approved:   number
    payroll_gross:         number | null
    payroll_headcount:     number | null
    joiners:               number
    exits:                 number
    net_headcount:         number
  }>
  month_count: number
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  if (n >= 10_000_000) return `₹${((n ?? 0) / 10_000_000).toFixed(1)}Cr`
  if (n >= 100_000)    return `₹${((n ?? 0) / 100_000).toFixed(1)}L`
  if (n >= 1_000)      return `₹${((n ?? 0) / 1_000).toFixed(0)}K`
  return `₹${(n ?? 0).toLocaleString()}`
}

function fmtPct(n: number): string { return `${(n ?? 0).toFixed(1)}%` }
function fmtNum(n: number): string { return (n ?? 0).toLocaleString() }
function fmtMonth(ym: string): string {
  try {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
  } catch { return ym }
}

// ── Reusable sub-components ───────────────────────────────────────────────────

function MetricCard({
  label, value, sub, trend, trendDir, icon: Icon, accent,
}: {
  label:    string
  value:    string | number
  sub?:     string
  trend?:   string
  trendDir?: 'up' | 'down' | 'neutral'
  icon?:    React.ComponentType<{ className?: string }>
  accent?:  'green' | 'amber' | 'red' | 'blue' | 'default'
}) {
  const colourMap = {
    green:   'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30',
    amber:   'border-amber-200   bg-amber-50/50   dark:border-amber-800   dark:bg-amber-950/30',
    red:     'border-red-200     bg-red-50/50     dark:border-red-800     dark:bg-red-950/30',
    blue:    'border-blue-200    bg-blue-50/50    dark:border-blue-800    dark:bg-blue-950/30',
    default: '',
  }
  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-1',
      accent ? colourMap[accent] : colourMap.default,
    )}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {trend && (
        <div className={cn('flex items-center gap-1 text-xs font-medium',
          trendDir === 'up'   ? 'text-emerald-600' :
          trendDir === 'down' ? 'text-red-500' : 'text-muted-foreground',
        )}>
          {trendDir === 'up'      ? <ArrowUpRight className="h-3 w-3" />
           : trendDir === 'down'  ? <ArrowDownRight className="h-3 w-3" />
           : <Minus className="h-3 w-3" />}
          {trend}
        </div>
      )}
    </div>
  )
}

function RiskBadge({ status }: { status: 'low' | 'medium' | 'high' }) {
  return (
    <Badge variant={
      status === 'high'   ? 'destructive' :
      status === 'medium' ? 'outline' : 'secondary'
    } className={cn(
      status === 'medium' && 'border-amber-400 text-amber-700 bg-amber-50',
      status === 'low'    && 'border-emerald-400 text-emerald-700 bg-emerald-50',
    )}>
      {status.toUpperCase()} RISK
    </Badge>
  )
}

function SimpleBar({ label, value, max, colour = 'bg-primary' }: {
  label: string; value: number; max: number; colour?: string
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 truncate text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', colour)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-medium tabular-nums">{fmtNum(value)}</span>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 h-48 justify-center text-muted-foreground">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <p className="text-sm">{message ?? 'Failed to load data'}</p>
    </div>
  )
}

function NarrativeBox({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20 p-3">
      <div className="flex gap-2">
        <Brain className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExecutiveIntelligenceCenter() {
  const [activeTab, setActiveTab] = useState('ceo')

  // All queries are lazy — only fetch when the tab is first visited
  const ceoQ = useQuery<CeoSnapshot>({
    queryKey:  ['exec-ceo'],
    queryFn:   () => api.get('/executive/ceo').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'ceo',
    staleTime: 60_000,
  })

  const chroQ = useQuery<ChroSnapshot>({
    queryKey:  ['exec-chro'],
    queryFn:   () => api.get('/executive/chro').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'chro',
    staleTime: 60_000,
  })

  const workforceQ = useQuery<WorkforceData>({
    queryKey:  ['exec-workforce'],
    queryFn:   () => api.get('/executive/workforce').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'workforce',
    staleTime: 60_000,
  })

  const financialQ = useQuery<FinancialData>({
    queryKey:  ['exec-financial'],
    queryFn:   () => api.get('/executive/financial').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'financial',
    staleTime: 60_000,
  })

  const complianceQ = useQuery<ComplianceData>({
    queryKey:  ['exec-compliance'],
    queryFn:   () => api.get('/executive/compliance').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'compliance',
    staleTime: 60_000,
  })

  const trendsQ = useQuery<TrendsData>({
    queryKey:  ['exec-trends'],
    queryFn:   () => api.get('/executive/trends').then((r: any) => r.data ?? r),
    enabled:   activeTab === 'trends',
    staleTime: 60_000,
  })

  // ── CEO Tab ──────────────────────────────────────────────────────────────────

  const CeoTab = useMemo(() => {
    const { data, isLoading, isError } = ceoQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data

    const headcountTrend = d.net_headcount_change > 0 ? 'up'
      : d.net_headcount_change < 0 ? 'down' : 'neutral'

    const momChange = (d as any).payroll_mom_change as number | undefined
    const payrollTrend = momChange !== undefined
      ? (momChange > 0 ? 'up' : momChange < 0 ? 'down' : 'neutral')
      : undefined

    return (
      <div className="space-y-4">
        <NarrativeBox text={d.narrative} />

        {/* Workforce */}
        <SectionCard title="Workforce Snapshot" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Active Employees"
              value={fmtNum(d.employee_count)}
              accent="blue"
              icon={Users}
            />
            <MetricCard
              label="Joiners (30d)"
              value={d.joiners_30d}
              sub="New hires"
              trend={d.joiners_30d > 0 ? `+${d.joiners_30d}` : undefined}
              trendDir={headcountTrend}
              accent="green"
            />
            <MetricCard
              label="Exits (30d)"
              value={d.exits_30d}
              sub="Separations"
              accent={d.exits_30d > 5 ? 'amber' : 'default'}
            />
            <MetricCard
              label="Net Change"
              value={d.net_headcount_change >= 0 ? `+${d.net_headcount_change}` : d.net_headcount_change}
              trendDir={headcountTrend}
              trend={headcountTrend === 'up' ? 'Growing' : headcountTrend === 'down' ? 'Shrinking' : 'Stable'}
            />
          </div>
        </SectionCard>

        {/* Payroll */}
        <SectionCard title="Payroll Snapshot" icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Gross Cost"
              value={fmtCurrency(d.payroll_cost_current)}
              sub={`${d.payroll_month}`}
              accent="blue"
              icon={DollarSign}
            />
            <MetricCard
              label="Net Payout"
              value={fmtCurrency(d.payroll_net_current)}
              sub="Take-home total"
            />
            <MetricCard
              label="Avg Cost / Employee"
              value={fmtCurrency(d.avg_cost_per_employee)}
              sub={`${fmtNum(d.payroll_headcount)} employees`}
            />
            {(d as any).payroll_mom_change !== undefined && (
              <MetricCard
                label="MoM Change"
                value={`${(d as any).payroll_mom_change > 0 ? '+' : ''}${(d as any).payroll_mom_change}%`}
                trendDir={payrollTrend}
                trend={payrollTrend === 'up' ? 'Increased' : 'Decreased'}
              />
            )}
          </div>
        </SectionCard>

        {/* Attendance */}
        <SectionCard title="Operational Health (Last 30 Days)" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Attendance Rate"
              value={fmtPct(d.attendance_rate)}
              accent={d.attendance_rate >= 90 ? 'green' : d.attendance_rate >= 75 ? 'amber' : 'red'}
            />
            <MetricCard
              label="Absence Rate"
              value={fmtPct(d.absence_rate)}
              accent={d.absence_rate <= 5 ? 'green' : d.absence_rate <= 15 ? 'amber' : 'red'}
            />
            <MetricCard
              label="Open Exceptions"
              value={d.open_exceptions}
              accent={d.open_exceptions > 10 ? 'amber' : 'default'}
              icon={AlertTriangle}
            />
            <MetricCard
              label="Open Incidents"
              value={d.open_incidents}
              accent={d.open_incidents > 0 ? 'red' : 'green'}
              icon={ShieldCheck}
            />
          </div>
        </SectionCard>

        {/* Attention items */}
        {d.total_attention_items > 0 && (
          <SectionCard title="Attention Required" icon={<AlertCircle className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {d.open_exceptions > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    Open attendance exceptions
                  </span>
                  <Badge variant="outline" className="text-amber-700 border-amber-400 bg-amber-50">
                    {d.open_exceptions}
                  </Badge>
                </div>
              )}
              {d.open_incidents > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-red-500" />
                    Open operational incidents
                  </span>
                  <Badge variant="destructive">{d.open_incidents}</Badge>
                </div>
              )}
              {d.pending_revisions > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                    Pending compensation revisions
                  </span>
                  <Badge variant="secondary">{d.pending_revisions}</Badge>
                </div>
              )}
            </div>
          </SectionCard>
        )}
      </div>
    )
  }, [ceoQ.data, ceoQ.isLoading, ceoQ.isError])

  // ── CHRO Tab ─────────────────────────────────────────────────────────────────

  const ChroTab = useMemo(() => {
    const { data, isLoading, isError } = chroQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data

    const deptEntries = Object.entries(d.dept_distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
    const maxDept = deptEntries[0]?.[1] ?? 1

    const typeEntries = Object.entries(d.employment_type_distribution)
      .sort((a, b) => b[1] - a[1])

    return (
      <div className="space-y-4">
        <NarrativeBox text={d.narrative} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Workforce overview */}
          <SectionCard title="Workforce Distribution" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <MetricCard label="Active Headcount" value={fmtNum(d.employee_count)} accent="blue" />
            </div>
            <div className="space-y-1.5 mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">By Department</p>
              {deptEntries.map(([dept, count]) => (
                <SimpleBar key={dept} label={dept} value={count} max={maxDept} />
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground mb-2">By Employment Type</p>
              {typeEntries.map(([type, count]) => (
                <SimpleBar key={type} label={type} value={count} max={d.employee_count} colour="bg-blue-500" />
              ))}
            </div>
          </SectionCard>

          {/* Attendance & Leave */}
          <SectionCard title="Attendance & Leave (30d)" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Attendance"
                value={fmtPct(d.attendance_rate)}
                accent={d.attendance_rate >= 90 ? 'green' : 'amber'}
              />
              <MetricCard
                label="Absence"
                value={fmtPct(d.absence_rate)}
                accent={d.absence_rate <= 5 ? 'green' : 'amber'}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <MetricCard label="Leave Applied" value={d.leave_applied} />
              <MetricCard label="Leave Approved" value={d.leave_approved} accent="green" />
              <MetricCard label="Pending" value={d.leave_pending} accent={d.leave_pending > 5 ? 'amber' : 'default'} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {d.total_days_taken} days taken · {fmtPct(d.leave_utilization_pct)} utilization
            </div>
          </SectionCard>

          {/* Compensation revisions */}
          <SectionCard title="Compensation Revisions" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Pending"
                value={d.pending_revisions}
                accent={d.pending_revisions > 5 ? 'amber' : 'default'}
              />
              <MetricCard label="Approved (30d)" value={d.approved_revisions} accent="green" />
            </div>
            {Object.entries(d.pending_revisions_by_type).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Pending by Type</p>
                {Object.entries(d.pending_revisions_by_type).map(([type, count]) => (
                  <SimpleBar
                    key={type}
                    label={type.replace(/_/g, ' ')}
                    value={count}
                    max={d.pending_revisions}
                    colour="bg-amber-500"
                  />
                ))}
              </div>
            )}
          </SectionCard>

          {/* Trust */}
          <SectionCard title="Trust & Verification" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="High Risk"
                value={d.trust_high_risk}
                accent={d.trust_high_risk > 0 ? 'red' : 'green'}
                icon={AlertTriangle}
              />
              <MetricCard
                label="Verified"
                value={fmtPct(d.trust_verification_pct)}
                accent={d.trust_verification_pct >= 80 ? 'green' : 'amber'}
                icon={CheckCircle2}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtNum(d.trust_verified)} of {fmtNum(d.trust_total)} employees verified
            </div>
          </SectionCard>
        </div>
      </div>
    )
  }, [chroQ.data, chroQ.isLoading, chroQ.isError])

  // ── Workforce Tab ─────────────────────────────────────────────────────────────

  const WorkforceTab = useMemo(() => {
    const { data, isLoading, isError } = workforceQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data
    const maxDept = d.dept_distribution[0]?.count ?? 1

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Active Headcount" value={fmtNum(d.employee_count)} icon={Users} accent="blue" />
          <MetricCard label="Joiners (Period)" value={d.total_joiners_period} trendDir="up" accent="green" />
          <MetricCard label="Exits (Period)" value={d.total_exits_period} trendDir="down" />
          <MetricCard
            label="Net Change"
            value={d.total_joiners_period - d.total_exits_period >= 0
              ? `+${d.total_joiners_period - d.total_exits_period}`
              : d.total_joiners_period - d.total_exits_period}
            trendDir={d.total_joiners_period - d.total_exits_period > 0 ? 'up' : 'down'}
          />
        </div>

        {/* Monthly trend table */}
        <SectionCard title="Monthly Headcount Movement" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2 px-2 font-medium text-muted-foreground">Month</th>
                  {d.monthly_trends.map(t => (
                    <th key={t.month} className="text-center pb-2 px-2 font-medium text-muted-foreground">
                      {fmtMonth(t.month)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Joiners', key: 'joiners' as const },
                  { label: 'Exits',   key: 'exits'   as const },
                  { label: 'Net',     key: 'net'     as const },
                ].map(({ label, key }) => (
                  <tr key={key} className="border-b last:border-0">
                    <td className="py-1.5 px-2 font-medium text-muted-foreground">{label}</td>
                    {d.monthly_trends.map(t => (
                      <td key={t.month} className={cn(
                        'py-1.5 px-2 text-center tabular-nums',
                        key === 'net' && t.net > 0  ? 'text-emerald-600 font-medium' :
                        key === 'net' && t.net < 0  ? 'text-red-500 font-medium' : '',
                      )}>
                        {key === 'net' && t[key] > 0 ? `+${t[key]}` : t[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Department breakdown */}
          <SectionCard title="Department Breakdown" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-1.5">
              {d.dept_distribution.slice(0, 10).map(item => (
                <SimpleBar key={item.dept} label={item.dept} value={item.count} max={maxDept} />
              ))}
            </div>
          </SectionCard>

          {/* Type & Gender */}
          <SectionCard title="Employment Mix" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
            <p className="text-xs font-medium text-muted-foreground mb-2">By Employment Type</p>
            <div className="space-y-1.5 mb-4">
              {d.employment_type_distribution.slice(0, 6).map(item => (
                <SimpleBar
                  key={item.type}
                  label={item.type.replace(/_/g, ' ')}
                  value={item.count}
                  max={d.employee_count}
                  colour="bg-blue-500"
                />
              ))}
            </div>
            <p className="text-xs font-medium text-muted-foreground mb-2">By Gender</p>
            <div className="space-y-1.5">
              {Object.entries(d.gender_distribution).map(([g, count]) => (
                <SimpleBar
                  key={g}
                  label={g}
                  value={count}
                  max={d.employee_count}
                  colour="bg-violet-500"
                />
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    )
  }, [workforceQ.data, workforceQ.isLoading, workforceQ.isError])

  // ── Financial Tab ─────────────────────────────────────────────────────────────

  const FinancialTab = useMemo(() => {
    const { data, isLoading, isError } = financialQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data
    const maxDeptCost = d.dept_cost_breakdown[0]?.total_gross ?? 1

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Current Gross Cost"
            value={fmtCurrency(d.payroll_current_gross)}
            sub={d.payroll_current_month}
            icon={DollarSign}
            accent="blue"
          />
          <MetricCard
            label="Current Net Payout"
            value={fmtCurrency(d.payroll_current_net)}
            sub="Employee take-home"
          />
          <MetricCard
            label="Avg Cost / Head"
            value={fmtCurrency(
              d.payroll_current_headcount > 0
                ? Math.round(d.payroll_current_gross / d.payroll_current_headcount)
                : 0,
            )}
            sub={`${fmtNum(d.payroll_current_headcount)} employees`}
          />
          <MetricCard
            label="MoM Change"
            value={`${d.payroll_mom_change >= 0 ? '+' : ''}${d.payroll_mom_change}%`}
            trendDir={d.payroll_mom_change > 0 ? 'up' : d.payroll_mom_change < 0 ? 'down' : 'neutral'}
            accent={Math.abs(d.payroll_mom_change) > 10 ? 'amber' : 'default'}
          />
        </div>

        {/* Payroll trend table */}
        <SectionCard title="Payroll Cost Trend" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
          {d.payroll_cost_trend.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left pb-2 px-2 font-medium text-muted-foreground">Month</th>
                    {d.payroll_cost_trend.map(t => (
                      <th key={t.month} className="text-center pb-2 px-2 font-medium text-muted-foreground">
                        {fmtMonth(t.month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Gross Cost',    key: 'total_gross'       as const, fmt: fmtCurrency },
                    { label: 'Net Payout',    key: 'total_net'         as const, fmt: fmtCurrency },
                    { label: 'Headcount',     key: 'employee_count'    as const, fmt: fmtNum      },
                    { label: 'Avg / Head',    key: 'avg_cost_per_head' as const, fmt: fmtCurrency },
                  ].map(({ label, key, fmt }) => (
                    <tr key={key} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-medium text-muted-foreground">{label}</td>
                      {d.payroll_cost_trend.map(t => (
                        <td key={t.month} className="py-1.5 px-2 text-center tabular-nums">
                          {(fmt as (n: number) => string)(t[key] as number)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No payroll runs found for this period</p>
          )}
        </SectionCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Dept cost breakdown */}
          <SectionCard title="Cost by Department (Current Month)" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
            {d.dept_cost_breakdown.length > 0 ? (
              <div className="space-y-1.5">
                {d.dept_cost_breakdown.map(dept => (
                  <div key={dept.dept} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate text-muted-foreground shrink-0">{dept.dept}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(100, (dept.total_gross / maxDeptCost) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right font-medium tabular-nums">{fmtCurrency(dept.total_gross)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No dept snapshot available</p>
            )}
          </SectionCard>

          {/* Revision impact */}
          <SectionCard title="Compensation Revision Impact" icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Total Delta"
                value={fmtCurrency(Math.abs(d.total_revision_delta))}
                sub={d.total_revision_delta >= 0 ? 'Increase' : 'Decrease'}
                trendDir={d.total_revision_delta > 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="Avg Delta %"
                value={`${d.avg_revision_pct > 0 ? '+' : ''}${d.avg_revision_pct}%`}
                sub={`${d.approved_revisions_count} revisions`}
              />
            </div>
            {Object.entries(d.revisions_by_type).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Approved by Type</p>
                {Object.entries(d.revisions_by_type).map(([type, count]) => (
                  <SimpleBar
                    key={type}
                    label={type.replace(/_/g, ' ')}
                    value={count}
                    max={d.approved_revisions_count}
                    colour="bg-green-500"
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    )
  }, [financialQ.data, financialQ.isLoading, financialQ.isError])

  // ── Compliance Tab ────────────────────────────────────────────────────────────

  const ComplianceTab = useMemo(() => {
    const { data, isLoading, isError } = complianceQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data

    return (
      <div className="space-y-4">
        {/* Overall risk */}
        <SectionCard title="Compliance Risk Status" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-4xl font-bold tabular-nums">{d.compliance_risk_score}</div>
            <div className="space-y-1">
              <RiskBadge status={d.risk_status} />
              <p className="text-xs text-muted-foreground">Composite risk score (0 = no risk, 100 = critical)</p>
            </div>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                d.compliance_risk_score >= 50 ? 'bg-destructive' :
                d.compliance_risk_score >= 25 ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              style={{ width: `${d.compliance_risk_score}%` }}
            />
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Incidents */}
          <SectionCard title="Operational Incidents" icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Open Incidents"
                value={d.open_incidents}
                accent={d.open_incidents > 0 ? 'red' : 'green'}
                icon={AlertCircle}
              />
              <MetricCard
                label="Critical / High"
                value={d.critical_incidents}
                accent={d.critical_incidents > 0 ? 'red' : 'default'}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {d.total_incidents_30d} incidents logged in last 30 days
            </div>
          </SectionCard>

          {/* Exceptions & SLA */}
          <SectionCard title="Exception & SLA Health" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <MetricCard
                label="Open Exceptions"
                value={d.open_exceptions}
                accent={d.open_exceptions > 10 ? 'amber' : 'default'}
              />
              <MetricCard
                label="SLA Breach Rate"
                value={fmtPct(d.sla_breach_rate)}
                accent={d.sla_breach_rate >= 20 ? 'red' : d.sla_breach_rate >= 10 ? 'amber' : 'green'}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {d.sla_breached_30d} of {d.total_exceptions_30d} exceptions breached SLA (30d)
            </div>
          </SectionCard>

          {/* Trust */}
          <SectionCard title="Trust & Identity Risk" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <MetricCard
                label="High Risk"
                value={d.trust_high_risk}
                accent={d.trust_high_risk > 0 ? 'red' : 'green'}
              />
              <MetricCard
                label="Medium Risk"
                value={d.trust_medium_risk}
                accent={d.trust_medium_risk > 5 ? 'amber' : 'default'}
              />
              <MetricCard
                label="Verified %"
                value={fmtPct(d.trust_verification_pct)}
                accent={d.trust_verification_pct >= 80 ? 'green' : 'amber'}
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {fmtNum(d.trust_verified)} of {fmtNum(d.trust_total)} profiles verified ·
              {d.open_duplicates > 0 && ` ${d.open_duplicates} duplicate flags open`}
            </div>
          </SectionCard>

          {/* Governance events */}
          <SectionCard title="Governance Events (30d)" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
            <div className="mb-3">
              <MetricCard label="Total Events" value={d.gov_total_30d} />
            </div>
            {Object.entries(d.gov_by_severity).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">By Severity</p>
                {Object.entries(d.gov_by_severity)
                  .sort((a, b) => b[1] - a[1])
                  .map(([sev, count]) => (
                    <SimpleBar
                      key={sev}
                      label={sev}
                      value={count}
                      max={d.gov_total_30d}
                      colour={
                        sev === 'critical' ? 'bg-red-500' :
                        sev === 'high'     ? 'bg-orange-500' :
                        sev === 'medium'   ? 'bg-amber-500' : 'bg-muted-foreground'
                      }
                    />
                  ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    )
  }, [complianceQ.data, complianceQ.isLoading, complianceQ.isError])

  // ── Trends Tab ────────────────────────────────────────────────────────────────

  const TrendsTab = useMemo(() => {
    const { data, isLoading, isError } = trendsQ
    if (isLoading) return <LoadingState />
    if (isError || !data) return <ErrorState />
    const d = data
    const months = d.months

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Historical trend view — last {d.month_count} months. No forecasting. Read-only.
        </p>

        {/* Attendance trend */}
        <SectionCard title="Attendance Rate Trend" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left pb-2 px-2 font-medium text-muted-foreground w-32">Metric</th>
                  {months.map(m => (
                    <th key={m.month} className="text-center pb-2 px-2 font-medium text-muted-foreground">
                      {fmtMonth(m.month)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Attendance %</td>
                  {months.map(m => (
                    <td key={m.month} className={cn(
                      'py-1.5 px-2 text-center tabular-nums font-medium',
                      m.attendance_rate >= 90 ? 'text-emerald-600' :
                      m.attendance_rate >= 75 ? 'text-amber-600' : 'text-red-500',
                    )}>
                      {m.attendance_rate > 0 ? fmtPct(m.attendance_rate) : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Leave Days</td>
                  {months.map(m => (
                    <td key={m.month} className="py-1.5 px-2 text-center tabular-nums">
                      {m.leave_days_approved > 0 ? fmtNum(m.leave_days_approved) : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Gross Payroll</td>
                  {months.map(m => (
                    <td key={m.month} className="py-1.5 px-2 text-center tabular-nums">
                      {m.payroll_gross !== null ? fmtCurrency(m.payroll_gross) : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Payroll Head</td>
                  {months.map(m => (
                    <td key={m.month} className="py-1.5 px-2 text-center tabular-nums">
                      {m.payroll_headcount !== null ? fmtNum(m.payroll_headcount) : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Joiners</td>
                  {months.map(m => (
                    <td key={m.month} className="py-1.5 px-2 text-center tabular-nums text-emerald-600">
                      {m.joiners > 0 ? `+${m.joiners}` : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-1.5 px-2 font-medium text-muted-foreground">Exits</td>
                  {months.map(m => (
                    <td key={m.month} className="py-1.5 px-2 text-center tabular-nums text-red-500">
                      {m.exits > 0 ? m.exits : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Net headcount bar indicators */}
        <SectionCard title="Net Headcount Change by Month" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-2">
            {months.map(m => {
              const abs = Math.abs(m.net_headcount)
              const maxAbs = Math.max(1, ...months.map(x => Math.abs(x.net_headcount)))
              return (
                <div key={m.month} className="flex items-center gap-3 text-xs">
                  <span className="w-12 font-medium text-muted-foreground">{fmtMonth(m.month)}</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden relative">
                    {m.net_headcount !== 0 && (
                      <div
                        className={cn('h-full rounded-full', m.net_headcount > 0 ? 'bg-emerald-500' : 'bg-red-400')}
                        style={{ width: `${Math.min(100, (abs / maxAbs) * 100)}%` }}
                      />
                    )}
                  </div>
                  <span className={cn(
                    'w-8 text-right font-medium tabular-nums',
                    m.net_headcount > 0 ? 'text-emerald-600' :
                    m.net_headcount < 0 ? 'text-red-500' : 'text-muted-foreground',
                  )}>
                    {m.net_headcount > 0 ? `+${m.net_headcount}` : m.net_headcount || '0'}
                  </span>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>
    )
  }, [trendsQ.data, trendsQ.isLoading, trendsQ.isError])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Executive Intelligence Center"
        subtitle="Read-only strategic intelligence derived from operational SSOT. No actions, no approvals."
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mt-4"
      >
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="ceo"        className="flex items-center gap-1.5 text-xs">
            <Activity className="h-3.5 w-3.5" />CEO View
          </TabsTrigger>
          <TabsTrigger value="chro"       className="flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />CHRO View
          </TabsTrigger>
          <TabsTrigger value="workforce"  className="flex items-center gap-1.5 text-xs">
            <Users className="h-3.5 w-3.5" />Workforce
          </TabsTrigger>
          <TabsTrigger value="financial"  className="flex items-center gap-1.5 text-xs">
            <DollarSign className="h-3.5 w-3.5" />Financial
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />Compliance
          </TabsTrigger>
          <TabsTrigger value="trends"     className="flex items-center gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />Trends
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="ceo"        className="m-0">{CeoTab}</TabsContent>
          <TabsContent value="chro"       className="m-0">{ChroTab}</TabsContent>
          <TabsContent value="workforce"  className="m-0">{WorkforceTab}</TabsContent>
          <TabsContent value="financial"  className="m-0">{FinancialTab}</TabsContent>
          <TabsContent value="compliance" className="m-0">{ComplianceTab}</TabsContent>
          <TabsContent value="trends"     className="m-0">{TrendsTab}</TabsContent>
        </div>
      </Tabs>
    </PageContainer>
  )
}
