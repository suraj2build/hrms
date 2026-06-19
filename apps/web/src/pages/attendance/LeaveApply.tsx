/**
 * LeaveApply — /leave/apply
 *
 * Employee self-service leave application form.
 *
 * Phase 4 — Multi-Day Half-Day + Backend Duration Engine:
 *  · Separate start_session and end_session (full_day / first_half / second_half / hourly)
 *  · Hourly session locks to a single day; half-day sessions now allow multi-day ranges
 *  · Duration is computed by the backend engine (POST /leave/duration/preview), NOT the frontend
 *  · Example: "May 10 (Second Half) → May 12 (First Half) = 1.5 days" with May 11 excluded
 *  · Submits to POST /leave-requests with start_session + end_session + legacy session field
 *
 * Design: design-system tokens only. Major UI/UX redesign with interactive calendar.
 */

import { useState, useMemo }                             from 'react'
import { useNavigate, Link }                             from 'react-router-dom'
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query'
import {
  CalendarDays, Loader2, AlertTriangle, Info, CheckCircle2, Clock,
  TrendingDown, ExternalLink, Wallet,
  ChevronLeft, ChevronRight, Zap, Sparkles, Users,
} from 'lucide-react'
import { toast }                                         from 'sonner'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { PeriodLockBanner }  from '@/components/layout/PeriodLockBanner'
import { Button }            from '@/components/ui/button'
import { Input }             from '@/components/ui/input'
import { DateInput }         from '@/components/ui/date-input'

import { api }               from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { cn }                from '@/lib/utils'
import { usePeriodLock }     from '@/hooks/usePeriodLock'
import { PolicyExplainPanel, type PolicyResolutionInfo } from '@/components/operational/PolicyChain'

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveSession = 'full_day' | 'first_half' | 'second_half' | 'hourly'

interface LeaveType {
  id:             string
  name:           string
  is_paid:        boolean
  allow_sandwich: boolean
  allow_half_day: boolean
  allow_hourly:   boolean
  max_hours_per_day?: number | null
  is_active:      boolean
}

/** Policy-level session + application-window governance — fetched from /masters/leave-policies/by-type/:id */
interface LeaveSessionPolicy {
  // Session governance
  allow_half_day:                       boolean
  allow_hourly_leave:                   boolean
  allow_cross_session:                  boolean
  minimum_leave_unit:                   number
  maximum_sessions_per_day:             number
  hours_per_shift:                      number
  max_hours_per_day:                    number | null
  // Application window governance (migration 161)
  allow_past_dated_leave:               boolean
  maximum_past_days:                    number
  allow_current_period_leave:           boolean
  allow_future_leave:                   boolean
  maximum_future_days:                  number | null
  future_application_requires_approval: boolean
  same_day_application_mode:            'allowed' | 'restricted' | 'manager_override_only'
}

interface BalanceRow {
  leave_type_id: string
  balance:       number
  year:          number
  leave_types:   { id: string; name: string; is_paid: boolean }
}

interface LeaveRequest {
  id:            string
  status:        string
  from_date:     string
  to_date:       string
  computed_days: number
  session:       LeaveSession
}

interface DayAnalysis {
  date:           string
  is_holiday:     boolean
  is_weekly_off:  boolean
  is_sandwiched:  boolean
  collision_type: string | null
  resolution:     string
  charged:        boolean
}

interface CollisionResult {
  requested_dates:  string[]
  charged_dates:    string[]
  sandwiched_dates: string[]
  converted_dates:  string[]
  charged_days:     number
  is_blocked:       boolean
  block_reason:     string | null
  per_day:          DayAnalysis[]
  policy:           {
    sandwich_mode:            string
    collision_on_holiday:     string
    collision_on_weekly_off:  string
  }
}

interface DurationPerDay {
  date:    string
  dow:     string
  session: string
  charged: number
  type:    'working' | 'holiday' | 'weekend' | 'sandwich' | 'overlap'
}

interface DurationBreakdown {
  working:  number
  holiday:  number
  weekend:  number
  sandwich: number
  per_day:  DurationPerDay[]
}

interface DurationResult {
  calculated_days: number
  breakdown:       DurationBreakdown
  warnings:        string[]
}

// ── New calendar-related types ─────────────────────────────────────────────────

type CalDailyStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'half_day'
  | 'holiday'
  | 'weekend'
  | 'weekly_off'
  | 'leave'
  | 'missing_punch'
  | 'early_out'
  | 'lop'

interface CalDailyRecord {
  date:   string
  status: CalDailyStatus
}

interface CalAttResponse {
  daily: CalDailyRecord[]
}

interface CalHoliday {
  id:          string
  date:        string
  name:        string
  is_optional: boolean
}

