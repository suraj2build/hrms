/**
 * MyAttendance — /my-attendance
 *
 * Employee self-service attendance view.
 *
 * Features:
 *   · Summary cards  — Present, Absent, Holidays, Total Hours
 *   · Monthly calendar grid — colored cells per status + incomplete warning
 *   · Hover tooltips on day cells — date / status / work hours (no external lib)
 *   · "Today" button  — jumps to current month and auto-selects today
 *   · Export CSV      — client-side CSV of the viewed month
 *   · Day detail panel — click any day to see sessions, hours, badge
 *
 * Data source: GET /attendance/:employeeId?from=&to=
 * Employee ID comes from profile.employee_id (Profile type, optional field).
 *
 * Design rules: design system tokens only — no raw hex, no bg-gray-*, no bg-green-*.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle,
  CalendarDays, Loader2, AlertTriangle, SearchX, WifiOff, RefreshCw,
  Download, FileEdit, LogIn, LogOut,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { PeriodLockBanner } from '@/components/layout/PeriodLockBanner'
import { Badge }            from '@/components/ui/badge'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { usePeriodLock }    from '@/hooks/usePeriodLock'

// ── Types ─────────────────────────────────────────────────────────────────────

type DailyStatus = 'present' | 'late' | 'absent' | 'half_day' | 'holiday' | 'weekend' | 'weekly_off' | 'leave'

interface DailyRecord {
  id:               string
  date:             string
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  status:           DailyStatus
}

interface LogEntry {
  id:        string
  check_in:  string | null
  check_out: string | null
}

interface HolidayEntry {
  id:          string
  date:        string
  name:        string
  is_optional: boolean
}

interface RegularisationRequest {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  status:              'pending' | 'approved' | 'rejected'
  created_at:          string
}

interface AttendanceResponse {
  employee: { id: string; name: string; employee_code: string }
  range:    { from: string; to: string }
  summary:  {
    total_days:  number
    present:     number
    absent:      number
    late:        number
    avg_hours:   number
    total_hours: number
  }
  daily: DailyRecord[]
  logs:  LogEntry[]
}

// ── Style maps ────────────────────────────────────────────────────────────────

const CELL_STYLE: Partial<Record<DailyStatus, string>> = {
  present:    'bg-success/15 text-success ring-1 ring-success/30',
  late:       'bg-warning/15 text-warning ring-1 ring-warning/30',
  absent:     'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
  half_day:   'bg-muted text-muted-foreground ring-1 ring-border',
  holiday:    'bg-info/15 text-info ring-1 ring-info/30',
  weekend:    'bg-muted/40 text-muted-foreground',
  weekly_off: 'bg-muted/40 text-muted-foreground ring-1 ring-border',
  leave:      'bg-accent/15 text-accent-foreground ring-1 ring-accent/30',
}

const BADGE_VARIANT: Partial<Record<DailyStatus, string>> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  half_day:   'secondary',
  holiday:    'info',
  weekend:    'outline',
  weekly_off: 'outline',
  leave:      'secondary',
}

const REG_BADGE_VARIANT: Record<RegularisationRequest['status'], string> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}

// Legend chips mirror CELL_STYLE exactly so users see the same color in the key as on the grid.
// Incomplete shares warning color with Late but uses ring-2 to stay visually distinct.
const LEGEND = [
  { label: 'Present',    cls: 'bg-success/15     ring-1 ring-success/30' },
  { label: 'Late',       cls: 'bg-warning/15     ring-1 ring-warning/30' },
  { label: 'Absent',     cls: 'bg-destructive/15 ring-1 ring-destructive/30' },
  { label: 'Holiday',    cls: 'bg-info/15        ring-1 ring-info/30' },
  { label: 'Incomplete', cls: 'bg-warning/15     ring-2 ring-warning/50' },
] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Short date for tooltip: "Mon, 6 Jan" */
function fmtTooltipDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('default', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function monthStart(y: number, m: number) {
  return new Date(y, m, 1).toISOString().slice(0, 10)
}

function monthEnd(y: number, m: number) {
  return new Date(y, m + 1, 0).toISOString().slice(0, 10)
}

/** Returns a flat array of day-numbers (null = padding outside the month). */
function buildCalendarDays(y: number, m: number): (number | null)[] {
  const firstDow = new Date(y, m, 1).getDay()   // 0 = Sunday
  const total    = new Date(y, m + 1, 0).getDate()
  const cells    = Math.ceil((firstDow + total) / 7) * 7
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length < cells) days.push(null)
  return days
}

