/**
 * ExecutiveIntelligence — /admin/executive-intelligence
 *
 * Executive Operational Intelligence dashboard.
 * Provides strategic workforce operations visibility for HR admins.
 *
 * Surfaces:
 *   - Workforce stability, operational SLA, payroll volatility KPIs
 *   - Reliability trends (3-month)
 *   - Burnout exposure signals
 *   - Exception resolution metrics
 *   - Staffing sustainability overview
 *
 * Access: hr_admin / super_admin only.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useQuery }             from '@tanstack/react-query'
import {
  ShieldAlert, Loader2, AlertTriangle, CheckCircle2,
  TrendingUp, Users, Activity, BarChart2, Shield,
} from 'lucide-react'

import { PageContainer }       from '@/components/layout/PageContainer'
import { PageHeader }          from '@/components/layout/PageHeader'
import { SectionCard }         from '@/components/layout/SectionCard'
import { Badge }               from '@/components/ui/badge'
import { api }                 from '@/lib/api/client'
import { useAuthStore }        from '@/stores/authStore'
import { cn }                  from '@/lib/utils'
import { ensureArray, safeNumber } from '@/lib/array-utils'
import { ErrorBoundary }       from '@/components/error-boundary/ErrorBoundary'
import { ChartErrorBoundary }  from '@/components/error-boundary/ChartErrorBoundary'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ExecutiveDashboard {
  attendance_rate:           number
  absence_rate:              number
  consistency_score:         number
  exception_sla_breach_rate: number
  incident_sla_breach_rate:  number
  open_exceptions:           number
  open_incidents:            number
  avg_ot_hours:              number
  lop_rate:                  number
  payroll_risk_score:        number
}

interface ReliabilityMonth {
  month:        string
  present_rate: number
  late_rate:    number
  absent_rate:  number
}

interface ReliabilityTrendsResponse {
  months: ReliabilityMonth[]
}

interface BurnoutSeverityBreakdown {
  critical?: number
  high?:     number
  medium?:   number
  low?:      number
  [key: string]: number | undefined
}

interface BurnoutExposureResponse {
  at_risk_employees:        number
  hint_count_by_severity:   BurnoutSeverityBreakdown
  overload_concentration:   number
}

interface ExceptionSeverityRow {
  severity: string
  count:    number
  pct:      number
}

interface ExceptionResolutionResponse {
  total_exceptions:    number
  resolution_rate:     number
  avg_resolution_hours: number
  by_severity:         ExceptionSeverityRow[]
}

interface PressureDay {
  pressure: string
  count:    number
}

interface StaffingSustainabilityResponse {
  avg_coverage:        number
  understaffed_days:   number
  overstaffed_days:    number
  critical_days:       number
  pressure_distribution: PressureDay[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentMonthParam() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtPct(n: number, decimals = 1) {
  return `${(n ?? 0).toFixed(decimals)}%`
}

function payrollRiskColor(score: number): string {
  if (score > 70) return 'text-destructive'
  if (score > 40) return 'text-warning'
  return 'text-success'
}

function presentRateColor(rate: number): string {
  if (rate > 90) return 'text-success'
  if (rate >= 80) return 'text-warning'
  return 'text-destructive'
}

function pressureBadgeVariant(p: string): 'destructive' | 'warning' | 'secondary' | 'success' {
  if (p === 'critical') return 'destructive'
  if (p === 'high')     return 'warning'
  if (p === 'moderate') return 'secondary'
  return 'success'
}

function severityBadgeVariant(s: string): 'destructive' | 'warning' | 'secondary' | 'success' {
  if (s === 'critical' || s === 'high') return 'destructive'
  if (s === 'medium')                   return 'warning'
  return 'secondary'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiBlock({
  label, value, colorCls, sub,
}: {
  label: string; value: string | number; colorCls?: string; sub?: string
}) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={cn('text-xl font-bold mt-0.5', colorCls ?? 'text-foreground')}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function SummaryTopCard({
  title, icon: Icon, children,
}: {
  title: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {children}
      </div>
    </div>
  )
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 py-8 text-muted-foreground text-xs justify-center">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  )
}

// ── Top Summary Cards ──────────────────────────────────────────────────────────

function DashboardSummary() {
  const { data, isLoading } = useQuery<ExecutiveDashboard>({
    queryKey: ['exec-dashboard'],
    queryFn:  () => api.get('/analytics/executive/dashboard'),
    staleTime: 300_000,
  })

  if (isLoading) return <LoadingRow />
  if (!data) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Workforce Stability */}
      <SummaryTopCard title="Workforce Stability" icon={Users}>
        <KpiBlock
          label="Attendance Rate"
          value={fmtPct(data.attendance_rate)}
          colorCls={data.attendance_rate >= 90 ? 'text-success' : data.attendance_rate >= 80 ? 'text-warning' : 'text-destructive'}
        />
        <KpiBlock
          label="Absence Rate"
          value={fmtPct(data.absence_rate)}
          colorCls={data.absence_rate > 10 ? 'text-destructive' : 'text-muted-foreground'}
        />
        <KpiBlock
          label="Consistency Score"
          value={(data.consistency_score ?? 0).toFixed(1)}
          colorCls={(data.consistency_score ?? 0) >= 80 ? 'text-success' : (data.consistency_score ?? 0) >= 60 ? 'text-warning' : 'text-destructive'}
          sub="out of 100"
        />
      </SummaryTopCard>

      {/* Operational SLA */}
      <SummaryTopCard title="Operational SLA" icon={Shield}>
        <KpiBlock
          label="Exception SLA Breach"
          value={fmtPct(data.exception_sla_breach_rate)}
          colorCls={data.exception_sla_breach_rate > 20 ? 'text-destructive' : data.exception_sla_breach_rate > 10 ? 'text-warning' : 'text-success'}
        />
        <KpiBlock
          label="Incident SLA Breach"
          value={fmtPct(data.incident_sla_breach_rate)}
          colorCls={data.incident_sla_breach_rate > 20 ? 'text-destructive' : data.incident_sla_breach_rate > 10 ? 'text-warning' : 'text-success'}
        />
        <KpiBlock
          label="Open Exceptions"
          value={data.open_exceptions}
          colorCls={data.open_exceptions > 0 ? 'text-warning' : 'text-success'}
        />
        <KpiBlock
          label="Open Incidents"
          value={data.open_incidents}
          colorCls={data.open_incidents > 0 ? 'text-warning' : 'text-success'}
        />
      </SummaryTopCard>

      {/* Payroll Volatility */}
      <SummaryTopCard title="Payroll Volatility" icon={BarChart2}>
        <KpiBlock
          label="Avg OT Hours"
          value={`${(data.avg_ot_hours ?? 0).toFixed(1)}h`}
          colorCls={(data.avg_ot_hours ?? 0) > 20 ? 'text-warning' : 'text-muted-foreground'}
        />
        <KpiBlock
          label="LOP Rate"
          value={fmtPct(data.lop_rate)}
          colorCls={data.lop_rate > 5 ? 'text-destructive' : 'text-muted-foreground'}
        />
        <KpiBlock
          label="Payroll Risk Score"
          value={(data.payroll_risk_score ?? 0).toFixed(0)}
          colorCls={payrollRiskColor(data.payroll_risk_score ?? 0)}
          sub={(data.payroll_risk_score ?? 0) > 70 ? 'High risk' : (data.payroll_risk_score ?? 0) > 40 ? 'Moderate' : 'Low risk'}
        />
      </SummaryTopCard>
    </div>
  )
}