interface CalShiftAssignment {
  is_current: boolean
  shifts:     { name: string; weekly_off_days: number[] }
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

const STD_SHIFT_HOURS = 8

function today(): string {
  return new Date().toISOString().slice(0, 10)
}


// ── Policy resolution builder ─────────────────────────────────────────────────

/** Synthesise a PolicyResolutionInfo from the collision preview's policy block */
function buildLeaveCollisionPolicy(
  policy: CollisionResult['policy'],
): PolicyResolutionInfo {
  return {
    policy_id:   null,
    policy_name: 'Leave Calculation Policy',
    source:      'default',
    rules: [
      {
        leave_type_name:     'Sandwich Mode',
        eligible:            policy.sandwich_mode === 'include',
        eligibility_reason:  policy.sandwich_mode === 'include'
          ? 'Intervening weekends/holidays between leave days are auto-included in the leave count (charged to balance).'
          : 'Intervening weekends/holidays between leave days are excluded — they are not charged to your leave balance.',
      },
      {
        leave_type_name:     'Holiday Collision',
        eligible:            policy.collision_on_holiday === 'include',
        eligibility_reason:  policy.collision_on_holiday === 'include'
          ? 'Public holidays that fall within the leave period are charged to your leave balance.'
          : 'Public holidays inside the leave period are converted — they are not deducted from your balance.',
      },
      {
        leave_type_name:     'Weekly-Off Collision',
        eligible:            policy.collision_on_weekly_off === 'include',
        eligibility_reason:  policy.collision_on_weekly_off === 'include'
          ? 'Weekly-off days within the leave period are charged to your leave balance.'
          : 'Weekly-off days inside the leave period are not charged.',
      },
    ],
  }
}

// ── Session option definitions ─────────────────────────────────────────────────

interface SessionOption {
  value:       LeaveSession
  label:       string
  description: string
  days:        string
}

/**
 * Compute effective session permissions — policy governs when available,
 * otherwise fall back to leave_type-level flags.
 */
function effectivePermissions(
  lt:     LeaveType | null,
  policy: LeaveSessionPolicy | null,
): { allowHalfDay: boolean; allowHourly: boolean; allowCrossSession: boolean } {
  if (policy) {
    return {
      allowHalfDay:      policy.allow_half_day,
      allowHourly:       policy.allow_hourly_leave,
      allowCrossSession: policy.allow_cross_session,
    }
  }
  // Fallback: leave_type-level flags (no cross-session info at type level — allow by default)
  return {
    allowHalfDay:      lt?.allow_half_day  ?? false,
    allowHourly:       lt?.allow_hourly    ?? false,
    allowCrossSession: true,
  }
}

function getSessionOptions(
  lt:     LeaveType | null,
  policy: LeaveSessionPolicy | null,
): SessionOption[] {
  const { allowHalfDay, allowHourly } = effectivePermissions(lt, policy)
  const opts: SessionOption[] = [
    { value: 'full_day', label: 'Full Day', description: 'Entire working day(s)', days: 'per day' },
  ]
  if (allowHalfDay) {
    opts.push(
      { value: 'first_half',  label: 'First Half (AM)',  description: 'Morning session only',   days: '0.5 days' },
      { value: 'second_half', label: 'Second Half (PM)', description: 'Afternoon session only', days: '0.5 days' },
    )
  }
  if (allowHourly) {
    opts.push(
      { value: 'hourly', label: 'Hourly', description: 'Short / permission leave', days: 'per hour' },
    )
  }
  return opts
}

// Start session options for multi-day: full day or leave starts mid-day
const START_SESSION_OPTIONS: { value: LeaveSession; label: string; description: string }[] = [
  { value: 'full_day',    label: 'Full Day Start',    description: 'Leave starts full first day' },
  { value: 'second_half', label: 'Second Half Start', description: 'Works AM, leave starts PM on first day' },
]

// End session options for multi-day: full day or leave ends mid-day
const END_SESSION_OPTIONS: { value: LeaveSession; label: string; description: string }[] = [
  { value: 'full_day',   label: 'Full Day End',   description: 'Leave ends full last day' },
  { value: 'first_half', label: 'First Half End', description: 'Leave ends at noon, works PM on last day' },
]

// Session display pill colours
function sessionPillClass(type: DurationPerDay['type']): string {
  switch (type) {
    case 'working':  return 'bg-success/15 text-success border-success/30'
    case 'holiday':  return 'bg-muted/40 text-muted-foreground border-border/40'
    case 'weekend':  return 'bg-muted/40 text-muted-foreground border-border/40'
    case 'sandwich': return 'bg-warning/15 text-warning border-warning/30'
    case 'overlap':  return 'bg-info/15 text-info border-info/30'
    default:         return 'bg-muted/40 text-muted-foreground'
  }
}

// ── New calendar helper functions ──────────────────────────────────────────────

function monthStart(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function monthEnd(y: number, m: number) {
  const days = new Date(y, m + 1, 0).getDate()
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(days).padStart(2, '0')}`
}

function buildCalendarDays(y: number, m: number): (number | null)[] {
  const dow      = new Date(y, m, 1).getDay()
  const firstDow = dow // Sunday first
  const total    = new Date(y, m + 1, 0).getDate()
  const days: (number | null)[] = Array(firstDow).fill(null)
  for (let d = 1; d <= total; d++) days.push(d)
  while (days.length % 7 !== 0) days.push(null)
  return days
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── Leave type card color palette (cycles by index) ────────────────────────────
const LT_CARD_COLORS = [
  { topBar: 'bg-info',    iconBg: 'bg-info dark:bg-blue-950/40',       iconText: 'text-info dark:text-blue-400'       },
  { topBar: 'bg-success', iconBg: 'bg-success dark:bg-emerald-950/40', iconText: 'text-success dark:text-emerald-400' },
  { topBar: 'bg-accent-violet',  iconBg: 'bg-accent-violet dark:bg-violet-950/40',   iconText: 'text-accent-violet dark:text-violet-400'   },
  { topBar: 'bg-destructive',    iconBg: 'bg-destructive dark:bg-rose-950/40',       iconText: 'text-destructive dark:text-rose-400'       },
  { topBar: 'bg-warning',   iconBg: 'bg-warning dark:bg-amber-950/40',     iconText: 'text-warning dark:text-amber-400'     },
  { topBar: 'bg-accent-teal',    iconBg: 'bg-accent-teal dark:bg-cyan-950/40',       iconText: 'text-accent-teal dark:text-cyan-400'       },
] as const

// ── Reason chips constant ──────────────────────────────────────────────────────

const REASON_CHIPS = [
  { emoji: '✈️', label: 'Planned Vacation', value: 'Planning a vacation trip' },
  { emoji: '🏥', label: 'Medical Checkup',  value: 'Medical checkup / doctor visit' },
  { emoji: '🏠', label: 'Apartment Move',   value: 'Moving to a new place' },
  { emoji: '😷', label: 'Feeling Unwell',   value: 'Not feeling well / sick' },
  { emoji: '🚨', label: 'Urgent Personal',  value: 'Urgent personal matter' },
]

// ── LeaveCalendar sub-component ────────────────────────────────────────────────

interface LeaveCalendarProps {
  year:          number
  month:         number   // 0-indexed
  attendance:    CalDailyRecord[]
  holidays:      CalHoliday[]
  weeklyOffDays: number[] // 0=Sun..6=Sat
  fromDate:      string
  toDate:        string
  hoverDate:     string | null
  minDate:       string | undefined
  maxDate:       string | undefined
  todayStr:      string
  existingLeaves: { from_date: string; to_date: string; status: string }[]
  onDateClick:   (date: string) => void
  onDateHover:   (date: string | null) => void
  onPrevMonth:   () => void
  onNextMonth:   () => void
  onTodayJump:   () => void
}

function LeaveCalendar({
  year, month, attendance, holidays, weeklyOffDays,
  fromDate, toDate, hoverDate, minDate, maxDate, todayStr,
  existingLeaves, onDateClick, onDateHover,
  onPrevMonth, onNextMonth, onTodayJump,
}: LeaveCalendarProps) {
  const calDays    = buildCalendarDays(year, month)
  const attMap     = new Map(attendance.map(r => [r.date, r]))
  const holidaySet = new Set(holidays.filter(h => !h.is_optional).map(h => h.date))
  const monthLabel = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

  // Build existing-leave date set from existing leave applications
  const existingLeaveSet = new Set<string>()
  for (const lv of existingLeaves) {
    if (lv.status === 'approved' || lv.status === 'pending') {
      const cur = new Date(`${lv.from_date}T12:00:00Z`)
      const end = new Date(`${lv.to_date}T12:00:00Z`)
      while (cur <= end) {
        existingLeaveSet.add(cur.toISOString().slice(0, 10))
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
    }
  }

  // Determine annotation for a cell
  function getCellInfo(dateStr: string): { annotation: string; annotationCls: string; bgCls: string } {
    const rec      = attMap.get(dateStr)
    const isHol    = holidaySet.has(dateStr)
    const dow      = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
    const isWO     = weeklyOffDays.includes(dow) || dow === 0 || dow === 6
    const isExLeave = existingLeaveSet.has(dateStr)

    if (rec) {
      switch (rec.status) {
        case 'present':       return { annotation: 'P',  annotationCls: 'text-success',                              bgCls: 'bg-success/8'                              }
        case 'late':          return { annotation: 'P',  annotationCls: 'text-warning',                              bgCls: 'bg-warning/8'                              }
        case 'early_out':     return { annotation: 'P',  annotationCls: 'text-warning',                              bgCls: 'bg-warning/5'                              }
        case 'holiday':       return { annotation: 'H',  annotationCls: 'text-accent-violet dark:text-violet-400',      bgCls: 'bg-accent-violet dark:bg-violet-950/30'        }
        case 'weekend':
        case 'weekly_off':    return { annotation: 'O',  annotationCls: 'text-muted-foreground/50',                  bgCls: ''                                          }
        case 'leave':         return { annotation: 'OL', annotationCls: 'text-info',                                 bgCls: 'bg-info/8'                                 }
        case 'half_day':      return { annotation: 'HD', annotationCls: 'text-muted-foreground',                     bgCls: 'bg-muted/40'                               }
        case 'absent':        return { annotation: 'A',  annotationCls: 'text-destructive',                          bgCls: 'bg-destructive/8'                          }
        case 'lop':           return { annotation: 'A',  annotationCls: 'text-destructive',                          bgCls: 'bg-destructive/10'                         }
        case 'missing_punch': return { annotation: 'MP', annotationCls: 'text-warning',                              bgCls: 'bg-warning/8'                              }
      }
    }
    if (isHol)     return { annotation: 'H',  annotationCls: 'text-accent-violet dark:text-violet-400', bgCls: 'bg-accent-violet/60 dark:bg-violet-950/20' }
    if (isExLeave) return { annotation: 'OL', annotationCls: 'text-info',                            bgCls: 'bg-info/6'                             }
    if (isWO)      return { annotation: 'O',  annotationCls: 'text-muted-foreground/40',             bgCls: ''                                      }
    return { annotation: '', annotationCls: '', bgCls: '' }
  }

  return (
    <div className="space-y-2">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevMonth}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onTodayJump}
            className="text-[10px] font-bold text-primary hover:text-primary/80 px-1.5 py-0.5 rounded hover:bg-primary/5 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0.5">
        {['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map(d => (
          <div key={d} className="text-center text-[9px] font-bold text-muted-foreground/50 py-1 uppercase tracking-widest">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {calDays.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} />
          const dateStr    = isoDate(year, month, day)
          const isToday    = dateStr === todayStr
          const isFrom     = dateStr === fromDate
          const isTo       = dateStr === toDate
          const isEndpoint = isFrom || isTo

          // Range highlight: between fromDate and toDate (or fromDate and hoverDate if no toDate)
          const effectiveEnd = toDate || hoverDate || ''
          const rangeStart   = fromDate && effectiveEnd ? (fromDate <= effectiveEnd ? fromDate : effectiveEnd) : ''
          const rangeEnd     = fromDate && effectiveEnd ? (fromDate <= effectiveEnd ? effectiveEnd : fromDate) : ''
          const inRange      = rangeStart && rangeEnd && dateStr > rangeStart && dateStr < rangeEnd

          const isDisabled = !!(minDate && dateStr < minDate) || !!(maxDate && dateStr > maxDate)
          const { annotation, annotationCls, bgCls } = getCellInfo(dateStr)

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onDateClick(dateStr)}
              onMouseEnter={() => !isDisabled && onDateHover(dateStr)}
              onMouseLeave={() => onDateHover(null)}
              className={cn(
                'relative flex flex-col items-center justify-center rounded-lg py-1.5 transition-all min-h-[44px] text-center',
                isDisabled && 'opacity-25 cursor-not-allowed',
                !isDisabled && 'cursor-pointer',
                // Endpoint: solid fill
                isEndpoint && 'bg-primary text-primary-foreground',
                // In-range: subtle tint
                inRange && !isEndpoint && 'bg-primary/12 text-foreground rounded-none',
                // Normal (with status background if no selection override)
                !isEndpoint && !inRange && bgCls,
                // Hover
                !isDisabled && !isEndpoint && 'hover:bg-primary/15 hover:text-foreground',
                // Range edge rounding
                isFrom && toDate && 'rounded-r-none',
                isTo && fromDate && fromDate !== toDate && 'rounded-l-none',
              )}
            >
              {/* Today ring */}
              <span className={cn(
                'text-xs font-semibold leading-none',
                isEndpoint ? 'text-primary-foreground' : 'text-foreground',
                isToday && !isEndpoint && 'relative after:absolute after:inset-[-2px] after:rounded-full after:ring-2 after:ring-primary/70',
              )}>
                {day}
              </span>
              {/* Annotation */}
              {annotation && (
                <span className={cn(
                  'text-[8px] font-bold leading-none mt-0.5',
                  isEndpoint ? 'text-primary-foreground/70' : annotationCls,
                )}>
                  {annotation}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-border/40">
        {[
          { label: 'Present',  dot: 'bg-success/40' },
          { label: 'On Leave', dot: 'bg-info/40' },
          { label: 'Holiday',  dot: 'bg-accent-violet/60' },
          { label: 'Absent',   dot: 'bg-destructive/40' },
          { label: 'Week Off', dot: 'bg-muted/60' },
        ].map(({ label, dot }) => (
          <span key={label} className="flex items-center gap-1 text-[9px] text-muted-foreground/60 font-medium">
            <span className={cn('w-2 h-2 rounded-sm', dot)} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface LeaveApplyProps {
  /** 'page' = standalone route with PageContainer+PageHeader (default).
   *  'sheet' = embedded inside a slide-over; no outer wrapper, no title bar. */
  mode?:      'page' | 'sheet'
  /** Called after a successful submission when mode='sheet'. */
  onSuccess?: () => void
  /** Called when the user wants to dismiss the sheet (Cancel / close). */
  onClose?:   () => void
}

export function LeaveApply({ mode = 'page', onSuccess, onClose }: LeaveApplyProps = {}) {
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null

  // ── Form state ───────────────────────────────────────────────────────────────
  const [leaveTypeId,     setLeaveTypeId]     = useState('')
  const [fromDate,        setFromDate]        = useState('')
  const [toDate,          setToDate]          = useState('')
  const [startSession,    setStartSession]    = useState<LeaveSession>('full_day')
  const [endSession,      setEndSession]      = useState<LeaveSession>('full_day')
  const [hoursRequested,  setHoursRequested]  = useState<number>(1)
  const [reason,          setReason]          = useState('')
  const [fieldErrors,     setFieldErrors]     = useState<Record<string, string>>({})

  // ── Calendar navigation state ─────────────────────────────────────────────────
  const [calYear,  setCalYear]  = useState(() => new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth()) // 0-indexed
  const [calHover, setCalHover] = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: ltData, isLoading: ltLoading } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave-types-active'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 120_000,
  })
  const leaveTypes = (ltData?.data ?? []).filter(lt => lt.is_active)

  const { data: balanceData } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['my-leave-balance', employeeId],
    queryFn:  () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  // ── Policy-level session governance ─────────────────────────────────────────
  const { data: sessionPolicyData } = useQuery<{ data: LeaveSessionPolicy | null }>({
    queryKey: ['leave-session-policy', leaveTypeId],
    queryFn:  () => api.get(`/masters/leave-policies/by-type/${leaveTypeId}`),
    enabled:  !!leaveTypeId,
    staleTime: 120_000,
    retry:    false,
  })
  const sessionPolicy = sessionPolicyData?.data ?? null

  // ── Policy-driven date range ─────────────────────────────────────────────────
  const minDate = useMemo((): string => {
    if (!sessionPolicy || !sessionPolicy.allow_past_dated_leave) return today()
    if (sessionPolicy.maximum_past_days <= 0) return today()
    const d = new Date()
    d.setDate(d.getDate() - sessionPolicy.maximum_past_days)
    return d.toISOString().slice(0, 10)
  }, [sessionPolicy])

  const maxDate = useMemo((): string | undefined => {
    if (!sessionPolicy) return undefined
    if (!sessionPolicy.allow_future_leave) return today()
    if (sessionPolicy.maximum_future_days != null) {
      const d = new Date()
      d.setDate(d.getDate() + sessionPolicy.maximum_future_days)
      return d.toISOString().slice(0, 10)
    }
    return undefined
  }, [sessionPolicy])

  const balanceMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of balanceData?.data ?? []) m.set(row.leave_type_id, row.balance)
    return m
  }, [balanceData])

  // ── Derived — single-day lock ─────────────────────────────────────────────────
  const isSingleDayOnly = startSession === 'hourly'
  const isMultiDay      = !isSingleDayOnly && !!fromDate && !!toDate && fromDate !== toDate
  const effectiveToDate = isSingleDayOnly ? fromDate : (toDate || fromDate)

  // ── Queries — Collision preview (full_day only) ───────────────────────────────
  const collisionEnabled = startSession === 'full_day' && !!employeeId && !!leaveTypeId && !!fromDate && !!toDate && fromDate <= toDate
  const { data: collisionData, isFetching: collisionFetching } = useQuery<{ data: CollisionResult }>({
    queryKey: ['leave-collision-preview', employeeId, leaveTypeId, fromDate, toDate],
    queryFn:  () => api.get(`/leave/collision/preview?employee_id=${employeeId}&leave_type_id=${leaveTypeId}&from_date=${fromDate}&to_date=${toDate}`),
    enabled:  collisionEnabled,
    staleTime: 30_000,
  })
  const collision = collisionData?.data ?? null

  // ── Queries — Backend duration preview (non-hourly) ─────────────────────────
  const durationEnabled =
    !!employeeId &&
    !!leaveTypeId &&
    !!fromDate &&
    !!toDate &&
    fromDate <= toDate &&
    startSession !== 'hourly'

  const { data: durationData, isFetching: durationFetching } = useQuery<{ data: DurationResult }>({
    queryKey: ['leave-duration-preview', employeeId, leaveTypeId, fromDate, effectiveToDate, startSession, endSession],
    queryFn:  () => api.post('/leave/duration/preview', {
      employee_id:   employeeId,
      leave_type_id: leaveTypeId,
      start_date:    fromDate,
      start_session: startSession,
      end_date:      effectiveToDate || fromDate,
      end_session:   endSession,
    }),
    enabled:   durationEnabled,
    staleTime: 30_000,
  })
  const durationResult = durationData?.data ?? null

  // For hourly: keep frontend calculation
  const hourlyDays = startSession === 'hourly' && hoursRequested > 0
    ? parseFloat((hoursRequested / STD_SHIFT_HOURS).toFixed(4))
    : 0

  // Combined computed days — backend engine for non-hourly, frontend for hourly
  const computedDays = startSession === 'hourly'
    ? hourlyDays
    : (durationResult?.calculated_days ?? 0)

  // ── More derived ──────────────────────────────────────────────────────────────

  const selectedLt       = leaveTypes.find(lt => lt.id === leaveTypeId) ?? null
  const perms            = effectivePermissions(selectedLt, sessionPolicy)
  const sessionOptions   = getSessionOptions(selectedLt, sessionPolicy)
  const availableBalance = selectedLt ? (balanceMap.get(selectedLt.id) ?? null) : null
  const insufficientBal  = selectedLt?.is_paid && availableBalance !== null && computedDays > availableBalance

  // Period lock — check the month of fromDate
  const lockMonth = fromDate ? fromDate.slice(0, 7) : new Date().toISOString().slice(0, 7)
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(lockMonth)

  // Date breakdown fallback (only used when durationResult is unavailable)
  const rangeDates = useMemo(() => {
    if (!fromDate || !effectiveToDate || startSession !== 'full_day') return []
    const dates: string[] = []
    const cur = new Date(`${fromDate}T12:00:00.000Z`)
    const end = new Date(`${effectiveToDate}T12:00:00.000Z`)
    while (cur <= end && dates.length < 31) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return dates
  }, [fromDate, effectiveToDate, startSession])

  const weekendCount = rangeDates.filter(d => {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
    return dow === 0 || dow === 6
  }).length
  const weekdayCount = rangeDates.length - weekendCount

  // ── todayStr memo ─────────────────────────────────────────────────────────────
  const todayStr = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // ── New calendar queries ──────────────────────────────────────────────────────
  const calFrom = monthStart(calYear, calMonth)
  const calTo   = monthEnd(calYear, calMonth)

  const { data: calAttData } = useQuery<CalAttResponse>({
    queryKey:  ['leave-apply-attendance', employeeId, calFrom, calTo],
    queryFn:   () => api.get(`/attendance/${employeeId}?from=${calFrom}&to=${calTo}`),
    enabled:   !!employeeId,
    staleTime: 120_000,
  })

  const { data: calHolidaysData } = useQuery<{ data: CalHoliday[] }>({
    queryKey:  ['leave-apply-holidays', calYear],
    queryFn:   () => api.get(`/masters/holidays?year=${calYear}`),
    staleTime: 300_000,
  })

  const { data: shiftHistResp } = useQuery<{ data: CalShiftAssignment[] }>({
    queryKey:  ['leave-apply-shift', employeeId],
    queryFn:   () => api.get(`/masters/employee-shifts/${employeeId}/history`),
    enabled:   !!employeeId,
    staleTime: 300_000,
    retry:     false,
  })

  // Existing leaves for calendar OL annotation
  const { data: myLeavesData } = useQuery<{ data: { from_date: string; to_date: string; status: string }[] }>({
    queryKey: ['leave-apply-my-leaves', employeeId],
    queryFn:  () => api.get('/attendance/leave/my'),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })
  const allLeaves = myLeavesData?.data ?? []

  // ── New derived for calendar ──────────────────────────────────────────────────
  const calAttendance = calAttData?.daily ?? []
  const calHolidays   = calHolidaysData?.data ?? []
  const currentShift  = useMemo(() => {
    const list = shiftHistResp?.data ?? []
    const cur  = list.find(a => a.is_current)
    return cur?.shifts ?? list[0]?.shifts ?? null
  }, [shiftHistResp])
  const weeklyOffDays = currentShift?.weekly_off_days ?? []

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleLeaveTypeChange(id: string) {
    setLeaveTypeId(id)
    setStartSession('full_day')
    setEndSession('full_day')
    setFieldErrors({})
  }

  function handleStartSessionChange(s: LeaveSession) {
    setStartSession(s)
    if (s === 'hourly') {
      setEndSession('full_day')
      if (fromDate) setToDate(fromDate)
    }
  }

  function handleEndSessionChange(s: LeaveSession) {
    setEndSession(s)
  }

  function handleSingleSessionChange(s: LeaveSession) {
    setStartSession(s)
    setEndSession(s === 'hourly' ? 'full_day' : s)
    if (s === 'hourly' && fromDate) {
      setToDate(fromDate)
    }
  }

  function handleFromDateChange(d: string) {
    setFromDate(d)
    setFieldErrors(p => ({ ...p, fromDate: '' }))
    if (d) {
      const dt = new Date(`${d}T12:00:00Z`)
      setCalYear(dt.getUTCFullYear())
      setCalMonth(dt.getUTCMonth())
    }
    if (isSingleDayOnly) {
      setToDate(d)
      return
    }
    if (toDate && d > toDate) setToDate(d)
  }

  // ── Calendar date handlers ────────────────────────────────────────────────────

  function handleCalendarDateClick(dateStr: string) {
    if (!fromDate || (fromDate && toDate)) {
      setFromDate(dateStr)
      setToDate('')
      setFieldErrors(p => ({ ...p, fromDate: '', toDate: '' }))
      if (isSingleDayOnly) setToDate(dateStr)
    } else if (fromDate && !toDate) {
      if (dateStr === fromDate) {
        setFromDate('')
        return
      }
      if (dateStr < fromDate) {
        setFromDate(dateStr)
        setToDate('')
      } else {
        setToDate(dateStr)
      }
    }
  }

  function handleCalPrevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }

  function handleCalNextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  function handleCalTodayJump() {
    const n = new Date()
    setCalYear(n.getFullYear())
    setCalMonth(n.getMonth())
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!leaveTypeId)        errs.leaveTypeId = 'Select a leave type'
    if (!fromDate)           errs.fromDate    = 'Select start date'
    // To Date is optional — an empty To Date means a single-day leave (to = from).

    if (fromDate) {
      const todayRef = today()
      if (fromDate < todayRef) {
        if (!sessionPolicy) {
          errs.fromDate = 'Past-dated leave is not allowed (no policy configured)'
        } else if (!sessionPolicy.allow_past_dated_leave) {
          errs.fromDate = 'Past-dated leave is not allowed for this leave policy'
        } else {
          const pastDays = Math.round(
            (new Date(todayRef).getTime() - new Date(fromDate).getTime()) / 86_400_000,
          )
          if (pastDays > (sessionPolicy.maximum_past_days ?? 0)) {
            errs.fromDate = `Start date too far in the past — maximum ${sessionPolicy.maximum_past_days} day(s) back allowed`
          }
        }
      } else if (fromDate === todayRef) {
        if (sessionPolicy?.same_day_application_mode === 'restricted') {
          errs.fromDate = 'Same-day leave applications are not allowed for this leave policy'
        }
      } else {
        if (sessionPolicy && !sessionPolicy.allow_future_leave) {
          errs.fromDate = 'Future-dated leave is not allowed for this leave policy'
        } else if (sessionPolicy?.maximum_future_days != null) {
          const futureDays = Math.round(
            (new Date(fromDate).getTime() - new Date(todayRef).getTime()) / 86_400_000,
          )
          if (futureDays > sessionPolicy.maximum_future_days) {
            errs.fromDate = `Start date too far ahead — maximum ${sessionPolicy.maximum_future_days} day(s) in advance allowed`
          }
        }
      }
      if (sessionPolicy && !sessionPolicy.allow_current_period_leave && !errs.fromDate) {
        const currentYM = todayRef.slice(0, 7)
        if (fromDate.slice(0, 7) === currentYM) {
          errs.fromDate = 'Leave for the current calendar month is not allowed for this leave policy'
        }
      }
    }

    if (!isSingleDayOnly && fromDate && toDate && fromDate > toDate)
      errs.toDate = 'End date must be on or after start date'
    if (startSession === 'hourly' && hoursRequested <= 0) errs.hoursRequested = 'Enter hours requested (> 0)'
    if (startSession === 'hourly' && hoursRequested > 24) errs.hoursRequested = 'Cannot exceed 24 hours'
    if (startSession === 'hourly' && selectedLt?.max_hours_per_day && hoursRequested > selectedLt.max_hours_per_day)
                                                          errs.hoursRequested = `Max ${selectedLt.max_hours_per_day} hours allowed per day for this leave type`
    if (!reason.trim())                                   errs.reason         = 'Reason is required'

    const isHalfDay = startSession === 'first_half' || startSession === 'second_half' ||
                      endSession   === 'first_half' || endSession   === 'second_half'
    if (isHalfDay && !perms.allowHalfDay) {
      errs.leaveTypeId = 'Half-day leave is not allowed for this leave policy'
    }
    if (startSession === 'hourly' && !perms.allowHourly) {
      errs.leaveTypeId = 'Hourly leave is not allowed for this leave policy'
    }
    const isCrossSession = isMultiDay && startSession !== endSession &&
                           !(startSession === 'full_day' && endSession === 'full_day')
    if (isCrossSession && !perms.allowCrossSession) {
      errs.toDate = 'Cross-session multi-day leave is not allowed for this leave policy — use full day for both start and end, or select a single day'
    }

    setFieldErrors(errs)
    return errs
  }

  // ── Submit mutation ───────────────────────────────────────────────────────────

  const { mutate: submitLeave, isPending } = useMutation<{ data: LeaveRequest }, Error>({
    mutationFn: () =>
      api.post('/leave-requests', {
        leave_type_id:   leaveTypeId,
        from_date:       fromDate,
        to_date:         effectiveToDate || fromDate,
        start_session:   startSession,
        end_session:     endSession,
        session:         startSession, // backward compat
        hours_requested: startSession === 'hourly' ? hoursRequested : undefined,
        reason:          reason.trim(),
      }),
    onSuccess: (_res) => {
      const sessionLabel: Record<LeaveSession, string> = {
        full_day:    'full day',
        first_half:  'first half (AM)',
        second_half: 'second half (PM)',
        hourly:      `${hoursRequested}h`,
      }
      toast.success('Leave request submitted', {
        description: `${computedDays} day(s) (${sessionLabel[startSession]}) from ${fromDate}${effectiveToDate && effectiveToDate !== fromDate ? ` to ${effectiveToDate}` : ''} — pending approval.`,
      })
      qc.invalidateQueries({ queryKey: ['my-leave-requests'] })
      qc.invalidateQueries({ queryKey: ['ess-leave-history'] })
      qc.invalidateQueries({ queryKey: ['ess-leave-balance'] })
      if (onSuccess) { onSuccess() } else { navigate('/ess/leave') }
    },
    onError: (err) => {
      toast.error('Submission failed', { description: err.message })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      // Surface a top-level reason so the user is never left guessing why the
      // form won't submit — the inline field errors are small and easy to miss.
      toast.error('Cannot submit leave request', { description: Object.values(errs)[0] })
      return
    }
    submitLeave()
  }

  // ── No employee record guard ──────────────────────────────────────────────────

  if (!employeeId) {
    const inner = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-warning" />
        <p className="text-sm font-medium">Profile not linked</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Your account is not linked to an employee record. Contact HR to complete setup.
        </p>
      </div>
    )
    if (mode === 'sheet') return inner
    return (
      <PageContainer><PageHeader title="Apply for Leave" /><SectionCard>{inner}</SectionCard></PageContainer>
    )
  }

  /** Per-day breakdown from backend engine — rendered inside preview sidebar */
  function renderEngineBreakdown() {
    if (!durationResult?.breakdown?.per_day?.length) return null
    return (
      <div>
        <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
          Date Breakdown
          {durationFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        </p>
        <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
          {durationResult.breakdown.per_day.map(d => (
            <div key={d.date} className={cn(
              'flex items-center justify-between text-xs px-2 py-1 rounded',
              d.type === 'holiday'  ? 'bg-muted/30' :
              d.type === 'weekend'  ? 'bg-muted/20' :
              d.type === 'sandwich' ? 'bg-warning/10' :
              d.type === 'overlap'  ? 'bg-info/10' :
              'bg-transparent',
            )}>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums text-foreground">{d.date}</span>
                <span className="text-[10px] text-muted-foreground">{d.dow}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'text-[9px] px-1.5 py-0.5 rounded border capitalize',
                  sessionPillClass(d.type),
                )}>
                  {d.session}
                </span>
                <span className={cn(
                  'text-[10px] font-medium tabular-nums w-6 text-right',
                  d.charged === 0 ? 'text-muted-foreground' : 'text-primary',
                )}>
                  {d.charged}
                </span>
              </div>
            </div>
          ))}
        </div>
        {durationResult.warnings?.length > 0 && (
          <div className="mt-2 space-y-1">
            {durationResult.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-warning p-1.5 rounded bg-warning/10 border border-warning/20">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  /** Collision preview section (full_day only) */
  function renderCollisionPreview() {
    if (!collisionEnabled) {
      if (rangeDates.length > 0 && !durationResult) {
        const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        return (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Date Breakdown</p>
            {weekendCount > 0 && (
              <p className="text-[10px] text-muted-foreground mb-1">
                {weekdayCount} weekday{weekdayCount !== 1 ? 's' : ''} + {weekendCount} weekend{weekendCount !== 1 ? 's' : ''} — all days deducted
              </p>
            )}
            <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
              {rangeDates.map(d => {
                const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
                const isWeekend = dow === 0 || dow === 6
                return (
                  <div key={d} className={cn(
                    'flex items-center justify-between text-xs px-2 py-0.5 rounded',
                    isWeekend ? 'text-muted-foreground/50 bg-muted/20' : 'text-foreground',
                  )}>
                    <span className="font-mono tabular-nums">{d}</span>
                    <span className="text-[10px]">{DOW_SHORT[dow]}</span>
                  </div>
                )
              })}
            </div>
            {selectedLt?.allow_sandwich && (
              <p className="text-[10px] text-warning mt-1.5">
                Sandwich policy active — intervening weekends may also be charged.
              </p>
            )}
          </div>
        )
      }
      return null
    }

    const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return (
      <div>
        <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
          Collision Preview
          {collisionFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        </p>

        {!collision && !collisionFetching && (
          <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
            {rangeDates.map(d => {
              const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
              const isWeekend = dow === 0 || dow === 6
              return (
                <div key={d} className={cn(
                  'flex items-center justify-between text-xs px-2 py-0.5 rounded',
                  isWeekend ? 'text-muted-foreground/50 bg-muted/20' : 'text-foreground',
                )}>
                  <span className="font-mono tabular-nums">{d}</span>
                  <span className="text-[10px]">{DOW_SHORT[dow]}</span>
                </div>
              )
            })}
          </div>
        )}

        {collision && (
          <div className="space-y-2">
            {collision.is_blocked && (
              <div className="flex items-start gap-2 text-xs p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>{collision.block_reason}</span>
              </div>
            )}
            {collision.sandwiched_dates.length > 0 && (
              <div className={cn(
                'text-xs p-2 rounded-md',
                collision.policy.sandwich_mode === 'include'
                  ? 'bg-warning/10 border border-warning/20 text-warning'
                  : 'bg-muted/40 text-muted-foreground',
              )}>
                <p className="font-medium mb-1">
                  {collision.policy.sandwich_mode === 'include'
                    ? `Sandwich — ${collision.sandwiched_dates.length} day(s) auto-included`
                    : `${collision.sandwiched_dates.length} sandwiched day(s) excluded`}
                </p>
                <p className="text-[10px]">{collision.sandwiched_dates.join(', ')}</p>
              </div>
            )}
            {collision.converted_dates.length > 0 && (
              <div className="text-xs p-2 rounded-md bg-info/10 border border-info/20 text-info">
                <p className="font-medium mb-1">
                  {collision.converted_dates.length} day(s) converted (not charged to balance)
                </p>
                <p className="text-[10px]">{collision.converted_dates.join(', ')}</p>
              </div>
            )}
            <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
              {collision.per_day.map(d => (
                <div key={d.date} className={cn(
                  'flex items-center justify-between text-xs px-2 py-0.5 rounded',
                  d.is_holiday    ? 'bg-info/10'    :
                  d.is_weekly_off ? 'bg-muted/30'   :
                  d.is_sandwiched ? 'bg-warning/10' :
                  'bg-transparent',
                )}>
                  <span className="font-mono tabular-nums text-foreground">{d.date}</span>
                  <div className="flex items-center gap-1">
                    {d.is_holiday    && <span className="text-[9px] text-info px-1 bg-info/20 rounded">Holiday</span>}
                    {d.is_weekly_off && <span className="text-[9px] text-muted-foreground px-1 bg-muted/50 rounded">WO</span>}
                    {d.is_sandwiched && <span className="text-[9px] text-warning px-1 bg-warning/20 rounded">Sandwich</span>}
                    <span className={cn(
                      'text-[9px] px-1 rounded',
                      d.charged ? 'text-destructive bg-destructive/10' : 'text-muted-foreground bg-muted/40',
                    )}>
                      {d.charged ? 'Charged' : 'Free'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {!collision.is_blocked && (
              <div className="flex items-center justify-between text-xs p-2 rounded-md bg-primary/10 border border-primary/20">
                <span className="text-muted-foreground">Days charged to balance</span>
                <span className="font-bold text-primary">{collision.charged_days}</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── New form body (stepped design) ───────────────────────────────────────────

  function renderFormBody() {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── STEP 1: SELECT LEAVE TYPE ───────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              1. Select Leave Type
            </h3>
            <span className="text-[10px] text-destructive font-medium">* required</span>
          </div>

          {ltLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-pulse">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-muted rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {leaveTypes.map((lt, idx) => {
                const bal        = balanceMap.get(lt.id) ?? null
                const isSelected = leaveTypeId === lt.id
                const isLow      = bal !== null && bal <= 3 && bal > 0
                const isEmpty    = bal !== null && bal === 0
                const color      = LT_CARD_COLORS[idx % LT_CARD_COLORS.length]
                return (
                  <button
                    key={lt.id}
                    type="button"
                    onClick={() => handleLeaveTypeChange(lt.id)}
                    className={cn(
                      'flex flex-col rounded-xl border overflow-hidden text-left transition-all',
                      isSelected
                        ? 'border-primary shadow-md shadow-primary/10 ring-1 ring-primary/20'
                        : isEmpty
                        ? 'border-destructive/20 bg-destructive/5 hover:border-destructive/40'
                        : isLow
                        ? 'border-warning/25 bg-warning/5 hover:border-warning/40'
                        : 'border-border bg-card hover:shadow-sm hover:border-primary/20',
                    )}
                  >
                    {/* Colored top accent bar */}
                    <div className={cn('h-0.5 w-full flex-shrink-0', color.topBar)} />

                    <div className="px-2.5 py-2 flex items-center gap-2">
                      {/* Icon */}
                      <div className={cn(
                        'w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0',
                        color.iconBg,
                      )}>
                        <CalendarDays className={cn('h-3 w-3', color.iconText)} />
                      </div>
                      {/* Name + balance */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'text-[11px] font-semibold leading-tight truncate',
                          isSelected ? 'text-primary' : 'text-foreground',
                        )}>
                          {lt.name}
                        </p>
                        {bal !== null ? (
                          <p className={cn(
                            'text-[10px] font-bold font-display leading-none mt-0.5',
                            isEmpty ? 'text-destructive' : isLow ? 'text-warning' : 'text-muted-foreground',
                          )}>
                            {bal} <span className="font-normal text-[9px]">days</span>
                          </p>
                        ) : (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            {lt.is_paid ? 'No cap' : 'Unpaid'}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {fieldErrors.leaveTypeId && (
            <p className="text-xs text-destructive">{fieldErrors.leaveTypeId}</p>
          )}

          {/* Policy info box */}
          {selectedLt && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <Info className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {selectedLt.is_paid
                      ? availableBalance !== null
                        ? `Allotted limit: ${availableBalance} days. ${insufficientBal ? 'Insufficient balance — LOP may apply.' : `Remaining balance: ${availableBalance} days.`}`
                        : 'No balance cap — unlimited paid leave'
                      : 'Unpaid leave — no balance deducted'
                    }
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {perms.allowHalfDay && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-background border border-border rounded-full px-2 py-0.5 text-foreground">
                        Half-day allowed
                      </span>
                    )}
                    {perms.allowHourly && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-background border border-border rounded-full px-2 py-0.5 text-foreground">
                        Hourly allowed
                      </span>
                    )}
                    {selectedLt.allow_sandwich && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-warning/10 border border-warning/20 rounded-full px-2 py-0.5 text-warning">
                        Sandwich policy
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Application window */}
              {sessionPolicy && (
                <div className="border-t border-border/40 pt-2.5 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Application Window</p>
                  {sessionPolicy.allow_past_dated_leave && sessionPolicy.maximum_past_days > 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className="text-muted-foreground/40">←</span>
                      Up to {sessionPolicy.maximum_past_days} day{sessionPolicy.maximum_past_days !== 1 ? 's' : ''} in the past allowed (Retrospective application)
                    </p>
                  )}
                  {!sessionPolicy.allow_past_dated_leave && (
                    <p className="text-[10px] text-destructive/70 flex items-center gap-1.5">
                      <span>←</span> Past-dated leave not allowed
                    </p>
                  )}
                  {sessionPolicy.allow_future_leave ? (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className="text-muted-foreground/40">→</span>
                      {sessionPolicy.maximum_future_days != null
                        ? `Up to ${sessionPolicy.maximum_future_days} days ahead allowed`
                        : 'Unlimited future applications (Advanced booking)'}
                    </p>
                  ) : (
                    <p className="text-[10px] text-destructive/70 flex items-center gap-1.5">
                      <span>→</span> Future leave not allowed
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── STEP 2: CHOOSE DATES ────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            2. Choose Dates
          </h3>

          {/* Date text inputs */}
          <div className={cn('grid gap-3', isSingleDayOnly ? 'grid-cols-1' : 'grid-cols-2')}>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {isSingleDayOnly ? 'Date' : 'From Date'}
              </label>
              <DateInput
                value={fromDate}
                min={minDate}
                max={maxDate}
                onChange={handleFromDateChange}
                className="h-9 text-sm"
              />
              {fieldErrors.fromDate && (
                <p className="text-xs text-destructive">{fieldErrors.fromDate}</p>
              )}
            </div>
            {!isSingleDayOnly && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  To Date (Optional)
                </label>
                <DateInput
                  value={toDate}
                  min={fromDate || minDate}
                  max={maxDate}
                  onChange={v => { setToDate(v); setFieldErrors(p => ({ ...p, toDate: '' })) }}
                  className="h-9 text-sm"
                />
                {fieldErrors.toDate && (
                  <p className="text-xs text-destructive">{fieldErrors.toDate}</p>
                )}
              </div>
            )}
          </div>

          {/* Interactive calendar */}
          <div className="rounded-xl border border-border bg-card p-3.5">
            <p className="text-[9px] text-muted-foreground mb-2.5 font-medium">Click to pick leave range</p>
            <LeaveCalendar
              year={calYear}
              month={calMonth}
              attendance={calAttendance}
              holidays={calHolidays}
              weeklyOffDays={weeklyOffDays}
              fromDate={fromDate}
              toDate={toDate}
              hoverDate={calHover}
              minDate={minDate}
              maxDate={maxDate}
              todayStr={todayStr}
              existingLeaves={allLeaves}
              onDateClick={handleCalendarDateClick}
              onDateHover={setCalHover}
              onPrevMonth={handleCalPrevMonth}
              onNextMonth={handleCalNextMonth}
              onTodayJump={handleCalTodayJump}
            />
          </div>

          {/* Hourly hours input */}
          {startSession === 'hourly' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                Hours Requested <span className="text-destructive">*</span>
                {selectedLt?.max_hours_per_day && (
                  <span className="text-muted-foreground font-normal">(max {selectedLt.max_hours_per_day}h/day)</span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={hoursRequested}
                  min={0.25}
                  max={selectedLt?.max_hours_per_day ?? 24}
                  step={0.25}
                  onChange={e => setHoursRequested(parseFloat(e.target.value) || 0)}
                  className="h-9 w-28 text-sm"
                />
                <span className="text-sm text-muted-foreground">hours</span>
                {hoursRequested > 0 && (
                  <span className="text-xs text-muted-foreground">= {computedDays.toFixed(4)} days</span>
                )}
              </div>
              {fieldErrors.hoursRequested && (
                <p className="text-xs text-destructive">{fieldErrors.hoursRequested}</p>
              )}
            </div>
          )}
        </div>

        {/* ── STEP 3: SESSION COVERAGE ────────────────────────────────── */}
        {leaveTypeId && sessionOptions.length > 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                3. Session Coverage
              </h3>
              {isMultiDay ? (
                <span className="text-[10px] font-bold text-muted-foreground bg-muted/60 border border-border px-2 py-0.5 rounded">
                  Multi Day Selection
                </span>
              ) : (
                <span className="text-[10px] font-bold text-muted-foreground bg-muted/60 border border-border px-2 py-0.5 rounded">
                  Single Day Selection
                </span>
              )}
            </div>

            {/* Single-day / hourly: unified selector */}
            {(!isMultiDay || isSingleDayOnly) && (
              <div className="grid grid-cols-3 gap-2.5">
                {sessionOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSingleSessionChange(opt.value)}
                    className={cn(
                      'flex flex-col items-start p-3.5 rounded-xl border text-left transition-all',
                      startSession === opt.value
                        ? 'border-primary bg-primary/[0.06] shadow-sm shadow-primary/10'
                        : 'border-border bg-card hover:border-primary/30 hover:bg-primary/[0.02]',
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1.5">
                      <span className={cn('text-xs font-bold', startSession === opt.value ? 'text-primary' : 'text-foreground')}>
                        {opt.label}
                      </span>
                      <span className={cn('text-xs font-bold tabular-nums', startSession === opt.value ? 'text-primary' : 'text-muted-foreground')}>
                        {opt.days}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Multi-day: separate start/end session selectors */}
            {isMultiDay && !isSingleDayOnly && perms.allowHalfDay && perms.allowCrossSession && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Start Session</label>
                  <div className="flex gap-2">
                    {START_SESSION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleStartSessionChange(opt.value)}
                        className={cn(
                          'flex-1 flex flex-col items-start p-3 rounded-xl border text-left transition-all',
                          startSession === opt.value
                            ? 'border-primary bg-primary/[0.06]'
                            : 'border-border bg-card hover:border-primary/30',
                        )}
                      >
                        <span className={cn('text-xs font-bold', startSession === opt.value ? 'text-primary' : 'text-foreground')}>{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">End Session</label>
                  <div className="flex gap-2">
                    {END_SESSION_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleEndSessionChange(opt.value)}
                        className={cn(
                          'flex-1 flex flex-col items-start p-3 rounded-xl border text-left transition-all',
                          endSession === opt.value
                            ? 'border-primary bg-primary/[0.06]'
                            : 'border-border bg-card hover:border-primary/30',
                        )}
                      >
                        <span className={cn('text-xs font-bold', endSession === opt.value ? 'text-primary' : 'text-foreground')}>{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: REASON & BACKUPS ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              4. Reason &amp; Backups
            </h3>
            <span className="text-[10px] font-bold text-primary flex items-center gap-1 bg-primary/8 border border-primary/20 px-2 py-0.5 rounded-full">
              <Sparkles className="h-2.5 w-2.5" />
              AI Reason Assistant
            </span>
          </div>

          {/* Quick-pick chips */}
          <div className="flex flex-wrap gap-1.5">
            {REASON_CHIPS.map(chip => (
              <button
                key={chip.value}
                type="button"
                onClick={() => { setReason(chip.value); setFieldErrors(p => ({ ...p, reason: '' })) }}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all',
                  reason === chip.value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/[0.04]',
                )}
              >
                <span>{chip.emoji}</span>
                <span>{chip.label}</span>
              </button>
            ))}
          </div>

          {/* Textarea */}
          <div className="space-y-1.5">
            <textarea
              value={reason}
              onChange={e => { setReason(e.target.value); setFieldErrors(p => ({ ...p, reason: '' })) }}
              maxLength={500}
              rows={4}
              placeholder="Draft your reason here… Select a preset chip above to instantly draft a professional request."
              className="flex w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-none"
            />
            <div className="flex justify-between items-center">
              {fieldErrors.reason
                ? <p className="text-xs text-destructive">{fieldErrors.reason}</p>
                : <span />
              }
              <span className="text-[10px] text-muted-foreground">{reason.length}/500 chars</span>
            </div>
          </div>
        </div>

        {/* Insufficient balance warning */}
        {insufficientBal && (
          <div className="flex items-start gap-2 text-xs p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Insufficient balance — {availableBalance} day(s) available, {computedDays} requested.
              Your manager may still approve at discretion (LOP applies).
            </span>
          </div>
        )}
      </form>
    )
  }

  // ── New preview sidebar (dark-themed) ────────────────────────────────────────

  function renderPreviewSidebar() {
    const chargedDays      = collision ? collision.charged_days : computedDays
    const remainingAfter   = availableBalance !== null ? Math.max(0, availableBalance - chargedDays) : null
    const balanceBarPct    = availableBalance && availableBalance > 0
      ? Math.min(100, (remainingAfter! / availableBalance) * 100)
      : 0

    return (
      <div className="space-y-4">
        {/* DAYS REQUESTED — dark card */}
        <div className="rounded-2xl bg-card dark:bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Days Requested
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0.5 rounded">
              {selectedLt?.name?.toUpperCase() ?? 'SELECT TYPE'}
            </span>
          </div>
          <div className="flex items-end gap-2">
            {durationFetching ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-5xl font-bold font-display text-white/90 leading-none tabular-nums">
                {computedDays > 0 ? computedDays : 0}
              </span>
            )}
            <span className="text-sm text-muted-foreground mb-1.5">days</span>
          </div>
          {/* Working / Holiday / Weekend / Sandwich stats */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: 'Working',  value: durationResult?.breakdown.working  ?? 0, cls: 'text-success' },
              { label: 'Holiday',  value: durationResult?.breakdown.holiday  ?? 0, cls: 'text-accent-violet'  },
              { label: 'Weekend',  value: durationResult?.breakdown.weekend  ?? 0, cls: 'text-muted-foreground'   },
              { label: 'Sandwich', value: durationResult?.breakdown.sandwich ?? 0, cls: 'text-warning'   },
            ].map(({ label, value, cls }) => (
              <div key={label} className="bg-muted rounded-lg p-2 text-center">
                <p className={cn('text-sm font-bold tabular-nums', cls)}>{value}</p>
                <p className="text-[8px] text-muted-foreground font-medium mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          {/* Per-day breakdown table */}
          {durationResult?.breakdown?.per_day?.length ? (
            <div className="border-t border-border pt-3">
              {renderEngineBreakdown()}
            </div>
          ) : null}
        </div>

        {/* Collision preview */}
        {collisionEnabled && (
          <div className="space-y-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Collision Analysis
            </span>
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="p-3">
                {renderCollisionPreview()}
              </div>
            </div>
          </div>
        )}

        {/* POLICY PROJECTION */}
        {selectedLt?.is_paid && availableBalance !== null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Policy Projection
              </span>
              <span className="text-[9px] text-primary font-bold">Active Mapping</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all duration-500"
                style={{ width: `${balanceBarPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Remaining: <strong className="text-foreground">{availableBalance} days</strong></span>
              <span>Post-Approval: <strong className={cn(remainingAfter === 0 ? 'text-destructive' : 'text-foreground')}>{remainingAfter ?? '—'} days</strong></span>
            </div>
          </div>
        )}

