/**
 * EssAttendanceCalendar — Enterprise Attendance Performance Calendar
 *
 * Fully redesigned ESS attendance experience:
 *   - Monthly performance summary strip (Present/Absent/Late/Leave/Off/Holiday)
 *   - Status-colored day cells with Monday-first grid
 *   - Rich hover tooltip with punch time, duration, lateness
 *   - Day-click detail modal: punch timeline, anomalies, correction CTA
 *   - Attendance intelligence insights (streak, late count, anomalies)
 *   - Calendar legend + keyboard accessible
 *
 * Architecture:
 *   All data derived from /attendance/:id — no extra API calls.
 *   useMemo gates on daily/logs arrays so re-renders are minimal.
 *   Tooltip uses createPortal to avoid z-index stacking issues.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */
import { useState, useMemo, useCallback, type ReactNode } from 'react'
import { createPortal }        from 'react-dom'
import { useQuery }            from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, CalendarDays,
  Clock, AlertTriangle, Loader2, Info,
  TrendingUp, CheckCircle2, Timer, X,
} from 'lucide-react'
import { PageContainer }       from '@/components/layout/PageContainer'
import { Badge }               from '@/components/ui/badge'
import { Button }              from '@/components/ui/button'
import { api }                 from '@/lib/api/client'
import { useAuthStore }        from '@/stores/authStore'
import { cn }                  from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyRecord {
  id:               string
  date:             string
  work_hours:       number
  late_minutes:     number
  overtime_minutes: number
  status:           string
  is_payable?:      boolean
  shift_name?:      string
  remarks?:         string
}

interface AttLog {
  id:        string
  check_in:  string | null
  check_out: string | null
}

interface AttResponse {
  summary: {
    total_days:  number
    present:     number
    absent:      number
    late:        number
    avg_hours:   number
    total_hours: number
  }
  daily: DailyRecord[]
  logs:  AttLog[]
}

// ── Status constants ──────────────────────────────────────────────────────────

// Cell background + text for each attendance status
const STATUS_CELL: Record<string, string> = {
  present:    'bg-success/18 text-success ring-1 ring-success/25',
  late:       'bg-warning/18 text-warning ring-1 ring-warning/25',
  absent:     'bg-destructive/15 text-destructive ring-1 ring-destructive/20',
  half_day:   'bg-muted text-muted-foreground ring-1 ring-border/50',
  leave:      'bg-info/18 text-info ring-1 ring-info/25',
  on_leave:   'bg-info/18 text-info ring-1 ring-info/25',
  holiday:    'bg-accent/25 text-accent-foreground ring-1 ring-accent/30',
  weekend:    'bg-muted/30 text-muted-foreground/40',
  weekly_off: 'bg-muted/30 text-muted-foreground/40',
}

const STATUS_LABEL: Record<string, string> = {
  present:    'Present',
  late:       'Late Entry',
  absent:     'Absent',
  half_day:   'Half Day',
  leave:      'On Leave',
  on_leave:   'On Leave',
  holiday:    'Holiday',
  weekend:    'Weekend',
  weekly_off: 'Weekly Off',
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive' | 'outline' | 'secondary'> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  half_day:   'secondary',
  leave:      'outline',
  on_leave:   'outline',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
}

