/**
 * EmployeeDashboard V2 — /ess/dashboard
 *
 * Redesigned as an intelligent operational workspace:
 *   • Today Workspace Bar  — compact command row (not a hero card)
 *   • Intelligence Strip   — scannable insight chips
 *   • Primary zone         — Attendance Insight Panel + Smart Alerts + compact calendar + activity timeline
 *   • Operational rail     — Today status · requests · balances · pay · quick actions · holidays
 *
 * Design principles: density-rhythm, tonal layering, emphasis hierarchy, operational urgency.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useQuery }    from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Clock, CheckCircle2, AlertTriangle, Calendar,
  ArrowRight, Sunrise, Sunset, Sun, Plus, Bell,
  TrendingUp, TrendingDown, ChevronRight, Receipt, Scale, CalendarPlus,
  FileCheck, FileText, X, CalendarDays, Zap, Activity, Timer,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { api }          from '@/lib/api/client'
import { Button }       from '@/components/ui/button'
import { Badge }        from '@/components/ui/badge'
import { cn }           from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyRecord {
  date:              string
  status:            string
  work_hours:        number
  late_minutes:      number
  overtime_minutes?: number
}

interface AttendanceLog {
  id:        string
  check_in:  string | null
  check_out: string | null
}

interface AttendanceResp {
  summary: {
    total_days: number; present: number; absent: number; late: number
    avg_hours: number;  total_hours: number
    payable_days?: number; lop_days?: number
  }
  daily: DailyRecord[]
  logs:  AttendanceLog[]
}

interface LeaveApp {
  id: string; from_date: string; to_date: string
  status: string; reason?: string
  leave_types?: { name: string }
}

interface LeaveBalance {
  id: string; leave_type_id: string; balance: number; year: number
  leave_types: { id: string; name: string; is_paid: boolean }
}

interface RegReq {
  id: string; date: string; status: string; reason: string; created_at: string
}

interface Holiday { id: string; name: string; date: string }

interface Payslip {
  id: string; month: string; status: string
  gross_pay: number; total_deductions: number; net_pay: number
  lop_days: number; payable_days: number
}

// ── Status maps ───────────────────────────────────────────────────────────────

const STATUS_BLOCK: Record<string, string> = {
  present:     'bg-success/20 text-success border-success/25 hover:bg-success/30',
  late:        'bg-warning/20 text-warning border-warning/25 hover:bg-warning/30',
  absent:      'bg-destructive/15 text-destructive border-destructive/20 hover:bg-destructive/25',
  half_day:    'bg-muted text-muted-foreground border-border hover:bg-muted/80',
  holiday:     'bg-transparent text-primary border-primary/35 hover:bg-primary/10',
  leave:       'bg-primary/12 text-primary border-primary/25 hover:bg-primary/20',
  weekend:     'bg-transparent text-muted-foreground/25 border-transparent cursor-default pointer-events-none',
  weekly_off:  'bg-muted/25 text-muted-foreground/35 border-border/20 cursor-default',
  future:      'text-foreground/15 border-transparent cursor-default pointer-events-none',
  unprocessed: 'bg-muted/20 text-muted-foreground/30 border-border/20 hover:bg-muted/40',
}


const STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'> = {
  present: 'success', late: 'warning', absent: 'destructive',
  half_day: 'secondary', holiday: 'outline', leave: 'outline',
  pending: 'warning', approved: 'success', rejected: 'destructive',
}

const STATUS_ACCENT: Record<string, string> = {
  present:  'bg-success/70',
  late:     'bg-warning/60',
  absent:   'bg-destructive/60',
  half_day: 'bg-muted-foreground/40',
  holiday:  'bg-primary/50',
  leave:    'bg-primary/50',
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function greetingIcon() {
  const h = new Date().getHours()
  if (h < 6)  return <Sunset  className="h-3.5 w-3.5 text-info"    />
  if (h < 12) return <Sunrise className="h-3.5 w-3.5 text-warning" />
  if (h < 18) return <Sun     className="h-3.5 w-3.5 text-warning" />
  return               <Sunset className="h-3.5 w-3.5 text-info"   />
}

function monthRange() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  return {
    from: new Date(y, m, 1).toISOString().slice(0, 10),
    to:   new Date(y, m + 1, 0).toISOString().slice(0, 10),
    year: y, month: m,
  }
}

function fmtDate(s: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString([], opts ?? { month: 'short', day: 'numeric' })
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(n)
}

function fmtCurrencyShort(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000)   return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtHours(h: number): string {
  if (!h || h <= 0) return '—'
  const hours = Math.floor(h)
  const mins  = Math.round((h - hours) * 60)
  if (mins === 0) return `${hours}h`
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

function fmtMinutes(m: number): string {
  if (!m || m <= 0) return '—'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function inferDayStatus(
  dateStr: string,
  rec:     DailyRecord | undefined,
  logs:    AttendanceLog[],
  today:   string,
): string {
  if (rec?.status) return rec.status
  if (dateStr > today) return 'future'
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay()
  if (dow === 0 || dow === 6) return 'weekend'
  const hasLogs = logs.some(l => (l.check_in ?? '').startsWith(dateStr))
  if (hasLogs) return 'unprocessed'
  return ''
}

function buildCalendarDays(y: number, m: number): (number | null)[] {
  const firstDow = new Date(y, m, 1).getDay()
  const total    = new Date(y, m + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  const cells = Math.ceil(days.length / 7) * 7
  while (days.length < cells) days.push(null)
  return days
}

function calcStreak(daily: DailyRecord[]): number {
  const today  = new Date().toISOString().slice(0, 10)
  const WORK   = new Set(['present', 'late', 'half_day'])
  const OFF    = new Set(['holiday', 'weekend', 'weekly_off'])
  const sorted = [...daily]
    .filter(d => d.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))

  let streak = 0
  for (const d of sorted) {
    if (WORK.has(d.status))      streak++
    else if (OFF.has(d.status)) { /* skip */ }
    else                         break
  }
  return streak
}

