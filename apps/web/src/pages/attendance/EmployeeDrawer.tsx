/**
 * EmployeeDrawer — right-side sliding decision panel
 *
 * Opens on team row click; shows:
 *   1. Header (avatar, name, code, High-Risk badge, Prev/Next navigation)
 *   2. Today's summary (check-in, check-out, late, hours)
 *   3. Decision Context (risk badges)
 *   4. Last 7 days (mini attendance list)
 *   5. Anomalies panel
 *   6. Pending requests (leave + corrections) with inline approve / reject
 *   7. Footer (Open Full Profile + Close)
 *
 * Phase 3:
 *   • Processing indicator in header when anyActionPending = true
 *   • Esc key respects anyActionPending
 *   • Backdrop click respects anyActionPending
 *   • Auto-focus first Approve button on open
 *   • aria-labels on action buttons
 *   • Decision Context with actionable risk badges
 *
 * Phase 4:
 *   Step 2  — Focus next available action button after approve/reject
 *   Step 5  — dialogOpen prop: Esc/backdrop skip if parent dialog is open
 *   Step 9  — Prev / Next employee navigation buttons in header
 */

import { useEffect, useRef }  from 'react'
import { useQuery }           from '@tanstack/react-query'
import {
  X, ExternalLink, AlertTriangle, CheckCircle2,
  Clock, Loader2, RefreshCw, ShieldAlert, ChevronLeft, ChevronRight,
} from 'lucide-react'

import { Badge, type BadgeProps }   from '@/components/ui/badge'
import { Button }  from '@/components/ui/button'
import { api }     from '@/lib/api/client'
import { cn }      from '@/lib/utils'

// ── Types (mirrors ManagerDashboard.tsx) ──────────────────────────────────────

export interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
  work_hours:    number
  late_minutes:  number
  check_in:      string | null
  check_out:     string | null
}

export interface LeaveRequestItem {
  id:            string
  from_date:     string
  to_date:       string
  computed_days: number
  reason:        string | null
  created_at:    string
  leave_types:   { id: string; name: string } | null
  employees:     { id: string; first_name: string; last_name: string; employee_code: string } | null
}

