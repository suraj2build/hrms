/**
 * LeaveApply — /leave/apply
 *
 * Employee self-service leave application form.
 *
 * Phase 3 — Half-Day + Hourly Leave Engine:
 *  · Session selector: Full Day / First Half / Second Half / Hourly
 *  · Session options are gated by leave type flags (allow_half_day, allow_hourly)
 *  · Hourly session shows hours input (0.25 h increments, max 24 h)
 *  · Half/hourly sessions lock fromDate = toDate (single day)
 *  · Live computed_days preview mirrors backend computeLeaveSession
 *  · Submits to POST /leave-requests with session + hours_requested
 *
 * Design: design-system tokens only.
 */

import { useState, useMemo }                             from 'react'
import { useNavigate, Link }                             from 'react-router-dom'
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query'
import {
  CalendarDays, Loader2, AlertTriangle, Info, CheckCircle2, Clock,
  TrendingDown, ExternalLink, Wallet,
} from 'lucide-react'
import { toast }                                         from 'sonner'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }        from '@/components/layout/PageHeader'
import { SectionCard }       from '@/components/layout/SectionCard'
import { PeriodLockBanner }  from '@/components/layout/PeriodLockBanner'
import { Button }            from '@/components/ui/button'
import { Input }             from '@/components/ui/input'
import { Badge }             from '@/components/ui/badge'
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

// ── Pure helpers ───────────────────────────────────────────────────────────────

const STD_SHIFT_HOURS = 8

