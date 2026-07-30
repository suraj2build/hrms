/**
 * PayrollCostIntelligence — /payroll/cost-intelligence
 *
 * Department-level payroll cost analytics:
 * - Monthly cost trends (6-month rolling)
 * - OT-heavy department detection
 * - High-variance alerts
 * - Department cost breakdown with prior month comparison
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }                          from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, AlertTriangle, ShieldAlert,
  RefreshCw, DollarSign, Users, Zap, BarChart2,
  ChevronUp, ChevronDown, Minus, Loader2,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Button }           from '@/components/ui/button'
import { Badge }            from '@/components/ui/badge'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { toast }            from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CostSummary {
  month:            string
  total_gross:      number
  total_net:        number
  total_ot_cost:    number
  headcount:        number
  by_department:    DeptRow[]
}

interface DeptRow {
  department_id:   string
  department_name: string
  headcount:       number
  total_gross:     number
  total_ot_cost:   number
  ot_pct?:         number   // derived client-side if the API omits it
  ot_heavy:        boolean
  prior_gross:     number | null
  variance_pct:    number | null
}

interface TrendPoint {
  month:         string
  total_gross:   number
  total_ot_cost: number
  headcount:     number
}

interface Insight {
  type:           string
  department_id:  string | null
  department_name: string
  month:          string
  severity:       'medium' | 'high' | 'critical'
  message:        string
  value:          number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 10_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`
  if (n >= 1_000) return `₹${Math.round(n / 1_000)}K`
  return `₹${Math.round(n)}`
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' })
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const SEVERITY_VARIANT: Record<string, 'warning' | 'destructive'> = {
  medium: 'warning',
  high:   'destructive',
  critical: 'destructive',
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PayrollCostIntelligence() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [month, setMonth] = useState(currentMonth())

  // ── Queries ──────────────────────────────────────────────────────────────

  const summaryQ = useQuery<{ data: CostSummary }>({
    queryKey: ['payroll-cost', month],
    queryFn:  () => api.get(`/analytics/payroll/cost?month=${month}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const trendsQ = useQuery<{ data: TrendPoint[] }>({
    queryKey: ['payroll-cost-trends'],
    queryFn:  () => api.get('/analytics/payroll/cost/trends'),
    enabled:  isAdmin,
    staleTime: 300_000,
  })

  const insightsQ = useQuery<{ data: Insight[]; emitted: number }>({
    queryKey: ['payroll-cost-insights', month],
    queryFn:  () => api.get(`/analytics/payroll/cost/insights?month=${month}`),
    enabled:  isAdmin,
    staleTime: 300_000,
  })

  const deptsQ = useQuery<{ data: DeptRow[] }>({
    queryKey: ['payroll-cost-departments', month],
    queryFn:  () => api.get(`/analytics/payroll/cost/departments?month=${month}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  // ── Backfill ───────────────────────────────────────────────────────────────
  // Rebuild payroll_dept_snapshots from every finalized run, for tenants whose
  // runs were finalized before snapshot population existed. Idempotent.
  const qc = useQueryClient()
  const backfillM = useMutation({
    mutationFn: () => api.post<{ data: { months_processed: number; rows_written: number; failed: number } }>(
      '/analytics/payroll/cost/backfill-snapshots',
    ),
    onSuccess: (res) => {
      const d = res.data
      toast.success('Department snapshots rebuilt', {
        description: `${d.months_processed} month(s) processed, ${d.rows_written} row(s) written${d.failed ? ` — ${d.failed} failed` : ''}.`,
      })
      for (const k of ['payroll-cost', 'payroll-cost-trends', 'payroll-cost-insights', 'payroll-cost-departments']) {
        qc.invalidateQueries({ queryKey: [k] })
      }
    },
    onError: (e: Error) => toast.error('Backfill failed', { description: e.message }),
  })

  // ── Access guard ─────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Payroll Cost Intelligence" subtitle="Department-level cost analytics" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const summary  = summaryQ.data?.data
  const trends   = trendsQ.data?.data ?? []
  const insights = insightsQ.data?.data ?? []
  const depts    = deptsQ.data?.data ?? []

  // Month navigation
  function navigate(dir: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Chart data
  const trendChartData = trends.map(t => ({
    month:     monthLabel(t.month),
    Gross:     Math.round(t.total_gross / 1000),
    OT:        Math.round(t.total_ot_cost / 1000),
    Headcount: t.headcount,
  }))

  const deptChartData = depts.slice(0, 8).map(d => ({
    name:  d.department_name.length > 12 ? d.department_name.slice(0, 12) + '…' : d.department_name,
    Gross: Math.round(d.total_gross / 1000),
    OT:    Math.round(d.total_ot_cost / 1000),
  }))

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Cost Intelligence"
        subtitle="Department-level cost trends, OT analysis, and variance insights"
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)}>
              <ChevronDown className="h-4 w-4 rotate-90" />
            </Button>
            <span className="text-sm font-medium tabular-nums w-20 text-center">{month}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8"
              onClick={() => navigate(1)}
              disabled={month >= currentMonth()}>
              <ChevronUp className="h-4 w-4 rotate-90" />
            </Button>
          </div>
        }
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Gross',
            value: fmt(summary?.total_gross),
            icon:  DollarSign,
            cls:   'text-foreground',
            loading: summaryQ.isLoading,
          },
          {
            label: 'Total OT Cost',
            value: fmt(summary?.total_ot_cost),
            icon:  Zap,
            cls:   'text-warning',
            loading: summaryQ.isLoading,
          },
          {
            label: 'Headcount',
            value: summary?.headcount ?? '—',
            icon:  Users,
            cls:   'text-info',
            loading: summaryQ.isLoading,
          },
          {
            label: 'Active Insights',
            value: insights.length,
            icon:  AlertTriangle,
            cls:   insights.length > 0 ? 'text-warning' : 'text-success',
            loading: insightsQ.isLoading,
          },
        ].map(({ label, value, icon: Icon, cls, loading }) => (
          <div key={label}
            className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
              <Icon className={cn('h-4 w-4', cls)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('text-lg font-bold', cls, loading && 'animate-pulse text-muted')}>
                {loading ? '…' : value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Insights panel */}
      {insights.length > 0 && (
        <SectionCard
          title="Active Alerts"
          icon={<AlertTriangle className="h-4 w-4 text-warning" />}
        >
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div key={i}
                className={cn(
                  'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm border',
                  ins.severity === 'critical' || ins.severity === 'high'
                    ? 'bg-destructive/10 border-destructive/20'
                    : 'bg-warning/10 border-warning/20',
                )}>
                <AlertTriangle className={cn(
                  'h-4 w-4 flex-shrink-0 mt-0.5',
                  ins.severity === 'critical' || ins.severity === 'high'
                    ? 'text-destructive' : 'text-warning',
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={SEVERITY_VARIANT[ins.severity] ?? 'warning'}
                      className="rounded-full text-[10px]">
                      {ins.severity}
                    </Badge>
                    <span className="text-xs font-medium text-foreground">{ins.department_name}</span>
                    <span className="text-xs text-muted-foreground">{ins.month}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{ins.message}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Trend charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 6-month gross + OT trend */}
        <SectionCard
          title="6-Month Cost Trend"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        >
          {trendsQ.isLoading
            ? <div className="h-40 bg-muted/30 animate-pulse rounded-md" />
            : trendChartData.length === 0
              ? <p className="text-xs text-muted-foreground py-8 text-center">No trend data available.</p>
              : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendChartData}>
                    <CartesianGrid {...gridStyle} />
                    <XAxis dataKey="month" {...axisStyle} />
                    <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="Gross"
                      stroke={getChartColor('chart1')} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="OT"
                      stroke={getChartColor('on_notice')} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )
          }
        </SectionCard>

        {/* Dept cost bar chart */}
        <SectionCard
          title="Department Cost Breakdown"
          icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
        >
          {deptsQ.isLoading
            ? <div className="h-40 bg-muted/30 animate-pulse rounded-md" />
            : deptChartData.length === 0
              ? <p className="text-xs text-muted-foreground py-8 text-center">No department data.</p>
              : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={deptChartData} barSize={14}>
                    <CartesianGrid {...gridStyle} />
                    <XAxis dataKey="name" {...axisStyle} tick={{ ...axisStyle.tick, fontSize: 9 }} />
                    <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Gross" fill={getChartColor('chart1')} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="OT"    fill={getChartColor('on_notice')} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
          }
        </SectionCard>
      </div>

      {/* Dept table */}
      <SectionCard
        title={`Department Details — ${month}`}
        icon={<Users className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7"
              onClick={() => backfillM.mutate()} disabled={backfillM.isPending}
              title="Rebuild department cost snapshots from all finalized payroll runs">
              {backfillM.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5">Backfill snapshots</span>
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => deptsQ.refetch()} title="Refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        {deptsQ.isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        )}
        {!deptsQ.isLoading && depts.length === 0 && (
          <p className="text-xs text-muted-foreground py-6 text-center">
            No department data for {month}. Run payroll first.
          </p>
        )}
        {!deptsQ.isLoading && depts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Department', 'HC', 'Gross', 'OT Cost', 'OT %', 'vs Prior', ''].map(h => (
                    <th key={h}
                      className="text-left text-xs font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {depts.map(dept => (
                  <tr key={dept.department_id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{dept.department_name}</span>
                        {dept.ot_heavy && (
                          <Badge variant="warning" className="rounded-full text-[9px]">OT Heavy</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{dept.headcount}</td>
                    <td className="px-3 py-2 font-medium text-foreground tabular-nums">
                      {fmt(dept.total_gross)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <span className={dept.ot_heavy ? 'text-warning font-medium' : 'text-muted-foreground'}>
                        {fmt(dept.total_ot_cost)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {(dept.ot_pct ?? (dept.total_gross > 0 ? (dept.total_ot_cost / dept.total_gross) * 100 : 0)).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {dept.variance_pct == null
                        ? <span className="text-muted-foreground">—</span>
                        : (
                          <span className={cn(
                            'flex items-center gap-0.5 font-medium',
                            dept.variance_pct > 5 ? 'text-warning'
                            : dept.variance_pct < -5 ? 'text-success'
                            : 'text-muted-foreground',
                          )}>
                            {dept.variance_pct > 0
                              ? <TrendingUp className="h-3 w-3" />
                              : dept.variance_pct < 0
                                ? <TrendingDown className="h-3 w-3" />
                                : <Minus className="h-3 w-3" />}
                            {dept.variance_pct > 0 ? '+' : ''}{dept.variance_pct.toFixed(1)}%
                          </span>
                        )
                      }
                    </td>
                    <td className="px-3 py-2">
                      {dept.variance_pct != null && Math.abs(dept.variance_pct) > 15 && (
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
