/**
 * RosterIntelligence — /roster/intelligence
 *
 * Phase 3 — Roster Intelligence dashboard.
 * Surfaces operational shift coverage, employee burnout risk,
 * shift-weekday work-hours heatmap, and coverage gap alerts.
 *
 * All data from:
 *   GET /analytics/roster/coverage   — daily per-shift coverage %
 *   GET /analytics/roster/burnout    — employee burnout risk ranking
 *   GET /analytics/roster/heatmap    — shift × weekday avg hours
 *   GET /analytics/roster/gaps       — understaffed days
 *   GET /analytics/roster/summary    — headline stats
 *
 * Access: hr_admin / super_admin only.
 */

import { useState, useMemo } from 'react'
import { Link }          from 'react-router-dom'
import { useQuery }       from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts'
import {
  Flame, AlertTriangle, Activity, CalendarRange,
  ChevronLeft, ChevronRight, ShieldAlert, Users,
  TrendingDown, Clock, Zap, Search, Loader2,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import {
  getChartColor,
  getAxisStyle,
  getGridStyle,
  getTooltipStyle,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoverageRow {
  date:         string
  shift_id:     string
  shift_name:   string
  shift_code:   string | null
  scheduled:    number
  present:      number
  absent:       number
  coverage_pct: number
}

interface BurnoutEmployee {
  employee_id:     string
  employee_code:   string
  name:            string
  ot_minutes:      number
  ot_hours:        number
  weekly_off_days: number
  holiday_days:    number
  late_minutes:    number
  total_days:      number
  risk_score:      number
  severity:        'high' | 'medium' | 'low'
}

interface HeatmapRow {
  shift_id:       string
  shift_name:     string
  weekday:        number
  avg_work_hours: number
  record_count:   number
}

interface GapRow {
  date:         string
  shift_id:     string
  shift_name:   string
  shift_code:   string | null
  scheduled:    number
  present:      number
  absent:       number
  coverage_pct: number
  severity:     'high' | 'medium' | 'low'
}

interface RosterSummary {
  month: string
  roster: {
    covered_employees: number
    total_ot_hours:    number
    weekly_off_worked: number
    holidays_worked:   number
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function monthLabel(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
}

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

// Heatmap cell color: 0h=muted, 8h=success, >10h=destructive
function heatColor(hours: number): string {
  if (hours === 0) return 'bg-muted/30 text-muted-foreground/50'
  if (hours <= 6)  return 'bg-warning/20 text-warning'
  if (hours <= 9)  return 'bg-success/20 text-success'
  if (hours <= 11) return 'bg-warning/30 text-warning'
  return 'bg-destructive/20 text-destructive'
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function RosterIntelligence() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // Derive date range from month
  const [y, mo]   = month.split('-').map(Number)
  const fromDate  = `${month}-01`
  const toDate    = new Date(y, mo, 0).toISOString().slice(0, 10)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: summary } = useQuery<RosterSummary>({
    queryKey: ['roster-summary', month],
    queryFn:  () => api.get('/analytics/roster/summary'),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: coverageData, isLoading: coverageLoading } = useQuery<{
    range: { from: string; to: string }
    coverage: CoverageRow[]
  }>({
    queryKey: ['roster-coverage', fromDate, toDate],
    queryFn:  () => api.get(`/analytics/roster/coverage?from=${fromDate}&to=${toDate}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: burnoutData, isLoading: burnoutLoading } = useQuery<{
    month: string
    summary: { high: number; medium: number; low: number; total: number }
    employees: BurnoutEmployee[]
  }>({
    queryKey: ['roster-burnout', month],
    queryFn:  () => api.get(`/analytics/roster/burnout?month=${month}&limit=25`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery<{
    month: string
    heatmap: HeatmapRow[]
  }>({
    queryKey: ['roster-heatmap', month],
    queryFn:  () => api.get(`/analytics/roster/heatmap?month=${month}`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  const { data: gapsData, isLoading: gapsLoading } = useQuery<{
    range:            { from: string; to: string }
    min_coverage_pct: number
    total_gaps:       number
    high_severity:    number
    gaps:             GapRow[]
  }>({
    queryKey: ['roster-gaps', fromDate, toDate],
    queryFn:  () => api.get(`/analytics/roster/gaps?from=${fromDate}&to=${toDate}&min_coverage_pct=70`),
    enabled:  isAdmin,
    staleTime: 120_000,
  })

  // ── Derived (memoized — these iterate large arrays on every render) ─────────

  /**
   * Coverage trend: average coverage_pct per date across all shifts.
   * Re-computed only when coverageData changes.
   */
  const coverageTrend = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>()
    for (const row of coverageData?.coverage ?? []) {
      const e = byDate.get(row.date) ?? { total: 0, count: 0 }
      e.total += row.coverage_pct; e.count++
      byDate.set(row.date, e)
    }
    return Array.from(byDate.entries())
      .map(([date, v]) => ({
        date: date.slice(5),  // MM-DD
        avg_coverage: v.count > 0 ? Math.round(v.total / v.count) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [coverageData])

  /** Unique shift names present in the heatmap dataset — re-computed when heatmapData changes. */
  const shiftNames = useMemo(
    () => Array.from(new Set((heatmapData?.heatmap ?? []).map(r => r.shift_name))).sort(),
    [heatmapData],
  )

  /**
   * Heatmap grid: shiftName → weekday index → avg_work_hours.
   * Re-computed only when heatmapData changes.
   */
  const heatmapGrid = useMemo(() => {
    const grid: Record<string, Record<number, number>> = {}
    for (const row of heatmapData?.heatmap ?? []) {
      if (!grid[row.shift_name]) grid[row.shift_name] = {}
      grid[row.shift_name][row.weekday] = row.avg_work_hours
    }
    return grid
  }, [heatmapData])

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Roster Intelligence" subtitle="Shift coverage and burnout analytics" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
            <p className="text-sm">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Roster Intelligence"
        subtitle={`Shift coverage, burnout risk, and gap analysis — ${monthLabel(month)}`}
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

      {/* ── Summary stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Roster Coverage',
            value: summary ? `${summary.roster.covered_employees}` : '—',
            sub:   'employees with shift',
            icon:  Users,
            cls:   'text-foreground',
          },
          {
            label: 'Total OT Hours',
            value: summary ? `${summary.roster.total_ot_hours}h` : '—',
            sub:   'this month',
            icon:  Clock,
            cls:   (summary?.roster.total_ot_hours ?? 0) > 100 ? 'text-destructive' : 'text-warning',
          },
          {
            label: 'WO Days Worked',
            value: summary ? summary.roster.weekly_off_worked : '—',
            sub:   'rest days sacrificed',
            icon:  Flame,
            cls:   (summary?.roster.weekly_off_worked ?? 0) > 10 ? 'text-destructive' : 'text-warning',
          },
          {
            label: 'Coverage Gaps',
            value: gapsData ? gapsData.total_gaps : '—',
            sub:   gapsData ? `${gapsData.high_severity} high severity` : '',
            icon:  AlertTriangle,
            cls:   (gapsData?.high_severity ?? 0) > 0 ? 'text-destructive' : 'text-success',
          },
        ].map(({ label, value, sub, icon: Icon, cls }) => (
          <SectionCard key={label}>
            <div className="flex items-center gap-2 mb-1">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
            <p className={cn('text-2xl font-bold', cls)}>{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
          </SectionCard>
        ))}
      </div>

      {/* ── Coverage trend line chart ──────────────────────────────────────── */}
      <SectionCard
        title="Daily Coverage Trend"
        icon={<Activity className="h-4 w-4 text-muted-foreground" />}
      >
        {coverageLoading ? (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
            Loading coverage data…
          </div>
        ) : coverageTrend.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
            No coverage data for this month.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={coverageTrend}>
              <CartesianGrid {...gridStyle} />
              <XAxis
                dataKey="date"
                tick={{ ...axisStyle.tick, fontSize: 9 }}
                axisLine={axisStyle.axisLine}
                tickLine={axisStyle.tickLine}
              />
              <YAxis
                tick={axisStyle.tick}
                axisLine={axisStyle.axisLine}
                tickLine={axisStyle.tickLine}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v}%`, 'Avg Coverage']}
              />
              <Line
                type="monotone"
                dataKey="avg_coverage"
                stroke={getChartColor('active')}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                name="Coverage %"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* ── Coverage gaps ─────────────────────────────────────────────────── */}
      {(gapsData?.gaps.length ?? 0) > 0 && (
        <SectionCard
          title={`Coverage Gaps (< 70%)`}
          icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
        >
          {gapsLoading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Date', 'Shift', 'Scheduled', 'Present', 'Coverage', 'Severity'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(gapsData?.gaps ?? []).map((gap, i) => (
                    <tr key={i} className={cn(
                      'border-b border-border/50',
                      gap.severity === 'high' && 'bg-destructive/5',
                      gap.severity === 'medium' && 'bg-warning/5',
                    )}>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{gap.date}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{gap.shift_name}</span>
                        {gap.shift_code && <span className="text-muted-foreground ml-1">({gap.shift_code})</span>}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{gap.scheduled}</td>
                      <td className="px-3 py-2 tabular-nums">{gap.present}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                gap.coverage_pct >= 70 ? 'bg-success' : gap.coverage_pct >= 50 ? 'bg-warning' : 'bg-destructive',
                              )}
                              style={{ width: `${gap.coverage_pct}%` }}
                            />
                          </div>
                          <span className="tabular-nums font-medium">{gap.coverage_pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={gap.severity === 'high' ? 'destructive' : gap.severity === 'medium' ? 'warning' : 'secondary'}
                          className="rounded-full text-[10px] capitalize"
                        >
                          {gap.severity}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Burnout risk table ────────────────────────────────────────────── */}
      <SectionCard
        title="Burnout Risk Ranking"
        icon={<Flame className="h-4 w-4 text-muted-foreground" />}
        action={
          burnoutData?.summary && (
            <div className="flex items-center gap-1.5">
              {burnoutData.summary.high > 0 && (
                <Badge variant="destructive" className="rounded-full text-[10px]">
                  {burnoutData.summary.high} high
                </Badge>
              )}
              {burnoutData.summary.medium > 0 && (
                <Badge variant="warning" className="rounded-full text-[10px]">
                  {burnoutData.summary.medium} medium
                </Badge>
              )}
            </div>
          )
        }
      >
        {burnoutLoading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : (burnoutData?.employees.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
            <Zap className="h-8 w-8 opacity-30" />
            <p className="text-sm">No burnout indicators detected.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['Employee', 'Risk Score', 'OT Hours', 'WO Worked', 'Late (min)', 'Severity', ''].map(h => (
                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(burnoutData?.employees ?? []).map(emp => (
                  <tr
                    key={emp.employee_id}
                    className={cn(
                      'border-b border-border/50 transition-colors',
                      emp.severity === 'high'   && 'bg-destructive/5',
                      emp.severity === 'medium' && 'bg-warning/5',
                    )}
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground">{emp.name}</p>
                      <p className="text-[10px] text-muted-foreground">{emp.employee_code}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              emp.risk_score >= 70 ? 'bg-destructive' : emp.risk_score >= 40 ? 'bg-warning' : 'bg-muted-foreground',
                            )}
                            style={{ width: `${emp.risk_score}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-semibold">{emp.risk_score}</span>
                      </div>
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums', emp.ot_hours > 20 ? 'text-warning font-semibold' : 'text-foreground')}>
                      {emp.ot_hours}h
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums', emp.weekly_off_days > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {emp.weekly_off_days}
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums', emp.late_minutes > 60 ? 'text-warning' : 'text-muted-foreground')}>
                      {emp.late_minutes}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={emp.severity === 'high' ? 'destructive' : emp.severity === 'medium' ? 'warning' : 'secondary'}
                        className="rounded-full text-[10px] capitalize"
                      >
                        {emp.severity}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={cn(
                          'h-7 w-7 p-0',
                          emp.severity === 'high'   ? 'text-destructive hover:text-destructive/80'
                          : emp.severity === 'medium' ? 'text-warning hover:text-warning/80'
                          : 'text-muted-foreground hover:text-foreground',
                        )}
                        asChild
                        title={`Investigate payroll for ${emp.name}`}
                      >
                        <Link to={`/admin/payroll/investigate?employee_id=${emp.employee_id}&month=${month}`}>
                          <Search className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Shift × Weekday Work-Hours Heatmap ───────────────────────────── */}
      <SectionCard
        title="Shift × Weekday Heatmap"
        icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
      >
        {heatmapLoading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : shiftNames.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No heatmap data available.</p>
        ) : (
          <>
            {/* Column headers: weekdays */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-muted-foreground font-semibold px-3 py-2 w-32">Shift</th>
                    {WEEKDAY_LABELS.map(d => (
                      <th key={d} className="text-center text-muted-foreground font-semibold px-2 py-2">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shiftNames.map(shiftName => (
                    <tr key={shiftName} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <span className="font-medium text-foreground">{shiftName}</span>
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map(wd => {
                        const hours = heatmapGrid[shiftName]?.[wd] ?? 0
                        return (
                          <td key={wd} className="px-1 py-1 text-center">
                            <div className={cn(
                              'rounded-md py-1.5 px-2 text-[10px] font-semibold tabular-nums transition-colors',
                              heatColor(hours),
                            )}>
                              {hours > 0 ? `${hours}h` : '—'}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-[10px] text-muted-foreground">
              {[
                { label: '< 6h',  cls: 'bg-warning/20' },
                { label: '6–9h',  cls: 'bg-success/20' },
                { label: '9–11h', cls: 'bg-warning/30' },
                { label: '> 11h', cls: 'bg-destructive/20' },
              ].map(({ label, cls }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={cn('w-3 h-3 rounded-sm', cls)} />
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      {/* ── Per-shift coverage bar (top 10 worst) ────────────────────────── */}
      {(coverageData?.coverage.length ?? 0) > 0 && (() => {
        // Aggregate average coverage per shift across all days
        const byShift = new Map<string, { total: number; count: number; name: string }>()
        for (const row of coverageData!.coverage) {
          const e = byShift.get(row.shift_id) ?? { total: 0, count: 0, name: row.shift_name }
          e.total += row.coverage_pct; e.count++
          byShift.set(row.shift_id, e)
        }
        const shiftAvg = Array.from(byShift.values())
          .map(v => ({ shift: v.name, avg_coverage: v.count > 0 ? Math.round(v.total / v.count) : 0 }))
          .sort((a, b) => a.avg_coverage - b.avg_coverage)
          .slice(0, 10)

        return (
          <SectionCard
            title="Coverage by Shift (Monthly Avg)"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          >
            <ResponsiveContainer width="100%" height={Math.max(120, shiftAvg.length * 30)}>
              <BarChart data={shiftAvg} layout="vertical">
                <CartesianGrid {...gridStyle} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={axisStyle.tick}
                  axisLine={axisStyle.axisLine}
                  tickLine={axisStyle.tickLine}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <YAxis
                  type="category"
                  dataKey="shift"
                  tick={axisStyle.tick}
                  axisLine={axisStyle.axisLine}
                  tickLine={axisStyle.tickLine}
                  width={90}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [`${v}%`, 'Avg Coverage']}
                />
                <Bar
                  dataKey="avg_coverage"
                  name="Avg Coverage %"
                  radius={[0, 4, 4, 0]}
                  fill={getChartColor('active')}
                />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        )
      })()}
    </PageContainer>
  )
}