/** Mirrors backend computeLeaveSession */
function computeDaysFromSession(
  from:           string,
  to:             string,
  session:        LeaveSession,
  hoursRequested: number,
): number {
  if (!from || !to) return 0
  if (session === 'first_half' || session === 'second_half') return 0.5
  if (session === 'hourly') {
    return hoursRequested > 0
      ? parseFloat((hoursRequested / STD_SHIFT_HOURS).toFixed(4))
      : 0
  }
  // full_day
  if (from > to) return 0
  let count = 0
  const cur = new Date(`${from}T12:00:00.000Z`)
  const end = new Date(`${to}T12:00:00.000Z`)
  while (cur <= end) { count++; cur.setUTCDate(cur.getUTCDate() + 1) }
  return count
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
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

function getSessionOptions(lt: LeaveType | null): SessionOption[] {
  const opts: SessionOption[] = [
    { value: 'full_day',    label: 'Full Day',    description: 'Entire working day(s)',        days: 'per day' },
  ]
  if (lt?.allow_half_day) {
    opts.push(
      { value: 'first_half',  label: 'First Half (AM)',  description: 'Morning session only',     days: '0.5 days' },
      { value: 'second_half', label: 'Second Half (PM)', description: 'Afternoon session only',   days: '0.5 days' },
    )
  }
  if (lt?.allow_hourly) {
    opts.push(
      { value: 'hourly',      label: 'Hourly',           description: 'Short / permission leave', days: 'per hour' },
    )
  }
  return opts
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaveApply() {
  const navigate    = useNavigate()
  const qc          = useQueryClient()
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null

  // ── Form state ───────────────────────────────────────────────────────────────
  const [leaveTypeId,     setLeaveTypeId]     = useState('')
  const [fromDate,        setFromDate]        = useState('')
  const [toDate,          setToDate]          = useState('')
  const [session,         setSession]         = useState<LeaveSession>('full_day')
  const [hoursRequested,  setHoursRequested]  = useState<number>(1)
  const [reason,          setReason]          = useState('')
  const [fieldErrors,     setFieldErrors]     = useState<Record<string, string>>({})

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
  const balanceMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const row of balanceData?.data ?? []) m.set(row.leave_type_id, row.balance)
    return m
  }, [balanceData])

  // Collision preview — only for full_day multi-day requests once all key fields are set
  const collisionEnabled = session === 'full_day' && !!employeeId && !!leaveTypeId && !!fromDate && !!toDate && fromDate <= toDate
  const { data: collisionData, isFetching: collisionFetching } = useQuery<{ data: CollisionResult }>({
    queryKey: ['leave-collision-preview', employeeId, leaveTypeId, fromDate, toDate],
    queryFn:  () => api.get(`/leave/collision/preview?employee_id=${employeeId}&leave_type_id=${leaveTypeId}&from_date=${fromDate}&to_date=${toDate}`),
    enabled:  collisionEnabled,
    staleTime: 30_000,
  })
  const collision = collisionData?.data ?? null

  // ── Derived ──────────────────────────────────────────────────────────────────

  const selectedLt       = leaveTypes.find(lt => lt.id === leaveTypeId) ?? null
  const sessionOptions   = getSessionOptions(selectedLt)
  const isSingleDayOnly  = session === 'first_half' || session === 'second_half' || session === 'hourly'
  const effectiveToDate  = isSingleDayOnly ? fromDate : toDate    // clamp to_date for single-day sessions
  const computedDays     = computeDaysFromSession(fromDate, effectiveToDate, session, hoursRequested)
  const availableBalance = selectedLt ? (balanceMap.get(selectedLt.id) ?? null) : null
  const insufficientBal  = selectedLt?.is_paid && availableBalance !== null && computedDays > availableBalance

  // Period lock — check the month of fromDate
  const lockMonth = fromDate ? fromDate.slice(0, 7) : new Date().toISOString().slice(0, 7)
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(lockMonth)

  // Date breakdown (full_day only, capped at 31)
  const rangeDates = useMemo(() => {
    if (!fromDate || !effectiveToDate || session !== 'full_day') return []
    const dates: string[] = []
    const cur = new Date(`${fromDate}T12:00:00.000Z`)
    const end = new Date(`${effectiveToDate}T12:00:00.000Z`)
    while (cur <= end && dates.length < 31) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return dates
  }, [fromDate, effectiveToDate, session])

  const weekendCount = rangeDates.filter(d => {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay()
    return dow === 0 || dow === 6
  }).length
  const weekdayCount = rangeDates.length - weekendCount

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleLeaveTypeChange(id: string) {
    setLeaveTypeId(id)
    setSession('full_day')   // reset session when leave type changes
    setFieldErrors(p => ({ ...p, leaveTypeId: '' }))
  }

  function handleSessionChange(s: LeaveSession) {
    setSession(s)
    // For single-day sessions, snap toDate to fromDate
    if ((s === 'first_half' || s === 'second_half' || s === 'hourly') && fromDate) {
      setToDate(fromDate)
    }
  }

  function handleFromDateChange(d: string) {
    setFromDate(d)
    setFieldErrors(p => ({ ...p, fromDate: '' }))
    // If multi-day session, ensure toDate >= fromDate
    if (!isSingleDayOnly && toDate && d > toDate) setToDate(d)
    // For single-day sessions, keep toDate synced
    if (isSingleDayOnly) setToDate(d)
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!leaveTypeId)                              errs.leaveTypeId = 'Select a leave type'
    if (!fromDate)                                 errs.fromDate    = 'Select start date'
    if (!isSingleDayOnly && !toDate)               errs.toDate      = 'Select end date'
    if (fromDate && fromDate < today())            errs.fromDate    = 'Start date cannot be in the past'
    if (!isSingleDayOnly && fromDate && toDate && fromDate > toDate)
                                                   errs.toDate      = 'End date must be on or after start date'
    if (session === 'hourly' && hoursRequested <= 0)
                                                   errs.hoursRequested = 'Enter hours requested (> 0)'
    if (session === 'hourly' && hoursRequested > 24)
                                                   errs.hoursRequested = 'Cannot exceed 24 hours'
    if (session === 'hourly' && selectedLt?.max_hours_per_day && hoursRequested > selectedLt.max_hours_per_day)
                                                   errs.hoursRequested = `Max ${selectedLt.max_hours_per_day} hours allowed per day for this leave type`
    if (!reason.trim())                            errs.reason      = 'Reason is required'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit mutation ───────────────────────────────────────────────────────────

  const { mutate: submitLeave, isPending } = useMutation<{ data: LeaveRequest }, Error>({
    mutationFn: () =>
      api.post('/leave-requests', {
        leave_type_id:   leaveTypeId,
        from_date:       fromDate,
        to_date:         effectiveToDate || fromDate,
        session,
        hours_requested: session === 'hourly' ? hoursRequested : undefined,
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
        description: `${computedDays} day(s) (${sessionLabel[session]}) from ${fromDate}${effectiveToDate !== fromDate ? ` to ${effectiveToDate}` : ''} — pending approval.`,
      })
      qc.invalidateQueries({ queryKey: ['my-leave-requests'] })
      navigate('/ess/leave')
    },
    onError: (err) => {
      toast.error('Submission failed', { description: err.message })
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    submitLeave()
  }

  // ── No employee record guard ──────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Apply for Leave" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-warning" />
            <p className="text-sm font-medium">Profile not linked</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Your account is not linked to an employee record. Contact HR to complete setup.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a new leave request for approval"
      />

      {/* Period lock banner */}
      {fromDate && periodLocked && (
        <PeriodLockBanner state={periodState} month={lockMonth} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Form card ─────────────────────────────────────────────────── */}
        <SectionCard
          className="lg:col-span-2"
          title="Leave Details"
          icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
        >
          {ltLoading ? (
            <div className="space-y-5 animate-pulse">
              {[1, 2, 3].map(i => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-20 bg-muted rounded" />
                  <div className="h-9 bg-muted rounded-md" />
                </div>
              ))}
              <div className="h-9 w-36 bg-muted rounded-md" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Leave Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Leave Type <span className="text-destructive">*</span>
                </label>
                <select
                  value={leaveTypeId}
                  onChange={e => handleLeaveTypeChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">Select a leave type…</option>
                  {leaveTypes.map(lt => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
                {fieldErrors.leaveTypeId && (
                  <p className="text-xs text-destructive">{fieldErrors.leaveTypeId}</p>
                )}

                {/* Balance + flags hint */}
                {selectedLt && (
                  <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-md bg-muted/50">
                    <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      {selectedLt.is_paid ? (
                        availableBalance !== null ? (
                          <span className={cn(insufficientBal ? 'text-destructive' : 'text-foreground')}>
                            Available balance: <strong>{availableBalance} day(s)</strong>
                            {insufficientBal && ' — insufficient for this request'}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Balance not set — HR has not configured a cap</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Unpaid leave — no balance deducted</span>
                      )}
                      <div className="flex gap-2 mt-0.5 flex-wrap">
                        {selectedLt.allow_half_day && (
                          <Badge variant="secondary" className="rounded-full text-[9px]">Half-day allowed</Badge>
                        )}
                        {selectedLt.allow_hourly && (
                          <Badge variant="secondary" className="rounded-full text-[9px]">Hourly allowed</Badge>
                        )}
                        {selectedLt.allow_sandwich && (
                          <Badge variant="outline" className="rounded-full text-[9px] text-warning border-warning/30">Sandwich policy</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Session selector — shown once leave type is selected */}
              {leaveTypeId && sessionOptions.length > 1 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Leave Session</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {sessionOptions.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleSessionChange(opt.value)}
                        className={cn(
                          'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-md border text-left transition-colors',
                          session === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background text-foreground hover:bg-muted/50',
                        )}
                      >
                        <span className="text-xs font-semibold">{opt.label}</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>
                        <span className={cn(
                          'text-[10px] font-medium mt-0.5',
                          session === opt.value ? 'text-primary' : 'text-muted-foreground',
                        )}>
                          {opt.days}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Date Row — from_date always visible; to_date only for full_day */}
              <div className={cn('grid gap-4', isSingleDayOnly ? 'grid-cols-1' : 'grid-cols-2')}>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {isSingleDayOnly ? 'Date' : 'From Date'} <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="date"
                    value={fromDate}
                    min={today()}
                    onChange={e => handleFromDateChange(e.target.value)}
                    className="h-9 text-sm"
                  />
                  {fieldErrors.fromDate && (
                    <p className="text-xs text-destructive">{fieldErrors.fromDate}</p>
                  )}
                </div>

                {!isSingleDayOnly && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      To Date <span className="text-destructive">*</span>
                    </label>
                    <Input
                      type="date"
                      value={toDate}
                      min={fromDate || today()}
                      onChange={e => { setToDate(e.target.value); setFieldErrors(p => ({ ...p, toDate: '' })) }}
                      className="h-9 text-sm"
                    />
                    {fieldErrors.toDate && (
                      <p className="text-xs text-destructive">{fieldErrors.toDate}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Hours input — only for hourly session */}
              {session === 'hourly' && (
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
                      <span className="text-xs text-muted-foreground">
                        = {computedDays.toFixed(4)} days
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Supports 15-minute increments (0.25 h)</p>
                  {fieldErrors.hoursRequested && (
                    <p className="text-xs text-destructive">{fieldErrors.hoursRequested}</p>
                  )}
                </div>
              )}

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => { setReason(e.target.value); setFieldErrors(p => ({ ...p, reason: '' })) }}
                  maxLength={500}
                  rows={3}
                  placeholder="Briefly describe the reason for your leave…"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-y"
                />
                <div className="flex justify-between">
                  {fieldErrors.reason
                    ? <p className="text-xs text-destructive">{fieldErrors.reason}</p>
                    : <span />
                  }
                  <span className="text-[10px] text-muted-foreground">{reason.length}/500</span>
                </div>
              </div>

              {/* Insufficient balance warning */}
              {insufficientBal && (
                <div className="flex items-start gap-2 text-xs p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Insufficient balance — you have {availableBalance} day(s) available but requested {computedDays} day(s).
                    Your manager may still approve at their discretion.
                  </span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isPending || periodLocked}
                className="w-full sm:w-auto"
                title={periodLocked ? 'This period is locked — leave requests cannot be submitted' : undefined}
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit Leave Request
              </Button>
            </form>
          )}
        </SectionCard>

        {/* ── Summary panel ─────────────────────────────────────────────── */}
        <SectionCard
          title="Request Preview"
          icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-4 text-sm">
            {/* Leave type */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Leave Type</p>
              {selectedLt ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{selectedLt.name}</span>
                  <Badge
                    variant={selectedLt.is_paid ? 'success' : 'secondary'}
                    className="rounded-full text-[10px]"
                  >
                    {selectedLt.is_paid ? 'Paid' : 'Unpaid'}
                  </Badge>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">Not selected</span>
              )}
            </div>

            {/* Session */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Session</p>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full text-[10px] capitalize">
                  {session === 'full_day'    && 'Full Day'}
                  {session === 'first_half'  && 'First Half (AM)'}
                  {session === 'second_half' && 'Second Half (PM)'}
                  {session === 'hourly'      && `Hourly — ${hoursRequested}h`}
                </Badge>
              </div>
            </div>

            {/* Duration */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Date</p>
              {fromDate ? (
                <div className="space-y-0.5">
                  <p className="font-medium text-xs">
                    {fmtDate(fromDate)}
                    {!isSingleDayOnly && effectiveToDate && effectiveToDate !== fromDate && (
                      <> → {fmtDate(effectiveToDate)}</>
                    )}
                  </p>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">Select a date</span>
              )}
            </div>

            {/* Computed days */}
            <div className={cn(
              'p-3 rounded-md text-center',
              computedDays > 0 ? 'bg-primary/10' : 'bg-muted/40',
            )}>
              <p className="text-[10px] text-muted-foreground mb-0.5">Days Requested</p>
              <p className={cn(
                'text-2xl font-bold',
                computedDays > 0 ? 'text-primary' : 'text-muted-foreground',
              )}>
                {computedDays > 0 ? computedDays : '—'}
              </p>
              {session === 'hourly' && computedDays > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  ({hoursRequested}h ÷ {STD_SHIFT_HOURS}h shift)
                </p>
              )}
            </div>

            {/* Collision Preview — full_day multi-day requests */}
            {collisionEnabled && (
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
                      const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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
                    {/* Blocked warning */}
                    {collision.is_blocked && (
                      <div className="flex items-start gap-2 text-xs p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                        <span>{collision.block_reason}</span>
                      </div>
                    )}

                    {/* Sandwich info */}
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

                    {/* Converted (holiday/WO not charged) */}
                    {collision.converted_dates.length > 0 && (
                      <div className="text-xs p-2 rounded-md bg-info/10 border border-info/20 text-info">
                        <p className="font-medium mb-1">
                          {collision.converted_dates.length} day(s) converted (not charged to balance)
                        </p>
                        <p className="text-[10px]">{collision.converted_dates.join(', ')}</p>
                      </div>
                    )}

                    {/* Per-day table */}
                    <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                      {collision.per_day.map(d => (
                        <div key={d.date} className={cn(
                          'flex items-center justify-between text-xs px-2 py-0.5 rounded',
                          d.is_holiday ? 'bg-info/10' :
                          d.is_weekly_off ? 'bg-muted/30' :
                          d.is_sandwiched ? 'bg-warning/10' :
                          'bg-transparent',
                        )}>
                          <span className="font-mono tabular-nums text-foreground">{d.date}</span>
                          <div className="flex items-center gap-1">
                            {d.is_holiday   && <span className="text-[9px] text-info px-1 bg-info/20 rounded">Holiday</span>}
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

                    {/* Charged days summary */}
                    {!collision.is_blocked && (
                      <div className="flex items-center justify-between text-xs p-2 rounded-md bg-primary/10 border border-primary/20">
                        <span className="text-muted-foreground">Days charged to balance</span>
                        <span className="font-bold text-primary">{collision.charged_days}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Date breakdown — fallback for non-full_day or when collision unavailable */}
            {!collisionEnabled && rangeDates.length > 0 && (
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
                    const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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
                    ⚠ Sandwich policy active — intervening weekends may also be charged.
                  </p>
                )}
              </div>
            )}

            {/* ── Payroll Impact Preview ──────────────────────────────── */}
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
                      {collision ? collision.charged_days : computedDays}
                    </span>
                  </div>
                  <div className="h-px bg-border/40" />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">Balance after</span>
                    <span className={cn(
                      'font-bold tabular-nums',
                      (availableBalance - (collision ? collision.charged_days : computedDays)) < 0
                        ? 'text-destructive'
                        : 'text-success',
                    )}>
                      {Math.max(0, availableBalance - (collision ? collision.charged_days : computedDays))} day(s)
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

            {/* ── Policy Explainer ──────────────────────────────────── */}
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

            {/* ── Contextual attendance links ─────────────────────────── */}
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
                  to={`/ess/leave`}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <CalendarDays className="h-3 w-3" />
                  My leave history
                </Link>
              </div>
            )}

            {/* Status preview */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-md bg-muted/30">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Request will be submitted as{' '}
              <Badge variant="warning" className="rounded-full text-[10px] ml-1">PENDING</Badge>
            </div>
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  )
}
