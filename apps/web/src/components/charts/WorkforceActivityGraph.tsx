/**
 * WorkforceActivityGraph.tsx — Multi-panel workforce activity chart dashboard
 * Phase UX-4
 *
 * Six recharts panels deriving data from the unified activity stream:
 *   1. Attendance Trends (AreaChart)
 *   2. Anomaly Clusters (BarChart)
 *   3. OT Spikes (BarChart)
 *   4. Approval Load (BarChart + Cell)
 *   5. Payroll Readiness (custom CSS gauge)
 *   6. Compliance Risk Trends (LineChart)
 */

import { useMemo } from 'react'
import { useQuery }   from '@tanstack/react-query'
import {
  AreaChart, Area,
  BarChart,  Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts'
import { RefreshCw } from 'lucide-react'
import { cn }         from '@/lib/utils'
import { api }        from '@/lib/api/client'
import { Button }     from '@/components/ui/button'
import {
  getAxisStyle, getGridStyle, getTooltipStyle,
} from '@/components/ui/chart'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import type { OperationalActivityEvent } from '@/lib/activity/types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface WorkforceActivityGraphProps {
  /** ISO date strings for range. Default: last 14 days */
  dateFrom?: string
  dateTo?:   string
  compact?:  boolean
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getLast14Days(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function getLast7Days(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function formatDayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}`
}

/** Returns "YYYY-Www" (ISO week string) for a given Date */
function isoWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function getLast4WeekKeys(): string[] {
  const keys: string[] = []
  const now = new Date()
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    keys.push(isoWeekKey(d))
  }
  return keys
}

/** Minutes since a Date */
function minutesAgo(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 60_000)
}

// ── Panel wrapper ──────────────────────────────────────────────────────────────

function Panel({
  title,
  description,
  lastUpdated,
  children,
}: {
  title:       string
  description: string
  lastUpdated: Date | null
  children:    React.ReactNode
}) {
  const ago = lastUpdated ? minutesAgo(lastUpdated) : null
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex-1">{children}</div>
      {ago !== null && (
        <p className="text-xs text-muted-foreground text-right">
          Updated {ago === 0 ? 'just now' : `${ago}m ago`}
        </p>
      )}
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkforceActivityGraph({
  dateFrom,
  dateTo,
  compact = false,
}: WorkforceActivityGraphProps) {
  const { allEvents, isLoading, lastUpdated, refresh } = useActivityStream()

  // Secondary queries (results used for stats display, not chart derivation)
  useQuery({
    queryKey: ['dashboard-stats-graph'],
    queryFn:  () => api.get('/analytics/dashboard'),
    staleTime: 5 * 60_000,
  })
  useQuery({
    queryKey: ['anomalies-graph'],
    queryFn:  () =>
      api.get<{ data: unknown[] }>('/attendance/anomalies?limit=100').then(r => r.data),
  })

  // ── Panel 1: Attendance Trends ─────────────────────────────────────────────

  const attendanceTrends = useMemo(() => {
    const days = getLast14Days()
    return days.map(day => {
      const eventsOnDay = allEvents.filter(
        (e: OperationalActivityEvent) => e.timestamp.slice(0, 10) === day,
      )
      return {
        day:       formatDayLabel(day),
        anomalies: eventsOnDay.filter(e => e.type === 'attendance_anomaly').length,
        missing:   eventsOnDay.filter(e => e.type === 'missing_punch').length,
      }
    })
  }, [allEvents])

  // ── Panel 2: Anomaly Clusters ──────────────────────────────────────────────

  const anomalyClusters = useMemo(() => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const
    const anomalies  = allEvents.filter(e => e.type === 'attendance_anomaly')
    return severities.map(sev => ({
      name:  sev.charAt(0).toUpperCase() + sev.slice(1),
      count: anomalies.filter(e => e.severity === sev).length,
    }))
  }, [allEvents])

  // ── Panel 3: OT Spikes ─────────────────────────────────────────────────────

  const otSpikes = useMemo(() => {
    const days = getLast7Days()
    return days.map(day => {
      const eventsOnDay = allEvents.filter(
        (e: OperationalActivityEvent) => e.timestamp.slice(0, 10) === day,
      )
      return {
        day:   formatDayLabel(day),
        spikes: eventsOnDay.filter(e => e.type === 'ot_spike' || e.type === 'fatigue_risk').length,
      }
    })
  }, [allEvents])

  // ── Panel 4: Approval Load ─────────────────────────────────────────────────

  const approvalLoad = useMemo(() => [
    {
      name:  'Pending',
      value: allEvents.filter(e => e.type === 'approval_pending').length,
      fill:  'var(--color-warning)',
    },
    {
      name:  'Approved',
      value: allEvents.filter(e => e.type === 'approval_approved').length,
      fill:  'var(--color-success)',
    },
    {
      name:  'Rejected',
      value: allEvents.filter(e => e.type === 'approval_rejected').length,
      fill:  'var(--color-destructive)',
    },
  ], [allEvents])

  // ── Panel 5: Payroll Readiness ─────────────────────────────────────────────

  const payrollReadiness = useMemo(() => {
    const openBlockers = allEvents.filter(
      e => e.type === 'payroll_blocker' && e.status === 'open',
    )
    const processed = allEvents.filter(e => e.type === 'payroll_processed').length
    const total      = processed + openBlockers.length
    const pct        = total === 0 ? 100 : Math.min(100, Math.round((processed / total) * 100))
    return { pct, openBlockers: openBlockers.slice(0, 3) }
  }, [allEvents])

  const readinessColor =
    payrollReadiness.pct >= 90
      ? 'bg-success'
      : payrollReadiness.pct >= 70
        ? 'bg-warning'
        : 'bg-destructive'

  const readinessTextColor =
    payrollReadiness.pct >= 90
      ? 'text-success'
      : payrollReadiness.pct >= 70
        ? 'text-warning'
        : 'text-destructive'

  // ── Panel 6: Compliance Risk Trends ───────────────────────────────────────

  const complianceTrends = useMemo(() => {
    const weeks     = getLast4WeekKeys()
    const alerts    = allEvents.filter(e => e.type === 'compliance_alert')
    return weeks.map(wk => {
      const inWeek = alerts.filter(e => isoWeekKey(new Date(e.timestamp)) === wk)
      return {
        week:     wk,
        critical: inWeek.filter(e => e.severity === 'critical').length,
        high:     inWeek.filter(e => e.severity === 'high').length,
      }
    })
  }, [allEvents])

  // ── Axis / grid / tooltip styles ──────────────────────────────────────────

  const axis    = getAxisStyle()
  const grid    = getGridStyle()
  const tooltip = getTooltipStyle()

  // ── Date range display ─────────────────────────────────────────────────────

  const rangeLabel = useMemo(() => {
    if (dateFrom || dateTo) {
      const from = dateFrom ? formatDayLabel(dateFrom) : '—'
      const to   = dateTo   ? formatDayLabel(dateTo)   : '—'
      return `${from} – ${to}`
    }
    const days = getLast14Days()
    return `${formatDayLabel(days[0])} – ${formatDayLabel(days[13])}`
  }, [dateFrom, dateTo])

  if (isLoading) {
    return (
      <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3')}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 h-[260px] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Workforce Activity</h2>
          <p className="text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* 6-panel grid */}
      <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3')}>

        {/* Panel 1 — Attendance Trends */}
        <Panel title="Attendance Trends" description="Anomalies & missing punches — last 14 days" lastUpdated={lastUpdated}>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={attendanceTrends} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gradAnomalies" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-destructive)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-destructive)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradMissing" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--color-warning)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-warning)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...grid} />
              <XAxis dataKey="day" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} interval={3} />
              <YAxis tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} />
              <Area
                type="monotone" dataKey="anomalies" name="Anomalies"
                stroke="var(--color-destructive)" fill="url(#gradAnomalies)" strokeWidth={1.5}
              />
              <Area
                type="monotone" dataKey="missing" name="Missing Punch"
                stroke="var(--color-warning)" fill="url(#gradMissing)" strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        {/* Panel 2 — Anomaly Clusters */}
        <Panel title="Anomaly Clusters" description="Attendance anomalies grouped by severity" lastUpdated={lastUpdated}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={anomalyClusters} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="name" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} />
              <YAxis tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} />
              <Bar dataKey="count" name="Count" fill="var(--color-destructive)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Panel 3 — OT Spikes */}
        <Panel title="OT Spikes" description="Overtime & fatigue risk events — last 7 days" lastUpdated={lastUpdated}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={otSpikes} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="day" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} />
              <YAxis tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} />
              <Bar dataKey="spikes" name="Spikes" fill="var(--color-warning)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Panel 4 — Approval Load */}
        <Panel title="Approval Load" description="Pending, approved, and rejected approvals" lastUpdated={lastUpdated}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={approvalLoad} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="name" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} />
              <YAxis tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} />
              <Bar dataKey="value" name="Count" radius={[3, 3, 0, 0]}>
                {approvalLoad.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        {/* Panel 5 — Payroll Readiness */}
        <Panel title="Payroll Readiness" description="Open blockers vs processed payroll events" lastUpdated={lastUpdated}>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-end gap-2">
              <span className={cn('text-4xl font-bold tabular-nums leading-none', readinessTextColor)}>
                {payrollReadiness.pct}%
              </span>
              <span className="text-xs text-muted-foreground pb-1">ready</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500', readinessColor)}
                style={{ width: `${payrollReadiness.pct}%` }}
              />
            </div>
            {payrollReadiness.openBlockers.length > 0 ? (
              <ul className="flex flex-col gap-1 mt-1">
                {payrollReadiness.openBlockers.map(e => (
                  <li key={e.id} className="text-xs text-destructive truncate flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive flex-shrink-0" />
                    {e.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-success">No open blockers</p>
            )}
          </div>
        </Panel>

        {/* Panel 6 — Compliance Risk Trends */}
        <Panel title="Compliance Risk Trends" description="Critical & high compliance alerts — last 4 weeks" lastUpdated={lastUpdated}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={complianceTrends} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="week" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} />
              <YAxis tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} allowDecimals={false} />
              <Tooltip contentStyle={tooltip} />
              <Line
                type="monotone" dataKey="critical" name="Critical"
                stroke="var(--color-destructive)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }}
              />
              <Line
                type="monotone" dataKey="high" name="High"
                stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

      </div>
    </div>
  )
}
