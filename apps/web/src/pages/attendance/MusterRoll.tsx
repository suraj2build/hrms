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

import { useState, useCallback, useMemo } from 'react'
import { Link }          from 'react-router-dom'
import { useQuery }      from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, ShieldAlert,
  TableProperties, Search, RefreshCw,
  CalendarCheck2, CalendarX2, Users,
  Minimize2, Maximize2, Download,
  AlertTriangle, Activity, FileText,
  ClipboardEdit, ClipboardCheck,
  CheckSquare, Square, CheckCircle2,
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

interface PayrollTotals {
  total_employees:    number
  total_payable_days: number
  total_lop_days:     number
  total_present:      number
  total_absent:       number
  total_on_leave:     number
}

interface PayrollSummaryData {
  month:   string
  totals:  PayrollTotals
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

// Statuses worth deep-linking to forensics (not weekend/holiday padding)
// Phase 4: missing_punch and no_punch are the most important to investigate
const FORENSICS_LINKABLE = new Set([
  'present', 'late', 'absent', 'half_day', 'leave',
  'overtime', 'missing_punch', 'no_punch',
])

// Payable statuses for per-row payable days computation
// Phase 3: overtime is always a payable day
const PAYABLE_STATUSES = new Set([
  'present', 'late', 'holiday', 'weekend', 'weekly_off', 'overtime',
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthStr(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

function computeSummary(days: DayRecord[]) {
  const counts: Record<string, number> = {}
  for (const d of days) {
    if (d.status) counts[d.status] = (counts[d.status] ?? 0) + 1
  }
  return counts
}

function computePayableDays(days: DayRecord[]): number {
  return days.reduce((acc, d) => {
    if (!d.status) return acc
    if (d.status === 'half_day') return acc + 0.5
    if (PAYABLE_STATUSES.has(d.status)) return acc + 1
    return acc
  }, 0)
}

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
      payable.toFixed(1),
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

  const [viewDate,     setViewDate]     = useState(() => new Date())
  const [search,       setSearch]       = useState('')
  const [compact,      setCompact]      = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected,     setSelected]     = useState<Set<string>>(new Set())

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const ms    = monthStr(year, month)

  const isCurrentMonth = ms === monthStr(new Date().getFullYear(), new Date().getMonth())

  // ── Period lock awareness ──────────────────────────────────────────────────
  const { state: periodState } = usePeriodLock(ms)

  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
  const todayStr   = new Date().toISOString().slice(0, 10)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<MusterData>({
    queryKey: ['muster', ms],
    queryFn:  () => api.get<MusterData>(`/attendance/muster?month=${ms}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: payrollData, isLoading: payrollLoading } = useQuery<PayrollSummaryData>({
    queryKey: ['payroll-summary', ms],
    queryFn:  () => api.get<PayrollSummaryData>(`/attendance/payroll-summary?month=${ms}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const payrollTotals = payrollData?.totals
  const allEmployees  = data?.employees ?? []

  // ── Roster summary (derived from muster data — no extra query) ─────────────
  const rosterSummary = useMemo(() => {
    let totalAbsent = 0, totalLate = 0, totalLeave = 0, totalMissingPunch = 0
    let empWithAbsence = 0, empWithLate = 0, empWithMissingPunch = 0
    let todayAbsent = 0, todayLate = 0, todayPresent = 0, todayOnLeave = 0

    for (const emp of allEmployees) {
      const s = computeSummary(emp.days)
      const a  = s.absent ?? 0
      const l  = s.late   ?? 0
      const mp = (s.missing_punch ?? 0) + (s.no_punch ?? 0)
      totalAbsent       += a
      totalLate         += l
      totalLeave        += (s.leave ?? 0)
      totalMissingPunch += mp
      if (a > 0)  empWithAbsence++
      if (l > 0)  empWithLate++
      if (mp > 0) empWithMissingPunch++

      if (isCurrentMonth) {
        const todayRec = emp.days.find(d => d.date === todayStr)
        if (todayRec?.status === 'absent')  todayAbsent++
        else if (todayRec?.status === 'late')    todayLate++
        else if (todayRec?.status === 'present') todayPresent++
        else if (todayRec?.status === 'leave')   todayOnLeave++
      }
    }
    return {
      totalAbsent, totalLate, totalLeave, totalMissingPunch,
      empWithAbsence, empWithLate, empWithMissingPunch,
      todayAbsent, todayLate, todayPresent, todayOnLeave,
    }
  }, [allEmployees, isCurrentMonth, todayStr])

  // Phase 7 — Missing records: past working weekdays (Mon–Fri) with no status.
  // These are unprocessed days — a payroll-critical signal.
  const missingRecordCount = useMemo(() => {
    let count = 0
    for (const emp of allEmployees) {
      for (const d of emp.days) {
        if (!d.status && d.date < todayStr) {
          const dow = new Date(`${d.date}T12:00:00.000Z`).getUTCDay()
          if (dow >= 1 && dow <= 5) count++
        }
      }
    }
    return count
  }, [allEmployees, todayStr])

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
          {/* ── Phase 6: Compact Payroll Stat Chips (4-up) ──────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label:    'Payable Days',
                icon:     <CalendarCheck2 className="h-3.5 w-3.5 text-success" />,
                value:    payrollLoading ? '…' : (payrollTotals?.total_payable_days?.toFixed(1) ?? '—'),
                colorCls: 'text-success',
              },
              {
                label:    'LOP Days',
                icon:     <CalendarX2 className="h-3.5 w-3.5 text-destructive" />,
                value:    payrollLoading ? '…' : (payrollTotals?.total_lop_days ?? '—'),
                colorCls: 'text-destructive',
              },
              {
                label:    'On Leave',
                icon:     <Users className="h-3.5 w-3.5 text-info" />,
                value:    payrollLoading ? '…' : (payrollTotals?.total_on_leave ?? '—'),
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
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => refetch()}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
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
                          {employees.map((emp, eIdx) => {
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
                                    {payable.toFixed(1)}d
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

              {/* Today's Status — only for current month */}
              {isCurrentMonth && (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold text-foreground">Today's Status</span>
                  </div>
                  {isLoading ? (
                    <div className="text-[11px] text-muted-foreground animate-pulse">Loading…</div>
                  ) : (
                    <div className="space-y-1.5">
                      {[
                        { label: 'Present',  value: rosterSummary.todayPresent,  cls: 'text-success' },
                        { label: 'Late',     value: rosterSummary.todayLate,     cls: 'text-warning' },
                        { label: 'Absent',   value: rosterSummary.todayAbsent,   cls: 'text-destructive' },
                        { label: 'On Leave', value: rosterSummary.todayOnLeave,  cls: 'text-info' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">{label}</span>
                          <span className={cn('font-semibold tabular-nums', value === 0 ? 'text-muted-foreground' : cls)}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Phase 8 — Month Exceptions: extended with missing punch + unprocessed signals */}
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold text-foreground">Month Exceptions</span>
                </div>
                {isLoading ? (
                  <div className="text-[11px] text-muted-foreground animate-pulse">Loading…</div>
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
                {payrollLoading ? (
                  <div className="text-[11px] text-muted-foreground animate-pulse">Loading…</div>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: 'Payable days', value: payrollTotals?.total_payable_days?.toFixed(1) ?? '—', cls: 'text-success' },
                      { label: 'LOP days',     value: String(payrollTotals?.total_lop_days ?? '—'),          cls: 'text-destructive' },
                      { label: 'On leave',     value: String(payrollTotals?.total_on_leave ?? '—'),          cls: 'text-info' },
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
