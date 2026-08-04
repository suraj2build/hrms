/**
 * AdminDashboard — Operational command-center for HR admins.
 *
 * Layout (inside AdminShellV2 which provides left sidebar + right rail):
 *   · InfoBanner  — processing status alert (warning/success/destructive)
 *   · KPI row     — 6 compact OperationalKPICard cards (full width)
 *   · Charts row  — Absent trend (area) + Employment types (donut), 2-col
 *   · Attention   — AlertRow panel + Quick Actions grid
 *   · RegQueue    — OperationalTable showing SLA-breached escalations only (Review → link)
 *
 * Data: same queries as before — no API changes.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PageHero } from '@/components/layout/PageHero'
import {
  Users, UserCheck, Clock, AlertTriangle,
  ArrowRight, RefreshCw,
  UserPlus, ClipboardList, CheckSquare,
  Activity, FileSearch, Play, Zap,
  UserX, CalendarCheck, Shield,
} from 'lucide-react'
import { useAuthStore }    from '@/stores/authStore'
import { api }             from '@/lib/api/client'
import { Button }          from '@/components/ui/button'
import { Badge }           from '@/components/ui/badge'
import type { DashboardStats } from '@/types'
import { InsightChart, EmptyWorkspaceState } from '@/components/dashboard'
import {
  OperationalKPICard,
  InfoBanner,
  SectionHeader,
  OperationalSurface,
  AlertRow,
  QuickActionRow,
  OperationalTable,
} from '@/components/dashboard/primitives'
import type { OpsTableColumn } from '@/components/dashboard/primitives'
import { fmtDateShort as fmtDate, fmtDateTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnomalyResp    { total?: number; data?: unknown[] }
interface CorrectionsResp { total?: number; data?: unknown[] }
interface RegularisationItem {
  id: string; employee_name?: string; employee_code?: string
  date: string; reason: string; status: string; created_at: string
}
interface Holiday { id: string; name: string; date: string }
interface LastRun {
  id: string; status: string; completed_at: string | null; started_at: string
  processed_count: number; error_message: string | null; duration_ms: number | null
}
interface MusterDay      { date: string; status: string | null; work_hours: number }
interface MusterEmployee { employee_id: string; name: string; days: MusterDay[] }
interface MusterResp     { month: string; employees: MusterEmployee[] }

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthRange() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(y, m + 1, 0)
  const to = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
  return { from, to, label: now.toLocaleString('default', { month: 'long', year: 'numeric' }) }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminDashboard() {
  const { tenant }  = useAuthStore()
  const navigate    = useNavigate()
  const { label }   = monthRange()
  // Browser-local date (not UTC) — attendance_daily.date is a tenant-local
  // calendar date; new Date().toISOString() is a day behind local for
  // timezones ahead of UTC like IST between midnight and the UTC offset,
  // which would misalign "today" lookups against yesterday's muster data.
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn:  () => api.get('/analytics/dashboard'),
    staleTime: 5 * 60_000,
  })

  const { data: anomalyResp } = useQuery<AnomalyResp>({
    queryKey: ['anomaly-count'],
    queryFn:  () => api.get('/attendance/anomalies?resolved=false&limit=1'),
    staleTime: 2 * 60_000,
  })

  const { data: correctionsResp } = useQuery<CorrectionsResp>({
    queryKey: ['corrections-count'],
    queryFn:  () => api.get('/attendance/corrections?status=pending&limit=1'),
    staleTime: 2 * 60_000,
  })

  const { data: regResp } = useQuery<{ data: RegularisationItem[] }>({
    queryKey: ['reg-pending'],
    queryFn:  () => api.get('/attendance/regularisation/pending'),
    staleTime: 60_000,
  })

  const { data: holidaysResp } = useQuery<{ data: Holiday[] }>({
    queryKey: ['holidays'],
    queryFn:  () => api.get('/masters/holidays'),
    staleTime: 60 * 60_000,
  })

  const { data: lastRunResp } = useQuery<{ run: LastRun | null }>({
    queryKey: ['last-run-dash'],
    queryFn:  () => api.get('/attendance/process/last'),
    staleTime: 60_000,
  })

  const { from: mFrom } = monthRange()
  const musterMonth = mFrom.slice(0, 7)
  const { data: musterResp } = useQuery<MusterResp>({
    queryKey: ['muster-dash', musterMonth],
    queryFn:  () => api.get(`/attendance/muster?month=${musterMonth}`),
    staleTime: 5 * 60_000,
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const anomalyCount     = anomalyResp?.total     ?? (Array.isArray(anomalyResp?.data)     ? anomalyResp!.data.length     : 0)
  const correctionsCount = correctionsResp?.total ?? (Array.isArray(correctionsResp?.data) ? correctionsResp!.data.length : 0)
  const regList          = regResp?.data ?? []

  const empTypeData = (stats?.employment_type_breakdown ?? []).map(e => ({ type: e.type, count: e.count }))
  const deptData    = stats?.department_breakdown ?? []
  const lastRun     = lastRunResp?.run ?? null

  // Processing status banner logic
  const runFailed = lastRun?.status === 'failed'
  const isStale   = (() => {
    if (!lastRun)                   return true
    if (lastRun.status === 'failed') return false
    return lastRun.started_at?.slice(0, 10) !== today
  })()

  // Absent trend from muster roll (last 14 days)
  const absentTrend = (() => {
    const emps = musterResp?.employees ?? []
    if (!emps.length) return []
    const dayMap = new Map<string, number>()
    for (const emp of emps) {
      for (const d of emp.days) {
        if (d.status !== null) {
          dayMap.set(d.date, (dayMap.get(d.date) ?? 0) + (d.status === 'absent' ? 1 : 0))
        }
      }
    }
    return [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, absent]) => ({ date: date.slice(5), absent }))
  })()

  const todayAbsent = (() => {
    const emps = musterResp?.employees ?? []
    return emps.filter(e => e.days?.find(d => d.date === today)?.status === 'absent').length
  })()

  // Sparkline data for KPI cards (absent 14d)
  const absentSparkData = absentTrend.map(d => ({ v: d.absent }))
  const pendingSparkData = regList.slice(0, 14).map((_r, i) => ({ v: i % 3 })) // static shape

  // Upcoming holidays (next 5)
  const upcomingHolidays = (holidaysResp?.data ?? []).filter(h => h.date >= today).slice(0, 5)

  // ── SLA escalation filter ─────────────────────────────────────────────────────
  // HR admin's dashboard queue shows ONLY items that have breached manager SLA
  // (pending for ≥2 days). Fresh items belong to the manager's approval queue.
  // HR resolves exceptions; managers own first-level approvals.
  const SLA_BREACH_DAYS = 2
  const escalatedRegList = regList.filter(r => {
    if (r.status !== 'pending') return false
    const submittedAt  = new Date(r.created_at).getTime()
    const ageMs        = Date.now() - submittedAt
    const ageDays      = ageMs / (1_000 * 60 * 60 * 24)
    return ageDays >= SLA_BREACH_DAYS
  })

  // Reg table rows (typed as Record for OperationalTable)
  type RegRow = Record<string, unknown> & {
    id: string; employee: string; date_display: string; reason: string; submitted: string; age_label: string
  }
  const regRows: RegRow[] = escalatedRegList.slice(0, 12).map(r => {
    const ageDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1_000 * 60 * 60 * 24))
    return {
      id:           r.id,
      employee:     r.employee_name ? `${r.employee_name}${r.employee_code ? ` · ${r.employee_code}` : ''}` : 'Employee',
      date_display: fmtDate(r.date),
      reason:       (r.reason ?? '').slice(0, 55) + ((r.reason ?? '').length > 55 ? '…' : ''),
      submitted:    fmtDate(r.created_at),
      age_label:    ageDays === 1 ? '1 day' : `${ageDays} days`,
    }
  })

  const regColumns: OpsTableColumn[] = [
    { header: 'Employee',  key: 'employee',     className: 'min-w-[140px]' },
    { header: 'Date',      key: 'date_display', width: '80px' },
    { header: 'Reason',    key: 'reason',       className: 'text-muted-foreground' },
    { header: 'Submitted', key: 'submitted',    width: '70px', className: 'text-muted-foreground' },
    {
      header: 'Pending',
      key:    'age_label',
      width:  '70px',
      render: row => (
        <Badge variant="destructive" className="rounded-full text-[10px]">
          {row.age_label as string}
        </Badge>
      ),
    },
    {
      header: '',
      key:    '_link',
      width:  '80px',
      align:  'right',
      render: () => (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 text-primary"
          onClick={(e) => { e.stopPropagation(); navigate('/admin/attendance/regularisation') }}
        >
          Review →
        </Button>
      ),
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Command Center"
        title={`${tenant?.name ?? 'Workspace'} Overview`}
        subtitle={label}
        actions={
          <>
            <button
              onClick={() => { refetchStats() }}
              className="gloss-sheen flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-medium text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
            <button
              onClick={() => navigate('/admin/employees/new')}
              className="gloss-sheen flex h-8 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <UserPlus className="h-3 w-3" /> Add Employee
            </button>
          </>
        }
      />

      {/* ── Processing / system status banner ────────────────────────── */}
      {(runFailed || isStale || lastRun) && (
        <InfoBanner
          variant={runFailed ? 'destructive' : isStale ? 'warning' : 'success'}
          message={
            runFailed ? 'Last attendance processing run failed' :
            isStale   ? 'Attendance not yet processed today' :
                        `Processed: ${lastRun?.processed_count ?? 0} employees`
          }
          detail={
            lastRun
              ? `· ${fmtDateTime(lastRun.started_at)}${lastRun.duration_ms ? ` · ${Math.round(lastRun.duration_ms / 1000)}s` : ''}`
              : '· No runs recorded'
          }
          action={{ label: 'Process now', onClick: () => navigate('/admin/attendance/process') }}
        />
      )}

      {/* ── KPI Cards row (6 cards) ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <OperationalKPICard
          label="Total Employees"
          value={statsLoading ? '—' : (stats?.total_employees ?? 0)}
          icon={Users}
          variant="neutral"
        />
        <OperationalKPICard
          label="Active"
          value={statsLoading ? '—' : (stats?.active_employees ?? 0)}
          icon={UserCheck}
          variant="success"
          trend={stats?.active_employees && stats?.total_employees
            ? { value: Math.round((stats.active_employees / stats.total_employees) * 100), label: 'of total' }
            : undefined
          }
        />
        <OperationalKPICard
          label="New Joiners"
          value={statsLoading ? '—' : (stats?.new_joiners_this_month ?? 0)}
          icon={UserPlus}
          variant={(stats?.new_joiners_this_month ?? 0) > 0 ? 'info' : 'neutral'}
        />
        <OperationalKPICard
          label="Absent Today"
          value={todayAbsent}
          icon={UserX}
          variant={todayAbsent > 0 ? 'warning' : 'neutral'}
          sparkData={absentSparkData.slice(-8)}
          onClick={() => navigate('/admin/attendance/muster')}
        />
        <OperationalKPICard
          label="Anomalies"
          value={anomalyCount}
          icon={AlertTriangle}
          variant={anomalyCount > 0 ? 'warning' : 'neutral'}
          onClick={() => navigate('/admin/attendance/anomalies')}
        />
        <OperationalKPICard
          label="Pending Corrections"
          value={correctionsCount}
          icon={Clock}
          variant={correctionsCount > 0 ? 'destructive' : 'neutral'}
          sparkData={pendingSparkData}
          onClick={() => navigate('/admin/attendance/corrections')}
        />
      </div>

      {/* ── Charts row ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Absent trend — wider panel */}
        <OperationalSurface className="lg:col-span-3">
          <SectionHeader
            title="Absent Trend"
            subtitle="Daily absent count — last 14 days"
            action={
              <Button
                size="sm" variant="ghost" className="h-6 text-[11px]"
                onClick={() => navigate('/admin/attendance/muster')}
              >
                Muster Roll <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          {absentTrend.length > 1 ? (
            <InsightChart
              type="bar"
              data={absentTrend}
              xKey="date"
              yKeys={[{ key: 'absent', label: 'Absent', color: 'chart4' }]}
              height={148}
            />
          ) : (
            <EmptyWorkspaceState context="custom" title="No trend data" />
          )}
        </OperationalSurface>

        {/* Employment types donut */}
        <OperationalSurface className="lg:col-span-2">
          <SectionHeader title="Employment Types" />
          {empTypeData.length > 0 ? (
            <InsightChart
              type="donut"
              data={empTypeData}
              xKey="type"
              yKeys={[{ key: 'count' }]}
              height={148}
            />
          ) : (
            <EmptyWorkspaceState context="custom" title="No data" />
          )}
        </OperationalSurface>
      </div>

      {/* ── Attention + Quick Actions row ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Attention Required */}
        <OperationalSurface className="lg:col-span-2">
          <SectionHeader title="Attention Required" />
          <div className="space-y-0.5">
            <AlertRow
              icon={AlertTriangle}
              label="Attendance Anomalies"
              count={anomalyCount}
              variant={anomalyCount > 0 ? 'warning' : 'neutral'}
              href="/admin/attendance/anomalies"
            />
            <AlertRow
              icon={Clock}
              label="Pending Corrections"
              count={correctionsCount}
              variant={correctionsCount > 0 ? 'destructive' : 'neutral'}
              href="/admin/attendance/corrections"
            />
            <AlertRow
              icon={ClipboardList}
              label="Regularisation Requests"
              count={regList.length}
              variant={regList.length > 0 ? 'info' : 'neutral'}
              href="/admin/attendance/regularisation"
            />
            {upcomingHolidays.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 mb-1.5">
                  Upcoming Holidays
                </p>
                {upcomingHolidays.slice(0, 3).map(h => (
                  <div key={h.id} className="flex items-center justify-between px-2 py-1 text-xs">
                    <span className="text-foreground/80 truncate">{h.name}</span>
                    <span className="text-muted-foreground flex-shrink-0 ml-2">{fmtDate(h.date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </OperationalSurface>

        {/* Quick Actions */}
        <OperationalSurface className="lg:col-span-3">
          <SectionHeader title="Quick Actions" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
            <QuickActionRow
              icon={Play}
              label="Process Attendance"
              onClick={() => navigate('/admin/attendance/process')}
            />
            <QuickActionRow
              icon={CheckSquare}
              label="Review Regularisation"
              detail={regList.length > 0 ? `${regList.length} pending` : undefined}
              onClick={() => navigate('/admin/attendance/regularisation')}
            />
            <QuickActionRow
              icon={CalendarCheck}
              label="Muster Roll"
              onClick={() => navigate('/admin/attendance/muster')}
            />
            <QuickActionRow
              icon={Activity}
              label="Attendance Audit Log"
              onClick={() => navigate('/admin/attendance/audit')}
            />
            <QuickActionRow
              icon={Users}
              label="People Directory"
              onClick={() => navigate('/admin/employees')}
            />
            <QuickActionRow
              icon={FileSearch}
              label="Leave Types & Balances"
              onClick={() => navigate('/admin/leave/types')}
            />
            <QuickActionRow
              icon={Zap}
              label="Observability"
              onClick={() => navigate('/admin/system/observability')}
            />
            <QuickActionRow
              icon={Shield}
              label="Compliance"
              onClick={() => navigate('/admin/compliance')}
            />
          </div>
        </OperationalSurface>
      </div>

      {/* ── Department breakdown ──────────────────────────────────────── */}
      {deptData.length > 0 && (
        <OperationalSurface>
          <SectionHeader
            title="Headcount by Department"
            action={
              <Button
                size="sm" variant="ghost" className="h-6 text-[11px]"
                onClick={() => navigate('/admin/employees')}
              >
                View People <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
          <InsightChart
            type="bar"
            data={deptData}
            xKey="name"
            yKeys={[{ key: 'count', label: 'Employees', color: 'chart1' }]}
            height={140}
          />
        </OperationalSurface>
      )}

      {/* ── Escalated Corrections ────────────────────────────────────── */}
      <OperationalSurface noPad>
        <div className="px-4 pt-4 pb-2">
          <SectionHeader
            title="Escalated Corrections"
            subtitle="Manager SLA breached — pending ≥2 days"
            action={
              <Button
                size="sm" variant="ghost" className="h-6 text-[11px]"
                onClick={() => navigate('/admin/attendance/regularisation')}
              >
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          />
        </div>
        <OperationalTable
          columns={regColumns}
          rows={regRows}
          rowKey={r => r.id as string}
          emptyText="No pending regularisation requests — all clear"
        />
        {regRows.length > 0 && (
          <div className="px-4 pb-3 pt-1">
            <p className="text-[11px] text-muted-foreground">
              Showing {regRows.length} of {regList.length} requests
            </p>
          </div>
        )}
      </OperationalSurface>

    </div>
  )
}
