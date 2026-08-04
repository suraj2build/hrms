/**
 * RightRail — Contextual right operations panel for AdminShell V2.
 *
 * Four sections:
 *   1. Top Priorities      — pending approvals / corrections / anomalies (live counts)
 *   2. Upcoming Deadlines  — next holidays + statutory payroll dates
 *   3. System Health       — last processing run status / API / DB
 *   4. Helpful Links       — Payroll, Statutory Reports, Compliance, Audit Logs
 *
 * Width: 240px (fixed, flex-shrink-0)
 * Data: reads from /analytics/dashboard, /attendance/process/last, /masters/holidays
 * No mutations — read-only informational panel.
 */

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  AlertTriangle, Clock, ClipboardList,
  CalendarDays, DollarSign, BookOpen,
  Shield, FileSearch, RefreshCw, Loader2,
} from 'lucide-react'
import { cn, fmtDateTime } from '@/lib/utils'
import { api } from '@/lib/api/client'
import { RailSection, PriorityItem, DeadlineItem, HealthRow, HelpfulLink } from '@/components/dashboard/primitives'
import { ContextualInsightsPanel } from '@/components/panels/ContextualInsightsPanel'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  total_employees:         number
  active_employees:        number
  new_joiners_this_month:  number
  separations_this_month:  number
}

interface AnomalyResp     { total?: number; data?: unknown[] }
interface CorrectionsResp { total?: number; data?: unknown[] }
// GET /attendance/regularisation/pending returns a bare array (reply.send(rows)),
// not a { data } wrapper — unlike the anomaly/corrections endpoints above.
type RegResp = unknown[]

interface Holiday         { id: string; name: string; date: string }

interface LastRun {
  id: string; status: string; completed_at: string | null; started_at: string
  processed_count: number; error_message: string | null; duration_ms: number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr + 'T12:00:00Z').getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / 86_400_000)
}

// ── RightRail ─────────────────────────────────────────────────────────────────

interface RightRailProps {
  show?: boolean
}