function timeAgo(dateStr: string): string {
  const now  = Date.now()
  const then = new Date(dateStr + 'T12:00:00Z').getTime()
  const diff = Math.floor((now - then) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7)  return `${diff}d ago`
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`
  return fmtDate(dateStr)
}

/** Returns elapsed time since check-in as "4h 23m", updating every 30s. */
function useLiveElapsed(checkInIso: string | null, isLive: boolean): string | null {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!checkInIso || !isLive) return
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [checkInIso, isLive])

  if (!checkInIso || !isLive) return null
  const ms   = Date.now() - new Date(checkInIso).getTime()
  if (ms < 0) return null
  const tot  = Math.floor(ms / 60_000)
  const h    = Math.floor(tot / 60)
  const m    = tot % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Consecutive work-day streak ending at `dateStr` (inclusive).
 * Skips over weekends/holidays without breaking the streak.
 */
function streakEndingAt(dateStr: string, daily: DailyRecord[]): number {
  const WORK = new Set(['present', 'late', 'half_day'])
  const OFF  = new Set(['holiday', 'weekend', 'weekly_off'])
  const sorted = [...daily]
    .filter(d => d.date <= dateStr)
    .sort((a, b) => b.date.localeCompare(a.date))
  let count = 0
  for (const d of sorted) {
    if (WORK.has(d.status))      count++
    else if (OFF.has(d.status)) { /* gap — don't break */ }
    else                         break
  }
  return count
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function EssCard({
  children, className, onClick,
}: {
  children:  React.ReactNode
  className?: string
  onClick?:  () => void
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={cn(
        'rounded-2xl border bg-card shadow-sm overflow-hidden transition-all duration-150',
        onClick
          ? 'border-border/60 hover:border-border/90 hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)] hover:-translate-y-px cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          : 'border-border/60',
        className,
      )}
    >
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/75 select-none">
      {children}
    </p>
  )
}

function DrillRow({
  children, onClick, last = false,
}: {
  children: React.ReactNode
  onClick?: ((e: React.MouseEvent) => void) | (() => void)
  last?: boolean
}) {
  return (
    <div
      onClick={onClick as React.MouseEventHandler<HTMLDivElement>}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'flex items-center justify-between py-2 transition-colors duration-100 rounded-lg px-1 -mx-1',
        !last && 'border-b border-border/40',
        onClick && 'cursor-pointer hover:bg-muted/40 group',
      )}
    >
      {children}
    </div>
  )
}

function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={cn(
      'rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center font-bold text-primary-foreground select-none flex-shrink-0',
      className,
    )}>
      {initials || '?'}
    </div>
  )
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────

interface MonthStats {
  lateCount:    number   // # of late days so far this month
  absentCount:  number   // # of absent days so far this month
  presentCount: number   // # of attended days (present+late+half_day) so far
}

interface TooltipState {
  date:       string
  rec:        DailyRecord | null   // null = interactive day with no processed record yet
  inferred:   string               // resolved status label for display
  dayLogs:    AttendanceLog[]      // logs for that specific date
  vx:         number
  vy:         number
  streakLen:  number               // consecutive-work-day streak ending at this date
  monthStats: MonthStats
}

function AttendanceTooltip({ state }: { state: TooltipState }) {
  const { date, rec, inferred, dayLogs, vx, vy, streakLen, monthStats } = state

  const label = new Date(date + 'T12:00:00Z').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  const firstLog      = dayLogs[0] ?? null
  const hasMissingOut = !!(firstLog && !firstLog.check_out)
  const workedStr     = rec ? fmtHours(rec.work_hours) : null
  const lateStr       = rec && rec.late_minutes > 0 ? fmtMinutes(rec.late_minutes) : null
  const otStr         = rec && (rec.overtime_minutes ?? 0) > 0 ? fmtMinutes(rec.overtime_minutes ?? 0) : null

  // For no-record days, use inferred as display status
  const displayStatus = rec?.status ?? inferred

  const TOOLTIP_W = 212
  const vw        = typeof window !== 'undefined' ? window.innerWidth : 1200
  const safeLeft  = Math.max(8, Math.min(vx - TOOLTIP_W / 2, vw - TOOLTIP_W - 8))
  // Flip below cursor if close to top of viewport
  const showBelow = vy < 168
  const yStyle    = showBelow
    ? { top: vy + 30 }
    : { top: vy, transform: 'translateY(calc(-100% - 10px))' }

  const ACCENT_LINE: Record<string, string> = {
    present:  'bg-success/70', late: 'bg-warning/70', absent: 'bg-destructive/60',
    half_day: 'bg-muted-foreground/50', leave: 'bg-primary/60', holiday: 'bg-primary/40',
  }

  return (
    <div
      className="fixed z-[200] pointer-events-none"
      style={{ left: safeLeft, ...yStyle }}
    >
      <div
        className="rounded-xl bg-popover border border-border/80 shadow-xl shadow-black/12 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        style={{ width: TOOLTIP_W }}
      >
        {/* Status accent bar */}
        <div className={cn('h-[2.5px]', ACCENT_LINE[displayStatus] ?? 'bg-border/50')} />

        {/* Header */}
        <div className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2 border-b border-border/35">
          <p className="text-[11px] font-semibold text-foreground">{label}</p>
          {rec ? (
            <Badge
              variant={STATUS_BADGE_VARIANT[rec.status] ?? 'secondary'}
              className="rounded-full text-[9px] px-1.5 py-px capitalize flex-shrink-0"
            >
              {rec.status.replace(/_/g, ' ')}
            </Badge>
          ) : (
            <span className="text-[9px] text-muted-foreground border border-border/50 rounded-full px-1.5 py-px flex-shrink-0">
              No data
            </span>
          )}
        </div>

        <div className="px-3 py-2.5 space-y-2.5">

          {/* No-record state — data not yet processed */}
          {!rec && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Attendance not yet processed for this day.
            </p>
          )}

          {/* Punch timeline — IN / OUT */}
          {rec && rec.status !== 'holiday' && rec.status !== 'leave' && (
            <div className="space-y-1.5">
              {firstLog ? (
                <>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-success/80 flex-shrink-0" />
                      In
                    </span>
                    <span className="font-semibold text-foreground tabular-nums">{fmtTime(firstLog.check_in)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {hasMissingOut
                        ? <span className="h-1.5 w-1.5 rounded-full bg-warning/80 animate-pulse flex-shrink-0" />
                        : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/35 flex-shrink-0" />
                      }
                      Out
                    </span>
                    {hasMissingOut
                      ? <span className="text-[10px] font-semibold text-warning">Missing ⚠</span>
                      : <span className="font-semibold text-foreground tabular-nums">{fmtTime(firstLog.check_out)}</span>
                    }
                  </div>
                </>
              ) : rec.status === 'absent' ? (
                <p className="text-[10px] text-destructive/75 font-medium">No punches recorded</p>
              ) : null}
            </div>
          )}

          {/* Stats row */}
          {rec && (workedStr || lateStr || otStr || rec.status === 'absent' || hasMissingOut) && (
            <div className="border-t border-border/30 pt-2 space-y-1.5">
              {workedStr && rec.work_hours > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">Worked</span>
                  <span className="font-semibold text-foreground">{workedStr}</span>
                </div>
              )}
              {lateStr && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-warning">Late by</span>
                  <span className="font-semibold text-warning">{lateStr}</span>
                </div>
              )}
              {otStr && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-success">Overtime</span>
                  <span className="font-semibold text-success">{otStr}</span>
                </div>
              )}
              {rec.status === 'absent' && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-destructive">Payroll</span>
                  <span className="font-semibold text-destructive">LOP day</span>
                </div>
              )}
              {hasMissingOut && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-warning/90">Action needed</span>
                  <span className="font-semibold text-warning/90">Fix checkout</span>
                </div>
              )}
            </div>
          )}

          {/* Contextual status lines */}
          {rec?.status === 'leave' && (
            <p className="text-[10px] text-primary/80 border-t border-border/30 pt-2">
              Approved leave day
            </p>
          )}
          {rec?.status === 'holiday' && (
            <p className="text-[10px] text-primary/80 border-t border-border/30 pt-2">
              Public holiday · Office closed
            </p>
          )}
          {rec?.status === 'half_day' && (
            <div className="flex items-center justify-between text-[10px] border-t border-border/30 pt-2">
              <span className="text-muted-foreground">Payable</span>
              <span className="font-semibold text-foreground">0.5 day</span>
            </div>
          )}

          {/* Month context — interpretive insight line */}
          {rec && (() => {
            const isWork = ['present', 'late', 'half_day'].includes(rec.status)
            const lines: React.ReactNode[] = []

            if (isWork && streakLen >= 3) {
              lines.push(
                <span key="streak" className="text-success/80">
                  {streakLen}-day attendance streak
                </span>
              )
            }
            if (rec.status === 'late' && monthStats.lateCount > 1) {
              const ord = monthStats.lateCount === 2 ? '2nd' : monthStats.lateCount === 3 ? '3rd' : `${monthStats.lateCount}th`
              lines.push(
                <span key="late" className="text-warning/80">
                  {ord} late arrival this month
                </span>
              )
            }
            if (rec.status === 'absent' && monthStats.absentCount > 1) {
              lines.push(
                <span key="absent" className="text-destructive/70">
                  {monthStats.absentCount} absences this month
                </span>
              )
            }
            if (!lines.length) return null
            return (
              <div className="border-t border-border/25 pt-1.5 space-y-0.5">
                {lines.map(l => (
                  <p key={(l as React.ReactElement).key} className="text-[9px] font-medium">{l}</p>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// ── Day detail drawer ─────────────────────────────────────────────────────────

function DayDrawer({
  date, rec, logs, regReqs, holidays, onClose,
}: {
  date:     string | null
  rec:      DailyRecord | undefined
  logs:     AttendanceLog[]
  regReqs:  RegReq[]
  holidays: Holiday[]
  onClose:  () => void
}) {
  const navigate = useNavigate()
  if (!date) return null

  const today      = new Date().toISOString().slice(0, 10)
  const isFuture   = date > today
  const isToday    = date === today
  const isPast     = date < today
  const dow        = new Date(date + 'T12:00:00Z').getUTCDay()
  const isWeekend  = dow === 0 || dow === 6
  const isWeeklyOff = rec?.status === 'weekly_off'
  const isHoliday  = rec?.status === 'holiday' || holidays.some(h => h.date === date)
  const isLeave    = rec?.status === 'leave'
  const isAbsent   = rec?.status === 'absent'

  const regReq  = regReqs.find(r => r.date === date)
  const dayLogs = logs.filter(l => (l.check_in ?? '').startsWith(date))

  const canRequestCorrection = isPast && !isHoliday && !isWeekend && !isWeeklyOff && !isLeave && !regReq

  const shortLabel = new Date(date + 'T12:00:00Z').toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  const resolvedStatus = rec?.status ?? (isFuture ? 'future' : isWeekend ? 'weekend' : 'absent')
  const ACCENT_CLS: Record<string, string> = {
    present: 'from-success/80', late: 'from-warning/80', absent: 'from-destructive/70',
    half_day: 'from-muted-foreground/50', holiday: 'from-primary/60', leave: 'from-primary/60',
    weekend: 'from-border', weekly_off: 'from-border', future: 'from-border',
  }

  function punchEmptyMsg(): string {
    if (isFuture)                        return "This date hasn't arrived yet"
    if (isToday && !rec)                 return "Today's punches will appear once processed"
    if (isHoliday)                       return "Public holiday · Office closed"
    if (isWeekend || isWeeklyOff)        return "Weekly rest day · No punches expected"
    if (isLeave)                         return "On approved leave"
    if (isAbsent)                        return "No punches recorded · Marked absent"
    return "No punch data available"
  }

  function payrollPill() {
    if (!rec) return null
    if (['holiday', 'weekend', 'weekly_off', 'future'].includes(resolvedStatus)) return null
    if (isAbsent) return {
      cls: 'bg-destructive/10 border-destructive/20 text-destructive',
      icon: <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />,
      msg: 'Loss of Pay · This day will be deducted from payroll',
    }
    if (isLeave) return {
      cls: 'bg-primary/8 border-primary/20 text-primary',
      icon: <Calendar className="h-3.5 w-3.5 flex-shrink-0" />,
      msg: 'Approved leave · Payroll depends on leave type',
    }
    if (rec.status === 'half_day') return {
      cls: 'bg-warning/10 border-warning/20 text-warning',
      icon: <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />,
      msg: 'Half day · 0.5 days payable',
    }
    return {
      cls: 'bg-success/10 border-success/20 text-success',
      icon: <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />,
      msg: 'Full payable day · No payroll impact',
    }
  }
  const pill = payrollPill()

  return (
    <>
      <div className="fixed inset-0 bg-background/50 backdrop-blur-[2px] z-[150]" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[360px] bg-card border-l border-border/60 shadow-2xl z-[160] flex flex-col">
        <div className={cn('h-0.5 bg-gradient-to-r to-transparent flex-shrink-0', ACCENT_CLS[resolvedStatus] ?? 'from-border')} />
        <div className="flex-shrink-0 border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/75 select-none">{shortLabel}</p>
            {rec && (
              <Badge variant={STATUS_BADGE_VARIANT[rec.status] ?? 'secondary'} className="rounded-full capitalize text-[10px] mt-1">
                {rec.status.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 space-y-3">
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-2 border-b border-border/30 bg-muted/20">
                <Clock className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <SectionLabel>Punch timeline</SectionLabel>
              </div>
              {dayLogs.length > 0 ? (
                <div className="px-3.5 py-2.5 space-y-0">
                  {dayLogs.map((log, i) => (
                    <div key={log.id} className="relative">
                      {i < dayLogs.length - 1 && (
                        <div className="absolute left-[7px] top-[28px] h-full w-px bg-border/40" />
                      )}
                      <div className="flex items-center gap-3 py-1.5">
                        <div className="h-3.5 w-3.5 rounded-full bg-success/80 ring-2 ring-success/20 flex-shrink-0" />
                        <div className="flex-1 flex items-center justify-between min-w-0">
                          <p className="text-[10px] text-muted-foreground">Check in</p>
                          <p className="text-xs font-semibold text-foreground tabular-nums">{fmtTime(log.check_in)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 py-1.5">
                        {log.check_out ? (
                          <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/35 ring-2 ring-muted/30 flex-shrink-0" />
                        ) : (
                          <div className="relative h-3.5 w-3.5 flex-shrink-0">
                            <div className="h-3.5 w-3.5 rounded-full bg-warning/70 ring-2 ring-warning/20 absolute" />
                            <div className="h-3.5 w-3.5 rounded-full bg-warning/40 animate-ping absolute" />
                          </div>
                        )}
                        <div className="flex-1 flex items-center justify-between min-w-0">
                          <p className="text-[10px] text-muted-foreground">Check out</p>
                          <div className="flex items-center gap-1.5">
                            {!log.check_out && (
                              <span className="text-[9px] text-warning bg-warning/10 rounded px-1.5 py-0.5">Missing</span>
                            )}
                            <p className={cn('text-xs font-semibold tabular-nums', log.check_out ? 'text-foreground' : 'text-warning')}>
                              {fmtTime(log.check_out)}
                            </p>
                          </div>
                        </div>
                      </div>
                      {i < dayLogs.length - 1 && (
                        <div className="border-t border-dashed border-border/30 my-1 ml-6" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-3.5 py-6 flex flex-col items-center gap-2 text-center">
                  <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center">
                    <Clock className="h-4 w-4 text-muted-foreground/35" />
                  </div>
                  <p className="text-xs text-muted-foreground">{punchEmptyMsg()}</p>
                </div>
              )}
            </div>

            {rec && !['holiday', 'weekend', 'weekly_off'].includes(rec.status) && (
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Worked', value: rec.work_hours > 0 ? `${rec.work_hours}h` : '—', cls: 'text-foreground' },
                  { label: 'Late', value: rec.late_minutes > 0 ? `${rec.late_minutes}m` : '—', cls: rec.late_minutes > 0 ? 'text-warning' : 'text-muted-foreground/40' },
                  { label: 'OT', value: (rec.overtime_minutes ?? 0) > 0 ? `${rec.overtime_minutes}m` : '—', cls: (rec.overtime_minutes ?? 0) > 0 ? 'text-success' : 'text-muted-foreground/40' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="rounded-xl bg-muted/30 border border-border/30 p-3 text-center">
                    <p className="text-[9px] text-muted-foreground/75 uppercase tracking-wider mb-1">{label}</p>
                    <p className={cn('text-sm font-bold tabular-nums', cls)}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            {pill && (
              <div className={cn('flex items-center gap-2.5 p-3 rounded-xl border text-xs font-medium', pill.cls)}>
                {pill.icon}
                {pill.msg}
              </div>
            )}

            <div className="rounded-xl border border-border/50 overflow-hidden">
              <div className="px-3.5 pt-2.5 pb-2 flex items-center gap-2 border-b border-border/30 bg-muted/20">
                <AlertTriangle className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <SectionLabel>Attendance correction</SectionLabel>
              </div>
              <div className="px-3.5 py-3">
                {regReq ? (
                  <div className="flex items-center gap-2.5">
                    <Badge variant={STATUS_BADGE_VARIANT[regReq.status] ?? 'secondary'} className="rounded-full capitalize text-[10px]">{regReq.status}</Badge>
                    <p className="text-xs text-muted-foreground">Submitted · {fmtDate(regReq.created_at.slice(0, 10))}</p>
                  </div>
                ) : canRequestCorrection ? (
                  <button
                    onClick={() => { onClose(); navigate('/ess/attendance/corrections') }}
                    className="w-full flex items-center justify-between gap-2 text-xs font-medium text-primary hover:text-primary/80 transition-colors py-0.5 group"
                  >
                    <span>Request a correction for this day</span>
                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                ) : isFuture ? (
                  <p className="text-xs text-muted-foreground">Corrections available for past dates only</p>
                ) : isHoliday || isWeekend || isWeeklyOff ? (
                  <p className="text-xs text-muted-foreground">No correction needed for this day type</p>
                ) : isLeave ? (
                  <p className="text-xs text-muted-foreground">Correction not applicable for leave days</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No correction requested</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-border/50 p-3 space-y-2">
          <Button variant="outline" size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/attendance') }}>
            <CalendarDays className="h-3.5 w-3.5" />
            Full attendance view
            <ArrowRight className="h-3.5 w-3.5 ml-auto" />
          </Button>
          {isPast && !isHoliday && !isWeekend && !isWeeklyOff && !isLeave && !rec && (
            <Button size="sm" variant="ghost" className="w-full gap-2 h-8 text-xs text-warning hover:text-warning hover:bg-warning/10" onClick={() => { onClose(); navigate('/ess/leave/apply') }}>
              <CalendarPlus className="h-3.5 w-3.5" />
              Apply leave for this day
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

// ── Pay detail drawer ─────────────────────────────────────────────────────────

function PayDrawer({ slip, onClose }: { slip: Payslip | null; onClose: () => void }) {
  const navigate  = useNavigate()
  if (!slip) return null

  const net        = slip.net_pay
  const gross      = slip.gross_pay
  const deductions = slip.total_deductions
  const total      = gross + deductions
  const grossPct   = total > 0 ? Math.round((gross / total) * 100) : 0
  const monthLabel = new Date(slip.month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="fixed inset-0 bg-background/50 backdrop-blur-[2px] z-[150]" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[360px] bg-card border-l border-border/60 shadow-2xl z-[160] flex flex-col">
        <div className="h-0.5 bg-gradient-to-r from-success/80 to-transparent flex-shrink-0" />
        <div className="flex-shrink-0 border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/75 select-none">Payslip</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{monthLabel}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
          <div className="rounded-xl bg-gradient-to-br from-success/8 to-success/4 border border-success/15 p-5 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5">Net Pay</p>
            <p className="text-3xl font-bold text-foreground tabular-nums">{fmtCurrency(net)}</p>
            <Badge variant={slip.status === 'processed' ? 'success' : 'warning'} className="rounded-full text-[9px] mt-2 capitalize">{slip.status}</Badge>
          </div>

          {total > 0 && (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                <div className="bg-success/70 rounded-l-full transition-all" style={{ width: `${grossPct}%` }} />
                <div className="bg-destructive/60 rounded-r-full flex-1" />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-success/70 inline-block" />Gross {grossPct}%</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-destructive/60 inline-block" />Deductions {100 - grossPct}%</span>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <div className="px-3.5 pt-2.5 pb-2 bg-muted/20 border-b border-border/30"><SectionLabel>Breakdown</SectionLabel></div>
            <div className="divide-y divide-border/40">
              {[
                { label: 'Gross Pay', value: fmtCurrency(gross), cls: 'text-foreground' },
                { label: 'Total Deductions', value: `− ${fmtCurrency(deductions)}`, cls: 'text-destructive' },
                { label: 'Net Pay', value: fmtCurrency(net), cls: 'text-success font-bold' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className={cn('text-sm font-semibold tabular-nums', cls)}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <div className="px-3.5 pt-2.5 pb-2 bg-muted/20 border-b border-border/30"><SectionLabel>Payroll details</SectionLabel></div>
            <div className="divide-y divide-border/40">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-xs text-muted-foreground">Payable Days</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{slip.payable_days}</span>
              </div>
              {slip.lop_days > 0 && (
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-xs text-warning">Loss of Pay</span>
                  <span className="text-sm font-semibold text-warning tabular-nums">{slip.lop_days} days</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-border/50 p-3">
          <Button variant="outline" size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/payroll/my-slips') }}>
            <Receipt className="h-3.5 w-3.5" />
            View full payslip
            <ArrowRight className="h-3.5 w-3.5 ml-auto" />
          </Button>
        </div>
      </div>
    </>
  )
}

// ── Requests drawer ────────────────────────────────────────────────────────────

function RequestsDrawer({
  leaves, regReqs, onClose,
}: {
  leaves:  LeaveApp[]
  regReqs: RegReq[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'leaves' | 'corrections'>('leaves')
  const sorted    = [...leaves].sort((a, b) => b.from_date.localeCompare(a.from_date))
  const sortedReg = [...regReqs].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <div className="fixed inset-0 bg-background/50 backdrop-blur-[2px] z-[150]" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[360px] bg-card border-l border-border/60 shadow-2xl z-[160] flex flex-col">
        <div className="h-0.5 bg-gradient-to-r from-primary/80 to-transparent flex-shrink-0" />
        <div className="flex-shrink-0 border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">My Requests</p>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-shrink-0 flex border-b border-border/40">
          {(['leaves', 'corrections'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('flex-1 text-xs font-medium py-2.5 transition-colors border-b-2', tab === t ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground')}>
              {t === 'leaves' ? `Leaves (${leaves.length})` : `Corrections (${regReqs.length})`}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'leaves' ? (
            <div className="p-4 space-y-0.5">
              {sorted.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-2"><CalendarPlus className="h-4 w-4 text-muted-foreground/35" /></div>
                  <p className="text-xs text-muted-foreground">No leave applications yet</p>
                </div>
              ) : sorted.map((l, i) => (
                <DrillRow key={l.id} last={i === sorted.length - 1}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{l.leave_types?.name ?? 'Leave'}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(l.from_date)}{l.from_date !== l.to_date && ` – ${fmtDate(l.to_date)}`}</p>
                    {l.reason && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{l.reason}</p>}
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[l.status] ?? 'secondary'} className="rounded-full text-[9px] ml-2 flex-shrink-0 capitalize">{l.status}</Badge>
                </DrillRow>
              ))}
            </div>
          ) : (
            <div className="p-4 space-y-0.5">
              {sortedReg.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="h-9 w-9 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-2"><Clock className="h-4 w-4 text-muted-foreground/35" /></div>
                  <p className="text-xs text-muted-foreground">No correction requests yet</p>
                </div>
              ) : sortedReg.map((r, i) => (
                <DrillRow key={r.id} last={i === sortedReg.length - 1}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{fmtDate(r.date)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{r.reason}</p>
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[r.status] ?? 'secondary'} className="rounded-full text-[9px] ml-2 flex-shrink-0 capitalize">{r.status}</Badge>
                </DrillRow>
              ))}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border/50 p-3 space-y-2">
          <Button size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/leave/apply') }}>
            <CalendarPlus className="h-3.5 w-3.5" />Apply leave
          </Button>
          <Button variant="outline" size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/attendance/corrections') }}>
            <Clock className="h-3.5 w-3.5" />Request correction
          </Button>
        </div>
      </div>
    </>
  )
}

// ── Balance drawer ─────────────────────────────────────────────────────────────

function BalanceDrawer({ balances, onClose }: { balances: LeaveBalance[]; onClose: () => void }) {
  const navigate   = useNavigate()
  const total      = balances.reduce((s, b) => s + b.balance, 0)
  const maxBalance = balances.length > 0 ? Math.max(...balances.map(b => b.balance), 1) : 1

  return (
    <>
      <div className="fixed inset-0 bg-background/50 backdrop-blur-[2px] z-[150]" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full max-w-[360px] bg-card border-l border-border/60 shadow-2xl z-[160] flex flex-col">
        <div className="h-0.5 bg-gradient-to-r from-primary/80 to-transparent flex-shrink-0" />
        <div className="flex-shrink-0 border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/75 select-none">Leave Balance</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">{total} days available</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2.5">
          {balances.length === 0 ? (
            <div className="py-10 text-center"><p className="text-xs text-muted-foreground">No leave balance data</p></div>
          ) : balances.map(b => {
            const pct = maxBalance > 0 ? (b.balance / maxBalance) * 100 : 0
            return (
              <div key={b.id} className="rounded-xl border border-border/50 p-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-2 w-2 rounded-full flex-shrink-0', b.leave_types.is_paid ? 'bg-primary' : 'bg-muted-foreground/40')} />
                    <p className="text-sm font-medium text-foreground truncate">{b.leave_types.name}</p>
                    {!b.leave_types.is_paid && <span className="text-[9px] text-muted-foreground border border-border/60 rounded px-1 flex-shrink-0">Unpaid</span>}
                  </div>
                  <div className="flex items-baseline gap-0.5 ml-3 flex-shrink-0">
                    <span className={cn('text-xl font-bold tabular-nums', b.balance === 0 ? 'text-muted-foreground/40' : 'text-foreground')}>{b.balance}</span>
                    <span className="text-[10px] text-muted-foreground ml-0.5">days</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', b.leave_types.is_paid ? 'bg-primary/60' : 'bg-muted-foreground/40')} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <p className="text-[9px] text-muted-foreground/60 mt-1.5">{b.year}</p>
              </div>
            )
          })}
        </div>
        <div className="flex-shrink-0 border-t border-border/50 p-3 space-y-2">
          <Button size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/leave/apply') }}>
            <CalendarPlus className="h-3.5 w-3.5" />Apply leave
          </Button>
          <Button variant="outline" size="sm" className="w-full gap-2 h-8 text-xs" onClick={() => { onClose(); navigate('/ess/leave/ledger') }}>
            <Scale className="h-3.5 w-3.5" />View ledger<ArrowRight className="h-3.5 w-3.5 ml-auto" />
          </Button>
        </div>
      </div>
    </>
  )
}

// ── Compact attendance calendar ───────────────────────────────────────────────

function CompactCalendarCard({
  year, month, daily, logs, regReqs, holidays,
}: {
  year:     number
  month:    number
  daily:    DailyRecord[]
  logs:     AttendanceLog[]
  regReqs:  RegReq[]
  holidays: Holiday[]
}) {
  const navigate = useNavigate()
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [tooltip, setTooltip]         = useState<TooltipState | null>(null)
  const tooltipTimeoutRef             = useRef<ReturnType<typeof setTimeout> | null>(null)

  const today       = new Date().toISOString().slice(0, 10)
  const days        = buildCalendarDays(year, month)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  const dailyByDate = useMemo(() => new Map(daily.map(d => [d.date, d])), [daily])

  // Month-level aggregate stats for tooltip context
  const monthStats: MonthStats = useMemo(() => ({
    lateCount:    daily.filter(d => d.status === 'late').length,
    absentCount:  daily.filter(d => d.status === 'absent').length,
    presentCount: daily.filter(d => ['present', 'late', 'half_day'].includes(d.status)).length,
  }), [daily])

  const handleMouseEnter = useCallback((
    e:         React.MouseEvent,
    dateStr:   string,
    rec:       DailyRecord | undefined,
    inferred:  string,
    allLogs:   AttendanceLog[],
    _daily:    DailyRecord[],
    _mStats:   MonthStats,
  ) => {
    // Clear any pending hide (prevents flicker when sweeping across rows)
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    // Never show for non-working days
    const SKIP = new Set(['weekend', 'weekly_off', 'future', ''])
    if (SKIP.has(inferred)) return
    const r         = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const dayLogs   = allLogs.filter(l => (l.check_in ?? '').startsWith(dateStr))
    const streak    = streakEndingAt(dateStr, _daily)
    setTooltip({
      date: dateStr, rec: rec ?? null, inferred, dayLogs,
      vx: r.left + r.width / 2, vy: r.top,
      streakLen: streak, monthStats: _mStats,
    })
  }, [])

  const handleMouseLeave = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => setTooltip(null), 80)
  }, [])

  return (
    <>
      <EssCard>
        <div className="px-4 pt-3 pb-0 flex items-center justify-between border-b border-border/40 pb-2">
          <SectionLabel>Monthly heatmap</SectionLabel>
          <button
            onClick={() => navigate('/ess/attendance')}
            className="flex items-center gap-0.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Full view <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        <div className="px-3 pt-2 pb-3">
          {/* Weekday labels */}
          <div className="grid grid-cols-7 mb-0.5">
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <div key={i} className="flex justify-center">
                <span className="text-[8px] font-semibold text-muted-foreground/35 select-none">{d}</span>
              </div>
            ))}
          </div>

          {/* Day blocks */}
          <div className="grid grid-cols-7 gap-y-[3px]">
            {days.map((day, i) => {
              if (!day) return <div key={i} className="h-8 w-8" />
              const dateStr  = `${monthPrefix}-${String(day).padStart(2, '0')}`
              const rec      = dailyByDate.get(dateStr)
              const inferred = inferDayStatus(dateStr, rec, logs, today)
              const isToday  = dateStr === today
              const blockCls = STATUS_BLOCK[inferred] ?? ''
              const hasLate  = rec && rec.late_minutes > 0
              const hasOT    = rec && (rec.overtime_minutes ?? 0) > 0
              const hasPendingCorrection = regReqs.some(r => r.date === dateStr && r.status === 'pending')
              const isInteractive = inferred && !['weekend', 'weekly_off', 'future'].includes(inferred)
              // Work-hours intensity bar — fills bottom 2px of cell proportional to hours/9
              const hoursFill = rec && rec.work_hours > 0
                ? `${Math.min((rec.work_hours / 9) * 100, 100)}%`
                : null
              const hoursBarCls = rec
                ? rec.status === 'present' ? 'bg-success/55'
                  : rec.status === 'late'  ? 'bg-warning/55'
                  : null
                : null

              return (
                <div key={i} className="flex justify-center">
                  <button
                    onClick={() => { if (!isInteractive && !rec) return; setTooltip(null); setSelectedDay(dateStr) }}
                    onMouseEnter={isInteractive ? (e) => handleMouseEnter(e, dateStr, rec, inferred, logs, daily, monthStats) : undefined}
                    onMouseLeave={isInteractive ? handleMouseLeave : undefined}
                    className={cn(
                      'relative h-8 w-8 rounded-[4px] border flex flex-col items-center justify-center pb-[2px]',
                      'text-[9px] font-medium transition-all duration-100 select-none',
                      blockCls || 'text-foreground/35 border-transparent',
                      !blockCls && !isToday && 'hover:bg-muted/40',
                      isToday && 'ring-2 ring-primary ring-offset-1 ring-offset-card font-bold',
                      isInteractive ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    {day}

                    {/* Work-hours intensity bar at bottom of cell */}
                    {hoursFill && hoursBarCls && (
                      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-[3px]">
                        <div className={cn('h-full', hoursBarCls)} style={{ width: hoursFill }} />
                      </div>
                    )}

                    {/* Late / OT micro-dots */}
                    {rec && isInteractive && (hasLate || hasOT) && !hoursFill && (
                      <div className="absolute bottom-[2px] left-0 right-0 flex items-center justify-center gap-[2px]">
                        {hasLate && <span className="h-[2px] w-[2px] rounded-full bg-warning/80 flex-shrink-0" />}
                        {hasOT   && <span className="h-[2px] w-[2px] rounded-full bg-success/80 flex-shrink-0" />}
                      </div>
                    )}

                    {/* Pending correction indicator — top-right corner dot */}
                    {hasPendingCorrection && (
                      <span className="absolute top-[2px] right-[2px] h-[4px] w-[4px] rounded-full bg-warning" />
                    )}

                    {isToday && <span className="absolute inset-[-2px] rounded-[6px] ring-1 ring-primary/25 animate-ping pointer-events-none" />}
                  </button>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 flex-wrap mt-2 pt-2 border-t border-border/25">
            {[
              { label: 'Present', cls: 'bg-success/30 border border-success/40' },
              { label: 'Absent',  cls: 'bg-destructive/25 border border-destructive/35' },
              { label: 'Late',    cls: 'bg-warning/25 border border-warning/35' },
              { label: 'Leave',   cls: 'bg-primary/20 border border-primary/30' },
              { label: 'Holiday', cls: 'bg-transparent border border-primary/35' },
            ].map(({ label, cls }) => (
              <span key={label} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className={cn('w-[7px] h-[7px] rounded-[2px] flex-shrink-0', cls)} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </EssCard>

      {tooltip && <AttendanceTooltip state={tooltip} />}
      <DayDrawer
        date={selectedDay}
        rec={selectedDay ? dailyByDate.get(selectedDay) : undefined}
        logs={logs}
        regReqs={regReqs}
        holidays={holidays}
        onClose={() => setSelectedDay(null)}
      />
    </>
  )
}

// ── V2: Today Workspace Bar ───────────────────────────────────────────────────

function TodayWorkspaceBar({
  fullName, firstName, todayAtt, todayLogs, attLoading,
}: {
  fullName:   string
  firstName:  string
  todayAtt:   DailyRecord | undefined
  todayLogs:  AttendanceLog[]
  attLoading: boolean
}) {
  const navigate   = useNavigate()
  const dateLabel  = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const firstLog   = todayLogs[0] ?? null
  const isLive     = !!(firstLog && !firstLog.check_out)

  // Checked in but attendance not yet processed (e.g., processing lag)
  const isRawLive  = isLive && !todayAtt

  // Missing checkout: processed record exists, punch-in done, no punch-out
  const isMissingCheckout = !!(
    firstLog?.check_in && !firstLog.check_out && todayAtt &&
    !['holiday', 'weekend', 'weekly_off', 'future'].includes(todayAtt.status)
  )

  // Live elapsed time ticker — updates every 30 seconds
  const liveElapsed = useLiveElapsed(firstLog?.check_in ?? null, isLive)

  const borderCls = isMissingCheckout ? 'border-warning/40' : 'border-border/60'
  const accentCls = isMissingCheckout
    ? 'from-warning via-warning/50'
    : isLive
    ? 'from-success/70 via-success/30'
    : 'from-primary via-primary/50'

  return (
    <div className={cn('rounded-2xl border bg-card shadow-sm overflow-hidden', borderCls)}>
      {/* Gradient accent line */}
      <div className={cn('h-0.5 bg-gradient-to-r to-transparent', accentCls)} />

      <div className="px-5 py-3 flex items-center gap-4 flex-wrap sm:flex-nowrap">

        {/* Left: Avatar + identity */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Avatar name={fullName} className="h-9 w-9 text-sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {greetingIcon()}
              <p className="text-sm font-semibold text-foreground leading-none">
                {greeting()}, <span className="text-primary">{firstName}</span>
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{dateLabel}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-8 bg-border/50 flex-shrink-0" />

        {/* Center: Today status */}
        <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
          {attLoading ? (
            <div className="flex items-center gap-2">
              <div className="h-3.5 w-3.5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
              <span className="text-xs text-muted-foreground">Loading…</span>
            </div>
          ) : (
            <>
              {/* Live elapsed — the emotional anchor when actively working */}
              {liveElapsed && !isMissingCheckout && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success/60" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success/80" />
                  </span>
                  <span className="text-sm font-bold text-success tabular-nums leading-none">
                    {liveElapsed}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">working</span>
                </div>
              )}

              {/* Missing checkout urgency */}
              {isMissingCheckout && liveElapsed && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                  <span className="text-sm font-bold text-warning tabular-nums">{liveElapsed}</span>
                  <span className="text-[10px] text-warning/80 font-medium">· checkout missing</span>
                </div>
              )}

              {/* Status badge when not live */}
              {todayAtt && !firstLog && (
                <Badge
                  variant={STATUS_BADGE_VARIANT[todayAtt.status] ?? 'secondary'}
                  className="rounded-full capitalize flex-shrink-0"
                >
                  {todayAtt.status.replace(/_/g, ' ')}
                </Badge>
              )}

              {/* Punch times */}
              {firstLog && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Sunrise className="h-3 w-3 text-success/60" />
                    {fmtTime(firstLog.check_in)}
                  </span>
                  {firstLog.check_out && (
                    <span className="flex items-center gap-1">
                      <Sunset className="h-3 w-3 text-muted-foreground/40" />
                      {fmtTime(firstLog.check_out)}
                    </span>
                  )}
                </div>
              )}

              {/* Processed work hours (when not live — use processed value) */}
              {todayAtt && !isLive && todayAtt.work_hours > 0 && (
                <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                  <Timer className="h-3 w-3 text-muted-foreground/50" />
                  {fmtHours(todayAtt.work_hours)}
                </span>
              )}

              {/* Late indicator */}
              {todayAtt && todayAtt.late_minutes > 0 && (
                <span className="text-warning text-[10px] font-medium flex-shrink-0">
                  {todayAtt.late_minutes}m late
                </span>
              )}

              {/* Unprocessed / not checked in state */}
              {!todayAtt && !firstLog && !attLoading && (
                <span className="text-xs text-muted-foreground">
                  {new Date().getHours() < 8 ? 'Your workday starts soon' : 'No activity recorded yet today'}
                </span>
              )}

              {/* Raw live (punched but not processed) */}
              {isRawLive && (
                <span className="text-[10px] text-muted-foreground/70">Pending processing</span>
              )}
            </>
          )}
        </div>

        {/* Right: CTAs */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
          {isMissingCheckout && (
            <Button
              size="sm" variant="ghost"
              onClick={() => navigate('/ess/attendance/corrections')}
              className="h-8 gap-1.5 text-xs text-warning hover:text-warning hover:bg-warning/10"
            >
              <Clock className="h-3.5 w-3.5" />
              Fix checkout
            </Button>
          )}
          <Button
            size="sm" variant="ghost"
            onClick={() => navigate('/ess/attendance')}
            className="h-8 gap-1.5 text-xs hidden sm:flex"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Attendance
          </Button>
          <Button
            size="sm"
            onClick={() => navigate('/ess/leave/apply')}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Apply Leave
          </Button>
        </div>

      </div>
    </div>
  )
}

// ── V2: Intelligence Strip ────────────────────────────────────────────────────

interface InsightChip {
  id:    string
  icon:  React.ComponentType<{ className?: string }>
  label: string
  cls:   string
  onClick?: () => void
}

function IntelligenceStrip({ chips }: { chips: InsightChip[] }) {
  if (!chips.length) return null
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
      {/* Label */}
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 flex-shrink-0 pr-2 border-r border-border/40 mr-1 select-none">
        Status
      </span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          onClick={chip.onClick}
          disabled={!chip.onClick}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all leading-none flex-shrink-0',
            chip.cls,
            chip.onClick ? 'cursor-pointer hover:opacity-80 hover:scale-[1.02]' : 'cursor-default',
          )}
        >
          <chip.icon className="h-3 w-3 flex-shrink-0" />
          {chip.label}
        </button>
      ))}
    </div>
  )
}

// ── V2: Mini attendance sparkline (CSS-only) ──────────────────────────────────

function AttendanceSparkline({
  daily,
}: {
  daily: DailyRecord[]
}) {
  const today = new Date().toISOString().slice(0, 10)

  const bars = useMemo(() => {
    const result: Array<{ date: string; hours: number; status: string }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const rec     = daily.find(r => r.date === dateStr)
      const dow     = d.getDay()
      const isWeekend = dow === 0 || dow === 6
      result.push({
        date:   dateStr,
        hours:  rec?.work_hours ?? 0,
        status: rec?.status ?? (isWeekend ? 'weekend' : dateStr < today ? '' : 'future'),
      })
    }
    return result
  }, [daily, today])

  const maxH = 9

  const barColor = (status: string): string => {
    if (status === 'present')  return 'bg-success/65'
    if (status === 'late')     return 'bg-warning/65'
    if (status === 'absent')   return 'bg-destructive/50'
    if (status === 'leave')    return 'bg-primary/45'
    if (status === 'half_day') return 'bg-muted-foreground/40'
    if (status === 'holiday')  return 'bg-primary/25'
    if (status === 'weekend' || status === 'weekly_off') return 'bg-border/60'
    return 'bg-border/30'
  }

  return (
    <div className="flex items-end gap-[3px]" style={{ height: 32 }}>
      {bars.map(b => {
        const pct = b.hours > 0
          ? Math.max(0.12, b.hours / maxH)
          : (['weekend', 'weekly_off', 'holiday'].includes(b.status) ? 0.08 : 0)
        return (
          <div
            key={b.date}
            title={`${b.date} · ${b.status || '—'} · ${b.hours}h`}
            className={cn('flex-1 rounded-[2px] min-h-[2px]', barColor(b.status))}
            style={{ height: `${Math.round(pct * 100)}%` }}
          />
        )
      })}
    </div>
  )
}

// ── V2: Attendance Insight Panel ──────────────────────────────────────────────

function AttendanceInsightPanel({
  summary, daily, attLoading,
}: {
  summary:    AttendanceResp['summary'] | undefined
  daily:      DailyRecord[]
  attLoading: boolean
}) {
  const navigate = useNavigate()

  // Trend direction — compare work-days count: first 7 of past 14 vs last 7
  const trend: 'up' | 'down' | 'flat' = useMemo(() => {
    const WORK = new Set(['present', 'late', 'half_day'])
    let first7 = 0, last7 = 0
    for (let i = 13; i >= 7; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      const rec = daily.find(r => r.date === ds)
      if (rec && WORK.has(rec.status)) first7++
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      const rec = daily.find(r => r.date === ds)
      if (rec && WORK.has(rec.status)) last7++
    }
    if (last7 > first7) return 'up'
    if (last7 < first7) return 'down'
    return 'flat'
  }, [daily])

  const attPct = summary && summary.total_days > 0
    ? Math.round((summary.present / summary.total_days) * 100)
    : null

  const stats = summary ? [
    { label: 'Present',    value: summary.present,                        cls: 'text-success',     bg: 'bg-success/10' },
    { label: 'Absent',     value: summary.absent,                         cls: 'text-destructive', bg: summary.absent > 0 ? 'bg-destructive/8' : 'bg-muted/50' },
    { label: 'Late',       value: summary.late,                           cls: 'text-warning',     bg: summary.late > 0 ? 'bg-warning/10' : 'bg-muted/50' },
    { label: 'Hours',      value: fmtHours(summary.total_hours ?? 0),     cls: 'text-foreground',  bg: 'bg-muted/40' },
  ] : null

  const lopDays = summary?.lop_days ?? 0

  return (
    <EssCard>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
          <SectionLabel>Attendance · This month</SectionLabel>
        </div>
        <button
          onClick={() => navigate('/ess/attendance')}
          className="flex items-center gap-0.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Full view <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="p-4 space-y-4">

        {/* Stat tiles */}
        {attLoading ? (
          <div className="grid grid-cols-4 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-muted/40 h-16 animate-pulse" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-4 gap-2">
            {stats.map(({ label, value, cls, bg }) => (
              <div key={label} className={cn('rounded-xl px-2.5 py-2.5 text-center', bg)}>
                <p className={cn('text-xl font-bold tabular-nums leading-none', cls)}>{value}</p>
                <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">{label}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/30 px-4 py-4 text-center">
            <p className="text-xs text-muted-foreground">No attendance data this month</p>
          </div>
        )}

        {/* 14-day sparkline */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground/70">Last 14 days</p>
              {trend === 'up' && (
                <span className="flex items-center gap-0.5 text-[9px] font-semibold text-success">
                  <TrendingUp className="h-2.5 w-2.5" />Improving
                </span>
              )}
              {trend === 'down' && (
                <span className="flex items-center gap-0.5 text-[9px] font-semibold text-destructive">
                  <TrendingDown className="h-2.5 w-2.5" />Declining
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/50">← Earlier · Recent →</p>
          </div>
          <AttendanceSparkline daily={daily} />
        </div>

        {/* Attendance rate bar */}
        {attPct !== null && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-medium text-muted-foreground/70">Attendance rate</p>
              <p className={cn(
                'text-[11px] font-bold tabular-nums',
                attPct >= 90 ? 'text-success' : attPct >= 75 ? 'text-warning' : 'text-destructive',
              )}>{attPct}%</p>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  attPct >= 90 ? 'bg-success/70' : attPct >= 75 ? 'bg-warning/70' : 'bg-destructive/60',
                )}
                style={{ width: `${attPct}%` }}
              />
            </div>
            {summary && (
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {summary.present} of {summary.total_days} working days
              </p>
            )}
          </div>
        )}

        {/* LOP warning */}
        {lopDays > 0 && (
          <div className="flex items-center gap-2.5 rounded-xl bg-destructive/8 border border-destructive/20 px-3 py-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
            <p className="text-xs text-destructive">
              <span className="font-semibold">{lopDays} LOP day{lopDays > 1 ? 's' : ''}</span> — these will reduce your net pay
            </p>
          </div>
        )}

      </div>
    </EssCard>
  )
}

// ── V2: Smart Insights ────────────────────────────────────────────────────────

interface SmartInsight {
  id:       string
  severity: 'critical' | 'warning' | 'info' | 'success'
  icon:     React.ComponentType<{ className?: string }>
  message:  string
  action?:  { label: string; onClick: () => void }
}

function SmartInsights({
  insights,
}: {
  insights: SmartInsight[]
}) {
  if (!insights.length) return null

  const SEV_CLS: Record<SmartInsight['severity'], { bg: string; text: string; icon: string }> = {
    critical: { bg: 'bg-destructive/8 border-destructive/25', text: 'text-destructive', icon: 'text-destructive' },
    warning:  { bg: 'bg-warning/8 border-warning/20',         text: 'text-warning',     icon: 'text-warning'     },
    info:     { bg: 'bg-primary/8 border-primary/20',         text: 'text-foreground',  icon: 'text-primary'     },
    success:  { bg: 'bg-success/8 border-success/20',         text: 'text-foreground',  icon: 'text-success'     },
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 overflow-hidden">
      <div className="px-4 pt-3 pb-2.5 border-b border-border/30 flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 text-warning/80" />
        <SectionLabel>Smart insights</SectionLabel>
      </div>
      <div className="p-3 space-y-2">
        {insights.map(insight => {
          const cls = SEV_CLS[insight.severity]
          return (
            <div
              key={insight.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-xs',
                cls.bg,
                insight.severity === 'critical' && 'border-l-[3px] border-l-destructive/60 pl-2.5',
                insight.severity === 'warning'  && 'border-l-[3px] border-l-warning/55 pl-2.5',
              )}
            >
              <insight.icon className={cn('h-3.5 w-3.5 flex-shrink-0', cls.icon)} />
              <p className={cn('flex-1 font-medium', cls.text)}>{insight.message}</p>
              {insight.action && (
                <button
                  onClick={insight.action.onClick}
                  className="text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5 flex-shrink-0 ml-1"
                >
                  {insight.action.label} <ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── V2: Activity Timeline ─────────────────────────────────────────────────────

function ActivityTimeline({
  leaves, regReqs,
}: {
  leaves:  LeaveApp[]
  regReqs: RegReq[]
}) {
  const navigate = useNavigate()

  const items = useMemo(() => {
    type Item = {
      id: string; type: 'leave' | 'correction'
      label: string; sub: string; date: string; status: string
      icon: React.ComponentType<{ className?: string }>
    }

    const leaveItems: Item[] = leaves.map(l => ({
      id:     l.id,
      type:   'leave',
      label:  l.leave_types?.name ?? 'Leave',
      sub:    `${fmtDate(l.from_date)}${l.from_date !== l.to_date ? ` – ${fmtDate(l.to_date)}` : ''}`,
      date:   l.from_date,
      status: l.status,
      icon:   CalendarPlus,
    }))

    const regItems: Item[] = regReqs.map(r => ({
      id:     r.id,
      type:   'correction',
      label:  'Attendance Correction',
      sub:    fmtDate(r.date),
      date:   r.date,
      status: r.status,
      icon:   Clock,
    }))

    return [...leaveItems, ...regItems]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 6)
  }, [leaves, regReqs])

  if (!items.length) return null

  return (
    <EssCard>
      <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
          <SectionLabel>Recent activity</SectionLabel>
        </div>
        <button
          onClick={() => navigate('/ess/leave/apply')}
          className="flex items-center gap-0.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </div>

      <div className="relative px-4 py-3">
        {/* Spine */}
        <div className="absolute left-[27px] top-3 bottom-3 w-px bg-border/40" />

        <div className="space-y-0">
          {items.map((item, i) => (
            <div key={item.id} className={cn('flex items-start gap-3 py-2', i < items.length - 1 && 'border-b border-border/25')}>
              {/* Icon node */}
              <div className={cn(
                'h-7 w-7 rounded-full border flex items-center justify-center flex-shrink-0 relative z-10',
                item.status === 'approved' ? 'bg-success/12 border-success/30'
                  : item.status === 'rejected' ? 'bg-destructive/12 border-destructive/30'
                  : 'bg-muted border-border/60',
              )}>
                <item.icon className={cn(
                  'h-3.5 w-3.5',
                  item.status === 'approved' ? 'text-success'
                    : item.status === 'rejected' ? 'text-destructive'
                    : 'text-muted-foreground/70',
                )} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.sub}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[9px] text-muted-foreground/60">{timeAgo(item.date)}</span>
                    <Badge
                      variant={STATUS_BADGE_VARIANT[item.status] ?? 'secondary'}
                      className="rounded-full text-[9px] capitalize"
                    >
                      {item.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </EssCard>
  )
}

// ── V2: Operational Sidebar (unified right rail) ──────────────────────────────
/**
 * Single unified panel replacing 6 stacked widgets.
 * Uses divide-y to separate sections — one coherent surface, not widget soup.
 */
function OperationalSidebar({
  todayAtt, todayLogs, attLoading, leaves, regReqs, balances, latestSlip, holidays,
  onExpandPay, onExpandRequests, onExpandBalance,
}: {
  todayAtt:         DailyRecord | undefined
  todayLogs:        AttendanceLog[]
  attLoading:       boolean
  leaves:           LeaveApp[]
  regReqs:          RegReq[]
  balances:         LeaveBalance[]
  latestSlip:       Payslip | null
  holidays:         Holiday[]
  onExpandPay:      () => void
  onExpandRequests: () => void
  onExpandBalance:  () => void
}) {
  const navigate = useNavigate()
  const today    = new Date().toISOString().slice(0, 10)

  // ── Today section ────────────────────────────────────────────────────────────
  const firstLog      = todayLogs[0] ?? null
  const isLive        = !!(firstLog?.check_in && !firstLog.check_out)
  const liveElapsed   = useLiveElapsed(firstLog?.check_in ?? null, isLive)
  const liveProgressPct: number | null = isLive && firstLog?.check_in
    ? Math.min(
        Math.round(((Date.now() - new Date(firstLog.check_in).getTime()) / 60_000) / 540 * 100),
        100,
      )
    : null

  const accentCls = isLive
    ? 'bg-success/60'
    : todayAtt
    ? (STATUS_ACCENT[todayAtt.status] ?? 'bg-primary/40')
    : 'bg-border/40'

  // ── Requests section ─────────────────────────────────────────────────────────
  const pending  = [...leaves, ...regReqs].filter(r => r.status === 'pending').length
  const approved = leaves.filter(l => l.status === 'approved').length
  const rejected = leaves.filter(l => l.status === 'rejected').length

  // ── Balance section ──────────────────────────────────────────────────────────
  const totalBalance = balances.reduce((s, b) => s + b.balance, 0)
  const maxBalance   = balances.length > 0 ? Math.max(...balances.map(b => b.balance), 1) : 1
  const balancePreview = balances.slice(0, 3)

  // ── Pay section ──────────────────────────────────────────────────────────────
  const payMonthLabel = latestSlip
    ? new Date(latestSlip.month + '-01').toLocaleString('default', { month: 'short', year: 'numeric' })
    : ''

  // ── Holidays section ─────────────────────────────────────────────────────────
  const upcoming = holidays.filter(h => h.date >= today).slice(0, 3)

  // ── Quick actions ────────────────────────────────────────────────────────────
  const actions: Array<{ label: string; icon: React.ComponentType<{ className?: string }>; href: string; cls: string }> = [
    { label: 'Apply Leave',  icon: CalendarPlus, href: '/ess/leave/apply',           cls: 'text-primary bg-primary/12'     },
    { label: 'Payslip',      icon: Receipt,      href: '/ess/payroll/my-slips',       cls: 'text-success bg-success/12'     },
    { label: 'Correct Time', icon: Clock,        href: '/ess/attendance/corrections', cls: 'text-warning bg-warning/12'     },
    { label: 'Balance',      icon: Scale,        href: '/ess/leave/ledger',           cls: 'text-info bg-info/12'           },
    { label: 'Documents',    icon: FileText,     href: '/ess/documents',              cls: 'text-muted-foreground bg-muted' },
    { label: 'Declarations', icon: FileCheck,    href: '/ess/declarations',           cls: 'text-muted-foreground bg-muted' },
  ]

  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden sticky top-4">
      {/* Dynamic accent line tied to today's attendance state */}
      <div className={cn('h-0.5', accentCls)} />

      <div className="divide-y divide-border/35">

        {/* ── TODAY ────────────────────────────────────────────────────────── */}
        <div className="px-4 pt-3.5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Today</SectionLabel>
            {todayAtt && (
              <Badge variant={STATUS_BADGE_VARIANT[todayAtt.status] ?? 'secondary'} className="rounded-full capitalize text-[9px]">
                {todayAtt.status.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>

          {attLoading ? (
            <div className="flex items-center gap-2 py-2">
              <div className="h-3.5 w-3.5 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
              <span className="text-xs text-muted-foreground/60">Loading…</span>
            </div>
          ) : firstLog ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-muted/40 border border-border/40 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">In</p>
                  <p className="text-xs font-bold text-success tabular-nums">{fmtTime(firstLog.check_in)}</p>
                </div>
                <div className="rounded-xl bg-muted/40 border border-border/40 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Out</p>
                  <div className="flex items-center gap-1">
                    {!firstLog.check_out && <span className="h-1.5 w-1.5 rounded-full bg-success/80 animate-pulse flex-shrink-0" />}
                    <p className={cn('text-xs font-bold tabular-nums', firstLog.check_out ? 'text-foreground' : 'text-muted-foreground/50')}>
                      {firstLog.check_out ? fmtTime(firstLog.check_out) : 'Active'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Live workday progress bar */}
              {isLive && liveElapsed && liveProgressPct !== null && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Working</span>
                    <span className="text-[11px] font-semibold text-success tabular-nums">
                      {liveElapsed}
                      <span className="text-[9px] text-muted-foreground/60 font-normal ml-1">/ 9h</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-success/55 transition-all duration-700" style={{ width: `${liveProgressPct}%` }} />
                  </div>
                </div>
              )}

              {/* Processed work hours */}
              {todayAtt && !isLive && todayAtt.work_hours > 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />{fmtHours(todayAtt.work_hours)} worked
                  </span>
                  {todayAtt.late_minutes > 0 && <span className="text-warning font-medium">{todayAtt.late_minutes}m late</span>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">
              {new Date().getHours() < 9 ? "Day hasn't started yet" : 'Awaiting attendance processing'}
            </p>
          )}

          <button
            onClick={() => navigate('/ess/attendance')}
            className="w-full mt-3 text-[10px] font-medium text-primary/70 hover:text-primary flex items-center justify-center gap-0.5 transition-colors"
          >
            Full view <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {/* ── REQUESTS ─────────────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <SectionLabel>My requests</SectionLabel>
            <button onClick={() => navigate('/ess/leave/apply')} className="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors">
              <Plus className="h-3 w-3" /> Apply
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'Pending',  count: pending,  bg: 'bg-warning/10 border-warning/20',        txt: 'text-warning'     },
              { label: 'Approved', count: approved, bg: 'bg-success/10 border-success/20',         txt: 'text-success'     },
              { label: 'Rejected', count: rejected, bg: 'bg-destructive/8 border-destructive/20', txt: 'text-destructive' },
            ].map(({ label, count, bg, txt }) => (
              <button key={label} onClick={onExpandRequests} className={cn('rounded-xl border p-2 text-center transition-colors hover:opacity-80', bg)}>
                <p className={cn('text-lg font-bold tabular-nums leading-none', txt)}>{count}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">{label}</p>
              </button>
            ))}
          </div>
          <button onClick={onExpandRequests} className="w-full mt-2.5 text-[10px] font-medium text-muted-foreground/70 hover:text-foreground flex items-center justify-center gap-0.5 transition-colors">
            View all <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {/* ── LEAVE BALANCE ─────────────────────────────────────────────────── */}
        {balances.length > 0 && (
          <div className="px-4 pt-3 pb-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <SectionLabel>Leave balance</SectionLabel>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-foreground tabular-nums">{totalBalance}d</span>
                <button onClick={() => navigate('/ess/leave/ledger')} className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors">Ledger</button>
              </div>
            </div>
            <div className="space-y-1.5">
              {balancePreview.map(b => {
                const pct = maxBalance > 0 ? (b.balance / maxBalance) * 100 : 0
                return (
                  <div key={b.id} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', b.leave_types.is_paid ? 'bg-primary' : 'bg-muted-foreground/40')} />
                        <span className="text-[11px] text-foreground truncate max-w-[100px]">{b.leave_types.name}</span>
                      </div>
                      <span className={cn('text-[11px] font-bold tabular-nums', b.balance === 0 ? 'text-muted-foreground/40' : 'text-foreground')}>{b.balance}d</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div className={cn('h-full rounded-full', b.leave_types.is_paid ? 'bg-primary/55' : 'bg-muted-foreground/35')} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                )
              })}
              {balances.length > 3 && <p className="text-[10px] text-muted-foreground/60 text-center pt-0.5">+{balances.length - 3} more</p>}
            </div>
            <button onClick={onExpandBalance} className="w-full mt-2.5 text-[10px] font-medium text-muted-foreground/70 hover:text-foreground flex items-center justify-center gap-0.5 transition-colors">
              Full breakdown <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* ── PAY ──────────────────────────────────────────────────────────── */}
        {latestSlip && (
          <button
            onClick={onExpandPay}
            className="w-full text-left px-4 pt-3 pb-3.5 hover:bg-muted/20 transition-colors group"
          >
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>Pay · {payMonthLabel}</SectionLabel>
              <div className="flex items-center gap-1.5">
                <Badge variant={latestSlip.status === 'processed' ? 'success' : 'warning'} className="rounded-full text-[9px] capitalize">
                  {latestSlip.status}
                </Badge>
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground mb-0.5">Net pay</p>
                <p className="text-lg font-bold text-foreground tabular-nums">{fmtCurrencyShort(latestSlip.net_pay)}</p>
              </div>
              {(latestSlip.payable_days > 0 || latestSlip.lop_days > 0) && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Payable: <span className="font-medium text-foreground">{latestSlip.payable_days}d</span></p>
                  {latestSlip.lop_days > 0 && <p className="text-[10px] text-warning">LOP: <span className="font-medium">{latestSlip.lop_days}d</span></p>}
                </div>
              )}
            </div>
          </button>
        )}

        {/* ── QUICK ACTIONS ─────────────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-3.5">
          <div className="mb-2.5"><SectionLabel>Quick actions</SectionLabel></div>
          <div className="grid grid-cols-3 gap-1.5">
            {actions.map(a => (
              <button
                key={a.label}
                onClick={() => navigate(a.href)}
                className="group flex flex-col items-center gap-1 p-2 rounded-xl border border-border/40 bg-card hover:bg-muted/30 hover:border-border transition-all duration-150"
              >
                <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center transition-transform duration-150 group-hover:scale-110', a.cls)}>
                  <a.icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[9px] font-medium text-muted-foreground group-hover:text-foreground transition-colors leading-tight text-center line-clamp-2">{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── HOLIDAYS ──────────────────────────────────────────────────────── */}
        {upcoming.length > 0 && (
          <div className="px-4 pt-3 pb-3.5">
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>Upcoming holidays</SectionLabel>
              <button onClick={() => navigate('/ess/optional-holidays')} className="text-[10px] font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5">
                All <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              {upcoming.map((h, i) => {
                const daysUntil = Math.ceil((new Date(h.date + 'T12:00:00Z').getTime() - Date.now()) / 86_400_000)
                const isHolToday    = daysUntil === 0
                const isTomorrow    = daysUntil === 1
                return (
                  <div key={h.id} className={cn(
                    'flex items-center justify-between py-1.5 rounded-lg transition-colors',
                    isHolToday  && 'px-2 -mx-0.5 bg-primary/8 border border-primary/20',
                    isTomorrow  && 'px-2 -mx-0.5 bg-warning/6 border border-warning/15',
                    !isHolToday && !isTomorrow && i < upcoming.length - 1 && 'border-b border-border/25',
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isHolToday && (
                          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary/80" />
                          </span>
                        )}
                        <p className={cn('text-[11px] font-medium truncate', isHolToday ? 'text-primary font-semibold' : 'text-foreground')}>{h.name}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{fmtDate(h.date)}</p>
                    </div>
                    <Badge
                      variant={isHolToday ? 'outline' : isTomorrow ? 'warning' : 'secondary'}
                      className={cn('rounded-full text-[9px] px-1.5 ml-2 flex-shrink-0', isHolToday && 'border-primary/40 text-primary bg-primary/10')}
                    >
                      {isHolToday ? 'Today!' : isTomorrow ? 'Tomorrow' : `${daysUntil}d`}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type DrawerType = 'pay' | 'requests' | 'balance' | null

export function EmployeeDashboard() {
  const { profile } = useAuthStore()
  const navigate    = useNavigate()
  const { from, to, year, month } = monthRange()
  const empId     = profile?.employee_id ?? null
  const today     = new Date().toISOString().slice(0, 10)
  const fullName  = profile?.full_name ?? 'there'
  const firstName = fullName.split(' ')[0]

  const [openDrawer, setOpenDrawer] = useState<DrawerType>(null)
  const closeDrawer = useCallback(() => setOpenDrawer(null), [])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: attResp, isLoading: attLoading } = useQuery<AttendanceResp>({
    queryKey:  ['ess-att', empId, from, to],
    queryFn:   () => api.get(`/attendance/${empId}?from=${from}&to=${to}`),
    enabled:   !!empId,
    staleTime: 60_000,
    retry:     false,
  })

  const { data: leaveResp } = useQuery<{ data: LeaveApp[] }>({
    queryKey:  ['ess-leave'],
    queryFn:   () => api.get('/attendance/leave/my'),
    enabled:   !!empId,
    staleTime: 60_000,
    retry:     false,
  })

  const { data: balanceResp } = useQuery<{ data: LeaveBalance[] }>({
    queryKey:  ['ess-balance', empId],
    queryFn:   () => api.get(`/attendance/leave/balance/${empId}`),
    enabled:   !!empId,
    staleTime: 5 * 60_000,
    retry:     false,
  })

  const { data: regResp } = useQuery<{ data: RegReq[] }>({
    queryKey:  ['ess-reg-my'],
    queryFn:   () => api.get('/attendance/regularisation/my'),
    enabled:   !!empId,
    staleTime: 60_000,
    retry:     false,
  })

  const { data: holidaysResp } = useQuery<{ data: Holiday[] }>({
    queryKey:  ['holidays'],
    queryFn:   () => api.get('/masters/holidays'),
    staleTime: 60 * 60_000,
    retry:     false,
  })

  const { data: payslipsData } = useQuery<Payslip[]>({
    queryKey:  ['ess-my-slips'],
    queryFn:   () => api.get('/payroll/my-slips'),
    enabled:   !!empId,
    staleTime: 15 * 60_000,
    retry:     false,
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const att        = attResp?.summary
  const daily      = attResp?.daily ?? []
  const logs       = attResp?.logs  ?? []
  const leaves     = leaveResp?.data ?? []
  const balances   = balanceResp?.data ?? []
  const regReqs    = regResp?.data ?? []
  const holidays   = holidaysResp?.data ?? []
  const latestSlip = payslipsData?.[0] ?? null

  const todayAtt     = daily.find(d => d.date === today)
  const todayLogs    = logs.filter(l => (l.check_in ?? '').startsWith(today))
  const pendingLeaves = leaves.filter(l => l.status === 'pending')
  const pendingReg    = regReqs.filter(r => r.status === 'pending')
  const totalPending  = pendingLeaves.length + pendingReg.length
  const totalBalance  = balances.reduce((s, b) => s + b.balance, 0)
  const streak        = calcStreak(daily)
  const attPct        = att && att.total_days > 0 ? Math.round((att.present / att.total_days) * 100) : null

  // ── Intelligence chips ──────────────────────────────────────────────────────

  const intelligenceChips = useMemo((): InsightChip[] => {
    const chips: InsightChip[] = []

    if (streak >= 3) chips.push({
      id: 'streak', icon: Zap, label: `${streak}-day streak`,
      cls: 'text-warning bg-warning/10 border-warning/25',
    })

    if (attPct !== null) chips.push({
      id: 'att', icon: TrendingUp,
      label: `${attPct}% attendance`,
      cls: attPct >= 90
        ? 'text-success bg-success/10 border-success/25'
        : attPct >= 75
          ? 'text-warning bg-warning/10 border-warning/25'
          : 'text-destructive bg-destructive/8 border-destructive/20',
    })

    if (totalPending > 0) chips.push({
      id: 'pending', icon: Bell,
      label: `${totalPending} pending`,
      cls: 'text-warning bg-warning/10 border-warning/25',
      onClick: () => setOpenDrawer('requests'),
    })

    if (totalBalance > 0) chips.push({
      id: 'balance', icon: Scale,
      label: `${totalBalance}d leave balance`,
      cls: 'text-primary bg-primary/10 border-primary/25',
      onClick: () => setOpenDrawer('balance'),
    })

    if (latestSlip) {
      const monthLabel = new Date(latestSlip.month + '-01').toLocaleString('default', { month: 'short', year: 'numeric' })
      chips.push({
        id: 'pay', icon: Receipt,
        label: `${monthLabel} payslip`,
        cls: 'text-success bg-success/10 border-success/25',
        onClick: () => setOpenDrawer('pay'),
      })
    }

    return chips
  }, [streak, attPct, totalPending, totalBalance, latestSlip, att])

  // ── Smart insights ──────────────────────────────────────────────────────────

  const smartInsights = useMemo((): SmartInsight[] => {
    const insights: SmartInsight[] = []

    // 1. Missing checkout today — highest operational urgency
    const hasMissingCheckout = todayLogs.some(l => !l.check_out)
    if (hasMissingCheckout) insights.push({
      id: 'missing-checkout', severity: 'critical', icon: AlertTriangle,
      message: "Today's checkout is missing — fix it to avoid attendance errors",
      action: { label: 'Correct', onClick: () => navigate('/ess/attendance/corrections') },
    })

    // 2. Missing checkouts on past days (not just today)
    const missingPastPunches = logs.filter(l => {
      if (l.check_out) return false
      const logDate = (l.check_in ?? '').slice(0, 10)
      return logDate.length === 10 && logDate < today
    }).length
    if (missingPastPunches > 0) insights.push({
      id: 'missing-past-punches', severity: 'warning', icon: Clock,
      message: `${missingPastPunches} past day${missingPastPunches > 1 ? 's' : ''} missing checkout — may affect payroll`,
      action: { label: 'Correct', onClick: () => navigate('/ess/attendance/corrections') },
    })

    // 3. Pending approvals
    if (totalPending > 0) insights.push({
      id: 'pending', severity: 'warning', icon: Bell,
      message: `${totalPending} request${totalPending > 1 ? 's' : ''} awaiting approval`,
      action: { label: 'View', onClick: () => setOpenDrawer('requests') },
    })

    // 4. Absences — LOP risk (threshold lowered to 1)
    if (att && att.absent >= 1) insights.push({
      id: 'absences', severity: att.absent >= 3 ? 'critical' : 'warning', icon: AlertTriangle,
      message: att.absent >= 3
        ? `${att.absent} absences this month — salary deduction likely`
        : `${att.absent} absence${att.absent > 1 ? 's' : ''} this month — may affect payroll`,
      action: { label: 'View', onClick: () => navigate('/ess/attendance') },
    })

    // 5. Late pattern — recurring lateness worth surfacing
    if (att && att.late >= 3) insights.push({
      id: 'late-pattern', severity: 'warning', icon: TrendingDown,
      message: `Late ${att.late} time${att.late > 1 ? 's' : ''} this month — try to improve punctuality`,
      action: { label: 'View', onClick: () => navigate('/ess/attendance') },
    })

    // 6. Low attendance rate
    if (attPct !== null && attPct < 80 && (att?.total_days ?? 0) >= 5) insights.push({
      id: 'low-att', severity: 'warning', icon: TrendingUp,
      message: `Attendance rate ${attPct}% — below the 80% threshold`,
      action: { label: 'Details', onClick: () => navigate('/ess/attendance') },
    })

    // 7. Low leave balance
    const lowBalances = balances.filter(b => b.leave_types.is_paid && b.balance < 3 && b.balance > 0)
    if (lowBalances.length > 0) insights.push({
      id: 'low-balance', severity: 'info', icon: Scale,
      message: `${lowBalances[0].leave_types.name} balance low — ${lowBalances[0].balance} day${lowBalances[0].balance === 1 ? '' : 's'} remaining`,
      action: { label: 'Apply leave', onClick: () => navigate('/ess/leave/apply') },
    })

    return insights.slice(0, 3)
  }, [todayLogs, logs, daily, totalPending, att, balances, attPct, navigate, today])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto min-h-0">
      <div className="p-5 lg:p-6 space-y-4 max-w-[1400px] mx-auto">

        {/* ── Today Workspace Bar ────────────────────────────────────────── */}
        <TodayWorkspaceBar
          fullName={fullName}
          firstName={firstName}
          todayAtt={todayAtt}
          todayLogs={todayLogs}
          attLoading={attLoading}
        />

        {/* ── Intelligence Strip ─────────────────────────────────────────── */}
        <IntelligenceStrip chips={intelligenceChips} />

        {/* ── Main grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ── Primary content zone (left 8 cols) ─────────────────────── */}
          <div className="lg:col-span-8 space-y-4">

            {/* Attendance insight panel — primary */}
            <AttendanceInsightPanel
              summary={att}
              daily={daily}
              attLoading={attLoading}
            />

            {/* Smart insights — contextual alerts */}
            <SmartInsights insights={smartInsights} />

            {/* Compact calendar heatmap — secondary */}
            {attLoading ? (
              <EssCard>
                <div className="h-48 flex items-center justify-center">
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              </EssCard>
            ) : (
              <CompactCalendarCard
                year={year} month={month}
                daily={daily} logs={logs}
                regReqs={regReqs} holidays={holidays}
              />
            )}

            {/* Activity timeline */}
            <ActivityTimeline leaves={leaves} regReqs={regReqs} />

          </div>

          {/* ── Operational right rail (4 cols) ────────────────────────── */}
          <div className="lg:col-span-4">
            <OperationalSidebar
              todayAtt={todayAtt}
              todayLogs={todayLogs}
              attLoading={attLoading}
              leaves={leaves}
              regReqs={regReqs}
              balances={balances}
              latestSlip={latestSlip}
              holidays={holidays}
              onExpandPay={() => setOpenDrawer('pay')}
              onExpandRequests={() => setOpenDrawer('requests')}
              onExpandBalance={() => setOpenDrawer('balance')}
            />
          </div>
        </div>
      </div>

      {/* ── Global drawers ─────────────────────────────────────────────── */}
      {openDrawer === 'pay' && (
        <PayDrawer slip={latestSlip} onClose={closeDrawer} />
      )}
      {openDrawer === 'requests' && (
        <RequestsDrawer leaves={leaves} regReqs={regReqs} onClose={closeDrawer} />
      )}
      {openDrawer === 'balance' && (
        <BalanceDrawer balances={balances} onClose={closeDrawer} />
      )}
    </div>
  )
}
