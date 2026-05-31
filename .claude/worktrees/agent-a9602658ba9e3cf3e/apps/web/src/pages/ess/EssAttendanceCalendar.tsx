/**
 * EssAttendanceCalendar — /ess/attendance/calendar
 *
 * Full-month attendance calendar with status-colored day cells,
 * monthly summary stats, and a day-click detail panel.
 * Uses the same /attendance/:employeeId API as MyAttendance.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState }  from 'react'
import { useQuery }  from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, CalendarDays, Clock,
  AlertTriangle, Loader2, Info,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyRecord {
  id:               string
  date:             string
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  status:           string
  is_payable?:      boolean
}

interface AttLog {
  id:        string
  check_in:  string | null
  check_out: string | null
}

interface AttResponse {
  summary: {
    total_days:   number
    present:      number
    absent:       number
    late:         number
    avg_hours:    number
    total_hours:  number
  }
  daily: DailyRecord[]
  logs:  AttLog[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function monthStart(y: number, m: number) {
  return new Date(y, m, 1).toISOString().slice(0, 10)
}
function monthEnd(y: number, m: number) {
  return new Date(y, m + 1, 0).toISOString().slice(0, 10)
}

function buildCalendarDays(y: number, m: number): (number | null)[] {
  const firstDow = new Date(y, m, 1).getDay()
  const total    = new Date(y, m + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

// Status → cell background
const CELL_BG: Record<string, string> = {
  present:    'bg-success/15 text-success ring-1 ring-success/30',
  late:       'bg-warning/15 text-warning ring-1 ring-warning/30',
  absent:     'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
  half_day:   'bg-muted text-muted-foreground ring-1 ring-border',
  holiday:    'bg-info/15 text-info ring-1 ring-info/30',
  weekend:    'bg-muted/40 text-muted-foreground/60',
  weekly_off: 'bg-muted/40 text-muted-foreground/60',
  leave:      'bg-accent/15 text-accent-foreground ring-1 ring-accent/30',
}

const STATUS_SHORT: Record<string, string> = {
  present:    'P',
  late:       'L',
  absent:     'A',
  half_day:   'H',
  holiday:    'Ho',
  weekend:    'WE',
  weekly_off: 'WO',
  leave:      'Lv',
}

const BADGE_VARIANT: Record<string, string> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  half_day:   'secondary',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
  leave:      'secondary',
}

// ── Stat strip ────────────────────────────────────────────────────────────────

function StatChip({ label, value, colorClass }: { label: string; value: string | number; colorClass?: string }) {
  return (
    <div className="flex-1 min-w-[80px] rounded-lg border border-border bg-muted/20 p-3 text-center">
      <p className={cn('text-xl font-bold tabular-nums', colorClass ?? 'text-foreground')}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssAttendanceCalendar() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null

  const [viewDate,    setViewDate]    = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const from  = monthStart(year, month)
  const to    = monthEnd(year, month)

  const { data, isLoading, isError, refetch } = useQuery<AttResponse>({
    queryKey: ['ess-att-calendar', employeeId, from, to],
    queryFn:  () => api.get(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  const daily  = data?.daily  ?? []
  const logs   = data?.logs   ?? []
  const summary = data?.summary

  const dailyByDate = new Map(daily.map(d => [d.date, d]))
  const incompleteSet = new Set(
    logs.filter(l => !l.check_out).map(l => l.check_in?.slice(0, 10)).filter(Boolean)
  )

  const days = buildCalendarDays(year, month)

  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
  const todayStr   = new Date().toISOString().slice(0, 10)

  function cellClass(dateStr: string) {
    if (incompleteSet.has(dateStr)) return 'bg-warning/15 text-warning ring-1 ring-warning/30'
    const rec = dailyByDate.get(dateStr)
    if (!rec) return ''
    return CELL_BG[rec.status] ?? ''
  }

  // Selected day data
  const selRec     = selectedDay ? dailyByDate.get(selectedDay) : null
  const selLogs    = selectedDay ? logs.filter(l => l.check_in?.startsWith(selectedDay)) : []
  const holidayCount = daily.filter(d => d.status === 'holiday').length

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Attendance Calendar" subtitle="Monthly attendance view" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader title="Attendance Calendar" subtitle={`${monthLabel} overview`} />

      {/* ── Monthly stats ─────────────────────────────────────────────────── */}
      {summary && (
        <div className="flex gap-3 flex-wrap">
          <StatChip label="Present"     value={summary.present}              colorClass="text-success" />
          <StatChip label="Absent"      value={summary.absent}               colorClass="text-destructive" />
          <StatChip label="Late"        value={summary.late}                 colorClass="text-warning" />
          <StatChip label="Holidays"    value={holidayCount}                 colorClass="text-info" />
          <StatChip label="Total Hours" value={`${summary.total_hours}h`}                            />
          <StatChip label="Avg Hours"   value={`${summary.avg_hours}h`}                              />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* ── Calendar ──────────────────────────────────────────────────── */}
        <SectionCard
          className="lg:col-span-2"
          title={monthLabel}
          icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
          action={
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null)
              }}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => {
                setViewDate(new Date()); setSelectedDay(null)
              }}>
                Today
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null)
              }}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          }
        >
          {isLoading ? (
            <div className="flex items-center gap-2 py-10 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <AlertTriangle className="h-6 w-6 text-destructive opacity-60" />
              <p className="text-xs text-muted-foreground">Failed to load attendance.</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <>
              {/* Weekday header */}
              <div className="grid grid-cols-7 mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1">
                {days.map((day, i) => {
                  if (!day) return <div key={i} />
                  const dateStr = `${String(year)}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const rec      = dailyByDate.get(dateStr)
                  const isSelected = selectedDay === dateStr
                  const isToday    = dateStr === todayStr
                  const statusCode = rec?.status
                  const shortCode  = statusCode ? STATUS_SHORT[statusCode] : null

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(prev => prev === dateStr ? null : dateStr)}
                      className={cn(
                        'aspect-square rounded-md transition-all flex flex-col items-center justify-center text-[10px] font-medium relative',
                        cellClass(dateStr),
                        !rec && 'text-muted-foreground hover:bg-muted/60',
                        rec  && 'cursor-pointer hover:opacity-80',
                        isSelected && 'ring-2 ring-primary ring-offset-1',
                      )}
                      title={statusCode ?? dateStr}
                    >
                      <span className={cn('text-xs font-semibold', isToday && 'underline')}>{day}</span>
                      {shortCode && <span className="text-[8px] leading-tight opacity-80">{shortCode}</span>}
                      {incompleteSet.has(dateStr) && (
                        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-warning" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
                {[
                  { label: 'Present',    cls: 'bg-success/30' },
                  { label: 'Absent',     cls: 'bg-destructive/30' },
                  { label: 'Late',       cls: 'bg-warning/30' },
                  { label: 'Holiday',    cls: 'bg-info/30' },
                  { label: 'Leave',      cls: 'bg-accent/30' },
                  { label: 'Half Day',   cls: 'bg-muted' },
                  { label: 'Incomplete', cls: 'bg-warning/30 ring-1 ring-warning' },
                ].map(({ label, cls }) => (
                  <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className={cn('w-3 h-3 rounded-sm flex-shrink-0', cls)} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
        </SectionCard>

        {/* ── Day detail panel ──────────────────────────────────────────── */}
        <SectionCard
          title={selectedDay ?? 'Day Detail'}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        >
          {!selectedDay ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground">
                Click any day in the calendar to view its attendance details.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {!selRec ? (
                <p className="text-xs text-muted-foreground py-2">No attendance record for this day.</p>
              ) : (
                <>
                  <Badge
                    variant={(BADGE_VARIANT[selRec.status] ?? 'outline') as any}
                    className="capitalize rounded-full"
                  >
                    {selRec.status.replace('_', ' ')}
                  </Badge>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Work Hours',  value: `${selRec.work_hours}h` },
                      { label: 'Late',        value: selRec.late_minutes > 0 ? `${selRec.late_minutes} min` : '—' },
                      { label: 'Overtime',    value: selRec.overtime_minutes > 0 ? `${selRec.overtime_minutes} min` : '—' },
                      { label: 'Sessions',    value: selLogs.length },
                    ].map(({ label, value }) => (
                      <div key={label} className="p-2 rounded-md bg-muted">
                        <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                        <p className="text-sm font-semibold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>

                  {selLogs.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Sessions</p>
                      {selLogs.map((log, i) => (
                        <div key={log.id} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                          <span className="text-muted-foreground">#{i + 1}</span>
                          <span>In: {fmtTime(log.check_in)}</span>
                          <span className={!log.check_out ? 'text-warning' : ''}>
                            Out: {fmtTime(log.check_out)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {incompleteSet.has(selectedDay) && (
                    <div className="flex items-center gap-2 text-xs text-warning p-2 rounded-md bg-warning/10 border border-warning/20">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      One or more sessions have no OUT punch.
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Info note ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          If your attendance shows incorrect data, raise a correction request from the{' '}
          <a href="/ess/attendance/corrections" className="text-info underline">Corrections</a> page.
          Processing may take up to 24 hours.
        </span>
      </div>
    </PageContainer>
  )
}
