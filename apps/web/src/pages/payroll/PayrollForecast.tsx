/**
 * PayrollForecast — /payroll/forecast
 *
 * Predictive payroll view: projected gross/net for next month,
 * risk factors, confidence indicator, and department breakdown.
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }                          from 'react'
import { useQuery, useMutation }             from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, AlertTriangle, ShieldAlert,
  RefreshCw, DollarSign, Users, Zap, CheckCircle2,
  Clock, Loader2, Target, BarChart2,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Button }           from '@/components/ui/button'
import { Badge }            from '@/components/ui/badge'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { toast }            from 'sonner'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { ensureArray }      from '@/lib/array-utils'
import { ErrorBoundary }    from '@/components/error-boundary/ErrorBoundary'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Forecast {
  id?:                   string
  target_month:          string
  forecast_headcount:    number
  forecast_total_gross:  number
  forecast_total_net:    number
  forecast_total_ot_cost: number
  base_month:            string
  base_total_gross:      number | null
  variance_pct:          number | null
  confidence_pct:        number
  by_department:         DeptForecast[]
  risk_factors:          RiskFactor[]
  assumptions:           Assumption[]
  generated_at?:         string
}

interface DeptForecast {
  department_id:   string
  department_name: string
  headcount:       number
  forecast_gross:  number
  forecast_ot:     number
}

interface RiskFactor {
  type:          string
  description:   string
  impact_amount: number
  severity:      'medium' | 'high'
}

interface Assumption {
  key:   string
  label: string
  value: number
}

interface ForecastResponse {
  data:      Forecast
  cached:    boolean
  age_hours: number
  stale:     boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 10_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`
  if (n >= 1_000) return `₹${Math.round(n / 1_000)}K`
  return `₹${Math.round(n)}`
}

function nextMonth() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ConfidenceBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? 'bg-success' : pct >= 65 ? 'bg-warning' : 'bg-destructive'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums text-foreground">{pct}%</span>
    </div>
  )
}

const SEVERITY_BADGE: Record<string, 'warning' | 'destructive'> = {
  medium: 'warning',
  high:   'destructive',
}

// ── Main page ─────────────────────────────────────────────────────────────────

function PayrollForecastInner() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [month, setMonth]     = useState(nextMonth())
  const [generating, setGenerating] = useState(false)

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // ── Queries ──────────────────────────────────────────────────────────────

  const forecastQ = useQuery<ForecastResponse>({
    queryKey: ['payroll-forecast', month],
    queryFn:  () => api.get(`/analytics/payroll/forecast?month=${month}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const generateMut = useMutation({
    mutationFn: (targetMonth: string) =>
      api.post('/analytics/payroll/forecast/generate', { month: targetMonth }),
    onSuccess: () => { forecastQ.refetch(); toast.success('Forecast generated') },
    onError:   (e: Error) => toast.error('Error', { description: e.message }),
    onSettled: () => setGenerating(false),
  })

  // ── Access guard ─────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Payroll Forecast" subtitle="Predictive payroll projections" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const forecast  = forecastQ.data?.data
  const cached    = forecastQ.data?.cached
  const stale     = forecastQ.data?.stale
  const ageHours  = forecastQ.data?.age_hours ?? 0

  const deptChartData = (forecast?.by_department ?? []).slice(0, 8).map(d => ({
    name:  d.department_name.length > 12 ? d.department_name.slice(0, 12) + '…' : d.department_name,
    Gross: Math.round(d.forecast_gross / 1000),
    OT:    Math.round(d.forecast_ot / 1000),
  }))

  function handleGenerate() {
    setGenerating(true)
    generateMut.mutate(month)
  }

  // Month navigation
  function navigate(dir: number) {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + dir, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Forecast"
        subtitle={`Projected payroll for ${month}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(-1)}>
              ‹
            </Button>
            <span className="text-sm font-medium tabular-nums w-20 text-center">{month}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(1)}>
              ›
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 ml-2"
              onClick={handleGenerate}
              disabled={generating || generateMut.isPending}>
              {generating || generateMut.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><RefreshCw className="h-3.5 w-3.5" />Regenerate</>}
            </Button>
          </div>
        }
      />

      {/* Cache status */}
      {forecast && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md text-xs border',
          stale
            ? 'bg-warning/10 border-warning/20 text-warning'
            : 'bg-muted/30 border-border text-muted-foreground',
        )}>
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          {cached
            ? stale
              ? `Cached forecast is ${ageHours}h old (stale). Click Regenerate to refresh.`
              : `Cached forecast — ${ageHours}h old`
            : 'Freshly generated forecast'}
        </div>
      )}

      {/* Loading */}
      {forecastQ.isLoading && (
        <SectionCard>
          <div className="text-xs text-muted-foreground animate-pulse py-8 text-center">
            Loading forecast…
          </div>
        </SectionCard>
      )}

      {/* No data */}
      {!forecastQ.isLoading && !forecast && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Target className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No forecast for {month}.</p>
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleGenerate}
              disabled={generating}>
              {generating
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><Zap className="h-3.5 w-3.5" />Generate Forecast</>}
            </Button>
          </div>
        </SectionCard>
      )}

      {forecast && (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Forecast Gross',   value: fmt(forecast.forecast_total_gross),  icon: DollarSign, cls: 'text-foreground' },
              { label: 'Forecast Net',     value: fmt(forecast.forecast_total_net),    icon: CheckCircle2, cls: 'text-success' },
              { label: 'Projected OT',     value: fmt(forecast.forecast_total_ot_cost), icon: Zap, cls: 'text-warning' },
              { label: 'Headcount',        value: forecast.forecast_headcount, icon: Users, cls: 'text-info' },
            ].map(({ label, value, icon: Icon, cls }) => (
              <div key={label}
                className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
                  <Icon className={cn('h-4 w-4', cls)} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn('text-lg font-bold', cls)}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Confidence + variance row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Forecast Confidence" icon={<Target className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-3">
                <ConfidenceBar pct={forecast.confidence_pct} />
                <div className="grid grid-cols-2 gap-3">
                  {ensureArray<Assumption>(forecast.assumptions).map(a => (
                    <div key={a.key} className="bg-muted/40 rounded-md p-2">
                      <p className="text-[10px] text-muted-foreground">{a.label}</p>
                      <p className="text-xs font-medium text-foreground mt-0.5">
                        {typeof a.value === 'number' && a.key.includes('cost')
                          ? fmt(a.value)
                          : a.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="vs Prior Month" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-xs text-muted-foreground">Base ({forecast.base_month})</span>
                  <span className="font-medium">{fmt(forecast.base_total_gross)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-xs text-muted-foreground">Forecast ({forecast.target_month})</span>
                  <span className="font-medium">{fmt(forecast.forecast_total_gross)}</span>
                </div>
                {forecast.variance_pct != null && (
                  <div className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                    forecast.variance_pct > 5
                      ? 'bg-warning/10 text-warning'
                      : forecast.variance_pct < -5
                        ? 'bg-success/10 text-success'
                        : 'bg-muted/40 text-foreground',
                  )}>
                    {forecast.variance_pct > 0
                      ? <TrendingUp className="h-4 w-4" />
                      : <TrendingDown className="h-4 w-4" />}
                    {forecast.variance_pct > 0 ? '+' : ''}{forecast.variance_pct.toFixed(1)}% vs prior month
                  </div>
                )}
                {forecast.variance_pct == null && (
                  <p className="text-xs text-muted-foreground">No prior month data for comparison.</p>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Risk factors */}
          {ensureArray<RiskFactor>(forecast.risk_factors).length > 0 && (
            <SectionCard
              title="Risk Factors"
              icon={<AlertTriangle className="h-4 w-4 text-warning" />}
            >
              <div className="space-y-2">
                {ensureArray<RiskFactor>(forecast.risk_factors).map((rf, i) => (
                  <div key={i}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-3 py-2.5 border text-sm',
                      rf.severity === 'high'
                        ? 'bg-destructive/10 border-destructive/20'
                        : 'bg-warning/10 border-warning/20',
                    )}>
                    <AlertTriangle className={cn(
                      'h-4 w-4 flex-shrink-0 mt-0.5',
                      rf.severity === 'high' ? 'text-destructive' : 'text-warning',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <Badge variant={SEVERITY_BADGE[rf.severity]} className="rounded-full text-[10px]">
                          {rf.severity}
                        </Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Impact: {fmt(rf.impact_amount)}
                        </span>
                      </div>
                      <p className="text-xs text-foreground">{rf.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Dept chart */}
          {deptChartData.length > 0 && (
            <SectionCard
              title="Department Forecast"
              icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={deptChartData} barSize={14}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="name" {...axisStyle} tick={{ ...axisStyle.tick, fontSize: 9 }} />
                  <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                  <Bar dataKey="Gross" fill={getChartColor('chart1')} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="OT"    fill={getChartColor('on_notice')} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              {/* Dept table */}
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Department', 'HC', 'Forecast Gross', 'Forecast OT'].map(h => (
                        <th key={h}
                          className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ensureArray<DeptForecast>(forecast.by_department).map(d => (
                      <tr key={d.department_id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium text-foreground">{d.department_name}</td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{d.headcount}</td>
                        <td className="px-3 py-2 tabular-nums">{fmt(d.forecast_gross)}</td>
                        <td className="px-3 py-2 tabular-nums text-warning">{fmt(d.forecast_ot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  )
}

export function PayrollForecast() {
  return (
    <ErrorBoundary title="Payroll Forecast">
      <PayrollForecastInner />
    </ErrorBoundary>
  )
}
