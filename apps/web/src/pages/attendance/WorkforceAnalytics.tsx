/**
 * WorkforceAnalytics — /admin/analytics/workforce
 *
 * Operational attendance analytics dashboard.
 * Shows absenteeism trends, leave utilization, reliability scores,
 * late arrival patterns, and overtime distribution.
 *
 * Uses the existing:
 *  GET /attendance/payroll-summary?month=YYYY-MM   → aggregate summary
 *  GET /attendance/muster?month=YYYY-MM            → per-employee per-day grid
 *  GET /overtime/requests                          → OT data
 *  GET /attendance/anomalies                       → anomaly counts
 */

import { useState, useMemo, useCallback }  from 'react'
import { useQuery }                         from '@tanstack/react-query'
import { useSearchParams }                  from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Users,
  AlertTriangle, CheckCircle2, ShieldAlert,
  ChevronLeft, ChevronRight, Calendar,
  Activity, Zap, Clock, Search,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import {
  getChartColor,
  getAxisStyle,
  getGridStyle,
  getTooltipStyle,
} from '@/components/ui/chart'
import { cn }              from '@/lib/utils'
import { ErrorBoundary }   from '@/components/error-boundary/ErrorBoundary'
import {
  InvestigationPanel,
  type DrillTarget,
  type DrillMetric,
} from '@/components/operational/InvestigationPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface MusterDay {
  date:        string
  status:      string | null
  work_hours:  number
  late_minutes: number
}

interface MusterEmployee {
  employee_id:   string
  employee_code: string
  name:          string
  days:          MusterDay[]
}

