/**
 * EssSchedule — /ess/schedule
 *
 * Employee Self-Service: forward-looking shift schedule for the current employee.
 *
 * Shows two months (current + next) with:
 *   · Processed attendance records for past days (status-colored cells)
 *   · Predicted schedule for future days based on standing shift + holidays
 *   · Shift assignment card (name, hours, weekly-off days)
 *   · Holiday list for the period
 *
 * Data sources (all ESS-accessible, no admin restriction):
 *   · GET /attendance/:employeeId?from=&to=   — processed daily records
 *   · GET /masters/employee-shifts/:id/history — current shift assignment
 *   · GET /masters/shifts                      — shift details (weekly_off_days)
 *   · GET /masters/holidays?year=YYYY          — holiday calendar
 *
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState }      from 'react'
import { useQuery }      from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, CalendarClock, Clock,
  CalendarDays, Loader2, AlertTriangle, Sun,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DailyRecord {
  date:             string
  status:           string
  work_hours:       number
  late_minutes:     number
}

interface ShiftDetail {
  id:              string
  name:            string
  code:            string | null
  start_time:      string
  end_time:        string
  grace_minutes:   number
  weekly_off_days: number[]
}

interface ShiftAssignment {
  id:             string
  effective_from: string
  is_current:     boolean
  shifts:         { id: string; name: string; code: string | null; start_time: string; end_time: string }
}

interface HolidayEntry {
  id:          string
  name:        string
  date:        string
  holiday_type: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DOW_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_NAMES_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthStart(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function monthEnd(y: number, m: number) {
  const d = new Date(y, m + 1, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildCalendarDays(y: number, m: number): (number | null)[] {
  const firstDow = new Date(y, m, 1).getDay()
  const total    = new Date(y, m + 1, 0).getDate()
  const cells    = Math.ceil((firstDow + total) / 7) * 7
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length < cells) days.push(null)
  return days
}

function fmtTime(t: string | null) {
  if (!t) return ''
  return t.slice(0, 5)
}

function fmtDate(d: string) {
  const dt = new Date(d + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const W = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  if (isNaN(dt.getTime())) return '—'
  return `${W[dt.getUTCDay()]}, ${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}`
}

// ── Cell determination ────────────────────────────────────────────────────────

type DayType = 'present' | 'late' | 'absent' | 'half_day' | 'leave' | 'holiday' | 'weekly_off' | 'weekend' | 'upcoming' | 'today_upcoming'

function determineDayType(
  dateStr:         string,
  todayStr:        string,
  record:          DailyRecord | undefined,
  isHoliday:       boolean,
  isWeeklyOff:     boolean,
): DayType {
  // Processed record takes highest priority
  if (record) return record.status as DayType

  // Future / today unprocessed
  const isFuture = dateStr > todayStr
  const isToday  = dateStr === todayStr

  if (isHoliday)    return 'holiday'
  if (isWeeklyOff)  return 'weekly_off'
  if (isToday)      return 'today_upcoming'
  if (isFuture)     return 'upcoming'
  return 'absent'  // past unprocessed day → treat as absent
}

const CELL_CONFIG: Record<DayType, { bg: string; text: string; label: string }> = {
  present:        { bg: 'bg-success/15 ring-1 ring-success/30',       text: 'text-success',             label: 'P'  },
  late:           { bg: 'bg-warning/15 ring-1 ring-warning/30',       text: 'text-warning',             label: 'L'  },
  absent:         { bg: 'bg-destructive/15 ring-1 ring-destructive/30', text: 'text-destructive',       label: 'A'  },
  half_day:       { bg: 'bg-muted ring-1 ring-border',                 text: 'text-muted-foreground',   label: 'H'  },
  leave:          { bg: 'bg-info/15 ring-1 ring-info/30',              text: 'text-info',               label: 'Lv' },
  holiday:        { bg: 'bg-accent/20 ring-1 ring-accent/40',          text: 'text-accent-foreground',  label: 'Ho' },
  weekly_off:     { bg: 'bg-muted/60',                                 text: 'text-muted-foreground/60', label: 'WO' },
  weekend:        { bg: 'bg-muted/40',                                 text: 'text-muted-foreground/50', label: 'WE' },
  upcoming:       { bg: '',                                            text: 'text-muted-foreground/40', label: '·'  },
  today_upcoming: { bg: 'bg-primary/10 ring-1 ring-primary/30',        text: 'text-primary',            label: '→'  },
}

// ── Mini calendar ─────────────────────────────────────────────────────────────

interface MiniCalendarProps {
  year:        number
  month:       number
  dailyMap:    Map<string, DailyRecord>
  holidaySet:  Set<string>
  weeklyOffSet: Set<number>
  todayStr:    string
}

function MiniCalendar({ year, month, dailyMap, holidaySet, weeklyOffSet, todayStr }: MiniCalendarProps) {
  const days      = buildCalendarDays(year, month)
  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div>
      <p className="text-xs font-semibold text-foreground mb-2">{monthLabel}</p>

      {/* DOW header */}
      <div className="grid grid-cols-7 mb-1">
        {DOW_NAMES_SHORT.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-0.5">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day, i) => {
          if (!day) return <div key={i} />

          const mm      = String(month + 1).padStart(2, '0')
          const dd      = String(day).padStart(2, '0')
          const dateStr = `${year}-${mm}-${dd}`
          const dow     = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
          const record  = dailyMap.get(dateStr)
          const isHol   = holidaySet.has(dateStr)
          const isOff   = weeklyOffSet.has(dow)
          const isToday = dateStr === todayStr
          const type    = determineDayType(dateStr, todayStr, record, isHol, isOff)
          const cfg     = CELL_CONFIG[type]

          return (
            <div
              key={i}
              title={`${fmtDate(dateStr)} — ${type.replace('_', ' ')}`}
              className={cn(
                'aspect-square rounded text-[10px] font-medium flex items-center justify-center transition-colors',
                cfg.bg,
                cfg.text,
                isToday && 'font-bold',
              )}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EssSchedule() {
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null

  const [monthOffset, setMonthOffset] = useState(0)

  const now        = new Date()
  const baseYear   = now.getFullYear()
  const baseMonth  = now.getMonth()
  const todayStr   = `${baseYear}-${String(baseMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Derive the two months to show (current + next, offset by monthOffset for navigation)
  const m1Year  = baseYear  + Math.floor((baseMonth + monthOffset)     / 12)
  const m1Month = ((baseMonth + monthOffset)     % 12 + 12) % 12
  const m2Year  = baseYear  + Math.floor((baseMonth + monthOffset + 1) / 12)
  const m2Month = ((baseMonth + monthOffset + 1) % 12 + 12) % 12

  const from = monthStart(m1Year, m1Month)
  const to   = monthEnd(m2Year,   m2Month)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: attResp, isLoading: attLoading } = useQuery<{
    daily: DailyRecord[]
  }>({
    queryKey: ['ess-schedule-att', employeeId, from, to],
    queryFn:  () => api.get(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:  !!employeeId,
    staleTime: 120_000,
  })

  const { data: shiftHistResp, isLoading: shiftLoading } = useQuery<{
    data: ShiftAssignment[]
  }>({
    queryKey: ['ess-schedule-shift', employeeId],
    queryFn:  () => api.get(`/masters/employee-shifts/${employeeId}/history`),
    enabled:  !!employeeId,
    staleTime: 300_000,
  })

  const { data: allShiftsResp } = useQuery<{ data: ShiftDetail[] }>({
    queryKey: ['ess-schedule-shifts-master'],
    queryFn:  () => api.get('/masters/shifts'),
    enabled:  !!employeeId,
    staleTime: 300_000,
  })

  const { data: holidaysY1 } = useQuery<{ data: HolidayEntry[] }>({
    queryKey: ['ess-schedule-holidays', m1Year],
    queryFn:  () => api.get(`/masters/holidays?year=${m1Year}`),
    enabled:  !!employeeId,
    staleTime: 300_000,
  })

  const { data: holidaysY2 } = useQuery<{ data: HolidayEntry[] }>({
    queryKey: ['ess-schedule-holidays', m2Year],
    queryFn:  () => api.get(`/masters/holidays?year=${m2Year}`),
    enabled:  !!employeeId && m2Year !== m1Year,
    staleTime: 300_000,
  })

  // ── Derived data ──────────────────────────────────────────────────────────────

  const dailyMap = new Map<string, DailyRecord>(
    (attResp?.daily ?? []).map(d => [d.date, d])
  )

  const currentAssignment = (shiftHistResp?.data ?? []).find(a => a.is_current) ?? null

  // Match the current shift to its full detail (with weekly_off_days)
  const allShifts = allShiftsResp?.data ?? []
  const currentShiftDetail: ShiftDetail | null = currentAssignment
    ? (allShifts.find(s => s.id === currentAssignment.shifts.id) ?? null)
    : null

  const weeklyOffSet = new Set<number>(currentShiftDetail?.weekly_off_days ?? [])

  // Build holiday set (date strings) for quick lookup
  const allHolidays: HolidayEntry[] = [
    ...(holidaysY1?.data ?? []),
    ...(m2Year !== m1Year ? (holidaysY2?.data ?? []) : []),
  ]
  const holidaySet  = new Set<string>(allHolidays.map(h => h.date))

  // Holidays in the displayed range
  const rangeHolidays = allHolidays
    .filter(h => h.date >= from && h.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))

  const isLoading = attLoading || shiftLoading

  // ── Legend summary counts for current month ───────────────────────────────────

  function countType(y: number, m: number, type: DayType): number {
    let count = 0
    const start = new Date(y, m, 1)
    const end   = new Date(y, m + 1, 0)
    const cur   = new Date(start)
    while (cur <= end) {
      const ds  = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      const dow = cur.getDay()
      const t   = determineDayType(ds, todayStr, dailyMap.get(ds), holidaySet.has(ds), weeklyOffSet.has(dow))
      if (t === type) count++
      cur.setDate(cur.getDate() + 1)
    }
    return count
  }

  return (
    <PageContainer>
      <PageHeader
        title="My Schedule"
        subtitle="Your shift schedule and attendance calendar"
      />

      {!employeeId && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 text-warning opacity-70" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs">Your profile is not linked to an employee record. Contact HR.</p>
          </div>
        </SectionCard>
      )}

      {employeeId && isLoading && (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading schedule…</span>
        </div>
      )}

      {employeeId && !isLoading && (
        <div className="space-y-4">
          {/* ── Shift assignment card ────────────────────────────────────── */}
          <SectionCard
            title="Current Shift Assignment"
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
          >
            {!currentAssignment ? (
              <p className="text-sm text-muted-foreground py-3">
                No shift assigned. Contact HR to assign a shift.
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-6">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Shift</p>
                  <p className="text-sm font-semibold text-foreground">{currentAssignment.shifts.name}</p>
                  {currentAssignment.shifts.code && (
                    <p className="text-[11px] text-muted-foreground font-mono">{currentAssignment.shifts.code}</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Hours</p>
                  <p className="text-sm font-semibold text-foreground">
                    {fmtTime(currentAssignment.shifts.start_time)} – {fmtTime(currentAssignment.shifts.end_time)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Weekly Off</p>
                  {weeklyOffSet.size === 0 ? (
                    <p className="text-sm text-muted-foreground">None configured</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {Array.from(weeklyOffSet).sort().map(dow => (
                        <Badge key={dow} variant="secondary" className="text-[10px] rounded-full">
                          {DOW_NAMES_FULL[dow]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">Effective From</p>
                  <p className="text-sm text-foreground">{currentAssignment.effective_from}</p>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Two-month calendar ───────────────────────────────────────── */}
          <SectionCard
            title="Schedule Calendar"
            icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonthOffset(p => p - 1)}
                  title="Previous two months">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setMonthOffset(0)}>
                  Today
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMonthOffset(p => p + 1)}
                  title="Next two months">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            }
          >
            {/* Two calendars side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <MiniCalendar
                year={m1Year} month={m1Month}
                dailyMap={dailyMap} holidaySet={holidaySet}
                weeklyOffSet={weeklyOffSet} todayStr={todayStr}
              />
              <MiniCalendar
                year={m2Year} month={m2Month}
                dailyMap={dailyMap} holidaySet={holidaySet}
                weeklyOffSet={weeklyOffSet} todayStr={todayStr}
              />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border">
              {(
                [
                  { type: 'present'   as DayType, label: 'Present' },
                  { type: 'late'      as DayType, label: 'Late' },
                  { type: 'absent'    as DayType, label: 'Absent' },
                  { type: 'leave'     as DayType, label: 'Leave' },
                  { type: 'holiday'   as DayType, label: 'Holiday' },
                  { type: 'weekly_off' as DayType, label: 'Weekly Off' },
                  { type: 'upcoming'  as DayType, label: 'Upcoming' },
                ] as const
              ).map(({ type, label }) => {
                const cfg = CELL_CONFIG[type]
                return (
                  <span key={type} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className={cn('w-3 h-3 rounded', cfg.bg || 'bg-muted/40 ring-1 ring-border')} />
                    {label}
                  </span>
                )
              })}
            </div>

            {/* Monthly summary for first displayed month */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 pt-3 border-t border-border">
              {(
                [
                  { type: 'present'    as DayType, label: 'Present',    cls: 'text-success' },
                  { type: 'late'       as DayType, label: 'Late',        cls: 'text-warning' },
                  { type: 'absent'     as DayType, label: 'Absent',      cls: 'text-destructive' },
                  { type: 'leave'      as DayType, label: 'Leave',       cls: 'text-info' },
                  { type: 'holiday'    as DayType, label: 'Holidays',    cls: 'text-accent-foreground' },
                  { type: 'weekly_off' as DayType, label: 'Weekly Off',  cls: 'text-muted-foreground' },
                ] as const
              ).map(({ type, label, cls }) => (
                <div key={type} className="p-2 rounded-md bg-muted/40 text-center">
                  <p className="text-[9px] text-muted-foreground mb-0.5 uppercase tracking-wide">{label}</p>
                  <p className={cn('text-base font-bold', cls)}>
                    {countType(m1Year, m1Month, type)}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Upcoming holidays ────────────────────────────────────────── */}
          {rangeHolidays.length > 0 && (
            <SectionCard
              title={`Holidays in ${new Date(m1Year, m1Month).toLocaleString('default', { month: 'short' })}–${new Date(m2Year, m2Month).toLocaleString('default', { month: 'short', year: 'numeric' })}`}
              icon={<Sun className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="space-y-1">
                {rangeHolidays.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium text-foreground">{h.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span>
                      {h.date >= todayStr && (
                        <Badge variant="outline" className="text-[10px] rounded-full">Upcoming</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* ── Informational note ───────────────────────────────────────── */}
          <p className="text-[11px] text-muted-foreground px-1">
            Coloured cells show actual processed attendance. Future days marked "Weekly Off" or "Holiday" are
            predicted based on your current shift assignment and the holiday calendar.
          </p>
        </div>
      )}
    </PageContainer>
  )
}