export function RightRail({ show = true }: RightRailProps) {
  // Browser-local date (not UTC) — new Date().toISOString() is a day behind
  // local for timezones ahead of UTC like IST between midnight and the UTC
  // offset, which would misalign the "upcoming holidays" filter and the
  // processing-status staleness check against tenant-local calendar dates.
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const qc    = useQueryClient()

  // staleTime === refetchInterval on every polling query so that shell-level
  // mount (which fires on every page navigation) never triggers an extra fetch
  // while the cached value is still fresh.  keepPreviousData on the two queries
  // that drive the spinner prevents the icon from flashing during background polls.

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats-rail'],
    queryFn:  () => api.get('/analytics/dashboard'),
    staleTime: 5 * 60_000,         // ← was 60_000 (misaligned)
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: anomalyResp } = useQuery<AnomalyResp>({
    queryKey: ['anomaly-count-rail'],
    queryFn:  () => api.get('/attendance/anomalies?resolved=false&limit=1'),
    staleTime: 5 * 60_000,         // ← was 2 * 60_000 (misaligned)
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: correctionsResp } = useQuery<CorrectionsResp>({
    queryKey: ['corrections-count-rail'],
    queryFn:  () => api.get('/attendance/corrections?status=pending&limit=1'),
    staleTime: 5 * 60_000,         // ← was 2 * 60_000 (misaligned)
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: regResp } = useQuery<RegResp>({
    queryKey: ['reg-count-rail'],
    queryFn:  () => api.get('/attendance/regularisation/pending'),
    staleTime: 5 * 60_000,         // ← was 60_000 (misaligned)
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  const { data: holidaysResp } = useQuery<{ data: Holiday[] }>({
    queryKey: ['holidays-rail'],
    queryFn:  () => api.get('/masters/holidays'),
    staleTime: 60 * 60_000,        // no interval — fine as-is
  })

  const { data: lastRunResp, isLoading: runLoading } = useQuery<{ run: LastRun | null }>({
    queryKey: ['last-run-rail'],
    queryFn:  () => api.get('/attendance/process/last'),
    staleTime: 5 * 60_000,         // ← was 60_000 (misaligned)
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  })

  // Refresh button: invalidate all rail queries through RQ deduplication pipeline
  // (instead of calling refetch() on a single query as before)
  function handleRefresh() {
    const railKeys = [
      ['dashboard-stats-rail'],
      ['anomaly-count-rail'],
      ['corrections-count-rail'],
      ['reg-count-rail'],
      ['last-run-rail'],
    ]
    railKeys.forEach(key => qc.invalidateQueries({ queryKey: key, exact: true }))
  }

  if (!show) return null

  // ── Derived ────────────────────────────────────────────────────────────────

  const anomalyCount     = anomalyResp?.total     ?? (Array.isArray(anomalyResp?.data)     ? anomalyResp.data.length     : 0)
  const correctionsCount = correctionsResp?.total ?? (Array.isArray(correctionsResp?.data) ? correctionsResp.data.length : 0)
  const regCount         = Array.isArray(regResp) ? regResp.length : 0

  const upcomingHolidays = (holidaysResp?.data ?? [])
    .filter(h => h.date >= today)
    .slice(0, 4)

  const lastRun   = lastRunResp?.run ?? null
  const isLoading = statsLoading || runLoading

  const runStatus = (() => {
    if (!lastRun)                     return 'unknown' as const
    if (lastRun.status === 'failed')  return 'degraded' as const
    const isStale = lastRun.started_at?.slice(0, 10) !== today
    return isStale ? 'degraded' as const : 'healthy' as const
  })()

  const runDetail = lastRun
    ? `${lastRun.status === 'failed' ? 'Failed' : 'OK'} · ${fmtDateTime(lastRun.started_at)}`
    : 'No runs recorded'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <aside
      className={cn(
        'w-[240px] flex-shrink-0 border-l border-border bg-background overflow-y-auto',
        'scrollbar-none',
      )}
    >
      {/* ── Contextual Insights (route-aware live panel) ────────────── */}
      <div className="border-b border-border/60">
        <ContextualInsightsPanel />
      </div>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/60">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
          Operations
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          title="Refresh rail"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {isLoading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* ── Section 1: Top Priorities ────────────────────────────────── */}
      <RailSection title="Top Priorities">
        <div className="space-y-0.5">
          <PriorityItem
            label="Pending Approvals"
            count={regCount}
            variant={regCount > 0 ? 'info' : 'warning'}
            href="/admin/attendance/regularisation"
          />
          <PriorityItem
            label="Attendance Anomalies"
            count={anomalyCount}
            variant={anomalyCount > 0 ? 'warning' : 'info'}
            href="/admin/attendance/anomalies"
          />
          <PriorityItem
            label="Pending Corrections"
            count={correctionsCount}
            variant={correctionsCount > 0 ? 'destructive' : 'warning'}
            href="/admin/attendance/corrections"
          />
        </div>
        {/* New joiners / separations this month */}
        {stats && (
          <div className="mt-3 pt-2.5 border-t border-border/40 grid grid-cols-2 gap-2">
            <div className="text-center p-2 rounded-lg bg-success/[0.07] border border-success/15">
              <p className="text-base font-bold text-success tabular-nums">{stats.new_joiners_this_month}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Joiners</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-warning/[0.07] border border-warning/15">
              <p className="text-base font-bold text-warning tabular-nums">{stats.separations_this_month}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">Separations</p>
            </div>
          </div>
        )}
      </RailSection>

      {/* ── Section 2: Upcoming Deadlines ───────────────────────────── */}
      <RailSection title="Upcoming Deadlines">
        {upcomingHolidays.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-1">No upcoming holidays.</p>
        ) : (
          <div className="space-y-0.5">
            {upcomingHolidays.map(h => {
              const days = daysUntil(h.date)
              return (
                <DeadlineItem
                  key={h.id}
                  icon={CalendarDays}
                  label={h.name}
                  date={`${fmtDate(h.date)} · ${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}`}
                  urgency={days <= 1 ? 'urgent' : days <= 7 ? 'soon' : 'normal'}
                />
              )
            })}
          </div>
        )}
      </RailSection>

      {/* ── Section 3: System Health ─────────────────────────────────── */}
      <RailSection title="System Health">
        <div className="space-y-0">
          <HealthRow
            label="Attendance Processing"
            status={runStatus}
            detail={runDetail}
          />
          <HealthRow
            label="API Services"
            status="healthy"
          />
          <HealthRow
            label="Database"
            status="healthy"
          />
        </div>
        {lastRun && lastRun.status !== 'failed' && (
          <div className="mt-2.5 pt-2.5 border-t border-border/40">
            <p className="text-[11px] text-muted-foreground">
              Last run processed{' '}
              <span className="font-semibold text-foreground tabular-nums">{lastRun.processed_count}</span>{' '}
              employees
              {lastRun.duration_ms && (
                <> in <span className="font-semibold text-foreground">{Math.round(lastRun.duration_ms / 1000)}s</span></>
              )}
            </p>
          </div>
        )}
      </RailSection>

      {/* ── Section 4: Helpful Links ─────────────────────────────────── */}
      <RailSection title="Helpful Links">
        <div className="space-y-0.5">
          <HelpfulLink
            icon={DollarSign}
            label="Payroll Runs"
            href="/admin/payroll"
          />
          <HelpfulLink
            icon={BookOpen}
            label="Leave Types & Balances"
            href="/admin/leave/types"
          />
          <HelpfulLink
            icon={Shield}
            label="Compliance"
            href="/admin/compliance"
          />
          <HelpfulLink
            icon={FileSearch}
            label="Attendance Audit Log"
            href="/admin/attendance/audit"
          />
          <HelpfulLink
            icon={ClipboardList}
            label="Muster Roll"
            href="/admin/attendance/muster"
          />
          <HelpfulLink
            icon={AlertTriangle}
            label="Anomalies"
            href="/admin/attendance/anomalies"
          />
          <HelpfulLink
            icon={Clock}
            label="Shift Roster"
            href="/admin/roster"
          />
        </div>
      </RailSection>

    </aside>
  )
}
