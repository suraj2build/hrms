/**
 * WorkforceAnalytics — /admin/analytics/workforce (also embedded as the
 * Executive "Headcount" tab).
 *
 * Operational attendance analytics dashboard, on the shared BI canvas.
 * Shows absenteeism trends, leave utilization, reliability scores,
 * late arrival patterns, and overtime distribution — with click-to-investigate
 * drilldowns preserved throughout.
 *
 * Uses the existing:
 *  GET /attendance/payroll-summary?month=YYYY-MM   → aggregate summary
 *  GET /attendance/muster?month=YYYY-MM            → per-employee per-day grid
 *  GET /attendance/anomalies                       → anomaly counts
 *  GET /analytics/workforce/summary | /absenteeism → 4-week intelligence
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Users,
  AlertTriangle, CheckCircle2, ShieldAlert,
  ChevronLeft, ChevronRight, Calendar,
  Activity, Zap, Clock, Search,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { getChartColor } from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary/ErrorBoundary'
import { KpiCard } from '@/components/exec/KpiCard'
import { Viz, DonutBlock, ChartTip, NoData, MiniStat } from '@/components/exec/viz'
import { GRID, AXIS } from '@/components/exec/exec-utils'
import {
  InvestigationPanel,
  type DrillTarget,
  type DrillMetric,
} from '@/components/operational/InvestigationPanel'

// ── Types ──────────────────────────────────────────────────────────────────────

interface MusterDay {
  date: string
  status: string | null
  work_hours: number
  late_minutes: number
}

interface MusterEmployee {
  employee_id: string
  employee_code: string
  name: string
  days: MusterDay[]
}

interface PayrollSummary {
  total_employees: number
  total_payable_days: number
  total_lop_days: number
  avg_work_hours: number
}

type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'info'

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
  present: getChartColor('active'),
  late: getChartColor('probation'),
  absent: getChartColor('separated'),
  half_day: getChartColor('inactive'),
  holiday: getChartColor('chart1'),
  weekly_off: getChartColor('chart2'),
  leave: getChartColor('chart3'),
}

// ── Reliability Score ─────────────────────────────────────────────────────────

interface ReliabilityEntry {
  name: string
  code: string
  score: number
  present: number
  late: number
  absent: number
  total: number
}

function computeReliabilityScore(days: MusterDay[]): number {
  const workDays = days.filter(d =>
    d.status && !['holiday', 'weekly_off', 'weekend'].includes(d.status)
  )
  if (!workDays.length) return 100
  const present = workDays.filter(d => d.status === 'present').length
  const late = workDays.filter(d => d.status === 'late').length
  const half = workDays.filter(d => d.status === 'half_day').length
  return Math.round(((present + late * 0.8 + half * 0.5) / workDays.length) * 100)
}

// ── Default investigation date range (last 4 weeks) ───────────────────────────

function defaultDrillRange(): { from: string; to: string } {
  const to = new Date().toISOString().slice(0, 10)
  const d = new Date(); d.setDate(d.getDate() - 28)
  return { from: d.toISOString().slice(0, 10), to }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function WorkforceAnalyticsInner({ embedded = false }: { embedded?: boolean }) {
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
    const from = searchParams.get('drill_from')
    const to = searchParams.get('drill_to')
    const week = searchParams.get('drill_week') ?? undefined
    const label = searchParams.get('drill_label') ?? ''
    if (!metric || !from || !to) return null
    return { metric, from, to, week, label }
  }, [searchParams])

  const openInvestigation = useCallback((target: DrillTarget) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('drill_metric', target.metric)
      next.set('drill_from', target.from)
      next.set('drill_to', target.to)
      next.set('drill_label', target.label)
      if (target.week) next.set('drill_week', target.week)
      else next.delete('drill_week')
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
    queryFn: () => api.get(`/attendance/muster?month=${month}`),
    enabled: isAdmin,
    staleTime: 120_000,
  })

  const { data: payrollData, isLoading: summaryLoading } = useQuery<{ summary: PayrollSummary }>({
    queryKey: ['payroll-summary', month],
    queryFn: () => api.get(`/attendance/payroll-summary?month=${month}`),
    enabled: isAdmin,
    staleTime: 120_000,
  })

  const { data: anomalyData } = useQuery<{ data: unknown[]; total?: number }>({
    queryKey: ['anomalies-count', month],
    queryFn: () => api.get(`/attendance/anomalies?month=${month}&resolved=false`),
    enabled: isAdmin,
    staleTime: 120_000,
  })

  // ── New intelligence API — 4-week operational summary ─────────────────────
  const { data: intelligenceSummary } = useQuery<{
    range: { from: string; to: string }
    attendance: { total_records: number; absent_rate: number; absent_only_rate: number; late_rate: number; on_leave_rate: number }
    overtime: { employees_with_ot: number; total_ot_minutes: number }
    staffing_pressure: number
    unresolved_anomalies: number
  }>({
    queryKey: ['workforce-intelligence-summary'],
    queryFn: () => api.get('/analytics/workforce/summary'),
    enabled: isAdmin,
    staleTime: 300_000,
  })

  // ── Absenteeism trend (weekly buckets from backend) ────────────────────────
  const { data: absenteeismData } = useQuery<{
    range: { from: string; to: string }
    buckets: Array<{ week: string; present: number; absent: number; total: number; absent_rate: number; late_rate: number }>
    summary: { total_records: number; total_absent: number; overall_absent_rate: number }
  }>({
    queryKey: ['workforce-absenteeism'],
    queryFn: () => api.get('/analytics/workforce/absenteeism'),
    enabled: isAdmin,
    staleTime: 300_000,
  })

  const employees = useMemo(() => musterData?.employees ?? [], [musterData])
  const payrollSum = payrollData?.summary
  const anomalyCount = Array.isArray(anomalyData?.data) ? anomalyData!.data.length : 0

  // ── Compute derived analytics ───────────────────────────────────────────────

  const analytics = useMemo(() => {
    if (!employees.length) return null

    const statusCounts: Record<string, number> = {}
    let totalLateMinutes = 0
    let totalDaysWithData = 0

    for (const emp of employees) {
      for (const d of emp.days) {
        if (!d.status) continue
        statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1
        totalLateMinutes += d.late_minutes ?? 0
        totalDaysWithData++
      }
    }

    const totalPresent = (statusCounts.present ?? 0) + (statusCounts.late ?? 0)
    const totalAbsent = statusCounts.absent ?? 0
    const totalLeave = statusCounts.leave ?? 0

    const attendanceRate = totalDaysWithData > 0 ? ((totalPresent / totalDaysWithData) * 100).toFixed(1) : '—'
    const absentRate = totalDaysWithData > 0 ? ((totalAbsent / totalDaysWithData) * 100).toFixed(1) : '—'
    const avgLateMin = totalPresent > 0 ? Math.round(totalLateMinutes / totalPresent) : 0

    const pieData = Object.entries(statusCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    const allDates = employees[0]?.days?.map(d => d.date) ?? []
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

    const reliability: ReliabilityEntry[] = employees.map(emp => {
      const workDays = emp.days.filter(d =>
        d.status && !['holiday', 'weekly_off', 'weekend'].includes(d.status)
      )
      return {
        name: emp.name,
        code: emp.employee_code,
        score: computeReliabilityScore(emp.days),
        present: workDays.filter(d => d.status === 'present').length,
        late: workDays.filter(d => d.status === 'late').length,
        absent: workDays.filter(d => d.status === 'absent').length,
        total: workDays.length,
      }
    }).sort((a, b) => a.score - b.score)

    const leaveBar = employees
      .map(e => ({ name: e.name.split(' ')[0], days: e.days.filter(d => d.status === 'leave').length }))
      .filter(e => e.days > 0)
      .sort((a, b) => b.days - a.days)
      .slice(0, 15)

    return {
      statusCounts, pieData, dailyTrend, reliability,
      leaveBar, attendanceRate, absentRate, avgLateMin,
      totalPresent, totalAbsent, totalLeave,
    }
  }, [employees])

  const filteredReliability = analytics?.reliability.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.code.toLowerCase().includes(search.toLowerCase())
  ) ?? []

  const donutData = useMemo(() => (analytics?.pieData ?? []).map(d => ({
    name: d.name.replace(/_/g, ' '), value: d.value, color: STATUS_COLOR[d.name] ?? getChartColor('inactive'),
  })), [analytics])
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Workforce Analytics" subtitle="Attendance and leave intelligence" />
        <Viz title="Access Restricted">
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
          </div>
        </Viz>
      </PageContainer>
    )
  }

  return (
    <PageContainer className={cn('space-y-5', embedded && 'p-0')}>
      {!embedded && (
        <PageHeader title="Workforce Analytics" subtitle={`Attendance intelligence dashboard — ${monthLabel(month)}`} />
      )}

      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(prevMonth(month))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[160px] text-center text-sm font-medium">{monthLabel(month)}</span>
        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setMonth(nextMonth(month))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* 4-week intelligence snapshot — each card drills into the metric */}
      {intelligenceSummary && (() => {
        const range = defaultDrillRange()
        const cards: Array<{ label: string; value: string | number; icon: typeof Clock; tone: Tone; sub: string; metric: DrillMetric | null; drillLabel: string }> = [
          { label: 'Absent Rate · 4wk', value: `${intelligenceSummary.attendance.absent_rate}%`, icon: TrendingDown, tone: intelligenceSummary.attendance.absent_rate > 10 ? 'destructive' : 'success', sub: `${intelligenceSummary.attendance.total_records} records`, metric: 'absent', drillLabel: 'Absent Rate · last 4 weeks' },
          { label: 'Employees w/ OT', value: intelligenceSummary.overtime.employees_with_ot, icon: Clock, tone: 'warning', sub: `${Math.round(intelligenceSummary.overtime.total_ot_minutes / 60)}h total OT`, metric: 'ot', drillLabel: 'Overtime Dependency · last 4 weeks' },
          { label: 'Staffing Pressure', value: intelligenceSummary.staffing_pressure, icon: Zap, tone: intelligenceSummary.staffing_pressure > 20 ? 'destructive' : 'info', sub: 'worked on off/holiday', metric: 'pressure', drillLabel: 'Staffing Pressure · last 4 weeks' },
          { label: 'Unresolved Anomalies', value: intelligenceSummary.unresolved_anomalies, icon: AlertTriangle, tone: intelligenceSummary.unresolved_anomalies > 0 ? 'warning' : 'success', sub: intelligenceSummary.unresolved_anomalies > 0 ? 'Needs review' : 'All clear', metric: null, drillLabel: '' },
        ]
        return (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map(c => (
              <KpiCard key={c.label} label={c.label} value={String(c.value)} icon={c.icon} tone={c.tone}
                deltaLabel={c.metric ? 'Investigate →' : undefined} hint={c.sub}
                onClick={c.metric ? () => openInvestigation({ metric: c.metric!, ...range, label: c.drillLabel }) : undefined} />
            ))}
          </section>
        )
      })()}

      {/* Absenteeism trend (weekly — click a data point to drill) */}
      {absenteeismData && Array.isArray(absenteeismData.buckets) && absenteeismData.buckets.length > 0 && (
        <Viz icon={Activity} title="Absenteeism Trend" sub="Last 12 weeks · click a point to investigate">
          <div className="h-[200px]">
            <ResponsiveContainer>
              <LineChart data={absenteeismData.buckets}
                onClick={(payload) => {
                  if (!payload?.activePayload?.[0]) return
                  const week = (payload.activePayload?.[0]?.payload as { week: string } | undefined)?.week
                  const bucket = absenteeismData.buckets.find(b => b.week === week)
                  if (!bucket) return
                  openInvestigation({ metric: 'absent', from: absenteeismData.range.from, to: absenteeismData.range.to, week, label: `Absent Rate · ${week}  (${bucket.absent_rate}%)` })
                }}
                margin={{ top: 6, right: 8, left: -16, bottom: 0 }} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="week" tick={{ ...AXIS, fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={<ChartTip fmt={(v: number) => `${v}%`} />} cursor={{ stroke: 'var(--muted)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="absent_rate" stroke={STATUS_COLOR.absent} strokeWidth={2} dot={{ r: 3, fill: STATUS_COLOR.absent, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2 }} name="Absent Rate %" />
                <Line type="monotone" dataKey="late_rate" stroke={STATUS_COLOR.late} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Late Rate %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>Overall absent rate: <strong className="text-foreground">{absenteeismData.summary.overall_absent_rate}%</strong></span>
            <span>Records analysed: <strong className="text-foreground">{(absenteeismData.summary.total_records ?? 0).toLocaleString()}</strong></span>
          </div>
        </Viz>
      )}

      {/* KPI ribbon */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Attendance Rate" value={`${analytics?.attendanceRate ?? '—'}%`} hint={`${analytics?.totalPresent ?? 0} present days`} icon={CheckCircle2} tone={parseFloat(analytics?.attendanceRate ?? '0') >= 90 ? 'success' : 'warning'} />
        <KpiCard label="Absenteeism Rate" value={`${analytics?.absentRate ?? '—'}%`} hint={`${analytics?.totalAbsent ?? 0} absent days`} icon={TrendingDown} tone={parseFloat(analytics?.absentRate ?? '0') <= 5 ? 'success' : 'destructive'} />
        <KpiCard label="Leave Days Used" value={String(analytics?.totalLeave ?? '—')} hint="across all employees" icon={Calendar} tone="info" />
        <KpiCard label="Avg Late · min" value={String(analytics?.avgLateMin ?? '—')} hint="per late arrival" icon={Clock} tone={(analytics?.avgLateMin ?? 0) > 30 ? 'warning' : 'primary'} />
      </section>

      {musterLoading || summaryLoading ? (
        <Viz title="Attendance Analytics">
          <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
            <Calendar className="h-8 w-8 animate-pulse opacity-30" />
            <p className="text-sm">Loading analytics…</p>
          </div>
        </Viz>
      ) : !analytics ? (
        <NoData text="No attendance data for this period." />
      ) : (
        <>
          {/* Charts row */}
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Viz icon={TrendingUp} title="Daily Attendance Trend" sub="Present vs absent · click to investigate">
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <LineChart data={analytics.dailyTrend}
                    onClick={(payload) => {
                      if (!payload?.activePayload?.[0]) return
                      const pt = payload.activePayload[0].payload as { date: string; present: number; absent: number }
                      const fullDate = `${month}-${pt.date.slice(-2)}`
                      const [y, mo] = month.split('-').map(Number)
                      const from = `${month}-01`
                      const to = new Date(y, mo, 0).toISOString().slice(0, 10)
                      openInvestigation({ metric: 'absent', from, to, label: `Absent / Present · ${fullDate}  (${pt.absent} absent, ${pt.present} present)` })
                    }}
                    margin={{ top: 6, right: 8, left: -16, bottom: 0 }} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--muted)' }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="present" stroke={STATUS_COLOR.present} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Present" />
                    <Line type="monotone" dataKey="absent" stroke={STATUS_COLOR.absent} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Absent" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Viz>

            <Viz icon={CheckCircle2} title="Status Distribution" sub="Across all employee-days">
              {donutData.length > 0 ? (
                <DonutBlock data={donutData} centerValue={donutTotal.toLocaleString()} centerLabel="days" total={donutTotal} />
              ) : <NoData text="No status data." />}
            </Viz>
          </section>

          {/* Leave utilization */}
          {analytics.leaveBar.length > 0 && (
            <Viz icon={Calendar} title="Leave Utilization" sub="Top employees · this month"
              right={
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                  onClick={() => {
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({ metric: 'leave', from, to, label: `Leave Utilization · ${monthLabel(month)}` })
                  }}>
                  <Search className="h-3 w-3" /> Investigate
                </Button>
              }>
              <div className="h-[200px]">
                <ResponsiveContainer>
                  <BarChart data={analytics.leaveBar} layout="vertical"
                    onClick={() => {
                      const [y, mo] = month.split('-').map(Number)
                      const from = `${month}-01`
                      const to = new Date(y, mo, 0).toISOString().slice(0, 10)
                      openInvestigation({ metric: 'leave', from, to, label: `Leave Utilization · ${monthLabel(month)}` })
                    }}
                    margin={{ top: 2, right: 16, left: 4, bottom: 2 }} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={72} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} />
                    <Bar dataKey="days" fill={STATUS_COLOR.leave} name="Leave Days" radius={[0, 4, 4, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Viz>
          )}

          {/* Reliability table */}
          <Viz icon={Users} title="Employee Reliability Scores" sub="Lowest first"
            right={
              <div className="flex items-center gap-2">
                <input type="text" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)}
                  className="h-7 w-36 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" />
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                  onClick={() => {
                    const [y, mo] = month.split('-').map(Number)
                    const from = `${month}-01`
                    const to = new Date(y, mo, 0).toISOString().slice(0, 10)
                    openInvestigation({ metric: 'reliability', from, to, label: `Reliability Scores · ${monthLabel(month)}` })
                  }}>
                  <Search className="h-3 w-3" /> Investigate
                </Button>
              </div>
            }>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {['Employee', 'Score', 'Present', 'Late', 'Absent', 'Work Days'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredReliability.map(e => (
                    <tr key={e.code} className="transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{e.name}</p>
                        <p className="text-[10px] text-muted-foreground">{e.code}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 max-w-[60px] flex-1 overflow-hidden rounded-full bg-muted">
                            <div className={cn('h-full rounded-full', e.score >= 90 ? 'bg-success' : e.score >= 70 ? 'bg-warning' : 'bg-destructive')} style={{ width: `${e.score}%` }} />
                          </div>
                          <Badge variant={e.score >= 90 ? 'success' : e.score >= 70 ? 'warning' : 'destructive'} className="rounded-full text-[10px]">{e.score}%</Badge>
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
          </Viz>

          {/* Anomaly alert */}
          {anomalyCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-warning/20 bg-warning/10 p-4 text-warning">
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold">{anomalyCount} unresolved anomaly(ies) this month</p>
                <p className="text-xs opacity-80">Review attendance anomalies to ensure data accuracy before payroll.</p>
              </div>
            </div>
          )}

          {/* Payroll summary footer */}
          {payrollSum && (
            <Viz title="Payroll Summary" sub={monthLabel(month)}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Total Employees" value={String(payrollSum.total_employees)} tone="primary" boxed />
                <MiniStat label="Payable Days" value={String(payrollSum.total_payable_days)} tone="success" boxed />
                <MiniStat label="LOP Days" value={String(payrollSum.total_lop_days)} tone="destructive" boxed />
                <MiniStat label="Avg Hours/Day" value={payrollSum.avg_work_hours?.toFixed(1) ?? '—'} tone="muted" boxed />
              </div>
            </Viz>
          )}
        </>
      )}

      {/* Investigation Panel — slide-over for any drilldown */}
      <InvestigationPanel target={investigation} onClose={closeInvestigation} />
    </PageContainer>
  )
}

export function WorkforceAnalytics({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <ErrorBoundary title="Workforce Analytics">
      <WorkforceAnalyticsInner embedded={embedded} />
    </ErrorBoundary>
  )
}
