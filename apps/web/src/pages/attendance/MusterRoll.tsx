/**
 * MusterRoll — /attendance/muster
 *
 * Live workforce attendance operations control surface.
 * Monthly muster roll grid with operational intelligence, inline workflow
 * continuity, bulk governance actions, and payroll-aware right rail.
 *
 * Access: hr_admin and super_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { Link }          from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, ShieldAlert,
  TableProperties, Search, RefreshCw,
  CalendarCheck2, CalendarX2, Users,
  Minimize2, Maximize2, Download,
  AlertTriangle, Activity, FileText,
  ClipboardEdit, ClipboardCheck,
  CheckSquare, Square, CheckCircle2,
  Calendar, Loader2, Play,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { PeriodLockBanner } from '@/components/layout/PeriodLockBanner'
import { TableToolbar, EmptyTableState } from '@/components/table'
import { usePeriodLock }    from '@/hooks/usePeriodLock'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import {
  FORENSICS_LINKABLE,
  computeSummary,
  computePayableDays,
  computeMonthTotals,
  countMissingRecords,
  computeEmployeeSummary,
} from '@/lib/attendance/selectors'
import { formatMonthLabel } from '@/lib/attendance/attendance-period-context'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayRecord {
  date:         string
  status:       string | null
  work_hours:   number
  late_minutes: number
}

interface EmployeeMuster {
  employee_id:   string
  employee_code: string
  name:          string
  days:          DayRecord[]
}

interface MusterData {
  month:     string
  employees: EmployeeMuster[]
}

// PayrollTotals and PayrollSummaryData removed — payroll metrics are now
// computed client-side from the muster data to guarantee a single source of
// truth. The /attendance/payroll-summary endpoint used is_payable + day_fraction
// which are NULL for CSV-sourced rows and produced incorrect values.

interface LatestMonthData {
  month:         string | null
  current_month: string
}

// Phase 6 — 'lop-risk' and 'missing-records' added for operational scanning
type StatusFilter =
  | 'all'
  | 'has-exceptions'
  | 'has-absence'
  | 'has-late'
  | 'on-leave'
  | 'lop-risk'
  | 'missing-records'

// ── Status display maps ───────────────────────────────────────────────────────
// Phase 3 — Extended with operational states: overtime, missing_punch, no_punch

const STATUS_SHORT: Record<string, string> = {
  present:       'P',
  late:          'L',
  absent:        'A',
  half_day:      'H',
  holiday:       'Ho',
  weekend:       'WE',
  weekly_off:    'WO',
  leave:         'Lv',
  overtime:      'OT',
  missing_punch: 'MP',
  no_punch:      'NP',
}

const STATUS_CELL: Record<string, string> = {
  present:       'bg-success/20 text-success',
  late:          'bg-warning/20 text-warning',
  absent:        'bg-destructive/20 text-destructive',
  half_day:      'bg-muted text-muted-foreground',
  holiday:       'bg-info/20 text-info',
  weekend:       'bg-muted/30 text-muted-foreground/50',
  weekly_off:    'bg-muted/30 text-muted-foreground/50',
  leave:         'bg-accent/20 text-accent-foreground',
  overtime:      'bg-info/20 text-info',
  // missing_punch / no_punch: distinct destructive border — payroll-critical
  missing_punch: 'bg-destructive/10 text-destructive ring-1 ring-destructive/40',
  no_punch:      'bg-destructive/10 text-destructive ring-1 ring-destructive/40',
}

const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// PAYABLE_STATUSES and FORENSICS_LINKABLE are imported from @/lib/attendance/selectors

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthStr(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

// computeSummary and computePayableDays are imported from @/lib/attendance/selectors

/** Generate and trigger download of a CSV export for the visible muster grid. */
function exportMusterCsv(employees: EmployeeMuster[], dates: string[], monthLabel: string) {
  if (!employees.length || !dates.length) return
  const header = ['Employee Code', 'Employee Name', ...dates, 'P', 'L', 'A', 'Lv', 'H', 'OT', 'MP', 'Payable Days']
  const rows = employees.map(emp => {
    const dayMap = new Map(emp.days.map(d => [d.date, d]))
    const summary = computeSummary(emp.days)
    const payable = computePayableDays(emp.days)
    const dayCells = dates.map(d => dayMap.get(d)?.status ?? '')
    return [
      emp.employee_code,
      emp.name,
      ...dayCells,
      summary.present         ?? 0,
      summary.late            ?? 0,
      summary.absent          ?? 0,
      summary.leave           ?? 0,
      summary.half_day        ?? 0,
      summary.overtime        ?? 0,
      (summary.missing_punch ?? 0) + (summary.no_punch ?? 0),
      (payable ?? 0).toFixed(1),
    ]
  })
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `muster-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MusterRoll() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const [viewDate,         setViewDate]         = useState(() => new Date())
  const [search,           setSearch]           = useState('')
  const [compact,          setCompact]          = useState(false)
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>('all')
  const [selected,         setSelected]         = useState<Set<string>>(new Set())
  // Tracks the real-world month we were on before the auto-navigation kicked in
  const [autoNavigatedFrom, setAutoNavigatedFrom] = useState<string | null>(null)
  const hasAutoNavigated = useRef(false)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const ms    = monthStr(year, month)

  // ── Period lock awareness ──────────────────────────────────────────────────
  const { state: periodState } = usePeriodLock(ms)

  const monthLabel = formatMonthLabel(ms)
  const todayStr   = new Date().toISOString().slice(0, 10)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<MusterData>({
    queryKey: ['muster', ms],
    queryFn:  () => api.get<MusterData>(`/attendance/muster?month=${ms}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Latest active month — auto-navigate away from empty current month ────────
  const { data: latestMonthData } = useQuery<LatestMonthData>({
    queryKey: ['muster-latest-month'],
    queryFn:  () => api.get<LatestMonthData>('/attendance/muster/latest-month'),
    enabled:  isAdmin,
    staleTime: 300_000,   // 5 min — changes rarely
  })

  useEffect(() => {
    if (hasAutoNavigated.current) return
    if (!latestMonthData?.month) return
    const currentMonthStr = monthStr(new Date().getFullYear(), new Date().getMonth())
    if (latestMonthData.month === currentMonthStr) return   // data exists for current month; no action needed
    // Auto-navigate to last active period
    const [ly, lm] = latestMonthData.month.split('-').map(Number)
    setViewDate(new Date(ly, lm - 1, 1))
    setAutoNavigatedFrom(currentMonthStr)
    hasAutoNavigated.current = true
  }, [latestMonthData?.month])

  const allEmployees = useMemo(() => data?.employees ?? [], [data])

  // ── Canonical metrics — all derived from shared selectors (attendance/selectors.ts)
  // Selectors use the same PAYABLE_STATUSES / LOP_STATUSES constants as the backend
  // read model, ensuring the stat chips, Payroll Impact rail, and the grid are all
  // consistent with each other and with /attendance/payroll-summary.
  const monthTotals = useMemo(() => {
    const summaries = allEmployees.map(emp => computeEmployeeSummary(emp.days))
    return computeMonthTotals(summaries)
  }, [allEmployees])

  // Aliases kept for template readability (used in JSX below)
  const payrollMetrics = useMemo(() => ({
    totalPayableDays: monthTotals.totalPayableDays,
    totalLopDays:     monthTotals.totalLopDays,
    totalOnLeave:     monthTotals.totalOnLeave,
  }), [monthTotals])

  const rosterSummary = useMemo(() => ({
    totalPresent:       monthTotals.totalPresent,
    totalAbsent:        monthTotals.totalAbsent,
    totalLate:          monthTotals.totalLate,
    totalLeave:         monthTotals.totalOnLeave,
    totalMissingPunch:  monthTotals.totalMissingPunch,
    empWithAbsence:     monthTotals.empWithAbsence,
    empWithLate:        monthTotals.empWithLate,
    empWithMissingPunch: monthTotals.empWithMissingPunch,
  }), [monthTotals])

  // Phase 7 — Missing records: past working weekdays (Mon–Fri) with no status.
  // These are unprocessed days — a payroll-critical signal.
  const missingRecordCount = useMemo(
    () => countMissingRecords(allEmployees, todayStr),
    [allEmployees, todayStr],
  )

  // ── Runtime payload trace ─────────────────────────────────────────────────
  // Logs the complete data transformation chain to the browser console every
  // time the muster data or the derived month changes.  Open DevTools → Console
  // and look for the "[MusterRoll] Payload trace" group to see the raw counts
  // at every step of the pipeline.
  //
  // What to look for:
  //   • rawStatusDist  — exactly what attendance_daily returned for each status
  //   • rosterSummary  — derived from the same raw rows
  //   • payrollMetrics — derived from the same raw rows
  //
  // If rawStatusDist has 'present': N but rosterSummary.totalPresent is 0,
  // there is a React state inconsistency (allEmployees stale / wrong reference).
  //
  // ── Filtered employees ─────────────────────────────────────────────────────
  const employees = useMemo(() => {
    return allEmployees.filter(e => {
      const q = search.toLowerCase()
      const matchSearch = !q || e.name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q)
      if (!matchSearch) return false
      if (statusFilter === 'all') return true
      const s = computeSummary(e.days)
      if (statusFilter === 'has-exceptions')   return (s.absent ?? 0) > 0 || (s.late ?? 0) > 0
      if (statusFilter === 'has-absence')      return (s.absent ?? 0) > 0
      if (statusFilter === 'has-late')         return (s.late ?? 0) > 0
      if (statusFilter === 'on-leave')         return (s.leave ?? 0) > 0
      // Phase 6 — LOP risk: 3+ absent days this month
      if (statusFilter === 'lop-risk')         return (s.absent ?? 0) >= 3
      // Phase 6 — missing records: at least one past weekday with no status
      if (statusFilter === 'missing-records') {
        return e.days.some(d => {
          if (!d.status && d.date < todayStr) {
            const dow = new Date(`${d.date}T12:00:00.000Z`).getUTCDay()
            return dow >= 1 && dow <= 5
          }
          return false
        })
      }
      return true
    })
  }, [allEmployees, search, statusFilter, todayStr])

  // ── Row windowing ──────────────────────────────────────────────────────────
  // The grid renders ~31 cells per employee; at 500+ employees that's 15k+ DOM
  // nodes and the page crawls. Render at most MUSTER_PAGE_SIZE rows at a time.
  const MUSTER_PAGE_SIZE = 50
  const [musterPage, setMusterPage] = useState(0)
  const musterPageCount = Math.max(1, Math.ceil(employees.length / MUSTER_PAGE_SIZE))
  // Clamp + reset when filters shrink the list below the current page
  useEffect(() => {
    if (musterPage >= musterPageCount) setMusterPage(0)
  }, [musterPage, musterPageCount])
  const pagedEmployees = useMemo(
    () => employees.slice(musterPage * MUSTER_PAGE_SIZE, (musterPage + 1) * MUSTER_PAGE_SIZE),
    [employees, musterPage],
  )

  // All days in month (from first employee's days array)
  const days: DayRecord[] = allEmployees[0]?.days ?? []
  const dates = days.map(d => d.date)

  // ── Bulk selection ─────────────────────────────────────────────────────────
  const allSelected = employees.length > 0 && employees.every(e => selected.has(e.employee_id))

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(_prev =>
      allSelected ? new Set() : new Set(employees.map(e => e.employee_id))
    )
  }

  const handleExport = useCallback(() => {
    exportMusterCsv(employees, dates, monthLabel)
  }, [employees, dates, monthLabel])

  function handleExportSelected() {
    const sel = employees.filter(e => selected.has(e.employee_id))
    exportMusterCsv(sel, dates, monthLabel)
  }

  // Processing state — true while background recompute is running on the server.
  // The API returns 202 immediately; we poll by auto-refreshing every 30s until
  // the user dismisses or navigates away.
  const [processingMonth, setProcessingMonth] = useState<string | null>(null)
  const processingPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (processingMonth !== ms) {
      // Month changed — cancel any outstanding poll
      if (processingPollRef.current) clearInterval(processingPollRef.current)
      processingPollRef.current = null
      setProcessingMonth(null)
    }
  }, [ms, processingMonth])

  // Clean up interval on unmount
  useEffect(() => () => { if (processingPollRef.current) clearInterval(processingPollRef.current) }, [])

  const processMonth = useMutation({
    mutationFn: () => {
      const lastDay = new Date(year, month + 1, 0).toISOString().slice(0, 10)
      return api.post<{ status: string; employees_queued?: number }>('/attendance/recompute', {
        from_date: `${ms}-01`,
        to_date:   lastDay,
      })
    },
    onSuccess: (data) => {
      if ((data as any)?.status === 'processing') {
        // 202 — background job started; poll every 30s and auto-refresh
        setProcessingMonth(ms)
        toast.info(`Recompute started for ${monthLabel}`, {
          description: `Processing ${(data as any)?.employees_queued ?? ''} employees in background. The muster roll will refresh every 30 seconds.`,
          duration: 10_000,
        })
        if (processingPollRef.current) clearInterval(processingPollRef.current)
        processingPollRef.current = setInterval(() => {
          refetch()
        }, 30_000)
      } else {
        // Instant completion (0 employees or single-employee path)
        toast.success(`Attendance processed for ${monthLabel}`)
        refetch()
      }
    },
    onError: (err: any) => {
      const msg = (err?.message ?? '') as string
      if (msg.includes('PERIOD_LOCKED')) {
        toast.error('Period is locked', { description: 'Reverse the payroll finalization before reprocessing.' })
      } else {
        toast.error('Failed to start recompute', { description: msg || 'Unexpected error. Check server logs.' })
      }
    },
  })

  const isProcessing = processingMonth === ms

  // Phase 5 — Bulk workflow links pass selected employee IDs as context
  const selectedIdsParam = [...selected].join(',')

  // Density-driven size tokens
  const cellW      = compact ? 'w-[26px] min-w-[26px]' : 'w-[38px] min-w-[38px]'
  const chipW      = compact ? 'w-[22px] h-[18px] text-[9px]'  : 'w-[30px] h-[22px] text-[10px]'
  const chipWEmpty = compact ? 'w-[22px] h-[18px]' : 'w-[30px] h-[22px]'

  // Payroll readiness signal derived from local muster data (no extra query)
  const isAttendanceReady = !isLoading && missingRecordCount === 0

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Attendance', href: '/admin/attendance' }, { label: 'Muster Roll' }]}
        title="Muster Roll"
        subtitle="Live workforce attendance — exceptions, payroll continuity, and operational governance"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can view the muster roll.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          {/* ── Auto-navigation notice: shown when we jumped to the last active period ── */}
          {autoNavigatedFrom && (
            <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-info flex-shrink-0" />
                <span className="text-[12px] text-foreground">
                  No attendance data for the current month — showing last active period:{' '}
                  <span className="font-semibold">{monthLabel}</span>
                </span>
              </div>
              <button
                onClick={() => {
                  setAutoNavigatedFrom(null)
                  setViewDate(new Date())
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground flex-shrink-0 whitespace-nowrap"
              >
                Go to current month ×
              </button>
            </div>
          )}

          {/* ── Data Verification Panel ─────────────────────────────────────
               Collapsed by default. Expand to see raw vs. derived counts at
               every step of the pipeline. Shows exactly what attendance_daily
               returned and what each widget is deriving from it.
               Also check browser DevTools → Console for the full "Payload trace"
               group with deep per-employee samples.
          ────────────────────────────────────────────────────────────────── */}
          {data && !isLoading && (
            <details className="rounded-md border border-border/60 bg-muted/30 text-[10px] font-mono">
              <summary className="px-3 py-1.5 cursor-pointer text-muted-foreground hover:text-foreground select-none">
                ▶ Data Verification Panel — {ms} ({allEmployees.length} employees, {(data.employees).flatMap(e => e.days).filter(d => d.status !== null).length} status rows)
              </summary>
              <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-muted-foreground">
                {/* Column 1 — Raw API status distribution */}
                <div>
                  <div className="font-semibold text-foreground mb-1">1. Raw API (attendance_daily)</div>
                  {Object.entries(
                    data.employees.flatMap(e => e.days)
                      .reduce<Record<string, number>>((acc, d) => {
                        if (d.status) acc[d.status] = (acc[d.status] ?? 0) + 1
                        return acc
                      }, {})
                  ).sort().map(([s, n]) => (
                    <div key={s}><span className="text-foreground">{s}:</span> {n}</div>
                  ))}
                  <div className="mt-1 border-t border-border/40 pt-1">
                    <span className="text-foreground">null (no row):</span>{' '}
                    {data.employees.flatMap(e => e.days).filter(d => d.status === null).length}
                  </div>
                </div>

                {/* Column 2 — rosterSummary derived values */}
                <div>
                  <div className="font-semibold text-foreground mb-1">2. rosterSummary (derived)</div>
                  <div><span className="text-foreground">totalPresent:</span> {rosterSummary.totalPresent}</div>
                  <div><span className="text-foreground">totalLate:</span> {rosterSummary.totalLate}</div>
                  <div><span className="text-foreground">totalAbsent:</span> {rosterSummary.totalAbsent}</div>
                  <div><span className="text-foreground">totalLeave:</span> {rosterSummary.totalLeave}</div>
                  <div><span className="text-foreground">totalMissingPunch:</span> {rosterSummary.totalMissingPunch}</div>
                  <div><span className="text-foreground">empWithAbsence:</span> {rosterSummary.empWithAbsence}</div>
                </div>

                {/* Column 3 — payrollMetrics derived values */}
                <div>
                  <div className="font-semibold text-foreground mb-1">3. payrollMetrics (derived)</div>
                  <div><span className="text-foreground">totalPayableDays:</span> {(payrollMetrics.totalPayableDays ?? 0).toFixed(2)}</div>
                  <div><span className="text-foreground">totalLopDays:</span> {payrollMetrics.totalLopDays}</div>
                  <div><span className="text-foreground">totalOnLeave:</span> {payrollMetrics.totalOnLeave}</div>
                </div>

                {/* Column 4 — What the widgets actually render */}
                <div>
                  <div className="font-semibold text-foreground mb-1">4. Widget values (rendered)</div>
                  <div><span className="text-foreground">Payable Days chip:</span> {(payrollMetrics.totalPayableDays ?? 0).toFixed(1)}</div>
                  <div><span className="text-foreground">LOP Days chip:</span> {payrollMetrics.totalLopDays}</div>
                  <div><span className="text-foreground">On Leave chip:</span> {payrollMetrics.totalOnLeave}</div>
                  <div><span className="text-foreground">LOP Risk chip:</span> {rosterSummary.empWithAbsence}</div>
                  <div className="mt-1 border-t border-border/40 pt-1">
                    <span className="text-foreground">Month Exceptions rail:</span>
                    <div className="pl-2">Absent: {rosterSummary.totalAbsent} | Late: {rosterSummary.totalLate}</div>
                  </div>
                  <div className="mt-1">
                    <span className="text-foreground">allEmployees:</span> {allEmployees.length}
                    {' / '}
                    <span className="text-foreground">filtered:</span> {employees.length}
                  </div>
                </div>
              </div>
            </details>
          )}

          {/* ── Phase 6: Compact Payroll Stat Chips (4-up) ──────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label:    'Payable Days',
                icon:     <CalendarCheck2 className="h-3.5 w-3.5 text-success" />,
                value:    isLoading ? '…' : (payrollMetrics.totalPayableDays ?? 0).toFixed(1),
                colorCls: 'text-success',
              },
              {
                label:    'LOP Days',
                icon:     <CalendarX2 className="h-3.5 w-3.5 text-destructive" />,
                value:    isLoading ? '…' : payrollMetrics.totalLopDays,
                colorCls: 'text-destructive',
              },
              {
                label:    'On Leave',
                icon:     <Users className="h-3.5 w-3.5 text-info" />,
                value:    isLoading ? '…' : payrollMetrics.totalOnLeave,
                colorCls: 'text-info',
              },
              {
                label:    'LOP Risk Employees',
                icon:     <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
                value:    isLoading ? '…' : rosterSummary.empWithAbsence,
                colorCls: rosterSummary.empWithAbsence > 0 ? 'text-warning' : 'text-muted-foreground',
              },
            ].map(({ label, icon, value, colorCls }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3 flex items-center gap-2.5">
                <div className="rounded-md bg-muted p-1.5 flex-shrink-0">{icon}</div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground font-medium truncate">{label}</p>
                  <p className={cn('text-lg font-bold leading-none', colorCls)}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Main content + Right rail ──────────────────────────────── */}
          <div className="flex gap-4 items-start">

            {/* Main muster table */}
            <div className="flex-1 min-w-0">
              <SectionCard
                noPadding
                title={monthLabel}
                icon={<TableProperties className="h-4 w-4 text-muted-foreground" />}
              >
                {/* Toolbar */}
                <TableToolbar
                  left={
                    <div className="flex items-center gap-2">
                      {/* Phase 6 — Status filter with operational options */}
                      <select
                        value={statusFilter}
                        onChange={e => {
                          setStatusFilter(e.target.value as StatusFilter)
                          setSelected(new Set())
                        }}
                        className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                      >
                        <option value="all">All Employees</option>
                        <option value="has-exceptions">Has Exceptions</option>
                        <option value="has-absence">Has Absence</option>
                        <option value="has-late">Has Late</option>
                        <option value="on-leave">On Leave</option>
                        <option value="lop-risk">LOP Risk (3+ Absent)</option>
                        <option value="missing-records">Missing Records</option>
                      </select>
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          className="h-7 pl-7 w-32 text-xs"
                          placeholder="Search…"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                        />
                      </div>
                    </div>
                  }
                  right={
                    <div className="flex items-center gap-1">
                      {/* Month nav with visible label */}
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { setViewDate(new Date(year, month - 1, 1)); setSelected(new Set()) }}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-[11px] text-muted-foreground font-medium min-w-[88px] text-center tabular-nums">
                        {monthLabel}
                      </span>
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => { setViewDate(new Date(year, month + 1, 1)); setSelected(new Set()) }}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()}
                        title="Refresh muster data">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      {isProcessing ? (
                        <button
                          className="inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-info/40 bg-info/10 text-info"
                          onClick={() => {
                            if (processingPollRef.current) clearInterval(processingPollRef.current)
                            processingPollRef.current = null
                            setProcessingMonth(null)
                            refetch()
                          }}
                          title="Recompute is running in background — click to stop auto-refresh"
                        >
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Processing… ×
                        </button>
                      ) : (
                        <Button
                          variant="outline"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => processMonth.mutate()}
                          disabled={processMonth.isPending || periodState === 'PAYROLL_FINALIZED'}
                          title={periodState === 'PAYROLL_FINALIZED' ? 'Period is locked' : `Recompute attendance for ${monthLabel}`}
                        >
                          {processMonth.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Play className="h-3 w-3" />}
                          {processMonth.isPending ? 'Starting…' : 'Process'}
                        </Button>
                      )}
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setCompact(c => !c)}
                        title={compact ? 'Normal density' : 'Compact density'}
                      >
                        {compact
                          ? <Maximize2 className="h-3.5 w-3.5" />
                          : <Minimize2 className="h-3.5 w-3.5" />}
                      </Button>
                      {employees.length > 0 && (
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={handleExport}
                          title="Export all to CSV"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  }
                />

                {/* Period lock banner */}
                {periodState !== 'OPEN' && (
                  <div className="px-4 pt-3 pb-0">
                    <PeriodLockBanner state={periodState} month={ms} />
                  </div>
                )}

                {/* Phase 5 — Bulk action bar with operational context */}
                {selected.size > 0 && (
                  <div className="px-3 py-2 bg-primary/5 border-b border-border flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-foreground">
                      {selected.size} employee{selected.size > 1 ? 's' : ''} selected
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={handleExportSelected}
                      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      Export Selected
                    </button>
                    {/* Phase 5: pass selected employee IDs so target pages can pre-filter */}
                    <Link
                      to={`/admin/attendance/corrections?employees=${encodeURIComponent(selectedIdsParam)}`}
                      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <ClipboardEdit className="h-3 w-3" />
                      Corrections
                    </Link>
                    <Link
                      to={`/admin/attendance/regularisation?employees=${encodeURIComponent(selectedIdsParam)}`}
                      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <ClipboardCheck className="h-3 w-3" />
                      Regularise
                    </Link>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="inline-flex items-center h-6 px-2 text-[11px] rounded-md text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                )}

                {/* Loading skeleton */}
                {isLoading && (
                  <div className="space-y-1 px-4 py-3">
                    <div className="flex gap-0.5 pb-1">
                      <div className="min-w-[28px] h-7 rounded bg-muted animate-pulse" />
                      <div className="min-w-[180px] h-7 rounded bg-muted animate-pulse ml-0.5" />
                      {Array.from({ length: dates.length || 16 }).map((_, i) => (
                        <div key={i} className="w-[38px] h-7 rounded bg-muted/60 animate-pulse" />
                      ))}
                    </div>
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="flex gap-0.5">
                        <div className="min-w-[28px] h-[34px] rounded bg-muted/30 animate-pulse" />
                        <div className="min-w-[180px] h-[34px] rounded bg-muted/40 animate-pulse" />
                        {Array.from({ length: dates.length || 16 }).map((_, j) => (
                          <div key={j} className={cn('w-[38px] h-[34px] rounded animate-pulse', j % 7 === 5 || j % 7 === 6 ? 'bg-muted/20' : 'bg-muted/30')} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Error */}
                {isError && (
                  <div className="flex flex-col items-center gap-2 py-12">
                    <p className="text-sm text-destructive">Failed to load muster roll</p>
                    <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
                  </div>
                )}

                {/* Phase 9 — Contextual empty states */}
                {!isLoading && !isError && employees.length === 0 && (
                  <EmptyTableState
                    preset={search || statusFilter !== 'all' ? 'no-results' : 'no-muster'}
                    title={
                      statusFilter === 'lop-risk'
                        ? 'No LOP risk employees this month'
                        : statusFilter === 'missing-records'
                        ? 'All attendance records are processed'
                        : statusFilter !== 'all' && !search
                        ? `No employees match "${
                            statusFilter === 'has-exceptions' ? 'Has Exceptions' :
                            statusFilter === 'has-absence'    ? 'Has Absence' :
                            statusFilter === 'has-late'       ? 'Has Late' :
                            'On Leave'
                          }" filter`
                        : search ? 'No employees match your search' : undefined
                    }
                    description={
                      statusFilter === 'lop-risk'
                        ? 'No employees have 3+ absent days this month — attendance looks healthy.'
                        : statusFilter === 'missing-records'
                        ? 'Attendance has been processed for all past working days — payroll is unblocked.'
                        : statusFilter !== 'all'
                        ? 'Try a different filter or check a different month.'
                        : search ? 'Try a different name or employee code.' : undefined
                    }
                  />
                )}

                {/* Muster grid */}
                {!isLoading && !isError && employees.length > 0 && (
                  <>
                    <div className="overflow-x-auto -mx-1">
                      <table className="text-xs border-separate border-spacing-0 w-full">
                        <thead>
                          <tr>
                            {/* Checkbox header */}
                            <th className="sticky left-0 z-20 bg-card border-b border-border px-1.5 py-2 w-7 min-w-[28px]">
                              <button
                                onClick={toggleSelectAll}
                                className="flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                                title={allSelected ? 'Deselect all' : 'Select all'}
                              >
                                {allSelected
                                  ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                                  : <Square className="h-3.5 w-3.5" />}
                              </button>
                            </th>
                            {/* Employee header */}
                            <th className="sticky left-7 z-20 bg-card border-b border-border text-left px-3 py-2 min-w-[180px] whitespace-nowrap text-muted-foreground font-semibold text-[11px]">
                              Employee
                            </th>
                            {/* Day headers */}
                            {dates.map(d => {
                              const dow       = new Date(`${d}T12:00:00.000Z`).getUTCDay()
                              const isWeekend = dow === 0 || dow === 6
                              const isToday   = d === todayStr
                              return (
                                <th
                                  key={d}
                                  className={cn(
                                    'border-b border-border text-center py-1.5',
                                    cellW,
                                    isWeekend ? 'text-muted-foreground/50' : 'text-muted-foreground',
                                    isToday && 'text-primary font-bold',
                                  )}
                                >
                                  <div>{new Date(`${d}T12:00:00Z`).getUTCDate()}</div>
                                  {!compact && <div className="text-[8px] font-normal">{DOW_SHORT[dow]}</div>}
                                </th>
                              )
                            })}
                            {/* Summary header */}
                            <th className="sticky right-0 z-20 bg-card border-b border-l border-border text-center px-2 py-2 whitespace-nowrap text-muted-foreground font-semibold text-[11px] min-w-[80px]">
                              Payable / Summary
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedEmployees.map((emp, eIdx) => {
                            const dayMap  = new Map(emp.days.map(d => [d.date, d]))
                            const summary = computeSummary(emp.days)
                            const payable = computePayableDays(emp.days)
                            // Phase 3: LOP risk at 3+ absent (threshold for payroll deduction risk)
                            const lopRisk = (summary.absent ?? 0) >= 3
                            // Phase 3: missing punch / no punch indicator
                            const hasMissingPunch = ((summary.missing_punch ?? 0) + (summary.no_punch ?? 0)) > 0
                            const isSelected = selected.has(emp.employee_id)
                            const rowBg = isSelected
                              ? 'bg-primary/5'
                              : eIdx % 2 === 0 ? 'bg-card' : 'bg-muted/20'

                            return (
                              // Phase 4: group class enables hover-reveal inline actions
                              <tr key={emp.employee_id} className={cn(rowBg, 'group')}>
                                {/* Checkbox cell */}
                                <td className={cn('sticky left-0 z-10 border-b border-border/50 px-1.5 py-1 w-7', rowBg)}>
                                  <button
                                    onClick={() => toggleSelect(emp.employee_id)}
                                    className="flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                                  >
                                    {isSelected
                                      ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                                      : <Square className="h-3.5 w-3.5" />}
                                  </button>
                                </td>

                                {/* Phase 4 — Sticky employee cell with hover-reveal inline actions */}
                                <td className={cn(
                                  'sticky left-7 z-10 border-b border-border/50 px-3 py-1 min-w-[180px]',
                                  rowBg,
                                )}>
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1">
                                        <Link
                                          to={`/admin/employees/${emp.employee_id}`}
                                          className="font-medium text-foreground leading-tight truncate max-w-[120px] hover:text-primary hover:underline block text-xs"
                                        >
                                          {emp.name}
                                        </Link>
                                        {lopRisk && (
                                          <span title="LOP risk — 3+ absences this month" className="flex-shrink-0">
                                            <AlertTriangle className="h-2.5 w-2.5 text-destructive" />
                                          </span>
                                        )}
                                        {hasMissingPunch && !lopRisk && (
                                          <span title="Missing punch — unresolved attendance record" className="flex-shrink-0">
                                            <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground font-mono">{emp.employee_code}</div>
                                    </div>
                                    {/* Phase 4 — Inline workflow actions, visible on row hover */}
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                      <Link
                                        to={`/admin/attendance/forensics?employeeId=${emp.employee_id}&month=${ms}`}
                                        title="Forensics — this employee, this month"
                                        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                      >
                                        <Search className="h-3 w-3" />
                                      </Link>
                                      <Link
                                        to={`/admin/attendance/corrections?employeeId=${emp.employee_id}`}
                                        title="Initiate correction for this employee"
                                        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                      >
                                        <ClipboardEdit className="h-3 w-3" />
                                      </Link>
                                    </div>
                                  </div>
                                </td>

                                {/* Day cells */}
                                {dates.map(d => {
                                  const rec    = dayMap.get(d)
                                  const status = rec?.status ?? null
                                  const short  = status ? (STATUS_SHORT[status] ?? status.slice(0, 2).toUpperCase()) : ''
                                  const cellCls = status ? (STATUS_CELL[status] ?? 'bg-muted text-muted-foreground') : ''
                                  const tooltipText = status
                                    ? `${emp.name} · ${d}\nStatus: ${status}${rec?.work_hours ? `\nHours: ${rec.work_hours}h` : ''}${rec?.late_minutes ? `\nLate: ${rec.late_minutes}m` : ''}${FORENSICS_LINKABLE.has(status) ? '\n↗ Open forensics' : ''}`
                                    : `${emp.name} · ${d}\nNo record`

                                  return (
                                    <td
                                      key={d}
                                      className="border-b border-border/50 px-0.5 py-1 text-center align-middle"
                                    >
                                      {status ? (
                                        FORENSICS_LINKABLE.has(status) ? (
                                          <Link
                                            to={`/admin/attendance/forensics?employeeId=${emp.employee_id}&date=${d}`}
                                            title={tooltipText}
                                            className={cn(
                                              'inline-flex items-center justify-center rounded font-semibold cursor-pointer hover:opacity-70 transition-opacity',
                                              chipW,
                                              cellCls,
                                            )}
                                          >
                                            {short}
                                          </Link>
                                        ) : (
                                          <span
                                            title={tooltipText}
                                            className={cn(
                                              'inline-flex items-center justify-center rounded font-semibold',
                                              chipW,
                                              cellCls,
                                            )}
                                          >
                                            {short}
                                          </span>
                                        )
                                      ) : (
                                        <span className={cn('inline-block', chipWEmpty)} />
                                      )}
                                    </td>
                                  )
                                })}

                                {/* Phase 2 — Summary cell: payable days + per-status breakdown */}
                                <td className={cn(
                                  'sticky right-0 z-10 border-b border-l border-border/50 px-2 py-1.5 whitespace-nowrap min-w-[80px]',
                                  rowBg,
                                )}>
                                  <div className="text-[11px] font-semibold text-foreground mb-0.5">
                                    {(payable ?? 0).toFixed(1)}d
                                  </div>
                                  {/* Phase 2: bumped from text-[9px] → text-[10px] for scanability */}
                                  <div className="flex gap-1 flex-wrap text-[10px]">
                                    {summary.present       ? <span className="text-success">P:{summary.present}</span>  : null}
                                    {summary.late          ? <span className="text-warning">L:{summary.late}</span>     : null}
                                    {summary.absent        ? <span className="text-destructive">A:{summary.absent}</span> : null}
                                    {summary.leave         ? <span className="text-info">Lv:{summary.leave}</span>      : null}
                                    {summary.half_day      ? <span className="text-muted-foreground">H:{summary.half_day}</span> : null}
                                    {summary.overtime      ? <span className="text-info">OT:{summary.overtime}</span>  : null}
                                    {(summary.missing_punch ?? 0) + (summary.no_punch ?? 0) > 0
                                      ? <span className="text-destructive">MP:{(summary.missing_punch ?? 0) + (summary.no_punch ?? 0)}</span>
                                      : null}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Row pager — keeps the DOM small for large workforces */}
                    {employees.length > MUSTER_PAGE_SIZE && (
                      <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground">
                        <span>
                          Showing {musterPage * MUSTER_PAGE_SIZE + 1}–{Math.min((musterPage + 1) * MUSTER_PAGE_SIZE, employees.length)} of {employees.length} employees
                        </span>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" className="h-7 px-2" disabled={musterPage === 0}
                                  onClick={() => setMusterPage(p => p - 1)}>
                            Previous
                          </Button>
                          <span className="px-2 tabular-nums">{musterPage + 1} / {musterPageCount}</span>
                          <Button variant="outline" size="sm" className="h-7 px-2" disabled={musterPage >= musterPageCount - 1}
                                  onClick={() => setMusterPage(p => p + 1)}>
                            Next
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Phase 3 — Legend: extended with operational states */}
                    <div className="flex flex-wrap gap-3 mt-4 pt-3 px-4 pb-3 border-t border-border text-xs text-muted-foreground">
                      {[
                        { label: 'Present (P)',         cls: 'bg-success/20 text-success' },
                        { label: 'Late (L)',             cls: 'bg-warning/20 text-warning' },
                        { label: 'Absent (A)',           cls: 'bg-destructive/20 text-destructive' },
                        { label: 'Half Day (H)',         cls: 'bg-muted text-muted-foreground' },
                        { label: 'Holiday (Ho)',         cls: 'bg-info/20 text-info' },
                        { label: 'Leave (Lv)',           cls: 'bg-accent/20 text-accent-foreground' },
                        { label: 'Overtime (OT)',        cls: 'bg-info/20 text-info' },
                        { label: 'Missing Punch (MP)',   cls: 'bg-destructive/10 text-destructive ring-1 ring-destructive/40' },
                        { label: 'Weekend (WE)',         cls: 'bg-muted/30 text-muted-foreground/50' },
                        { label: 'Weekly Off (WO)',      cls: 'bg-muted/30 text-muted-foreground/50' },
                      ].map(({ label, cls }) => (
                        <span key={label} className="flex items-center gap-1">
                          <span className={cn('inline-flex items-center justify-center w-6 h-4 rounded text-[9px] font-semibold', cls)}>
                            {label.match(/\((.+)\)/)?.[1]}
                          </span>
                          {label.split(' (')[0]}
                        </span>
                      ))}
                    </div>

                    <div className="mt-1 px-4 pb-3 text-xs text-muted-foreground">
                      Showing {employees.length} of {allEmployees.length} employees
                      {selected.size > 0 && <span className="ml-2 text-primary font-medium">· {selected.size} selected</span>}
                      {statusFilter !== 'all' && (
                        <button
                          onClick={() => { setStatusFilter('all'); setSearch('') }}
                          className="ml-2 text-primary hover:underline"
                        >
                          Clear filter
                        </button>
                      )}
                    </div>
                  </>
                )}
              </SectionCard>
            </div>

            {/* ── Phase 8 — Right rail (xl screens only) ──────────────── */}
            <div className="hidden xl:flex flex-col gap-3 w-56 flex-shrink-0">

              {/* Active Period Status — month-aggregate totals from canonical selectors */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">Active Period Status</span>
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-1.5 py-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="text-[11px]">Loading…</span></div>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: 'Present',  value: rosterSummary.totalPresent,  cls: 'text-success' },
                      { label: 'Late',     value: rosterSummary.totalLate,     cls: 'text-warning' },
                      { label: 'Absent',   value: rosterSummary.totalAbsent,   cls: 'text-destructive' },
                      { label: 'On Leave', value: rosterSummary.totalLeave,    cls: 'text-info' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={cn('font-semibold tabular-nums', value === 0 ? 'text-muted-foreground' : cls)}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Phase 8 — Month Exceptions: extended with missing punch + unprocessed signals */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">Month Exceptions</span>
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-1.5 py-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="text-[11px]">Loading…</span></div>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: 'Absent days',       value: rosterSummary.totalAbsent,       cls: 'text-destructive' },
                      { label: 'Late occurrences',  value: rosterSummary.totalLate,          cls: 'text-warning' },
                      { label: 'Missing punches',   value: rosterSummary.totalMissingPunch,  cls: rosterSummary.totalMissingPunch > 0 ? 'text-destructive' : 'text-muted-foreground' },
                      { label: 'Leave days',        value: rosterSummary.totalLeave,         cls: 'text-info' },
                      { label: 'At-risk employees', value: rosterSummary.empWithAbsence,     cls: 'text-foreground' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={cn('font-semibold tabular-nums', value === 0 ? 'text-muted-foreground' : cls)}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Phase 7 — Payroll Impact: attendance readiness signal */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">Payroll Impact</span>
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-1.5 py-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /><span className="text-[11px]">Loading…</span></div>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: 'Payable days', value: (payrollMetrics.totalPayableDays ?? 0).toFixed(1), cls: 'text-success' },
                      { label: 'LOP days',     value: String(payrollMetrics.totalLopDays),         cls: 'text-destructive' },
                      { label: 'On leave',     value: String(payrollMetrics.totalOnLeave),          cls: 'text-info' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={cn('font-semibold tabular-nums', value === '—' ? 'text-muted-foreground' : cls)}>{value}</span>
                      </div>
                    ))}

                    {/* Phase 7 — Attendance readiness signal */}
                    {!isLoading && (
                      <div className="flex items-center justify-between text-[11px] pt-1 mt-1 border-t border-border/40">
                        <span className="text-muted-foreground">Att. readiness</span>
                        {isAttendanceReady ? (
                          <span className="flex items-center gap-0.5 font-semibold text-success">
                            <CheckCircle2 className="h-3 w-3" />
                            Ready
                          </span>
                        ) : (
                          <span
                            className="font-semibold text-warning cursor-pointer hover:underline"
                            onClick={() => setStatusFilter('missing-records')}
                            title={`${missingRecordCount} unprocessed day(s) — click to filter`}
                          >
                            {missingRecordCount} unproc.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <Link
                  to="/admin/payroll/readiness"
                  className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Payroll readiness <ChevronRight className="h-3 w-3" />
                </Link>
              </div>

              {/* Workflows quick nav */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">Workflows</span>
                </div>
                <div className="space-y-1">
                  {[
                    { label: 'Corrections',     href: '/admin/attendance/corrections',    Icon: ClipboardEdit },
                    { label: 'Regularisation',  href: '/admin/attendance/regularisation', Icon: ClipboardCheck },
                    { label: 'Anomaly Review',  href: '/admin/attendance/anomalies',      Icon: AlertTriangle },
                    { label: 'Forensics',       href: '/admin/attendance/forensics',      Icon: Activity },
                  ].map(({ label, href, Icon }) => (
                    <Link
                      key={href}
                      to={href}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground py-0.5 transition-colors"
                    >
                      <Icon className="h-3 w-3 flex-shrink-0" />
                      {label}
                    </Link>
                  ))}
                </div>
              </div>

            </div>
            {/* end right rail */}

          </div>
          {/* end flex row */}

        </>
      )}
    </PageContainer>
  )
}