/** Escape a single CSV cell per RFC-4180 */
function csvCell(value: string | number) {
  const s = String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

// ── Shared micro-components ───────────────────────────────────────────────────

function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-muted-foreground">
      <Icon className="h-8 w-8 opacity-40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-xs text-center max-w-xs">{description}</p>}
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14">
      <WifiOff className="h-7 w-7 text-destructive opacity-70" />
      <p className="text-sm font-medium text-foreground">Could not load attendance</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Retry
        </Button>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  colorClass: string
}) {
  return (
    <SectionCard>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-muted ${colorClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function MyAttendance() {
  const { profile }   = useAuthStore()
  const employeeId    = profile?.employee_id ?? null

  // Month being viewed
  const [viewDate,    setViewDate]    = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // Correction request form state
  const [correctionDay,   setCorrectionDay]   = useState<string | null>(null)
  const [correctionForm,  setCorrectionForm]  = useState({ checkIn: '', checkOut: '', reason: '' })
  const [correctionError, setCorrectionError] = useState('')

  const queryClient = useQueryClient()

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const from = monthStart(year, month)
  const to   = monthEnd(year, month)

  const attMonth = `${year}-${String(month + 1).padStart(2, '0')}`
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(attMonth)

  const monthLabel = new Date(year, month, 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  })

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1))
    setSelectedDay(null)
  }
  function nextMonth() {
    setViewDate(new Date(year, month + 1, 1))
    setSelectedDay(null)
  }

  /** Jump to the current calendar month and auto-select today's date. */
  function goToToday() {
    const now = new Date()
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1))
    setSelectedDay(now.toISOString().slice(0, 10))
  }

  // ── Query ────────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<AttendanceResponse>({
    queryKey: ['my-attendance', employeeId, from, to],
    queryFn:  () => api.get<AttendanceResponse>(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  // Holiday names — shares cache with the admin Holidays page (same queryKey pattern).
  // Used to display holiday name(s) in the day detail panel.
  const { data: holidaysData } = useQuery<{ data: HolidayEntry[] }>({
    queryKey: ['holidays', year],
    queryFn:  () => api.get<{ data: HolidayEntry[] }>(`/masters/holidays?year=${year}`),
    enabled:  !!employeeId,
    staleTime: 30_000,
  })

  // Regularisation requests for this employee in the viewed month
  const { data: regData, refetch: refetchReg } = useQuery<RegularisationRequest[]>({
    queryKey: ['regularisation-my', employeeId, from, to],
    queryFn:  () => api.get<RegularisationRequest[]>(
      `/attendance/regularisation/my?from=${from}&to=${to}`
    ),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  const regByDate = new Map<string, RegularisationRequest>(
    (regData ?? []).map((r) => [r.date, r])
  )

  // Submit correction request mutation
  const { mutate: submitCorrection, isPending: submittingCorrection } = useMutation({
    mutationFn: (payload: {
      date:                string
      requested_check_in:  string | null
      requested_check_out: string | null
      reason:              string
    }) => api.post('/attendance/regularisation', payload),
    onSuccess: () => {
      setCorrectionDay(null)
      setCorrectionForm({ checkIn: '', checkOut: '', reason: '' })
      setCorrectionError('')
      refetchReg()
      queryClient.invalidateQueries({ queryKey: ['my-attendance', employeeId, from, to] })
    },
    onError: (e: Error) => {
      setCorrectionError(e.message ?? 'Failed to submit request')
    },
  })

  // ── Punch IN / OUT mutation ──────────────────────────────────────────────────
  const [punchError, setPunchError] = useState('')

  const { mutate: punch, isPending: punching } = useMutation({
    mutationFn: (direction: 'IN' | 'OUT') =>
      api.post<{ data: { id: string; direction: string; punched_at: string } }>(
        '/attendance/punch',
        { direction, source: 'web' },
      ),
    onSuccess: () => {
      setPunchError('')
      queryClient.invalidateQueries({ queryKey: ['my-attendance', employeeId, from, to] })
    },
    onError: (e: Error) => {
      setPunchError(e.message ?? 'Punch failed')
    },
  })

  // date string → full HolidayEntry array (preserves is_optional for display)
  const holidaysByDate = new Map<string, HolidayEntry[]>()
  for (const h of holidaysData?.data ?? []) {
    const arr = holidaysByDate.get(h.date) ?? []
    arr.push(h)
    holidaysByDate.set(h.date, arr)
  }

  const daily: DailyRecord[] = data?.daily ?? []
  const logs:  LogEntry[]    = data?.logs  ?? []

  // ── Derived maps ─────────────────────────────────────────────────────────────
  const dailyByDate = new Map(daily.map((d) => [d.date, d]))

  // Days that have at least one session with no OUT punch
  const incompleteByDate = new Set(
    logs
      .filter((l) => !l.check_out && l.check_in)
      .map((l) => l.check_in!.slice(0, 10)),
  )

  // ── Summary values ────────────────────────────────────────────────────────────
  const presentCount  = data?.summary.present    ?? 0
  const absentCount   = data?.summary.absent     ?? 0
  const holidayCount  = daily.filter((d) => d.status === 'holiday').length
  const totalHours    = data?.summary.total_hours ?? 0

  // ── Cell helpers ──────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)

  function cellStyle(dateStr: string): string {
    if (incompleteByDate.has(dateStr)) return 'bg-warning/15 text-warning ring-1 ring-warning/30'
    const rec = dailyByDate.get(dateStr)
    if (!rec) return ''
    return CELL_STYLE[rec.status] ?? ''
  }

  const calendarDays = buildCalendarDays(year, month)

  // ── Selected day data ─────────────────────────────────────────────────────────
  const selectedRec             = selectedDay ? dailyByDate.get(selectedDay) ?? null  : null
  const selectedLogs            = selectedDay ? logs.filter((l) => l.check_in?.startsWith(selectedDay)) : []
  const selectedIncomplete      = selectedDay ? incompleteByDate.has(selectedDay) : false
  const holidaysForSelected = selectedDay ? (holidaysByDate.get(selectedDay) ?? []) : []

  // ── CSV export (client-side, no extra round-trip) ─────────────────────────────
  function handleExport() {
    if (!daily.length) return

    const header = ['Date', 'Day', 'Status', 'Work Hours', 'Late (min)', 'Overtime (min)', 'Sessions']

    const rows = daily.map((d) => {
      const dayLogs   = logs.filter((l) => l.check_in?.startsWith(d.date))
      const dayOfWeek = new Date(`${d.date}T00:00:00`).toLocaleDateString('default', { weekday: 'short' })
      return [
        d.date,
        dayOfWeek,
        d.status.replace('_', ' '),
        d.work_hours,
        d.late_minutes,
        d.overtime_minutes,
        dayLogs.length,
      ]
    })

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n')

    const code     = data?.employee?.employee_code ?? employeeId ?? 'employee'
    const filename = `attendance-${from.slice(0, 7)}-${code}.csv`

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="My Attendance"
        subtitle="Your monthly attendance records"
      />

      {/* No employee_id — profile not linked to an employee record */}
      {!employeeId && (
        <SectionCard>
          <EmptyState
            icon={AlertTriangle}
            title="Profile not linked"
            description="Your account is not linked to an employee record. Please contact HR."
          />
        </SectionCard>
      )}

      {employeeId && (
        <div className="space-y-6">

          {/* ── Summary cards ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={CheckCircle2} label="Present"     value={presentCount}      colorClass="text-success" />
            <StatCard icon={XCircle}      label="Absent"      value={absentCount}       colorClass="text-destructive" />
            <StatCard icon={CalendarDays} label="Holidays"    value={holidayCount}      colorClass="text-info" />
            <StatCard icon={Clock}        label="Total Hours" value={`${totalHours}h`}  colorClass="text-foreground" />
          </div>

          {/* ── Today's Punch Card ──────────────────────────────────────── */}
          {(() => {
            const todayLogs = logs.filter((l) => l.check_in?.startsWith(todayStr))
            const lastLog   = todayLogs[todayLogs.length - 1] ?? null
            const isIn      = lastLog?.check_in && !lastLog?.check_out
            return (
              <SectionCard
                title="Today's Attendance"
                icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Sessions today */}
                  <div className="flex-1 text-sm text-muted-foreground">
                    {todayLogs.length === 0 ? (
                      <span className="italic">No punches recorded today.</span>
                    ) : (
                      <div className="space-y-1">
                        {todayLogs.map((l, i) => (
                          <div key={l.id} className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground w-4">#{i + 1}</span>
                            <span className="text-foreground font-medium">
                              In: {fmtTime(l.check_in)}
                            </span>
                            <span className={l.check_out ? 'text-foreground font-medium' : 'text-warning'}>
                              Out: {l.check_out ? fmtTime(l.check_out) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Punch buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant={isIn ? 'outline' : 'default'}
                      className="h-8 gap-1.5 text-xs"
                      disabled={!!isIn || punching}
                      onClick={() => punch('IN')}
                    >
                      {punching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogIn className="h-3.5 w-3.5" />
                      )}
                      Punch In
                    </Button>
                    <Button
                      size="sm"
                      variant={isIn ? 'default' : 'outline'}
                      className="h-8 gap-1.5 text-xs"
                      disabled={!isIn || punching}
                      onClick={() => punch('OUT')}
                    >
                      {punching ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <LogOut className="h-3.5 w-3.5" />
                      )}
                      Punch Out
                    </Button>
                  </div>
                </div>
                {punchError && (
                  <p className="mt-2 text-xs text-destructive">{punchError}</p>
                )}
              </SectionCard>
            )
          })()}

          {/* ── Period lock banner ────────────────────────────────────────── */}
          {periodState !== 'OPEN' && (
            <PeriodLockBanner state={periodState} month={attMonth} />
          )}

          {/* ── Calendar + Detail panel ───────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Calendar — spans 2 of 3 columns on lg */}
            <SectionCard
              className="lg:col-span-2"
              title={monthLabel}
              icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
              action={
                <div className="flex items-center gap-1">
                  {/* Today quick-jump */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs font-medium px-2"
                    onClick={goToToday}
                  >
                    Today
                  </Button>

                  {/* Divider */}
                  <div className="w-px h-4 bg-border mx-0.5" />

                  {/* Month navigation */}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={prevMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={nextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>

                  {/* Divider */}
                  <div className="w-px h-4 bg-border mx-0.5" />

                  {/* Export CSV */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={isLoading || !daily.length}
                    onClick={handleExport}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                </div>
              }
            >
              {isLoading && <LoadingState label="Loading calendar…" />}
              {isError   && <ErrorState onRetry={() => refetch()} />}

              {!isLoading && !isError && (
                <>
                  {/* Weekday headers */}
                  <div className="grid grid-cols-7 mb-1">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div
                        key={d}
                        className="text-center text-[10px] font-semibold text-muted-foreground py-1"
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Day cells — overflow-visible so tooltips escape the grid boundary */}
                  <div className="grid grid-cols-7 gap-1 overflow-visible">
                    {calendarDays.map((day, i) => {
                      if (!day) return <div key={`pad-${i}`} />

                      const dateStr      = `${from.slice(0, 7)}-${String(day).padStart(2, '0')}`
                      const rec          = dailyByDate.get(dateStr)
                      const isSelected   = selectedDay === dateStr
                      const isToday      = dateStr === todayStr
                      const isIncomplete = incompleteByDate.has(dateStr)

                      // Grid position for smart tooltip placement
                      const col = i % 7
                      const row = Math.floor(i / 7)

                      // Tooltip label combines status + incomplete flag
                      const hasTooltip   = !!(rec || isIncomplete)
                      const statusLabel  = isIncomplete && !rec
                        ? 'Incomplete'
                        : rec
                          ? (isIncomplete
                              ? `${rec.status.replace('_', ' ')} · Incomplete`
                              : rec.status.replace('_', ' '))
                          : ''

                      return (
                        <div key={dateStr} className="relative group">
                          <button
                            type="button"
                            onClick={() => setSelectedDay((prev) => prev === dateStr ? null : dateStr)}
                            className={cn(
                              'w-full aspect-square rounded-md text-xs font-medium transition-all',
                              'flex items-center justify-center select-none',
                              cellStyle(dateStr),
                              !rec && 'text-muted-foreground hover:bg-muted/60',
                              rec  && 'cursor-pointer hover:opacity-80',
                              isSelected && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
                              isToday    && 'font-bold underline underline-offset-2',
                            )}
                          >
                            {day}
                          </button>

                          {/* Lightweight hover tooltip */}
                          {hasTooltip && (
                            <div
                              className={cn(
                                'absolute z-50 pointer-events-none',
                                'invisible group-hover:visible opacity-0 group-hover:opacity-100',
                                'transition-opacity duration-150',
                                'bg-popover text-popover-foreground border border-border',
                                'rounded-md shadow-md px-2.5 py-1.5 text-xs whitespace-nowrap',
                                // Vertical: first row → below cell; all others → above
                                row === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
                                // Horizontal: anchor by column to avoid overflow
                                col <= 1 ? 'left-0' : col >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                              )}
                            >
                              <p className="font-semibold text-foreground">
                                {fmtTooltipDate(dateStr)}
                              </p>
                              <p className="text-muted-foreground capitalize mt-0.5">
                                {statusLabel}
                              </p>
                              {rec?.status === 'holiday' && holidaysByDate.get(dateStr)?.map((h, i) => (
                                <p key={i} className={h.is_optional ? 'text-info/70' : 'text-info'}>
                                  {h.name}{h.is_optional ? ' (Optional)' : ''}
                                </p>
                              ))}
                              {rec && rec.status !== 'holiday' && rec.work_hours > 0 && (
                                <p className="text-muted-foreground">
                                  {rec.work_hours}h worked
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-border">
                    {LEGEND.map(({ label, cls }) => (
                      <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn('w-3 h-3 rounded-sm flex-shrink-0', cls)} />
                        {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </SectionCard>

            {/* Day detail panel */}
            <SectionCard
              title={selectedDay ?? 'Day Detail'}
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            >
              {!selectedDay && (
                <EmptyState
                  icon={CalendarDays}
                  title="Select a day"
                  description="Click any date in the calendar to see details."
                />
              )}

              {selectedDay && (
                <div className="space-y-4 text-sm">
                  {!selectedRec && (
                    <p className="text-xs text-muted-foreground py-6 text-center">
                      No attendance record for this day.
                    </p>
                  )}

                  {selectedRec && (
                    <>
                      {/* Status badge + holiday name(s) */}
                      <div className="space-y-2">
                        <Badge
                          variant={BADGE_VARIANT[selectedRec.status] as 'success' | 'warning' | 'destructive' | 'secondary' | 'info' | 'outline'}
                          className="capitalize rounded-full text-xs"
                        >
                          {selectedRec.status.replace('_', ' ')}
                        </Badge>

                        {selectedRec.status === 'holiday' && (
                          <div className="space-y-0.5">
                            {holidaysForSelected.length > 0
                              ? holidaysForSelected.map((h, i) => (
                                  <p
                                    key={i}
                                    className={cn(
                                      'text-xs font-medium',
                                      h.is_optional ? 'text-info/70' : 'text-info',
                                    )}
                                  >
                                    {h.name}
                                    {h.is_optional && (
                                      <span className="font-normal"> (Optional)</span>
                                    )}
                                  </p>
                                ))
                              : <p className="text-xs text-muted-foreground">Holiday</p>
                            }
                          </div>
                        )}
                      </div>

                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Work Hours',  value: `${selectedRec.work_hours}h` },
                          { label: 'Late',        value: selectedRec.late_minutes > 0 ? `${selectedRec.late_minutes} min` : '—' },
                          { label: 'Overtime',    value: selectedRec.overtime_minutes > 0 ? `${selectedRec.overtime_minutes} min` : '—' },
                          { label: 'Sessions',    value: selectedLogs.length },
                        ].map(({ label, value }) => (
                          <div key={label} className="p-2 rounded-md bg-muted">
                            <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
                            <p className="font-semibold text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Session list */}
                      {selectedLogs.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Sessions
                          </p>
                          {selectedLogs.map((log, idx) => (
                            <div
                              key={log.id}
                              className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50 gap-2"
                            >
                              <span className="text-muted-foreground w-5 flex-shrink-0">
                                #{idx + 1}
                              </span>
                              <span className="flex-1">
                                <span className="text-muted-foreground">In: </span>
                                <span className="font-medium text-foreground">{fmtTime(log.check_in)}</span>
                              </span>
                              <span className="flex-1 text-right">
                                <span className="text-muted-foreground">Out: </span>
                                {log.check_out
                                  ? <span className="font-medium text-foreground">{fmtTime(log.check_out)}</span>
                                  : <span className="font-medium text-warning">—</span>
                                }
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Incomplete session warning */}
                      {selectedIncomplete && (
                        <div className="flex items-center gap-2 text-xs text-warning p-2 rounded-md bg-warning/10 border border-warning/20">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                          One or more sessions have no OUT punch.
                        </div>
                      )}

                      {/* Regularisation status or request button */}
                      {(() => {
                        const existingReg = selectedDay ? regByDate.get(selectedDay) : null
                        if (existingReg) {
                          return (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-muted text-xs">
                              <FileEdit className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                              <span className="text-muted-foreground">Correction:</span>
                              <Badge
                                variant={REG_BADGE_VARIANT[existingReg.status] as 'warning' | 'success' | 'destructive'}
                                className="capitalize rounded-full text-[10px] px-1.5 py-0"
                              >
                                {existingReg.status}
                              </Badge>
                            </div>
                          )
                        }
                        if (correctionDay === selectedDay) {
                          return (
                            <div className="space-y-2.5 border border-border rounded-md p-3 bg-muted/30">
                              <p className="text-xs font-semibold text-foreground">Request Correction</p>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Check-in</label>
                                <Input
                                  type="datetime-local"
                                  className="h-7 text-xs"
                                  value={correctionForm.checkIn}
                                  onChange={(e) => setCorrectionForm((p) => ({ ...p, checkIn: e.target.value }))}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Check-out</label>
                                <Input
                                  type="datetime-local"
                                  className="h-7 text-xs"
                                  value={correctionForm.checkOut}
                                  onChange={(e) => setCorrectionForm((p) => ({ ...p, checkOut: e.target.value }))}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Reason *</label>
                                <Input
                                  className="h-7 text-xs"
                                  placeholder="e.g. forgot to punch out"
                                  value={correctionForm.reason}
                                  onChange={(e) => setCorrectionForm((p) => ({ ...p, reason: e.target.value }))}
                                />
                              </div>
                              {correctionError && (
                                <p className="text-xs text-destructive">{correctionError}</p>
                              )}
                              <div className="flex gap-2 pt-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs flex-1"
                                  disabled={submittingCorrection || !correctionForm.reason.trim()}
                                  onClick={() => submitCorrection({
                                    date:                selectedDay!,
                                    requested_check_in:  correctionForm.checkIn  || null,
                                    requested_check_out: correctionForm.checkOut || null,
                                    reason:              correctionForm.reason.trim(),
                                  })}
                                >
                                  {submittingCorrection ? (
                                    <><Loader2 className="h-3 w-3 animate-spin mr-1" />Submitting…</>
                                  ) : 'Submit'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => { setCorrectionDay(null); setCorrectionError('') }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )
                        }
                        if (periodLocked) return null
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs w-full gap-1.5"
                            onClick={() => {
                              setCorrectionDay(selectedDay)
                              setCorrectionError('')
                            }}
                          >
                            <FileEdit className="h-3.5 w-3.5" />
                            Request Correction
                          </Button>
                        )
                      })()}
                    </>
                  )}
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