export interface RegularisationItem {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  created_at:          string
  employees:           { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface DailyRecord {
  id:           string
  date:         string
  status:       string
  work_hours:   number
  late_minutes: number
}

interface AnomalyItem {
  id:           string
  date:         string
  anomaly_type: string
  description?: string
  severity?:    string
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface EmployeeDrawerProps {
  employee:    TeamMember | null
  open:        boolean
  onClose:     () => void
  onNavigate:  (employeeId: string) => void
  // Pending requests filtered for this employee
  pendingLeave:    LeaveRequestItem[]
  pendingReg:      RegularisationItem[]
  // Which row ID is currently being actioned (for per-row loading)
  actionId:        string | null
  // Callbacks (reuse mutations from parent)
  onApproveLeave:  (id: string) => void
  onRejectLeave:   (id: string) => void
  onApproveReg:    (id: string) => void
  onRejectReg:     (id: string) => void
  approveLeaveLoading: boolean
  rejectLeaveLoading:  boolean
  approveRegLoading:   boolean
  rejectRegLoading:    boolean
  // True when ANY single-item action is in flight (guards all buttons)
  anyActionPending:    boolean
  // Step 5: when true, Esc and backdrop skip closing the drawer (parent dialog is open)
  dialogOpen?:         boolean
  // Step 9: employee navigation
  hasPrevEmployee:     boolean
  hasNextEmployee:     boolean
  onPrevEmployee:      () => void
  onNextEmployee:      () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(dateStr: string): string {
  const s = dateStr
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

const STATUS_BADGE: Record<string, BadgeProps['variant']> = {
  present:    'success',
  late:       'warning',
  absent:     'destructive',
  leave:      'secondary',
  half_day:   'secondary',
  holiday:    'outline',
  weekend:    'outline',
  weekly_off: 'outline',
  not_marked: 'outline',
}

const STATUS_LABEL: Record<string, string> = {
  present:    'Present',
  late:       'Late',
  absent:     'Absent',
  leave:      'On Leave',
  half_day:   'Half Day',
  holiday:    'Holiday',
  weekend:    'Weekend',
  weekly_off: 'Weekly Off',
  not_marked: 'Not Marked',
}

// ── Skeleton helper ───────────────────────────────────────────────────────────

function SkeletonLine({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <div className={cn('rounded bg-muted animate-pulse', w, h)} />
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeeDrawer({
  employee, open, onClose, onNavigate,
  pendingLeave, pendingReg,
  actionId,
  onApproveLeave, onRejectLeave, onApproveReg, onRejectReg,
  approveLeaveLoading, rejectLeaveLoading, approveRegLoading, rejectRegLoading,
  anyActionPending,
  dialogOpen = false,
  hasPrevEmployee, hasNextEmployee, onPrevEmployee, onNextEmployee,
}: EmployeeDrawerProps) {

  // ── Step 5: Esc key — skip if parent dialog is open OR action is pending ──
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !anyActionPending && !dialogOpen) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, anyActionPending, dialogOpen])

  // ── Auto-focus first Approve button when drawer opens ─────────────────────
  const firstApproveBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { firstApproveBtnRef.current?.focus() }, 320)
    return () => clearTimeout(t)
  }, [open, employee?.employee_id])

  // ── Step 2: Focus next Approve button after an item is actioned ──────────
  const prevTotalPendingRef = useRef(pendingLeave.length + pendingReg.length)
  useEffect(() => {
    const prev = prevTotalPendingRef.current
    const curr = pendingLeave.length + pendingReg.length
    prevTotalPendingRef.current = curr
    // Count decreased AND there are still items remaining → focus the new first
    if (open && curr > 0 && curr < prev) {
      const t = setTimeout(() => { firstApproveBtnRef.current?.focus() }, 50)
      return () => clearTimeout(t)
    }
  }, [open, pendingLeave.length, pendingReg.length])

  // ── Data fetching ─────────────────────────────────────────────────────────
  const today    = new Date().toISOString().slice(0, 10)
  const sevenAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 6)
    return d.toISOString().slice(0, 10)
  })()

  const {
    data: attData,
    isLoading: attLoading,
    isError: attError,
    refetch: attRefetch,
  } = useQuery<{ daily: DailyRecord[] }>({
    queryKey:  ['employee-drawer-att', employee?.employee_id],
    queryFn:   () => api.get(`/attendance/${employee!.employee_id}?from=${sevenAgo}&to=${today}`),
    enabled:   open && !!employee,
    staleTime: 60_000,
  })

  const {
    data: anomalyData,
    isLoading: anomalyLoading,
  } = useQuery<{ data?: AnomalyItem[]; items?: AnomalyItem[]; total?: number }>({
    queryKey:  ['employee-drawer-anomalies', employee?.employee_id],
    queryFn:   () => api.get(
      `/attendance/anomalies?employee_id=${employee!.employee_id}&resolved=false&limit=5`,
    ),
    enabled:   open && !!employee,
    staleTime: 60_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const daily     = attData?.daily ?? []
  const anomalies: AnomalyItem[] = anomalyData?.data ?? anomalyData?.items ?? []
  const highRisk  = anomalies.length > 2
  const hasPending = pendingLeave.length + pendingReg.length > 0

  function isBusy(id: string) { return actionId === id && anyActionPending }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — Step 5: skip close if dialog is open */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => { if (!anyActionPending && !dialogOpen) onClose() }}
          aria-hidden="true"
        />
      )}

      {/* Slide-in panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-[420px] max-w-[95vw]',
          'bg-card border-l border-border shadow-2xl flex flex-col',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        aria-hidden={!open}
      >
        {/* ── Section 1: Header ──────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border flex-shrink-0">
          {employee ? (
            <>
              <div className="h-11 w-11 rounded-full bg-primary/15 ring-2 ring-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary">
                  {employee.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                </span>
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground leading-tight truncate">
                    {employee.name}
                  </p>
                  {highRisk && (
                    <Badge variant="destructive" className="rounded-full text-[10px] flex-shrink-0 gap-0.5">
                      <ShieldAlert className="h-2.5 w-2.5" />
                      High Risk
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {employee.employee_code}
                  </p>
                  {anyActionPending && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      Processing…
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 space-y-1.5">
              <SkeletonLine w="w-32" h="h-4" />
              <SkeletonLine w="w-20" h="h-3" />
            </div>
          )}

          {/* Step 9: Prev / Next employee navigation */}
          <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            <button
              onClick={onPrevEmployee}
              disabled={!hasPrevEmployee}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                hasPrevEmployee
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  : 'text-muted-foreground/25 cursor-not-allowed',
              )}
              aria-label="Previous employee"
              title="Previous employee"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onNextEmployee}
              disabled={!hasNextEmployee}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                hasNextEmployee
                  ? 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  : 'text-muted-foreground/25 cursor-not-allowed',
              )}
              aria-label="Next employee"
              title="Next employee"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors ml-0.5"
              aria-label="Close employee details"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {employee ? (
            <div className="divide-y divide-border/50">

              {/* ── Section 2: Today's Summary ──────────────────────────────── */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Today
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    {
                      label: 'Status',
                      node: (
                        <Badge
                          variant={STATUS_BADGE[employee.status] ?? 'outline'}
                          className="rounded-full text-[10px]"
                        >
                          {STATUS_LABEL[employee.status] ?? employee.status}
                        </Badge>
                      ),
                    },
                    { label: 'Check In',  text: fmtTime(employee.check_in)  },
                    { label: 'Check Out', text: fmtTime(employee.check_out) },
                    {
                      label: 'Work Hours',
                      text: employee.work_hours > 0 ? `${employee.work_hours}h` : '—',
                    },
                  ] as Array<{ label: string; text?: string; node?: React.ReactNode }>).map(({ label, text, node }) => (
                    <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                      {node
                        ? node
                        : <p className="text-xs font-medium text-foreground tabular-nums">{text}</p>}
                    </div>
                  ))}
                </div>
                {employee.late_minutes > 0 && (
                  <div className="flex items-center gap-2 text-xs text-warning bg-warning/8 border border-warning/15 rounded-lg px-3 py-2">
                    <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                    Late by {employee.late_minutes} minute{employee.late_minutes !== 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* ── Section 2b: Decision Context ─────────────────────────────── */}
              {(() => {
                const lateCount    = daily.filter(d => d.status === 'late').length
                const missingCount = anomalies.filter(a => a.anomaly_type === 'missing_punch').length
                const anomalyTotal = anomalies.length
                if (lateCount === 0 && missingCount === 0 && anomalyTotal === 0) return null

                const isFrequentLate  = lateCount >= 3
                const hasMissingPunch = missingCount >= 1
                const isHighRiskMulti = anomalyTotal >= 3

                return (
                  <div className="px-5 py-4 space-y-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Decision Context
                      </p>
                      {isFrequentLate && (
                        <Badge variant="destructive" className="rounded-full text-[10px] px-1.5 gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Frequent Late
                        </Badge>
                      )}
                      {hasMissingPunch && (
                        <Badge variant="warning" className="rounded-full text-[10px] px-1.5 gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          Missing Punch
                        </Badge>
                      )}
                      {isHighRiskMulti && (
                        <Badge variant="destructive" className="rounded-full text-[10px] px-1.5 gap-0.5">
                          <ShieldAlert className="h-2.5 w-2.5" />
                          High Risk
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-2">
                      {lateCount > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Late {lateCount === 1 ? 'once' : `${lateCount} times`} this week
                          </span>
                          <Badge
                            variant={isFrequentLate ? 'destructive' : 'warning'}
                            className="rounded-full text-[10px] px-1.5"
                          >
                            {lateCount}×
                          </Badge>
                        </div>
                      )}
                      {missingCount > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Missing punch{missingCount !== 1 ? 'es' : ''}
                          </span>
                          <Badge variant="warning" className="rounded-full text-[10px] px-1.5">
                            {missingCount}
                          </Badge>
                        </div>
                      )}
                      {anomalyTotal > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {anomalyTotal === 1 ? '1 anomaly detected' : `${anomalyTotal} anomalies detected`}
                          </span>
                          <Badge
                            variant={isHighRiskMulti ? 'destructive' : 'outline'}
                            className="rounded-full text-[10px] px-1.5"
                          >
                            {anomalyTotal}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* ── Section 3: Last 7 Days ───────────────────────────────────── */}
              <div className="px-5 py-4 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Last 7 Days
                </p>
                {attLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <SkeletonLine w="w-16" h="h-3" />
                        <SkeletonLine w="w-14" h="h-5" />
                      </div>
                    ))}
                  </div>
                ) : attError ? (
                  <div className="text-center py-2">
                    <p className="text-xs text-muted-foreground mb-2">Failed to load attendance</p>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => attRefetch()}>
                      <RefreshCw className="h-3 w-3 mr-1" />Retry
                    </Button>
                  </div>
                ) : daily.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">No records for this period</p>
                ) : (
                  <div className="space-y-0.5">
                    {[...daily]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .slice(0, 7)
                      .map(day => (
                        <div
                          key={day.id}
                          className="flex items-center justify-between text-xs py-1.5 border-b border-border/25 last:border-0"
                        >
                          <span className="text-muted-foreground tabular-nums w-16 flex-shrink-0">
                            {fmtDate(day.date)}
                          </span>
                          <div className="flex items-center gap-2">
                            {day.work_hours > 0 && (
                              <span className="text-muted-foreground/60 tabular-nums text-[11px]">
                                {day.work_hours}h
                              </span>
                            )}
                            <Badge
                              variant={STATUS_BADGE[day.status] ?? 'outline'}
                              className="rounded-full text-[9px] px-1.5 py-0.5"
                            >
                              {STATUS_LABEL[day.status] ?? day.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* ── Section 4: Anomalies Panel ───────────────────────────────── */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Anomalies
                  </p>
                  {anomalies.length > 0 && (
                    <Badge variant="destructive" className="rounded-full text-[10px] h-4 px-1.5">
                      {anomalies.length}
                    </Badge>
                  )}
                </div>
                {anomalyLoading ? (
                  <SkeletonLine h="h-8" />
                ) : anomalies.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-success py-0.5">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                    No unresolved issues
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {anomalies.slice(0, 4).map(a => (
                      <div
                        key={a.id}
                        className="flex items-start gap-2 text-xs p-2 rounded-md bg-destructive/5 border border-destructive/10"
                      >
                        <AlertTriangle className="h-3 w-3 text-destructive flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-foreground capitalize">
                            {(a.anomaly_type ?? '').replace(/_/g, ' ')}
                          </span>
                          <span className="text-muted-foreground ml-1.5 tabular-nums">
                            {fmtDate(a.date)}
                          </span>
                          {a.description && (
                            <p className="text-muted-foreground/70 truncate mt-0.5">{a.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {anomalies.length > 4 && (
                      <p className="text-[10px] text-muted-foreground text-center pt-0.5">
                        +{anomalies.length - 4} more anomalies
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Sections 5 + 6: Pending Requests + Actions ──────────────── */}
              {hasPending && (
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Pending Requests
                    </p>
                    <Badge variant="warning" className="rounded-full text-[10px] px-1.5">
                      {pendingLeave.length + pendingReg.length} awaiting
                    </Badge>
                  </div>

                  {/* Leave requests */}
                  {pendingLeave.map((lr, lrIdx) => {
                    const busy        = isBusy(lr.id)
                    const isFirstItem = lrIdx === 0
                    return (
                      <div
                        key={lr.id}
                        className={cn(
                          'rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2.5 transition-opacity',
                          busy && 'opacity-60 pointer-events-none',
                        )}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <Badge variant="warning" className="rounded-full text-[10px]">
                              Pending Approval
                            </Badge>
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {lr.leave_types?.name ?? 'Leave'}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground tabular-nums mb-1">
                            {fmtDate(lr.from_date)}
                            {lr.from_date !== lr.to_date && ` – ${fmtDate(lr.to_date)}`}
                            {' · '}{lr.computed_days}d
                          </p>
                          {lr.reason && (
                            <p className="text-[10px] text-muted-foreground/80 italic leading-relaxed">
                              "{lr.reason}"
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            ref={isFirstItem ? firstApproveBtnRef : undefined}
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            disabled={anyActionPending}
                            aria-label={`Approve leave request for ${lr.leave_types?.name ?? 'leave'} (${fmtDate(lr.from_date)})`}
                            onClick={() => onApproveLeave(lr.id)}
                          >
                            {busy && approveLeaveLoading
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Approve'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            disabled={anyActionPending}
                            aria-label={`Reject leave request for ${lr.leave_types?.name ?? 'leave'} (${fmtDate(lr.from_date)})`}
                            onClick={() => onRejectLeave(lr.id)}
                          >
                            {busy && rejectLeaveLoading
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Reject'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}

                  {/* Correction requests */}
                  {pendingReg.map((reg, regIdx) => {
                    const busy           = isBusy(reg.id)
                    const isFirstOverall = pendingLeave.length === 0 && regIdx === 0
                    return (
                      <div
                        key={reg.id}
                        className={cn(
                          'rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2.5 transition-opacity',
                          busy && 'opacity-60 pointer-events-none',
                        )}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <Badge variant="warning" className="rounded-full text-[10px]">
                              Pending Approval
                            </Badge>
                            <Badge variant="secondary" className="rounded-full text-[10px]">
                              Correction
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground tabular-nums mb-1">
                            {fmtDate(reg.date)}
                            {' · '}In: {fmtTime(reg.requested_check_in)}
                            {' · '}Out: {fmtTime(reg.requested_check_out)}
                          </p>
                          {reg.reason && (
                            <p className="text-[10px] text-muted-foreground/80 italic leading-relaxed">
                              "{reg.reason}"
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            ref={isFirstOverall ? firstApproveBtnRef : undefined}
                            size="sm"
                            className="flex-1 h-7 text-xs"
                            disabled={anyActionPending}
                            aria-label={`Approve attendance correction for ${fmtDate(reg.date)}`}
                            onClick={() => onApproveReg(reg.id)}
                          >
                            {busy && approveRegLoading
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Approve'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            disabled={anyActionPending}
                            aria-label={`Reject attendance correction for ${fmtDate(reg.date)}`}
                            onClick={() => onRejectReg(reg.id)}
                          >
                            {busy && rejectRegLoading
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : 'Reject'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Bottom spacing */}
              <div className="h-2" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">No employee selected</p>
            </div>
          )}
        </div>

        {/* ── Section 7: Footer ──────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center gap-2 flex-shrink-0">
          <Button
            className="flex-1 h-9 gap-2"
            variant="outline"
            disabled={!employee}
            onClick={() => {
              if (employee) { onClose(); onNavigate(employee.employee_id) }
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Full Profile
          </Button>
          <Button
            variant="ghost"
            className="h-9 px-3 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