interface PayrollSummary {
  total_employees:   number
  total_payable_days: number
  total_lop_days:    number
  avg_work_hours:    number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

const STATUS_COLOR: Record<string, string> = {
  present:    getChartColor('active'),
  late:       getChartColor('probation'),
  absent:     getChartColor('separated'),
  half_day:   getChartColor('inactive'),
  holiday:    getChartColor('chart1'),
  weekly_off: getChartColor('chart2'),
  leave:      getChartColor('chart3'),
}

// ── Reliability Score ─────────────────────────────────────────────────────────

interface ReliabilityEntry {
  name:         string
  code:         string
  score:        number
  present:      number
  late:         number
  absent:       number
  total:        number
}

function computeReliabilityScore(days: MusterDay[]): number {
  const workDays = days.filter(d =>
    d.status && !['holiday', 'weekly_off', 'weekend'].includes(d.status)
  )
  if (!workDays.length) return 100
  const present = workDays.filter(d => d.status === 'present').length
  const late    = workDays.filter(d => d.status === 'late').length
  const half    = workDays.filter(d => d.status === 'half_day').length
  return Math.round(((present + late * 0.8 + half * 0.5) / workDays.length) * 100)
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, trend, cls }: {
  label: string; value: string | number; sub?: string
  trend?: 'up' | 'down'; cls?: string
}) {
  return (
    <div className="surface-premium lift-hover p-4">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold mt-0.5 tabular-nums', cls)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      {trend && (
        <div className={cn('flex items-center gap-1 text-[10px] mt-1', trend === 'up' ? 'text-success' : 'text-destructive')}>
          {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trend === 'up' ? 'Improving' : 'Needs attention'}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Default investigation date range (last 4 weeks) ───────────────────────────

function defaultDrillRange(): { from: string; to: string } {
  const to  = new Date().toISOString().slice(0, 10)
  const d   = new Date(); d.setDate(d.getDate() - 28)
  return { from: d.toISOString().slice(0, 10), to }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WorkforceAnalyticsInner() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const [search, setSearch] = useState('')

  // ── Investigation state — persisted in URL search params ─────────────────
  const [searchParams, setSearchParams] = useSearchParams()

  const investigation = useMemo((): DrillTarget | null => {
    const metric = searchParams.get('drill_metric') as DrillMetric | null
    const from   = searchParams.get('drill_from')
    const to     = searchParams.get('drill_to')
    const week   = searchParams.get('drill_week') ?? undefined
    const label  = searchParams.get('drill_label') ?? ''
    if (!metric || !from || !to) return null
    return { metric, from, to, week, label }
  }, [searchParams])

  const openInvestigation = useCallback((target: DrillTarget) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('drill_metric', target.metric)
      next.set('drill_from',   target.from)
      next.set('drill_to',     target.to)
      next.set('drill_label',  target.label)
      if (target.week) next.set('drill_week', target.week)
      else             next.delete('drill_week')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const closeInvestigation = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('drill_metric')
      next.delete('drill_from')
      next.delete('drill_to')
      next.delete('drill_week')
      next.delete('drill_label')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const { data: musterData, isLoading: musterLoading } = useQuery<{
    month: string; employees: MusterEmployee[]
  }>({
    queryKey: ['muster', month],
    queryFn:  () => api.get(`/attendance/muster?month=${month}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: payrollData, isLoading: summaryLoading } = useQuery<{ summary: PayrollSummary }>({
    queryKey: ['payroll-summary', month],
    queryFn:  () => api.get(`/attendance/payroll-summary?month=${month}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: anomalyData } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['anomalies-count', month],
    queryFn:  () => api.get(`/attendance/anomalies?month=${month}&resolved=false`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  // ── New intelligence API — 4-week operational summary ─────────────────────
  const { data: intelligenceSummary } = useQuery<{
    range: { from: string; to: string }
    attendance:  { total_records: number; absent_rate: number; late_rate: number; on_leave_rate: number }
    overtime:    { employees_with_ot: number; total_ot_minutes: number }
    staffing_pressure: number
    unresolved_anomalies: number
  }>({
    queryKey: ['workforce-intelligence-summary'],
    queryFn:  () => api.get('/analytics/workforce/summary'),
    enabled:  isAdmin,
    staleTime: 300_000,
  })

  // ── Absenteeism trend (weekly buckets from backend) ────────────────────────
  const { data: absenteeismData } = useQuery<{
    range: { from: string; to: string }
    buckets: Array<{ week: string; present: number; absent: number; total: number; absent_rate: number; late_rate: number }>
    summary: { total_records: number; total_absent: number; overall_absent_rate: number }
  }>({
    queryKey: ['workforce-absenteeism'],
    queryFn:  () => api.get('/analytics/workforce/absenteeism'),
    enabled:  isAdmin,
    staleTime: 300_000,
  })

  const employees  = musterData?.employees ?? []
  const payrollSum = payrollData?.summary
  const anomalyCount = Array.isArray(anomalyData?.data) ? anomalyData!.data.length : 0

  // ── Compute derived analytics ───────────────────────────────────────────────

  const analytics = useMemo(() => {
    if (!employees.length) return null

    // Status distribution across all employees × days
    const statusCounts: Record<string, number> = {}
    let   totalLateMinutes = 0
    let   totalWorkHours   = 0
    let   totalDaysWithData = 0

    for (const emp of employees) {
      for (const d of emp.days) {
        if (!d.status) continue
        statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1
        totalLateMinutes += d.late_minutes ?? 0
        totalWorkHours   += d.work_hours   ?? 0
        totalDaysWithData++
      }
    }

    const totalPresent = (statusCounts.present ?? 0) + (statusCounts.late ?? 0)
    const totalAbsent  = statusCounts.absent  ?? 0
    const totalLeave   = statusCounts.leave   ?? 0

    const attendanceRate = totalDaysWithData > 0
      ? ((totalPresent / totalDaysWithData) * 100).toFixed(1)
      : '—'

    const absentRate = totalDaysWithData > 0
      ? ((totalAbsent / totalDaysWithData) * 100).toFixed(1)
      : '—'

    const avgLateMin = totalPresent > 0
      ? Math.round(totalLateMinutes / totalPresent)
      : 0

    // Status pie data
    const pieData = Object.entries(statusCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    // Daily attendance trend (count of present per day)
    const allDates = employees[0]?.days.map(d => d.date) ?? []
    const dailyTrend = allDates.map(date => {
      const p = employees.filter(e => {
        const d = e.days.find(d => d.date === date)
        return d?.status === 'present' || d?.status === 'late'
      }).length
      const a = employees.filter(e => {
        const d = e.days.find(d => d.date === date)
        return d?.status === 'absent'
      }).length
      return { date: date.slice(5), present: p, absent: a }
    })

    // Reliability scores
    const reliability: ReliabilityEntry[] = employees.map(emp => {
      const workDays = emp.days.filter(d =>
        d.status && !['holiday', 'weekly_off', 'weekend'].includes(d.status)
      )
      return {
        name:    emp.name,
        code:    emp.employee_code,
        score:   computeReliabilityScore(emp.days),
        present: workDays.filter(d => d.status === 'present').length,
        late:    workDays.filter(d => d.status === 'late').length,
        absent:  workDays.filter(d => d.status === 'absent').length,
        total:   workDays.length,
      }
    }).sort((a, b) => a.score - b.score)

    // Leave utilization (employees with leave days)
    const leaveBar = employees
      .map(e => ({
        name: e.name.split(' ')[0],
        days: e.days.filter(d => d.status === 'leave').length,
      }))
      .filter(e => e.days > 0)
      .sort((a, b) => b.days - a.days)
      .slice(0, 15)

    return {
      statusCounts, pieData, dailyTrend, reliability,
      leaveBar, attendanceRate, absentRate, avgLateMin,
      totalPresent, totalAbsent, totalLeave,
    }
  }, [employees])

  const axisStyle   = getAxisStyle()
  const gridStyle   = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  const filteredReliability = analytics?.reliability.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.code.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Workforce Analytics" subtitle="Attendance and leave intelligence" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Workforce Analytics"
        subtitle={`Attendance intelligence dashboard — ${monthLabel(month)}`}
      />

      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(prevMonth(month))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium min-w-[160px] text-center">{monthLabel(month)}</span>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(nextMonth(month))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* ── 4-Week Intelligence Snapshot (each card drills into the metric) ── */}
      {intelligenceSummary && (() => {
        const range = defaultDrillRange()
        const summaryCards = [
          {
            label:  'Absent Rate (4wk)',
            value:  `${intelligenceSummary.attendance.absent_rate}%`,
            icon:   TrendingDown,
            cls:    intelligenceSummary.attendance.absent_rate > 10 ? 'text-destructive' : 'text-success',
            sub:    `${intelligenceSummary.attendance.total_records} records`,
            metric: 'absent' as DrillMetric,
            drillLabel: `Absent Rate · last 4 weeks`,
          },
          {
            label:  'Employees w/ OT',
            value:  intelligenceSummary.overtime.employees_with_ot,
            icon:   Clock,
            cls:    'text-warning',
            sub:    `${Math.round(intelligenceSummary.overtime.total_ot_minutes / 60)}h total OT`,
            metric: 'ot' as DrillMetric,
            drillLabel: `Overtime Dependency · last 4 weeks`,
          },
          {
            label:  'Staffing Pressure',
            value:  intelligenceSummary.staffing_pressure,
            icon:   Zap,
            cls:    intelligenceSummary.staffing_pressure > 20 ? 'text-destructive' : 'text-muted-foreground',
            sub:    'worked on off/holiday',
            metric: 'pressure' as DrillMetric,
            drillLabel: `Staffing Pressure · last 4 weeks`,
          },
          {
            label:  'Unresolved Anomalies',
            value:  intelligenceSummary.unresolved_anomalies,
            icon:   AlertTriangle,
            cls:    intelligenceSummary.unresolved_anomalies > 0 ? 'text-warning' : 'text-success',
            sub:    intelligenceSummary.unresolved_anomalies > 0 ? 'Needs review' : 'All clear',
            metric: null,   // anomalies don't map to a drill metric
            drillLabel: '',
          },
        ]
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {summaryCards.map(({ label, value, icon: Icon, cls, sub, metric: m, drillLabel }) => (
              <button
                key={label}
                onClick={m ? () => openInvestigation({ metric: m, ...range, label: drillLabel }) : undefined}
                disabled={!m}
                className={cn(
                  'text-left transition-all',
                  m && 'cursor-pointer group',
                  !m && 'cursor-default',
                )}
              >
                <div className={cn('surface-premium p-4 transition-all', m && 'group-hover:-translate-y-0.5 group-hover:ring-1 group-hover:ring-primary/30')}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground">{label}</p>
                    </div>
                    {m && (
                      <Search className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                  <p className={cn('text-2xl font-bold tabular-nums', cls)}>{value}</p>
                  {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
                  {m && (
                    <p className="text-[10px] text-primary mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Click to investigate →
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )
      })()}

      {/* ── Backend Absenteeism Trend (weekly — click a data point to drill) ── */}
      {absenteeismData && Array.isArray(absenteeismData.buckets) && absenteeismData.buckets.length > 0 && (
        <SectionCard
          title="Absenteeism Trend (Last 12 Weeks)"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          action={
            <span className="text-[10px] text-muted-foreground">
              Click a data point to investigate
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart
              data={absenteeismData.buckets}
              onClick={(payload) => {
                if (!payload?.activePayload?.[0]) return
                const week = (payload.activePayload[0].payload as { week: string }).week
                const bucket = absenteeismData.buckets.find(b => b.week === week)
                if (!bucket) return
                // Compute approximate date bounds from week label
                openInvestigation({
                  metric: 'absent',
                  from:   absenteeismData.range.from,
                  to:     absenteeismData.range.to,
                  week,
                  label:  `Absent Rate · ${week}  (${bucket.absent_rate}%)`,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid {...gridStyle} />
              <XAxis
                dataKey="week"
                tick={{ ...axisStyle.tick, fontSize: 9 }}
                axisLine={axisStyle.axisLine}
                tickLine={axisStyle.tickLine}
              />
              <YAxis
                tick={axisStyle.tick}
                axisLine={axisStyle.axisLine}
                tickLine={axisStyle.tickLine}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v}%`]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="absent_rate"
                stroke={STATUS_COLOR.absent}
                strokeWidth={2}
                dot={{ r: 3, fill: STATUS_COLOR.absent, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 2 }}
                name="Absent Rate %"
              />
              <Line
                type="monotone"
                dataKey="late_rate"
                stroke={STATUS_COLOR.late}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                name="Late Rate %"
                onClick={(data: unknown) => {
                  const pt = (data as { payload?: { week: string; late_rate: number } })?.payload
                  if (!pt) return
                  openInvestigation({
                    metric: 'late',
                    from:   absenteeismData.range.from,
                    to:     absenteeismData.range.to,
                    week:   pt.week,
                    label:  `Late Rate · ${pt.week}  (${pt.late_rate}%)`,
                  })
                }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <span>Overall absent rate: <strong className="text-foreground">{absenteeismData.summary.overall_absent_rate}%</strong></span>
            <span>Records analysed: <strong className="text-foreground">{(absenteeismData.summary.total_records ?? 0).toLocaleString()}</strong></span>
          </div>
        </SectionCard>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Attendance Rate"
          value={`${analytics?.attendanceRate ?? '—'}%`}
          sub={`${analytics?.totalPresent ?? 0} present days`}
          cls={parseFloat(analytics?.attendanceRate ?? '0') >= 90 ? 'text-success' : 'text-warning'}
          trend={parseFloat(analytics?.attendanceRate ?? '0') >= 90 ? 'up' : 'down'}
        />
        <StatCard
          label="Absenteeism Rate"
          value={`${analytics?.absentRate ?? '—'}%`}
          sub={`${analytics?.totalAbsent ?? 0} absent days`}
          cls={parseFloat(analytics?.absentRate ?? '0') <= 5 ? 'text-success' : 'text-destructive'}
        />
        <StatCard
          label="Leave Days Used"
          value={analytics?.totalLeave ?? '—'}
          sub="across all employees"
          cls="text-info"
        />
        <StatCard
          label="Avg Late (min)"
          value={analytics?.avgLateMin ?? '—'}
          sub="per late arrival"
          cls={(analytics?.avgLateMin ?? 0) > 30 ? 'text-warning' : 'text-foreground'}
        />
      </div>

      {musterLoading || summaryLoading ? (
        <SectionCard>
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Calendar className="h-8 w-8 opacity-30 animate-pulse" />
            <p className="text-sm">Loading analytics…</p>
          </div>
        </SectionCard>
      ) : !analytics ? (
        <SectionCard>
          <div className="flex flex-col items-center py-20 gap-3 text-muted-foreground">
            <Calendar className="h-10 w-10 opacity-30" />
            <p className="text-sm">No attendance data for this period.</p>
          </div>
        </SectionCard>
      ) : (
        <>
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Daily attendance trend */}
            <SectionCard
              title="Daily Attendance Trend"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              action={
                <span className="text-[10px] text-muted-foreground">Click to investigate</span>
              }
            >
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={analytics.dailyTrend}
                  onClick={(payload) => {
                    if (!payload?.activePayload?.[0]) return
                    const pt = payload.activePayload[0].payload as { date: string; present: number; absent: number }
                    // date is MM-DD; reconstruct full date for this month
                    const fullDate = `${month}-${pt.date.slice(-2)}`
                    const metric: DrillMetric = pt.absent > pt.present ? 'absent' : 'absent'
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to   = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({
                      metric,
                      from, to,
                      label: `Absent / Present · ${fullDate}  (${pt.absent} absent, ${pt.present} present)`,
                    })
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="date" tick={axisStyle.tick} axisLine={axisStyle.axisLine} tickLine={axisStyle.tickLine} />
                  <YAxis tick={axisStyle.tick} axisLine={axisStyle.axisLine} tickLine={axisStyle.tickLine} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="present" stroke={STATUS_COLOR.present} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Present" />
                  <Line type="monotone" dataKey="absent"  stroke={STATUS_COLOR.absent}  strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Absent" />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>

            {/* Status distribution pie */}
            <SectionCard
              title="Status Distribution"
              icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
            >
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={analytics.pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {analytics.pieData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLOR[entry.name] ?? getChartColor('inactive')} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          {/* Leave utilization bar */}
          {analytics.leaveBar.length > 0 && (
            <SectionCard
              title="Leave Utilization (Top Employees)"
              icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to   = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({
                      metric: 'leave',
                      from, to,
                      label: `Leave Utilization · ${monthLabel(month)}`,
                    })
                  }}
                >
                  <Search className="h-3 w-3" />
                  Investigate All
                </Button>
              }
            >
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={analytics.leaveBar}
                  layout="vertical"
                  onClick={() => {
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to   = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({
                      metric: 'leave',
                      from, to,
                      label: `Leave Utilization · ${monthLabel(month)}`,
                    })
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid {...gridStyle} />
                  <XAxis type="number" tick={axisStyle.tick} axisLine={axisStyle.axisLine} tickLine={axisStyle.tickLine} />
                  <YAxis type="category" dataKey="name" tick={axisStyle.tick} axisLine={axisStyle.axisLine} tickLine={axisStyle.tickLine} width={70} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="days" fill={STATUS_COLOR.leave} name="Leave Days" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>
          )}

          {/* Reliability Table */}
          <SectionCard
            title="Employee Reliability Scores"
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search employee…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none w-36"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to   = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({
                      metric: 'reliability',
                      from, to,
                      label:  `Reliability Scores · ${monthLabel(month)}`,
                    })
                  }}
                >
                  <Search className="h-3 w-3" />
                  Investigate
                </Button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Score', 'Present', 'Late', 'Absent', 'Work Days'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredReliability.map(e => (
                    <tr key={e.code} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{e.name}</p>
                        <p className="text-[10px] text-muted-foreground">{e.code}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden max-w-[60px]">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                e.score >= 90 ? 'bg-success' : e.score >= 70 ? 'bg-warning' : 'bg-destructive',
                              )}
                              style={{ width: `${e.score}%` }}
                            />
                          </div>
                          <Badge
                            variant={e.score >= 90 ? 'success' : e.score >= 70 ? 'warning' : 'destructive'}
                            className="rounded-full text-[10px]"
                          >
                            {e.score}%
                          </Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-success">{e.present}</td>
                      <td className="px-3 py-2 tabular-nums text-warning">{e.late}</td>
                      <td className="px-3 py-2 tabular-nums text-destructive">{e.absent}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{e.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Anomaly alert */}
          {anomalyCount > 0 && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/20 text-warning">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">{anomalyCount} unresolved anomaly(ies) this month</p>
                <p className="text-xs opacity-80">Review attendance anomalies to ensure data accuracy before payroll.</p>
              </div>
            </div>
          )}

          {/* Payroll summary footer */}
          {payrollSum && (
            <SectionCard>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Total Employees', value: payrollSum.total_employees,   cls: 'text-foreground' },
                  { label: 'Payable Days',    value: payrollSum.total_payable_days, cls: 'text-success' },
                  { label: 'LOP Days',        value: payrollSum.total_lop_days,    cls: 'text-destructive' },
                  { label: 'Avg Hours/Day',   value: payrollSum.avg_work_hours?.toFixed(1) ?? '—', cls: 'text-info' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className={cn('text-xl font-bold', cls)}>{value}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {/* ── Investigation Panel — slide-over for any drilldown ─────────── */}
      <InvestigationPanel
        target={investigation}
        onClose={closeInvestigation}
      />
    </PageContainer>
  )
}

export function WorkforceAnalytics() {
  return (
    <ErrorBoundary title="Workforce Analytics">
      <WorkforceAnalyticsInner />
    </ErrorBoundary>
  )
}