// ── Reliability Trends ─────────────────────────────────────────────────────────

function ReliabilityTrends() {
  const { data, isLoading } = useQuery<ReliabilityTrendsResponse>({
    queryKey: ['exec-reliability-trends'],
    queryFn:  () => api.get('/analytics/executive/reliability-trends?months=3'),
    staleTime: 300_000,
  })

  return (
    <SectionCard title="Reliability Trends" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
      {isLoading ? <LoadingRow /> : ensureArray<ReliabilityMonth>(data?.months).length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
          <CheckCircle2 className="h-6 w-6 opacity-30" />
          <p className="text-xs">No trend data available.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {['Month', 'Present Rate', 'Late Rate', 'Absent Rate'].map(h => (
                  <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ensureArray<ReliabilityMonth>(data?.months).map(row => (
                <tr key={row.month} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium text-foreground">{row.month}</td>
                  <td className={cn('px-3 py-2 tabular-nums font-semibold', presentRateColor(row.present_rate))}>
                    {fmtPct(row.present_rate)}
                  </td>
                  <td className={cn('px-3 py-2 tabular-nums', row.late_rate > 10 ? 'text-warning' : 'text-muted-foreground')}>
                    {fmtPct(row.late_rate)}
                  </td>
                  <td className={cn('px-3 py-2 tabular-nums', row.absent_rate > 10 ? 'text-destructive' : 'text-muted-foreground')}>
                    {fmtPct(row.absent_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ── Burnout Exposure ──────────────────────────────────────────────────────────

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

function BurnoutExposure() {
  const { data, isLoading } = useQuery<BurnoutExposureResponse>({
    queryKey: ['exec-burnout-exposure', currentMonthParam()],
    queryFn:  () => api.get('/analytics/executive/burnout-exposure'),
    staleTime: 300_000,
  })

  return (
    <SectionCard title="Burnout Exposure" icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}>
      {isLoading ? <LoadingRow /> : data ? (
        <div className="space-y-3">
          {/* Warning banner */}
          {data.at_risk_employees > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <p className="text-xs text-destructive font-medium">
                {data.at_risk_employees} employee{data.at_risk_employees !== 1 ? 's' : ''} showing burnout indicators
              </p>
            </div>
          )}

          {/* At-risk count */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">At-risk employees</span>
            <span className={cn('text-sm font-bold', data.at_risk_employees > 0 ? 'text-destructive' : 'text-success')}>
              {data.at_risk_employees}
            </span>
          </div>

          {/* Hint severity breakdown */}
          {Object.keys(data.hint_count_by_severity).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Hints by severity</p>
              {SEVERITY_ORDER
                .filter(s => (data.hint_count_by_severity[s] ?? 0) > 0)
                .map(s => (
                  <div key={s} className="flex items-center justify-between">
                    <Badge variant={severityBadgeVariant(s) as any} className="rounded-full text-[10px]">{s}</Badge>
                    <span className="text-xs tabular-nums text-foreground font-medium">
                      {data.hint_count_by_severity[s]}
                    </span>
                  </div>
                ))
              }
            </div>
          )}

          {/* Overload concentration */}
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <span className="text-xs text-muted-foreground">Overload concentration</span>
            <span className={cn('text-xs tabular-nums font-semibold', safeNumber(data.overload_concentration) > 0.5 ? 'text-destructive' : 'text-success')}>
              {(safeNumber(data.overload_concentration) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-6 text-center">No data available.</p>
      )}
    </SectionCard>
  )
}

// ── Exception Resolution ───────────────────────────────────────────────────────

function ExceptionResolution() {
  const { data, isLoading } = useQuery<ExceptionResolutionResponse>({
    queryKey: ['exec-exception-resolution', currentMonthParam()],
    queryFn:  () => api.get('/analytics/executive/exception-resolution'),
    staleTime: 300_000,
  })

  return (
    <SectionCard title="Exception Resolution" icon={<Activity className="h-4 w-4 text-muted-foreground" />}>
      {isLoading ? <LoadingRow /> : data ? (
        <div className="space-y-3">
          {/* Top metrics */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Total</p>
              <p className="text-lg font-bold text-foreground">{data.total_exceptions}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Resolution Rate</p>
              <p className={cn('text-lg font-bold', data.resolution_rate >= 80 ? 'text-success' : data.resolution_rate >= 60 ? 'text-warning' : 'text-destructive')}>
                {fmtPct(data.resolution_rate)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Avg Hours</p>
              <p className="text-lg font-bold text-foreground">{(data.avg_resolution_hours ?? 0).toFixed(1)}h</p>
            </div>
          </div>

          {/* By severity table */}
          {ensureArray<ExceptionSeverityRow>(data.by_severity).length > 0 && (
            <div className="border-t border-border pt-2 space-y-1.5">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">By severity</p>
              {ensureArray<ExceptionSeverityRow>(data.by_severity).map(row => (
                <div key={row.severity} className="flex items-center justify-between">
                  <Badge variant={severityBadgeVariant(row.severity) as any} className="rounded-full text-[10px]">
                    {row.severity}
                  </Badge>
                  <div className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="text-foreground font-medium">{row.count}</span>
                    <span className="text-muted-foreground">{fmtPct(row.pct)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-6 text-center">No data available.</p>
      )}
    </SectionCard>
  )
}

// ── Staffing Sustainability ────────────────────────────────────────────────────

function StaffingSustainability() {
  const { data, isLoading } = useQuery<StaffingSustainabilityResponse>({
    queryKey: ['exec-staffing-sustainability', currentMonthParam()],
    queryFn:  () => api.get('/analytics/executive/staffing-sustainability'),
    staleTime: 300_000,
  })

  return (
    <SectionCard
      title="Staffing Sustainability"
      icon={<Users className="h-4 w-4 text-muted-foreground" />}
      className="col-span-full"
    >
      {isLoading ? <LoadingRow /> : data ? (
        <div className="space-y-4">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Avg Coverage</p>
              <p className={cn('text-2xl font-bold mt-1', data.avg_coverage >= 90 ? 'text-success' : data.avg_coverage >= 75 ? 'text-warning' : 'text-destructive')}>
                {fmtPct(data.avg_coverage)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Understaffed Days</p>
              <p className={cn('text-2xl font-bold mt-1', data.understaffed_days > 5 ? 'text-destructive' : data.understaffed_days > 0 ? 'text-warning' : 'text-success')}>
                {data.understaffed_days}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Overstaffed Days</p>
              <p className={cn('text-2xl font-bold mt-1', data.overstaffed_days > 5 ? 'text-warning' : 'text-muted-foreground')}>
                {data.overstaffed_days}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3 text-center">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Critical Days</p>
              <p className={cn('text-2xl font-bold mt-1', data.critical_days > 0 ? 'text-destructive' : 'text-success')}>
                {data.critical_days}
              </p>
            </div>
          </div>

          {/* Pressure distribution */}
          {ensureArray<PressureDay>(data.pressure_distribution).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Staffing Pressure Distribution</p>
              <div className="flex flex-wrap gap-2">
                {ensureArray<PressureDay>(data.pressure_distribution).map(pd => (
                  <div key={pd.pressure} className="flex items-center gap-1.5">
                    <Badge variant={pressureBadgeVariant(pd.pressure) as any} className="rounded-full text-[10px]">
                      {pd.pressure}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">{pd.count} day{pd.count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-6 text-center">No staffing data available.</p>
      )}
    </SectionCard>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

function ExecutiveIntelligenceInner() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Executive Intelligence"
          subtitle="Strategic workforce operations visibility"
        />
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
        title="Executive Intelligence"
        subtitle="Strategic workforce operations visibility"
      />

      {/* Top 3-column summary cards */}
      <ChartErrorBoundary label="Dashboard Summary">
        <DashboardSummary />
      </ChartErrorBoundary>

      {/* 3-column section grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <ChartErrorBoundary label="Reliability Trends">
          <ReliabilityTrends />
        </ChartErrorBoundary>
        <ChartErrorBoundary label="Burnout Exposure">
          <BurnoutExposure />
        </ChartErrorBoundary>
        <ChartErrorBoundary label="Exception Resolution">
          <ExceptionResolution />
        </ChartErrorBoundary>
      </div>

      {/* Full-width staffing sustainability */}
      <div className="grid grid-cols-1 gap-4">
        <ChartErrorBoundary label="Staffing Sustainability">
          <StaffingSustainability />
        </ChartErrorBoundary>
      </div>
    </PageContainer>
  )
}

export function ExecutiveIntelligence() {
  return (
    <ErrorBoundary title="Executive Intelligence">
      <ExecutiveIntelligenceInner />
    </ErrorBoundary>
  )
}