        {/* EFFECTIVE HR RULES */}
        <div className="space-y-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Effective HR Rules
          </span>
          {collision?.policy ? (
            <div className="space-y-2">
              {[
                {
                  label:  'Sandwich Policy Exception',
                  desc:   'Intervening weekends/holidays inside the leave range will not be counted as charged.',
                  active: collision.policy.sandwich_mode === 'exclude',
                },
                {
                  label:  'Weekly-Off Collision',
                  desc:   "Holidays that land inside the selected leaves don't consume any balance checks.",
                  active: collision.policy.collision_on_weekly_off === 'exclude',
                },
                {
                  label:  'Holiday Collision',
                  desc:   'Public holidays within the leave period are handled per HR policy.',
                  active: collision.policy.collision_on_holiday === 'exclude',
                },
              ].map(rule => (
                <div key={rule.label} className="border border-border rounded-xl p-3 flex items-start gap-3">
                  <span className={cn(
                    'text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 mt-0.5 whitespace-nowrap',
                    rule.active
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-muted/60 text-muted-foreground border border-border',
                  )}>
                    {rule.active ? 'ACTIVE' : 'NOT ELIGIBLE'}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{rule.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{rule.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {[
                { label: 'Sandwich Policy Exception', desc: 'Intervening weekends/holidays inside the leave range will not be counted as charged.' },
                { label: 'Weekly-Off Collision',       desc: "Holidays that land inside the selected leaves don't consume any balance checks." },
              ].map(rule => (
                <div key={rule.label} className="border border-border/50 rounded-xl p-3 flex items-start gap-3 opacity-60">
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border shrink-0 mt-0.5 whitespace-nowrap">
                    NOT ELIGIBLE
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{rule.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{rule.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TEAM COVERAGE CHECK */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-muted-foreground/60" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Team Coverage Check
            </span>
          </div>
          <div className="border border-border/50 rounded-xl p-3">
            <p className="text-xs text-muted-foreground/60 italic">
              {fromDate
                ? 'Configure dates to evaluate dynamic team collisions.'
                : 'Select dates to check team coverage.'}
            </p>
          </div>
        </div>

        {/* Warnings */}
        {durationResult?.warnings && durationResult.warnings.length > 0 && (
          <div className="space-y-1.5">
            {durationResult.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] text-warning p-2.5 rounded-xl bg-warning/10 border border-warning/20">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Quick links */}
        {fromDate && (
          <div className="space-y-1.5 pt-1 border-t border-border/40">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Quick Links</p>
            <Link
              to={`/ess/attendance?month=${fromDate.slice(0, 7)}`}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              My attendance — {new Date(`${fromDate}-01`).toLocaleString('default', { month: 'long', year: 'numeric' })}
            </Link>
            <Link
              to="/ess/leave"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
            >
              <CalendarDays className="h-3 w-3" />
              My leave history
            </Link>
          </div>
        )}

        {/* Payroll Impact (kept for completeness) */}
        {selectedLt?.is_paid && computedDays > 0 && availableBalance !== null && (
          <div className="p-3 rounded-md border border-border/60 bg-card space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              Payroll Impact
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current balance</span>
                <span className="font-medium tabular-nums">{availableBalance} day(s)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Days charged</span>
                <span className={cn(
                  'font-medium tabular-nums flex items-center gap-1',
                  insufficientBal ? 'text-destructive' : 'text-warning',
                )}>
                  <TrendingDown className="h-3 w-3" />
                  {chargedDays}
                </span>
              </div>
              <div className="h-px bg-border/40" />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Balance after</span>
                <span className={cn(
                  'font-bold tabular-nums',
                  (availableBalance - chargedDays) < 0 ? 'text-destructive' : 'text-success',
                )}>
                  {Math.max(0, availableBalance - chargedDays)} day(s)
                </span>
              </div>
            </div>
            {insufficientBal && (
              <div className="flex items-start gap-1.5 text-[10px] text-destructive pt-1 border-t border-destructive/20">
                <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                <span>
                  {Math.abs(availableBalance - computedDays).toFixed(1)} day(s) will be Loss of Pay (LOP) — manager may still approve at discretion.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Policy Explainer */}
        {collision?.policy && (
          <div className="pt-1">
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
              Applied Policy Rules
            </p>
            <PolicyExplainPanel
              resolution={buildLeaveCollisionPolicy(collision.policy)}
              compact
            />
          </div>
        )}

        {/* Submit status */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2.5 rounded-xl bg-muted/30 border border-border/40">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-success" />
          Request will submit as{' '}
          <span className="font-bold text-warning ml-0.5">PENDING</span>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (mode === 'sheet') {
    return (
      <div className="flex h-full overflow-hidden">
        {/* Left: scrollable form */}
        <div className="flex-1 overflow-y-auto">
          {fromDate && periodLocked && (
            <div className="px-5 pt-4">
              <PeriodLockBanner state={periodState} month={lockMonth} />
            </div>
          )}
          <div className="p-5 space-y-6">
            {ltLoading ? (
              <div className="space-y-5 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 w-20 bg-muted rounded" />
                    <div className="h-9 bg-muted rounded-md" />
                  </div>
                ))}
              </div>
            ) : (
              renderFormBody()
            )}

            {/* Action buttons */}
            <div className="flex gap-2.5 pb-2">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || (!!fromDate && periodLocked)}
                className="flex-1 bg-gradient-to-r from-primary to-accent-violet text-primary-foreground font-semibold gap-2"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Submit Leave Request
              </Button>
              {onClose && (
                <Button type="button" variant="outline" onClick={onClose} className="gap-1.5">
                  Cancel Application
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right: sticky preview panel */}
        <div className="w-[300px] flex-shrink-0 border-l border-border flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">
              Request Preview
            </span>
            <span className="text-[8px] font-bold tracking-widest text-primary uppercase bg-primary/10 border border-primary/20 px-2 py-1 rounded">
              Real-Time Collision Engine
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {renderPreviewSidebar()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a new leave request with dynamic policy mapping"
      />
      {fromDate && periodLocked && (
        <PeriodLockBanner state={periodState} month={lockMonth} />
      )}
      <div className="flex gap-0 rounded-2xl border border-border overflow-hidden bg-card ring-1 ring-black/5">
        {/* Left: form */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {ltLoading ? (
            <div className="space-y-5 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-20 bg-muted rounded" />
                  <div className="h-9 bg-muted rounded-md" />
                </div>
              ))}
            </div>
          ) : renderFormBody()}
          <div className="flex gap-2.5">
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || (!!fromDate && periodLocked)}
              className="bg-gradient-to-r from-primary to-accent-violet text-primary-foreground font-semibold gap-2"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Submit Leave Request
            </Button>
          </div>
        </div>
        {/* Right: preview */}
        <div className="w-[320px] flex-shrink-0 border-l border-border flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">Request Preview</span>
            <span className="text-[8px] font-bold tracking-widest text-primary uppercase bg-primary/10 border border-primary/20 px-2 py-1 rounded">
              Real-Time Collision Engine
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {renderPreviewSidebar()}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