// Short code displayed inside cell (for non-present states only)
const STATUS_CODE: Record<string, string> = {
  late:       'L',
  absent:     'A',
  half_day:   'H',
  leave:      'Lv',
  on_leave:   'Lv',
  holiday:    'Ho',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtWorkHours(hours: number): string {
  if (!hours || hours <= 0) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function fmtDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  if (isNaN(d.getTime())) return dateStr
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

// Monday-first: Mon=0 … Sun=6
function buildCalendarDays(y: number, m: number): (number | null)[] {
  const dow      = new Date(y, m, 1).getDay()         // 0=Sun
  const firstDow = dow === 0 ? 6 : dow - 1            // Mon=0 … Sun=6
  const total    = new Date(y, m + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

function monthStart(y: number, m: number) {
  return new Date(y, m, 1).toISOString().slice(0, 10)
}
function monthEnd(y: number, m: number) {
  return new Date(y, m + 1, 0).toISOString().slice(0, 10)
}

// ── Summary strip ─────────────────────────────────────────────────────────────

interface SummaryMetric {
  label:   string
  value:   number
  color:   string
  dimmed?: boolean
}

function SummaryStrip({ metrics }: { metrics: SummaryMetric[] }) {
  return (
    <div className="grid border-b border-border/50" style={{ gridTemplateColumns: `repeat(${metrics.length}, 1fr)` }}>
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className={cn(
            'flex flex-col items-center justify-center py-3 gap-0.5',
            i < metrics.length - 1 && 'border-r border-border/30',
            m.dimmed && 'opacity-45',
          )}
        >
          <span className={cn('text-lg font-bold tabular-nums leading-none', m.color)}>
            {m.value}
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60 mt-0.5">
            {m.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Insight chips ─────────────────────────────────────────────────────────────

type InsightTone = 'success' | 'warning' | 'info' | 'neutral'

function InsightChip({ icon, text, tone }: { icon: ReactNode; text: string; tone: InsightTone }) {
  const cls: Record<InsightTone, string> = {
    success: 'bg-success/10 border-success/20 text-success',
    warning: 'bg-warning/10 border-warning/20 text-warning',
    info:    'bg-info/10 border-info/20 text-info',
    neutral: 'bg-muted/60 border-border/40 text-muted-foreground',
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2.5 py-1 border leading-none',
      cls[tone],
    )}>
      {icon}
      {text}
    </span>
  )
}

// ── Hover tooltip (portal) ────────────────────────────────────────────────────

interface TooltipData {
  dateStr:     string
  rec:         DailyRecord
  firstLog?:   AttLog
  lastLog?:    AttLog
  isIncomplete: boolean
}

interface TooltipPos { x: number; y: number }

function AttendanceTooltip({ data, pos }: { data: TooltipData; pos: TooltipPos }) {
  const { dateStr, rec, firstLog, lastLog, isIncomplete } = data
  const label = STATUS_LABEL[rec.status] ?? rec.status

  // Smart positioning — flip above/below + clamp horizontal
  const TW = 228
  const TH = 192
  const vW = window.innerWidth

  let top  = pos.y - TH - 8
  if (top < 8) top = pos.y + 36          // show below cell instead

  let left = pos.x - TW / 2
  if (left < 8)         left = 8
  if (left + TW > vW - 8) left = vW - TW - 8

  const toneText =
    rec.status === 'absent'  ? 'text-destructive' :
    rec.status === 'late'    ? 'text-warning'      :
    rec.status === 'present' ? 'text-success'      :
                               'text-foreground'

  return createPortal(
    <div
      className="fixed z-[300] pointer-events-none"
      style={{ top, left, width: TW }}
    >
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-3.5 pt-3 pb-2.5 border-b border-border/40">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
              {fmtDateLabel(dateStr)}
            </p>
            <p className={cn('text-xs font-semibold mt-0.5', toneText)}>
              {label}
            </p>
          </div>
          <Badge
            variant={STATUS_BADGE[rec.status] ?? 'outline'}
            className="text-[9px] h-4 px-1.5 rounded-full shrink-0 mt-0.5"
          >
            {label.split(' ')[0]}
          </Badge>
        </div>

        {/* Body */}
        <div className="px-3.5 py-2.5 space-y-2">
          {(firstLog?.check_in || lastLog?.check_out) && (
            <div className="flex items-center gap-2">
              <Clock className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />
              <div className="flex-1">
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Time</p>
                <p className="text-xs font-semibold text-foreground leading-tight">
                  {fmtTime(firstLog?.check_in ?? null)}&nbsp;–&nbsp;{fmtTime(lastLog?.check_out ?? null)}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {rec.work_hours > 0 && (
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Duration</p>
                <p className="text-xs font-semibold text-primary">{fmtWorkHours(rec.work_hours)}</p>
              </div>
            )}
            {rec.late_minutes > 0 && (
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Lateness</p>
                <p className="text-xs font-semibold text-warning">{fmtDuration(rec.late_minutes)}</p>
              </div>
            )}
            {rec.overtime_minutes > 0 && (
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Overtime</p>
                <p className="text-xs font-semibold text-info">{fmtDuration(rec.overtime_minutes)}</p>
              </div>
            )}
            {rec.shift_name && (
              <div>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Shift</p>
                <p className="text-[10px] text-muted-foreground truncate">{rec.shift_name}</p>
              </div>
            )}
          </div>

          {isIncomplete && (
            <div className="flex items-center gap-1 text-[9px] text-warning">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              Missing OUT punch
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Day detail modal ──────────────────────────────────────────────────────────

interface DayDetailProps {
  dateStr:     string
  rec:         DailyRecord | null
  logs:        AttLog[]
  isIncomplete: boolean
  onClose:     () => void
}

function DayDetailModal({ dateStr, rec, logs, isIncomplete, onClose }: DayDetailProps) {
  const label = rec ? (STATUS_LABEL[rec.status] ?? rec.status) : 'No Record'

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full sm:max-w-[440px] bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/50">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
              {fmtDateLabel(dateStr)}
            </p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{label}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rec && (
              <Badge variant={STATUS_BADGE[rec.status] ?? 'outline'} className="capitalize text-[10px]">
                {rec.status.replace(/_/g, ' ')}
              </Badge>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors p-1 rounded"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto max-h-[65vh]">
          {!rec ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center px-5">
              <CalendarDays className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground">No attendance record for this day.</p>
              <p className="text-xs text-muted-foreground/60">
                This day may not yet be processed, or it falls outside your shift schedule.
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-5">

              {/* Key metrics grid */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    label: 'Work Hours',
                    value: fmtWorkHours(rec.work_hours),
                    color: rec.work_hours > 0 ? 'text-foreground' : 'text-muted-foreground/50',
                  },
                  {
                    label: 'Lateness',
                    value: fmtDuration(rec.late_minutes),
                    color: rec.late_minutes > 0 ? 'text-warning' : 'text-muted-foreground/50',
                  },
                  {
                    label: 'Overtime',
                    value: fmtDuration(rec.overtime_minutes),
                    color: rec.overtime_minutes > 0 ? 'text-info' : 'text-muted-foreground/50',
                  },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg bg-muted/40 border border-border/30 px-3 py-2.5 text-center">
                    <p className={cn('text-sm font-bold leading-snug', color)}>{value}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5 uppercase font-semibold tracking-wider">{label}</p>
                  </div>
                ))}
              </div>

              {/* Shift info */}
              {rec.shift_name && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground/60 font-medium uppercase text-[9px] tracking-wider">Shift</span>
                  <span className="text-foreground font-medium">{rec.shift_name}</span>
                </div>
              )}

              {/* Punch timeline */}
              {logs.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
                    Punch Timeline — {logs.length} session{logs.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-2">
                    {logs.map((log, i) => {
                      const hasMissingOut = !log.check_out
                      return (
                        <div
                          key={log.id}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                            hasMissingOut
                              ? 'border-warning/30 bg-warning/5'
                              : 'border-border/40 bg-muted/25',
                          )}
                        >
                          {/* Mini timeline indicator */}
                          <div className="flex flex-col items-center gap-0.5 shrink-0">
                            <div className="w-2 h-2 rounded-full bg-success" />
                            <div className="w-px h-3 bg-border/50" />
                            <div className={cn('w-2 h-2 rounded-full', hasMissingOut ? 'bg-warning' : 'bg-destructive/50')} />
                          </div>

                          {/* Times */}
                          <div className="flex-1 grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">In</p>
                              <p className="text-xs font-semibold text-foreground">{fmtTime(log.check_in)}</p>
                            </div>
                            <div>
                              <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/50">Out</p>
                              <p className={cn('text-xs font-semibold', hasMissingOut ? 'text-warning' : 'text-foreground')}>
                                {hasMissingOut ? 'Missing' : fmtTime(log.check_out)}
                              </p>
                            </div>
                          </div>

                          <span className="text-[9px] text-muted-foreground/40 shrink-0">#{i + 1}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Incomplete punch warning */}
              {isIncomplete && (
                <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-warning">Missing OUT punch detected</p>
                    <p className="text-warning/70 mt-0.5">
                      One or more sessions are missing an OUT punch. Raise a correction request to fix this.
                    </p>
                  </div>
                </div>
              )}

              {/* Remarks */}
              {rec.remarks && (
                <div className="rounded-lg bg-muted/30 border border-border/30 px-3 py-2.5 text-xs">
                  <p className="font-semibold text-muted-foreground/70 text-[9px] uppercase tracking-wider mb-1">Remarks</p>
                  <p className="text-foreground">{rec.remarks}</p>
                </div>
              )}

              {/* Correction CTA */}
              <div className="pt-1 pb-2 text-center">
                <a
                  href="/ess/attendance/regularization"
                  className="text-xs text-info hover:underline inline-flex items-center gap-1"
                >
                  Raise a regularisation request for this day
                  <ChevronRight className="h-3 w-3" />
                </a>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Calendar legend ───────────────────────────────────────────────────────────

function CalendarLegend() {
  const items = [
    { label: 'Present',  cls: 'bg-success/20 ring-1 ring-success/30' },
    { label: 'Late',     cls: 'bg-warning/20 ring-1 ring-warning/30' },
    { label: 'Absent',   cls: 'bg-destructive/15 ring-1 ring-destructive/20' },
    { label: 'Leave',    cls: 'bg-info/20 ring-1 ring-info/30' },
    { label: 'Off',      cls: 'bg-muted/50' },
    { label: 'Holiday',  cls: 'bg-accent/25 ring-1 ring-accent/30' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pt-3 border-t border-border/30">
      {items.map(({ label, cls }) => (
        <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <span className={cn('w-2.5 h-2.5 rounded-sm shrink-0', cls)} />
          {label}
        </span>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssAttendanceCalendar() {
  const { profile }  = useAuthStore()
  const employeeId   = profile?.employee_id ?? null

  const [viewDate,    setViewDate]    = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [tooltip,     setTooltip]     = useState<{ data: TooltipData; pos: TooltipPos } | null>(null)

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const from  = monthStart(year, month)
  const to    = monthEnd(year, month)

  const { data, isLoading, isError, refetch } = useQuery<AttResponse>({
    queryKey:  ['ess-att-calendar', employeeId, from, to],
    queryFn:   () => api.get(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:   !!employeeId,
    staleTime: 60_000,
  })

  const daily = data?.daily ?? []
  const logs  = data?.logs  ?? []

  // ── Memoized data maps ──────────────────────────────────────────────────────

  const dailyByDate = useMemo(
    () => new Map(daily.map(d => [d.date, d])),
    [daily],
  )

  const logsByDate = useMemo(() => {
    const map = new Map<string, AttLog[]>()
    for (const log of logs) {
      const d = log.check_in?.slice(0, 10) ?? log.check_out?.slice(0, 10)
      if (!d) continue
      if (!map.has(d)) map.set(d, [])
      map.get(d)!.push(log)
    }
    return map
  }, [logs])

  const incompleteSet = useMemo(
    () => new Set(
      logs
        .filter(l => !l.check_out)
        .map(l => l.check_in?.slice(0, 10))
        .filter(Boolean) as string[],
    ),
    [logs],
  )

  const calendarDays = useMemo(() => buildCalendarDays(year, month), [year, month])
  const todayStr     = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // ── Summary strip metrics ───────────────────────────────────────────────────

  const summaryMetrics = useMemo((): SummaryMetric[] => {
    let present    = 0
    let absent     = 0
    let late       = 0
    let leave      = 0
    let weekly_off = 0
    let holiday    = 0

    for (const d of daily) {
      switch (d.status) {
        case 'present':    present++;    break
        case 'late':       late++;       break
        case 'absent':     absent++;     break
        case 'leave':
        case 'on_leave':
        case 'half_day':   leave++;      break
        case 'weekly_off':
        case 'weekend':    weekly_off++; break
        case 'holiday':    holiday++;    break
      }
    }

    // API summary may have richer counts — take the max as a safety net
    present = Math.max(present, data?.summary?.present ?? 0)
    absent  = Math.max(absent,  data?.summary?.absent  ?? 0)
    late    = Math.max(late,    data?.summary?.late    ?? 0)

    return [
      { label: 'Present',  value: present,    color: 'text-success' },
      { label: 'Absent',   value: absent,     color: 'text-destructive' },
      { label: 'Late',     value: late,       color: 'text-warning' },
      { label: 'Leave',    value: leave,      color: 'text-info' },
      { label: 'Off',      value: weekly_off, color: 'text-muted-foreground', dimmed: weekly_off === 0 },
      { label: 'Holiday',  value: holiday,    color: 'text-accent-foreground', dimmed: holiday === 0 },
    ]
  }, [daily, data?.summary])

  // ── Intelligence insights ───────────────────────────────────────────────────

  const insights = useMemo(() => {
    const result: { icon: ReactNode; text: string; tone: InsightTone }[] = []

    // Late arrivals count
    const lateCount = daily.filter(d => d.status === 'late').length
    if (lateCount > 0) {
      result.push({
        icon: <Timer className="h-3 w-3" />,
        text: `${lateCount} late arrival${lateCount !== 1 ? 's' : ''} this month`,
        tone: lateCount >= 4 ? 'warning' : 'neutral',
      })
    }

    // Consecutive attendance streak (counting back from today)
    let streak = 0
    const today = new Date(todayStr)
    for (let i = 0; i < 31; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      if (d.getMonth() !== month || d.getFullYear() !== year) break
      const ds  = d.toISOString().slice(0, 10)
      const rec = dailyByDate.get(ds)
      if (!rec) break
      if (rec.status === 'present' || rec.status === 'late') streak++
      else break
    }
    if (streak >= 5) {
      result.push({
        icon: <TrendingUp className="h-3 w-3" />,
        text: `${streak}-day attendance streak`,
        tone: streak >= 10 ? 'success' : 'info',
      })
    }

    // Perfect week (Mon–today, no absents)
    const todayDow = today.getDay()
    const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow
    const weekdays: string[] = []
    for (let i = 0; i <= Math.min(todayDow === 0 ? 6 : todayDow - 1, 4); i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + mondayOffset + i)
      if (d <= today) weekdays.push(d.toISOString().slice(0, 10))
    }
    const weekAbsents = weekdays.filter(ds => dailyByDate.get(ds)?.status === 'absent').length
    if (weekdays.length >= 3 && weekAbsents === 0) {
      result.push({
        icon: <CheckCircle2 className="h-3 w-3" />,
        text: 'Perfect attendance this week',
        tone: 'success',
      })
    }

    // Missing punches
    if (incompleteSet.size > 0) {
      result.push({
        icon: <AlertTriangle className="h-3 w-3" />,
        text: `${incompleteSet.size} missing OUT punch${incompleteSet.size !== 1 ? 'es' : ''}`,
        tone: 'warning',
      })
    }

    return result.slice(0, 4)
  }, [daily, dailyByDate, incompleteSet, todayStr, month, year])

  // ── Tooltip handlers ────────────────────────────────────────────────────────

  const handleCellEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>, dateStr: string) => {
    const rec = dailyByDate.get(dateStr)
    if (!rec) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dayLogs = logsByDate.get(dateStr) ?? []
    setTooltip({
      data: {
        dateStr,
        rec,
        firstLog:    dayLogs[0],
        lastLog:     dayLogs[dayLogs.length - 1],
        isIncomplete: incompleteSet.has(dateStr),
      },
      pos: {
        x: rect.left + rect.width / 2,
        y: rect.top,
      },
    })
  }, [dailyByDate, logsByDate, incompleteSet])

  const handleCellLeave = useCallback(() => setTooltip(null), [])

  // ── Selected day data ───────────────────────────────────────────────────────

  const selRec        = selectedDay ? (dailyByDate.get(selectedDay) ?? null) : null
  const selLogs       = selectedDay ? (logsByDate.get(selectedDay) ?? []) : []
  const selIncomplete = selectedDay ? incompleteSet.has(selectedDay) : false

  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

  // ── No employee guard ────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <div className="rounded-xl border border-border bg-card p-10 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-7 w-7 text-warning/60" />
          <p className="text-sm font-semibold text-foreground">Profile not linked</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Contact HR to link your account to an employee record before attendance data is available.
          </p>
        </div>
      </PageContainer>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <div className="rounded-xl border border-border/70 bg-card shadow-sm overflow-visible">

        {/* ── Card header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-5 pt-4 pb-0 gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Attendance Performance
            </p>
            <p className="text-[10px] text-muted-foreground/45 mt-0.5">
              Monthly attendance overview and daily activity
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Previous month"
              onClick={() => { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null) }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] px-2 font-medium"
              onClick={() => { setViewDate(new Date()); setSelectedDay(null) }}
            >
              {monthLabel}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Next month"
              onClick={() => { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null) }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-4 bg-border/40 mx-1" />
            <button
              className="h-7 w-7 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground rounded"
              aria-label="Calendar"
            >
              <CalendarDays className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── Summary strip ───────────────────────────────────────────────── */}
        <div className="mt-4">
          {isLoading ? (
            <div className="h-[60px] border-b border-border/50 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            <SummaryStrip metrics={summaryMetrics} />
          )}
        </div>

        {/* ── Calendar body ────────────────────────────────────────────────── */}
        <div className="px-4 pb-4 pt-3">

          {/* Intelligence insights */}
          {!isLoading && insights.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {insights.map((ins, i) => (
                <InsightChip key={i} icon={ins.icon} text={ins.text} tone={ins.tone} />
              ))}
            </div>
          )}

          {/* Loading state */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading attendance data…
            </div>

          /* Error state */
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-14">
              <AlertTriangle className="h-7 w-7 text-destructive/50" />
              <p className="text-sm text-muted-foreground">Failed to load attendance data</p>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refetch()}>
                Retry
              </Button>
            </div>

          /* Calendar grid */
          ) : (
            <>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map(d => (
                  <div
                    key={d}
                    className="text-center text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 py-1.5"
                  >
                    {d.slice(0, 1)}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                  if (day === null) return <div key={i} className="aspect-square" aria-hidden />

                  const dateStr      = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const rec          = dailyByDate.get(dateStr)
                  const isToday      = dateStr === todayStr
                  const isSelected   = selectedDay === dateStr
                  const isFuture     = dateStr > todayStr
                  const isIncomplete = incompleteSet.has(dateStr)
                  const code         = rec ? STATUS_CODE[rec.status] : null

                  return (
                    <button
                      key={i}
                      aria-label={`${dateStr}${rec ? `, ${STATUS_LABEL[rec.status]}` : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDay(prev => prev === dateStr ? null : dateStr)}
                      onMouseEnter={rec ? (e) => handleCellEnter(e, dateStr) : undefined}
                      onMouseLeave={rec ? handleCellLeave : undefined}
                      className={cn(
                        // Base
                        'aspect-square rounded-lg transition-all duration-100 flex flex-col items-center justify-center text-xs font-semibold relative',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',

                        // Today: solid primary fill
                        isToday && 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-0',

                        // Status color (not today)
                        !isToday && rec && STATUS_CELL[rec.status],

                        // No record — past
                        !isToday && !rec && !isFuture && 'text-muted-foreground/40 hover:bg-muted/40',

                        // Future
                        !isToday && isFuture && 'text-muted-foreground/25',

                        // Selected ring overlay
                        isSelected && 'ring-2 ring-primary ring-offset-1',

                        // Hover elevation for cells with data
                        !isToday && rec && 'hover:brightness-105 hover:shadow-sm cursor-pointer',
                        !rec && 'cursor-default',
                      )}
                    >
                      <span className={cn('text-xs leading-none', isToday && 'font-bold')}>
                        {day}
                      </span>

                      {/* Status badge — hidden for present (clean cell) and today */}
                      {!isToday && code && (
                        <span className="text-[7px] mt-0.5 leading-none opacity-75 font-medium">
                          {code}
                        </span>
                      )}

                      {/* Incomplete punch dot */}
                      {isIncomplete && (
                        <span
                          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-warning ring-1 ring-card"
                          aria-label="Missing punch"
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Legend */}
              <CalendarLegend />
            </>
          )}
        </div>

        {/* ── Info note ───────────────────────────────────────────────────── */}
        <div className="mx-4 mb-4 flex items-start gap-2 text-[10px] text-muted-foreground/60 bg-muted/20 border border-border/30 rounded-lg px-3 py-2 leading-relaxed">
          <Info className="h-3 w-3 mt-0.5 shrink-0 text-info/60" />
          <span>
            Incorrect attendance? Raise a regularisation request from{' '}
            <a href="/ess/attendance/regularization" className="text-info hover:underline font-medium">
              My Attendance
            </a>.{' '}
            Regularisation requests are reviewed by your manager.
          </span>
        </div>

      </div>

      {/* ── Hover tooltip ───────────────────────────────────────────────────── */}
      {tooltip && <AttendanceTooltip data={tooltip.data} pos={tooltip.pos} />}

      {/* ── Day detail modal ─────────────────────────────────────────────────── */}
      {selectedDay && (
        <DayDetailModal
          dateStr={selectedDay}
          rec={selRec}
          logs={selLogs}
          isIncomplete={selIncomplete}
          onClose={() => setSelectedDay(null)}
        />
      )}

    </PageContainer>
  )
}
