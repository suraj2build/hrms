/**
 * ManagerDashboard — action-first redesign
 *
 * Phase 3 enhancements:
 *   • Processing indicator in drawer header
 *   • Indeterminate "Select All" checkbox state
 *   • Improved bulk toast with partial failure (no full rollback)
 *   • Backdrop click / Esc respects anyActionPending
 *   • Auto-focus first Approve button; aria-labels
 *   • Enhanced Decision Context with actionable risk badges
 *
 * Phase 4 enhancements:
 *   Step 1  — Selection clears on filter / date change
 *   Step 2  — Focus next action button in drawer after approve/reject
 *   Step 3  — Fade-out animation on row removal
 *   Step 4  — "Last updated" relative timestamp + spinner on refresh
 *   Step 5  — Confirm dialog open → Esc / backdrop close drawer only
 *   Step 6  — Retry failed bulk items
 *   Step 7  — Stable layout during background refetch
 *   Step 8  — Enhanced bulk bar "N selected (X leave, Y corrections)"
 *   Step 9  — Prev / Next employee navigation inside drawer
 *   Step 10 — Telemetry via trackEvent
 */

import { useState, useEffect, useRef, useMemo }  from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link }                     from 'react-router-dom'
import { toast }                                 from 'sonner'
import {
  Users, CheckCircle2, XCircle, Clock, CalendarDays,
  AlertTriangle, ChevronLeft, ChevronRight, Inbox,
  RefreshCw, UserCheck, Loader2, Zap,
  BarChart2, CalendarClock, ClipboardList, ArrowRight, X,
  Flame, CircleDot,
} from 'lucide-react'

import { EmployeeDrawer } from './EmployeeDrawer'

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMember {
  employee_id:   string
  employee_code: string
  name:          string
  status:        string
  work_hours:    number
  late_minutes:  number
  check_in:      string | null
  check_out:     string | null
}

interface TodaySummary {
  present:    number
  late:       number
  absent:     number
  leave:      number
  not_marked: number
  total:      number
}

interface LeaveRequestItem {
  id:            string
  from_date:     string
  to_date:       string
  computed_days: number
  reason:        string | null
  created_at:    string
  leave_types:   { id: string; name: string } | null
  employees:     { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface RegularisationItem {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  created_at:          string
  employees:           { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface DashboardData {
  manager_employee_id: string | null
  date:                string
  team_members:        TeamMember[]
  today_summary:       TodaySummary
  pending: {
    leave_requests:  LeaveRequestItem[]
    regularisations: RegularisationItem[]
  }
  anomalies: { count: number }
}

type AttentionSeverity = 'error' | 'warning' | 'info'

interface NeedsAttentionItem {
  key:         string
  type:        'sla_breach' | 'absent_no_leave' | 'not_marked' | 'anomaly'
  severity:    AttentionSeverity
  label:       string          // employee name
  code?:       string          // employee code
  detail:      string          // human-readable detail
  itemId?:     string          // leave/reg ID for direct action
  employeeId?: string          // for deep-link to forensics/profile
}

// ── Attention queue helpers ────────────────────────────────────────────────────

/** Returns human-readable SLA age badge label for a pending item. */
function slaAge(createdAt: string): { label: string; breach: boolean; critical: boolean } {
  const ageH    = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  const breach  = ageH >= 24
  const critical = ageH >= 48
  if (ageH < 1)   return { label: 'just now',                            breach: false, critical: false }
  if (!breach)    return { label: `${Math.floor(ageH)}h ago`,            breach: false, critical: false }
  if (!critical)  return { label: `${Math.floor(ageH)}h — overdue`,     breach,        critical: false }
  return           { label: `${Math.floor(ageH / 24)}d — urgent`,       breach,        critical }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Step 10 — Lightweight telemetry. Non-blocking; never throws into UI. */
function trackEvent(event: string, props: Record<string, unknown>): void {
  try {
    if (typeof window !== 'undefined' && typeof (window as any).__trackEvent === 'function') {
      ; (window as any).__trackEvent(event, props)
    }
    if (import.meta.env.DEV) {
      console.debug('[telemetry]', event, props)
    }
  } catch {
    // intentionally swallowed
  }
}

/** Step 4 — Produces "just now", "3 min ago", "2 hr ago". */
function relativeTime(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000)
  if (secs < 60)   return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  return `${Math.floor(secs / 3600)} hr ago`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const STATUS_BADGE: Record<string, string> = {
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

// ── Skeleton helpers ───────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 animate-pulse">
      <div className="h-8 w-8 rounded-lg bg-muted" />
      <div className="flex-1 space-y-2 pt-0.5">
        <div className="h-5 w-12 rounded bg-muted" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border/40 animate-pulse">
      {[140, 72, 56, 56, 40, 40].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 rounded bg-muted" style={{ width: w }} />
        </td>
      ))}
    </tr>
  )
}

function SkeletonApprovalRow() {
  return (
    <div className="p-3 rounded-lg border border-border animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-32 rounded bg-muted" />
          <div className="h-3 w-48 rounded bg-muted" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-7 w-16 rounded bg-muted" />
          <div className="h-7 w-14 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, colorClass, active, onClick, dimmed,
}: {
  icon:       React.ElementType
  label:      string
  value:      number
  sub?:       string
  colorClass: string
  active?:    boolean
  onClick?:   () => void
  dimmed?:    boolean
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl border border-border bg-card p-4 flex items-start gap-3 transition-all',
        onClick && 'cursor-pointer hover:border-primary/40 hover:shadow-sm',
        active  && 'border-primary/60 ring-1 ring-primary/20 bg-primary/5',
        dimmed  && 'opacity-60',
      )}
    >
      <div className={cn('p-2 rounded-lg bg-muted/40', colorClass)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-none mt-0.5">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function QuickAction({
  icon: Icon, label, to,
}: {
  icon: React.ElementType; label: string; to: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/30 hover:border-primary/30 transition-colors text-xs font-medium text-foreground group"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
      {label}
      <ArrowRight className="h-3 w-3 text-muted-foreground/40 ml-auto group-hover:text-primary/60 transition-colors" />
    </Link>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ManagerDashboard() {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  // ── Status filter + side drawer ───────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [drawerMember, setDrawerMember] = useState<TeamMember | null>(null)
  const [drawerOpen,   setDrawerOpen]   = useState(false)

  // ── Bulk selection ────────────────────────────────────────────────────────
  const [selectedIds,  setSelectedIds]  = useState<Set<string>>(new Set())
  const [confirmState, setConfirmState] = useState<{
    action: 'approve' | 'reject'; count: number
  } | null>(null)

  // ── Optimistic dismissal ──────────────────────────────────────────────────
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // ── Step 3: Row fade-out animation ────────────────────────────────────────
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set())

  // ── Step 4: Last updated timestamp ───────────────────────────────────────
  const [lastUpdatedAt,    setLastUpdatedAt]    = useState<Date | null>(null)
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string>('')

  // ── Step 6: Retry failed bulk items ──────────────────────────────────────
  const [failedBulkState, setFailedBulkState] = useState<{
    ids: string[]; action: 'approve' | 'reject'
  } | null>(null)

  // ── Action tracking ───────────────────────────────────────────────────────
  const [actionId, setActionId] = useState<string | null>(null)

  // ── Core functions ─────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setFailedBulkState(null)   // Step 6: clear retry state on manual clear
  }

  function openDrawer(member: TeamMember) { setDrawerMember(member); setDrawerOpen(true) }
  function closeDrawer() { setDrawerOpen(false) }

  function dismiss(id: string) {
    setDismissedIds(prev => new Set([...prev, id]))
  }

  /** Step 3: Fade row to opacity-0 then remove from DOM after 200ms. */
  function dismissWithFade(id: string) {
    setFadingIds(prev => new Set([...prev, id]))
    setTimeout(() => {
      dismiss(id)
      setFadingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 200)
  }

  /** Step 3: Restore a row that was fading (on API error). */
  function cancelFade(id: string) {
    setFadingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function prevDay() {
    const d = new Date(`${date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    setDate(d.toISOString().slice(0, 10))
    setDismissedIds(new Set())
    clearSelection()
    closeDrawer()
  }
  function nextDay() {
    const d = new Date(`${date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    setDate(d.toISOString().slice(0, 10))
    setDismissedIds(new Set())
    clearSelection()
    closeDrawer()
  }

  // ── Step 7: isFetching for stable-layout refetch spinner ─────────────────
  const { data, isLoading, isFetching, isError, refetch } = useQuery<DashboardData>({
    queryKey:        ['manager-dashboard', date],
    queryFn:         () => api.get(`/manager/dashboard?date=${date}`),
    staleTime:       60_000,
    refetchInterval: 5 * 60_000,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  const approveLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/approve`, {}),
    onSuccess: (_data, id) => {
      dismissWithFade(id)                                             // Step 3
      setActionId(null)
      toast.success('Request approved')
      trackEvent('approval_action', { type: 'leave', action: 'approve', count: 1, success: true }) // Step 10
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id)                                                  // Step 3
      setActionId(null)
      toast.error(err.message || 'Failed to approve request')
      trackEvent('approval_action', { type: 'leave', action: 'approve', count: 1, success: false }) // Step 10
    },
  })

  const rejectLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/reject`, {}),
    onSuccess: (_data, id) => {
      dismissWithFade(id)                                             // Step 3
      setActionId(null)
      toast.success('Request rejected')
      trackEvent('approval_action', { type: 'leave', action: 'reject', count: 1, success: true }) // Step 10
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id)                                                  // Step 3
      setActionId(null)
      toast.error(err.message || 'Failed to reject request')
      trackEvent('approval_action', { type: 'leave', action: 'reject', count: 1, success: false }) // Step 10
    },
  })

  const approveRegMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: (_data, id) => {
      dismissWithFade(id)                                             // Step 3
      setActionId(null)
      toast.success('Correction approved')
      trackEvent('approval_action', { type: 'correction', action: 'approve', count: 1, success: true }) // Step 10
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id)                                                  // Step 3
      setActionId(null)
      toast.error(err.message || 'Failed to approve correction')
      trackEvent('approval_action', { type: 'correction', action: 'approve', count: 1, success: false }) // Step 10
    },
  })

  const rejectRegMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess: (_data, id) => {
      dismissWithFade(id)                                             // Step 3
      setActionId(null)
      toast.success('Correction rejected')
      trackEvent('approval_action', { type: 'correction', action: 'reject', count: 1, success: true }) // Step 10
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
    onError: (err: Error, id) => {
      cancelFade(id)                                                  // Step 3
      setActionId(null)
      toast.error(err.message || 'Failed to reject correction')
      trackEvent('approval_action', { type: 'correction', action: 'reject', count: 1, success: false }) // Step 10
    },
  })

  // ── Bulk mutation ─────────────────────────────────────────────────────────
  const bulkMutation = useMutation<
    { succeeded: number; failed: number; failedIds: string[] },
    Error,
    { leaveIds: string[]; regIds: string[]; action: 'approve' | 'reject' },
    { prev: DashboardData | undefined }
  >({
    mutationFn: async ({ leaveIds, regIds, action }) => {
      const allItems: Array<{ id: string; type: 'leave' | 'reg' }> = [
        ...leaveIds.map(id => ({ id, type: 'leave' as const })),
        ...regIds.map(id   => ({ id, type: 'reg'   as const })),
      ]
      const results = await Promise.allSettled(
        allItems.map(item =>
          item.type === 'leave'
            ? api.post(`/leave-requests/${item.id}/${action}`, {})
            : api.post(`/attendance/regularisation/${item.id}/${action}`, {}),
        ),
      )
      const failedIds = allItems
        .filter((_, i) => results[i].status === 'rejected')
        .map(item => item.id)
      return { succeeded: allItems.length - failedIds.length, failed: failedIds.length, failedIds }
    },
    onMutate: async ({ leaveIds, regIds }) => {
      const ids = [...leaveIds, ...regIds]
      await qc.cancelQueries({ queryKey: ['manager-dashboard', date] })
      const prev = qc.getQueryData<DashboardData>(['manager-dashboard', date])
      qc.setQueryData<DashboardData>(['manager-dashboard', date], (old) => {
        if (!old) return old
        return {
          ...old,
          pending: {
            leave_requests:  old.pending.leave_requests.filter(lr => !ids.includes(lr.id)),
            regularisations: old.pending.regularisations.filter(r  => !ids.includes(r.id)),
          },
        }
      })
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['manager-dashboard', date], ctx.prev)
      toast.error(err.message || 'Bulk action failed')
      setConfirmState(null)
    },
    onSuccess: ({ succeeded, failed, failedIds }, { action }, ctx) => {
      clearSelection()
      setConfirmState(null)
      const verb = action === 'approve' ? 'approved' : 'rejected'

      // Step 6: store failed IDs for retry
      if (failedIds.length > 0) {
        setFailedBulkState({ ids: failedIds, action })
      } else {
        setFailedBulkState(null)
      }

      if (failed === 0) {
        toast.success(`${succeeded} request${succeeded !== 1 ? 's' : ''} ${verb}`)
      } else if (succeeded > 0) {
        // Partial success — restore only the failed items into the cache.
        qc.setQueryData<DashboardData>(['manager-dashboard', date], (current) => {
          if (!current || !ctx?.prev) return current
          const prevLeave = ctx.prev!.pending.leave_requests.filter(lr => failedIds.includes(lr.id))
          const prevReg   = ctx.prev!.pending.regularisations.filter(r  => failedIds.includes(r.id))
          return {
            ...current,
            pending: {
              leave_requests:  [...current.pending.leave_requests,  ...prevLeave],
              regularisations: [...current.pending.regularisations, ...prevReg],
            },
          }
        })
        toast.warning(`${succeeded} ${verb}, ${failed} failed — use "Retry failed" to resubmit`)
      } else {
        if (ctx?.prev) qc.setQueryData(['manager-dashboard', date], ctx.prev)
        toast.error(`All ${failed} requests failed`)
      }

      // Step 10: telemetry
      trackEvent('approval_action', {
        type: 'bulk', action, count: succeeded + failed, succeeded, failed,
      })

      // Close drawer if employee's items were all bulk-actioned
      if (drawerOpen && drawerMember) {
        const currentData = qc.getQueryData<DashboardData>(['manager-dashboard', date])
        if (currentData) {
          const remainingLeave = currentData.pending.leave_requests.filter(
            lr => lr.employees?.id === drawerMember.employee_id && !dismissedIds.has(lr.id),
          )
          const remainingReg = currentData.pending.regularisations.filter(
            r => r.employees?.id === drawerMember.employee_id && !dismissedIds.has(r.id),
          )
          if (remainingLeave.length === 0 && remainingReg.length === 0) closeDrawer()
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['manager-dashboard'] })
    },
  })

  const anyActionPending =
    approveLeaveMutation.isPending || rejectLeaveMutation.isPending ||
    approveRegMutation.isPending   || rejectRegMutation.isPending

  const isBusy = (id: string) => actionId === id && anyActionPending

  // ── Derived ───────────────────────────────────────────────────────────────
  const summary       = data?.today_summary
  const team          = data?.team_members ?? []
  const pending       = data?.pending ?? { leave_requests: [], regularisations: [] }
  const anomalyCount  = data?.anomalies.count ?? 0

  const visibleLeave  = pending.leave_requests.filter(lr => !dismissedIds.has(lr.id))
  const visibleReg    = pending.regularisations.filter(r  => !dismissedIds.has(r.id))
  const pendingCount  = visibleLeave.length + visibleReg.length

  const filteredTeam  = statusFilter ? team.filter(m => m.status === statusFilter) : team

  const leaveIdSet        = new Set(visibleLeave.map(lr => lr.id))
  const regIdSet          = new Set(visibleReg.map(r  => r.id))
  const effectiveSelected = new Set([...selectedIds].filter(id => leaveIdSet.has(id) || regIdSet.has(id)))
  const allLeaveSelected  = visibleLeave.length > 0 && visibleLeave.every(lr => selectedIds.has(lr.id))
  const allRegSelected    = visibleReg.length   > 0 && visibleReg.every(r   => selectedIds.has(r.id))
  const bulkBusy          = bulkMutation.isPending

  // Step 7: background refetch without full skeleton reload
  const isRefetching = isFetching && !!data

  // Step 8: break down selected by type for bulk bar label
  const selectedLeaveCount = [...effectiveSelected].filter(id => leaveIdSet.has(id)).length
  const selectedRegCount   = [...effectiveSelected].filter(id => regIdSet.has(id)).length

  // Step 9: drawer index navigation within filteredTeam
  const drawerIndex    = drawerMember ? filteredTeam.findIndex(m => m.employee_id === drawerMember.employee_id) : -1
  const hasPrevEmployee = drawerIndex > 0
  const hasNextEmployee = drawerIndex >= 0 && drawerIndex < filteredTeam.length - 1

  // ── Needs-Attention queue: derived from existing data, no new API ──────────
  const needsAttentionItems = useMemo((): NeedsAttentionItem[] => {
    if (!data) return []
    const items: NeedsAttentionItem[] = []
    const now = Date.now()

    // 1. SLA breaches — pending requests older than 24h
    for (const lr of visibleLeave) {
      const ageH = (now - new Date(lr.created_at).getTime()) / 3_600_000
      if (ageH >= 24) {
        items.push({
          key:        `sla-leave-${lr.id}`,
          type:       'sla_breach',
          severity:   ageH >= 48 ? 'error' : 'warning',
          label:      lr.employees ? `${lr.employees.first_name} ${lr.employees.last_name}` : 'Unknown',
          code:       lr.employees?.employee_code,
          detail:     `Leave request pending ${Math.floor(ageH)}h — ${lr.leave_types?.name ?? 'Leave'}`,
          itemId:     lr.id,
          employeeId: lr.employees?.id,
        })
      }
    }
    for (const reg of visibleReg) {
      const ageH = (now - new Date(reg.created_at).getTime()) / 3_600_000
      if (ageH >= 24) {
        items.push({
          key:        `sla-reg-${reg.id}`,
          type:       'sla_breach',
          severity:   ageH >= 48 ? 'error' : 'warning',
          label:      reg.employees ? `${reg.employees.first_name} ${reg.employees.last_name}` : 'Unknown',
          code:       reg.employees?.employee_code,
          detail:     `Correction request pending ${Math.floor(ageH)}h — ${fmtDate(reg.date)}`,
          itemId:     reg.id,
          employeeId: reg.employees?.id,
        })
      }
    }

    // 2. Absent with no pending leave — flag employees who are absent today and have no leave in queue
    const empIdsWithPendingLeave = new Set(visibleLeave.map(lr => lr.employees?.id).filter(Boolean))
    for (const m of team) {
      if (m.status === 'absent' && !empIdsWithPendingLeave.has(m.employee_id)) {
        items.push({
          key:        `absent-${m.employee_id}`,
          type:       'absent_no_leave',
          severity:   'warning',
          label:      m.name,
          code:       m.employee_code,
          detail:     'Absent today — no leave request on file',
          employeeId: m.employee_id,
        })
      }
    }

    // 3. Not marked (no attendance record at all today)
    for (const m of team) {
      if (m.status === 'not_marked') {
        items.push({
          key:        `notmarked-${m.employee_id}`,
          type:       'not_marked',
          severity:   'info',
          label:      m.name,
          code:       m.employee_code,
          detail:     'No attendance punch or status recorded today',
          employeeId: m.employee_id,
        })
      }
    }

    // Sort: error first, then warning, then info; within same severity preserve insertion order
    const order: Record<AttentionSeverity, number> = { error: 0, warning: 1, info: 2 }
    return items.sort((a, b) => order[a.severity] - order[b.severity])
  }, [data, visibleLeave, visibleReg, team]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Team reliability scores: derived from today's team status ──────────────
  const teamReliability = useMemo(() => {
    const scoreable = team.filter(m =>
      !['leave', 'holiday', 'weekend', 'weekly_off'].includes(m.status)
    )
    if (scoreable.length === 0) return { avg: null, scored: [], total: 0 }

    const scored = scoreable.map(m => {
      let score: number
      if (m.status === 'present')    score = 100
      else if (m.status === 'late')  score = Math.max(50, 100 - Math.floor(m.late_minutes * 0.5))
      else if (m.status === 'half_day') score = 75
      else                           score = 0   // absent, not_marked
      return { employee_id: m.employee_id, score }
    })

    const avg = Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length)
    return { avg, scored, total: scoreable.length }
  }, [team])

  // ── Approval queue intelligence ───────────────────────────────────────────
  const queueIntelligence = useMemo(() => {
    const allItems = [
      ...visibleLeave.map(lr => ({ id: lr.id, created_at: lr.created_at, name: lr.employees ? `${lr.employees.first_name} ${lr.employees.last_name}` : 'Unknown' })),
      ...visibleReg.map(r  => ({ id: r.id,  created_at: r.created_at,  name: r.employees  ? `${r.employees.first_name} ${r.employees.last_name}`  : 'Unknown' })),
    ]
    if (allItems.length === 0) return { avgAgeH: 0, maxAgeH: 0, oldest: null, total: 0 }

    const now = Date.now()
    const ages = allItems.map(i => ({ ...i, ageH: (now - new Date(i.created_at).getTime()) / 3_600_000 }))
    const avgAgeH = ages.reduce((s, i) => s + i.ageH, 0) / ages.length
    const oldest  = ages.reduce((best, i) => i.ageH > best.ageH ? i : best, ages[0])
    return { avgAgeH, maxAgeH: oldest.ageH, oldest, total: allItems.length }
  }, [visibleLeave, visibleReg])

  // ── Effective coverage rate (excludes on-leave / holiday / weekly_off) ─────
  const coverageRate = useMemo(() => {
    if (team.length === 0) return null
    const excluded = new Set(['leave', 'holiday', 'weekend', 'weekly_off'])
    const inScope  = team.filter(m => !excluded.has(m.status))
    if (inScope.length === 0) return null
    const working  = inScope.filter(m => m.status === 'present' || m.status === 'late' || m.status === 'half_day').length
    return { pct: Math.round((working / inScope.length) * 100), working, inScope: inScope.length }
  }, [team])

  // ── Absence cluster detection: ≥3 employees absent simultaneously ──────────
  const absenceCluster = useMemo(() => {
    if (!data || !summary) return null
    const absentCount = summary.absent + summary.not_marked
    const total       = summary.total - (summary.leave ?? 0)
    if (total > 0 && absentCount / total >= 0.30) {
      return { count: absentCount, pct: Math.round((absentCount / total) * 100) }
    }
    return null
  }, [data, summary])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleStatusFilter(status: string) {
    setStatusFilter(prev => prev === status ? null : status)
  }

  function toggleSelectAllLeave() {
    if (allLeaveSelected) {
      setSelectedIds(prev => {
        const n = new Set(prev); visibleLeave.forEach(lr => n.delete(lr.id)); return n
      })
    } else {
      setSelectedIds(prev => new Set([...prev, ...visibleLeave.map(lr => lr.id)]))
    }
  }
  function toggleSelectAllReg() {
    if (allRegSelected) {
      setSelectedIds(prev => {
        const n = new Set(prev); visibleReg.forEach(r => n.delete(r.id)); return n
      })
    } else {
      setSelectedIds(prev => new Set([...prev, ...visibleReg.map(r => r.id)]))
    }
  }

  function handleBulkApprove() {
    if (effectiveSelected.size === 0) return
    setConfirmState({ action: 'approve', count: effectiveSelected.size })
  }
  function handleBulkReject() {
    if (effectiveSelected.size === 0) return
    setConfirmState({ action: 'reject', count: effectiveSelected.size })
  }
  function confirmBulkAction() {
    if (!confirmState) return
    const ids      = [...effectiveSelected]
    const leaveIds = ids.filter(id => leaveIdSet.has(id))
    const regIds   = ids.filter(id => regIdSet.has(id))
    bulkMutation.mutate({ leaveIds, regIds, action: confirmState.action })
  }

  /** Step 6: Retry only the IDs that failed in the previous bulk action. */
  function handleRetryFailed() {
    if (!failedBulkState || failedBulkState.ids.length === 0) return
    const leaveIds = failedBulkState.ids.filter(id => leaveIdSet.has(id))
    const regIds   = failedBulkState.ids.filter(id => regIdSet.has(id))
    bulkMutation.mutate({ leaveIds, regIds, action: failedBulkState.action })
    setFailedBulkState(null)
  }

  /** Step 9: Navigate to previous employee in filteredTeam. */
  function goDrawerPrev() {
    if (!hasPrevEmployee) return
    drawerHadPendingRef.current = false
    setDrawerMember(filteredTeam[drawerIndex - 1])
    setActionId(null)
  }

  /** Step 9: Navigate to next employee in filteredTeam. */
  function goDrawerNext() {
    if (!hasNextEmployee) return
    drawerHadPendingRef.current = false
    setDrawerMember(filteredTeam[drawerIndex + 1])
    setActionId(null)
  }

  // ── Drawer action callbacks ───────────────────────────────────────────────
  function drawerApproveLeave(id: string) { setActionId(id); approveLeaveMutation.mutate(id) }
  function drawerRejectLeave(id: string)  { setActionId(id); rejectLeaveMutation.mutate(id) }
  function drawerApproveReg(id: string)   { setActionId(id); approveRegMutation.mutate(id) }
  function drawerRejectReg(id: string)    { setActionId(id); rejectRegMutation.mutate(id) }

  // ── Drawer pending items for the selected employee ────────────────────────
  const employeePendingLeave = drawerMember
    ? visibleLeave.filter(lr => lr.employees?.id === drawerMember.employee_id)
    : []
  const employeePendingReg = drawerMember
    ? visibleReg.filter(r => r.employees?.id === drawerMember.employee_id)
    : []

  // ── Effects ───────────────────────────────────────────────────────────────

  // Step 1: Clear selection when status filter changes.
  useEffect(() => {
    clearSelection()
  }, [statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Step 4: Record last-updated timestamp whenever fresh data arrives.
  useEffect(() => {
    if (!data) return
    const now = new Date()
    setLastUpdatedAt(now)
    setLastUpdatedLabel(relativeTime(now))
  }, [data])

  // Step 4: Keep the relative label fresh every 30 s.
  useEffect(() => {
    if (!lastUpdatedAt) return
    const id = setInterval(() => {
      setLastUpdatedLabel(relativeTime(lastUpdatedAt))
    }, 30_000)
    return () => clearInterval(id)
  }, [lastUpdatedAt])

  // Track whether the drawer employee had pending items when opened.
  const drawerHadPendingRef = useRef(false)

  useEffect(() => {
    if (drawerOpen && drawerMember) {
      if (employeePendingLeave.length + employeePendingReg.length > 0) {
        drawerHadPendingRef.current = true
      }
    } else {
      drawerHadPendingRef.current = false
    }
  }, [drawerOpen, drawerMember?.employee_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close drawer when the employee's last pending item is actioned.
  useEffect(() => {
    if (!drawerOpen || !drawerMember) return
    if (
      drawerHadPendingRef.current &&
      employeePendingLeave.length === 0 &&
      employeePendingReg.length   === 0
    ) {
      closeDrawer()
    }
  }, [drawerOpen, drawerMember, employeePendingLeave.length, employeePendingReg.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close drawer if team data refreshes and employee is no longer in the list.
  useEffect(() => {
    if (!drawerOpen || !drawerMember || team.length === 0 || isLoading) return
    const stillInTeam = team.some(m => m.employee_id === drawerMember.employee_id)
    if (!stillInTeam) closeDrawer()
  }, [team, drawerOpen, drawerMember, isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: Indeterminate "Select All" checkboxes.
  const selectAllLeaveRef = useRef<HTMLInputElement>(null)
  const selectAllRegRef   = useRef<HTMLInputElement>(null)
  const someLeaveSelected = visibleLeave.some(lr => selectedIds.has(lr.id)) && !allLeaveSelected
  const someRegSelected   = visibleReg.some(r   => selectedIds.has(r.id))   && !allRegSelected

  useEffect(() => {
    if (selectAllLeaveRef.current) selectAllLeaveRef.current.indeterminate = someLeaveSelected
  }, [someLeaveSelected])
  useEffect(() => {
    if (selectAllRegRef.current) selectAllRegRef.current.indeterminate = someRegSelected
  }, [someRegSelected])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Manager Dashboard"
        subtitle="Your team's attendance snapshot and pending approvals"
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={prevDay}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium text-foreground min-w-[140px] text-center">
              {new Date(`${date}T12:00:00Z`).toLocaleDateString([], {
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
              })}
            </span>
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={nextDay}
              disabled={date >= new Date().toISOString().slice(0, 10)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {/* Step 4: Last updated label + spinner uses isFetching */}
            <div className="flex items-center gap-1.5">
              {lastUpdatedLabel && !isFetching && (
                <span className="text-[10px] text-muted-foreground/60 hidden sm:block">
                  {lastUpdatedLabel}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => refetch()}
                disabled={isFetching}
                title={lastUpdatedAt ? `Last updated ${lastUpdatedLabel}` : 'Refresh'}
              >
                <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              </Button>
            </div>
          </div>
        }
      />

      {/* ── 1. Action Required banner ────────────────────────────────────────── */}
      {!isLoading && pendingCount > 0 && (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-primary/8 border border-primary/20">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15 flex-shrink-0">
            <Inbox className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {pendingCount} item{pendingCount !== 1 ? 's' : ''} require your approval
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {visibleLeave.length > 0 &&
                `${visibleLeave.length} leave request${visibleLeave.length !== 1 ? 's' : ''}`}
              {visibleLeave.length > 0 && visibleReg.length > 0 && ' · '}
              {visibleReg.length > 0 &&
                `${visibleReg.length} attendance correction${visibleReg.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-primary/30 text-primary hover:bg-primary/10 flex-shrink-0"
            onClick={() => {
              const el = document.getElementById('pending-approvals')
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            Review now
          </Button>
        </div>
      )}

      {/* ── 2. Quick Actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <QuickAction icon={BarChart2}     label="Muster Roll"    to="/admin/attendance/muster"         />
        <QuickAction icon={CalendarClock} label="Shift Roster"   to="/admin/roster"                    />
        <QuickAction icon={AlertTriangle} label="Anomalies"      to="/admin/attendance/anomalies"      />
        <QuickAction icon={ClipboardList} label="Regularisation" to="/admin/attendance/regularisation" />
      </div>

      {/* ── 2b. Operational Intelligence Strip ──────────────────────────────── */}
      {!isLoading && data && (
        <div className="flex flex-wrap items-stretch gap-2">
          {/* Coverage rate */}
          {coverageRate !== null && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs flex-1 min-w-[140px]',
              coverageRate.pct >= 90 ? 'bg-success/5 border-success/20'
              : coverageRate.pct >= 70 ? 'bg-warning/5 border-warning/20'
              : 'bg-destructive/5 border-destructive/20',
            )}>
              <UserCheck className={cn(
                'h-4 w-4 flex-shrink-0',
                coverageRate.pct >= 90 ? 'text-success'
                : coverageRate.pct >= 70 ? 'text-warning'
                : 'text-destructive',
              )} />
              <div>
                <p className="text-[10px] text-muted-foreground">Coverage</p>
                <p className={cn(
                  'font-bold tabular-nums',
                  coverageRate.pct >= 90 ? 'text-success'
                  : coverageRate.pct >= 70 ? 'text-warning'
                  : 'text-destructive',
                )}>{coverageRate.pct}%</p>
              </div>
              <span className="text-muted-foreground/50 text-[10px] ml-auto tabular-nums">
                {coverageRate.working}/{coverageRate.inScope}
              </span>
            </div>
          )}

          {/* Reliability */}
          {teamReliability.avg !== null && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs flex-1 min-w-[140px]',
              teamReliability.avg >= 85 ? 'bg-success/5 border-success/20'
              : teamReliability.avg >= 60 ? 'bg-warning/5 border-warning/20'
              : 'bg-destructive/5 border-destructive/20',
            )}>
              <Zap className={cn(
                'h-4 w-4 flex-shrink-0',
                teamReliability.avg >= 85 ? 'text-success'
                : teamReliability.avg >= 60 ? 'text-warning'
                : 'text-destructive',
              )} />
              <div>
                <p className="text-[10px] text-muted-foreground">Reliability</p>
                <p className={cn(
                  'font-bold tabular-nums',
                  teamReliability.avg >= 85 ? 'text-success'
                  : teamReliability.avg >= 60 ? 'text-warning'
                  : 'text-destructive',
                )}>{teamReliability.avg}/100</p>
              </div>
              <span className="text-muted-foreground/50 text-[10px] ml-auto tabular-nums">
                {teamReliability.total} scored
              </span>
            </div>
          )}

          {/* Approval queue age */}
          {queueIntelligence.total > 0 && (
            <div className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs flex-1 min-w-[160px]',
              queueIntelligence.avgAgeH >= 48 ? 'bg-destructive/5 border-destructive/20'
              : queueIntelligence.avgAgeH >= 24 ? 'bg-warning/5 border-warning/20'
              : 'bg-muted/30 border-border/40',
            )}>
              <Clock className={cn(
                'h-4 w-4 flex-shrink-0',
                queueIntelligence.avgAgeH >= 48 ? 'text-destructive'
                : queueIntelligence.avgAgeH >= 24 ? 'text-warning'
                : 'text-muted-foreground',
              )} />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">Avg queue age</p>
                <p className={cn(
                  'font-bold tabular-nums',
                  queueIntelligence.avgAgeH >= 48 ? 'text-destructive'
                  : queueIntelligence.avgAgeH >= 24 ? 'text-warning'
                  : 'text-foreground',
                )}>
                  {queueIntelligence.avgAgeH < 1
                    ? '<1h'
                    : `${Math.floor(queueIntelligence.avgAgeH)}h`}
                </p>
              </div>
              {queueIntelligence.oldest && (
                <span className="text-muted-foreground/50 text-[10px] ml-auto truncate max-w-[80px]"
                  title={`Oldest: ${queueIntelligence.oldest.name}`}>
                  {queueIntelligence.total} pending
                </span>
              )}
            </div>
          )}

          {/* Absence cluster warning */}
          {absenceCluster && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-destructive/5 border-destructive/20 text-xs flex-1 min-w-[160px]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-destructive" />
              <div>
                <p className="text-[10px] text-muted-foreground">Absence cluster</p>
                <p className="font-bold text-destructive">{absenceCluster.pct}% absent</p>
              </div>
              <span className="text-muted-foreground/50 text-[10px] ml-auto">{absenceCluster.count} employees</span>
            </div>
          )}
        </div>
      )}

      {/* ── 2d. Needs-Attention queue ────────────────────────────────────────── */}
      {!isLoading && needsAttentionItems.length > 0 && (
        <SectionCard
          title={`Needs Attention (${needsAttentionItems.length})`}
          icon={<Flame className="h-4 w-4 text-warning" />}
          description="Items that require immediate action or investigation"
        >
          <div className="space-y-1.5">
            {needsAttentionItems.slice(0, 8).map(item => {
              const severityIcon = item.severity === 'error'
                ? <Flame    className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                : item.severity === 'warning'
                  ? <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                  : <CircleDot     className="h-3.5 w-3.5 text-info flex-shrink-0"    />
              const bgClass = item.severity === 'error'
                ? 'bg-destructive/5 border-destructive/20'
                : item.severity === 'warning'
                  ? 'bg-warning/5 border-warning/20'
                  : 'bg-info/5 border-info/15'

              return (
                <div
                  key={item.key}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg border text-xs',
                    bgClass,
                  )}
                >
                  {severityIcon}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-foreground">
                      {item.label}
                    </span>
                    {item.code && (
                      <span className="text-muted-foreground font-mono ml-1 text-[10px]">#{item.code}</span>
                    )}
                    <span className="text-muted-foreground ml-1.5">{item.detail}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {item.employeeId && (
                      <Link
                        to={`/admin/attendance/forensics?employeeId=${item.employeeId}&date=${date}`}
                        className="text-[10px] px-2 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors whitespace-nowrap"
                        title="View forensics"
                      >
                        Forensics
                      </Link>
                    )}
                    {item.type === 'sla_breach' && item.itemId && (
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors whitespace-nowrap"
                        onClick={() => {
                          const el = document.getElementById('pending-approvals')
                          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                      >
                        Review
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {needsAttentionItems.length > 8 && (
              <p className="text-[10px] text-muted-foreground text-center py-1">
                + {needsAttentionItems.length - 8} more items
              </p>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── 3. Stat cards — clickable to filter team table ───────────────────── */}
      {/* Step 7: dim cards slightly during background refetch to signal stale data */}
      <div className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 transition-opacity duration-300', isRefetching && 'opacity-70')}>
        {isLoading ? (
          <>{Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}</>
        ) : (
          <>
            <StatCard
              icon={CheckCircle2} label="Present"
              value={summary?.present ?? 0}
              sub={summary?.late ? `incl. ${summary.late} late` : undefined}
              colorClass="text-success"
              active={statusFilter === 'present'}
              onClick={() => toggleStatusFilter('present')}
            />
            <StatCard
              icon={Clock}        label="Late"       value={summary?.late      ?? 0}
              colorClass="text-warning"
              active={statusFilter === 'late'}
              onClick={() => toggleStatusFilter('late')}
            />
            <StatCard
              icon={XCircle}      label="Absent"     value={summary?.absent    ?? 0}
              colorClass="text-destructive"
              active={statusFilter === 'absent'}
              onClick={() => toggleStatusFilter('absent')}
            />
            <StatCard
              icon={CalendarDays} label="On Leave"   value={summary?.leave     ?? 0}
              colorClass="text-info"
              active={statusFilter === 'leave'}
              onClick={() => toggleStatusFilter('leave')}
            />
            <StatCard
              icon={Users}        label="Not Marked" value={summary?.not_marked ?? 0}
              colorClass="text-muted-foreground"
              active={statusFilter === 'not_marked'}
              onClick={() => toggleStatusFilter('not_marked')}
            />
          </>
        )}
      </div>

      {/* ── 4. Pending Approvals ─────────────────────────────────────────────── */}
      <div id="pending-approvals" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-4">

        {/* Leave requests */}
        <SectionCard
          title={`Pending Leave (${isLoading ? '…' : visibleLeave.length})`}
          icon={<Inbox className="h-4 w-4 text-muted-foreground" />}
        >
          {isLoading ? (
            <div className="space-y-2">
              <SkeletonApprovalRow />
              <SkeletonApprovalRow />
            </div>
          ) : isError ? (
            <div className="py-6 text-center">
              <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-destructive/50" />
              <p className="text-xs text-muted-foreground mb-3">Failed to load requests.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry
              </Button>
            </div>
          ) : visibleLeave.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="h-7 w-7 mx-auto mb-2 text-success/50" />
              <p className="text-sm font-medium text-foreground">No pending leave requests</p>
              <p className="text-xs text-muted-foreground mt-0.5">All caught up!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1 pb-1.5 border-b border-border/40">
                <input
                  ref={selectAllLeaveRef}
                  type="checkbox"
                  id="select-all-leave"
                  checked={allLeaveSelected}
                  onChange={toggleSelectAllLeave}
                  disabled={bulkBusy}
                  className="h-3.5 w-3.5 rounded cursor-pointer accent-primary"
                />
                <label htmlFor="select-all-leave" className="text-[11px] text-muted-foreground cursor-pointer select-none">
                  Select all ({visibleLeave.length})
                </label>
              </div>
              {visibleLeave.map(lr => {
                const busy    = isBusy(lr.id)
                const checked = selectedIds.has(lr.id)
                const fading  = fadingIds.has(lr.id)  // Step 3
                const age     = slaAge(lr.created_at)
                return (
                  <div
                    key={lr.id}
                    className={cn(
                      'p-3 rounded-lg border border-border bg-card transition-all duration-200',
                      busy   ? 'opacity-60 pointer-events-none' : 'hover:border-border/80',
                      fading && 'opacity-0 pointer-events-none',  // Step 3
                      checked && !fading && 'border-primary/40 bg-primary/5',
                      age.critical && 'border-destructive/30',
                      !age.critical && age.breach && 'border-warning/30',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(lr.id)}
                        disabled={busy || bulkBusy}
                        className="h-3.5 w-3.5 rounded cursor-pointer accent-primary mt-1 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {lr.employees ? `${lr.employees.first_name} ${lr.employees.last_name}` : '—'}
                          </p>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            #{lr.employees?.employee_code}
                          </span>
                          {age.breach && (
                            <span className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                              age.critical
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-warning/10 text-warning',
                            )}>
                              {age.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <Badge variant="outline" className="rounded-full text-[10px] mr-1.5">
                            {lr.leave_types?.name ?? 'Leave'}
                          </Badge>
                          {fmtDate(lr.from_date)}
                          {lr.from_date !== lr.to_date && ` – ${fmtDate(lr.to_date)}`}
                          {' · '}{lr.computed_days} day{lr.computed_days !== 1 ? 's' : ''}
                        </p>
                        {lr.reason && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">"{lr.reason}"</p>
                        )}
                        {!age.breach && (
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{age.label}</p>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
                        <Button
                          size="sm"
                          className="h-7 text-xs px-2.5 min-w-[64px]"
                          disabled={anyActionPending || bulkBusy}
                          onClick={() => { setActionId(lr.id); approveLeaveMutation.mutate(lr.id) }}
                        >
                          {busy && approveLeaveMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2.5 min-w-[56px]"
                          disabled={anyActionPending || bulkBusy}
                          onClick={() => { setActionId(lr.id); rejectLeaveMutation.mutate(lr.id) }}
                        >
                          {busy && rejectLeaveMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : 'Reject'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>

        {/* Corrections / Regularisations */}
        <SectionCard
          title={`Pending Corrections (${isLoading ? '…' : visibleReg.length})`}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        >
          {isLoading ? (
            <div className="space-y-2">
              <SkeletonApprovalRow />
              <SkeletonApprovalRow />
            </div>
          ) : isError ? (
            <div className="py-6 text-center">
              <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-destructive/50" />
              <p className="text-xs text-muted-foreground mb-3">Failed to load corrections.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry
              </Button>
            </div>
          ) : visibleReg.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="h-7 w-7 mx-auto mb-2 text-success/50" />
              <p className="text-sm font-medium text-foreground">No pending correction requests</p>
              <p className="text-xs text-muted-foreground mt-0.5">All caught up!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1 pb-1.5 border-b border-border/40">
                <input
                  ref={selectAllRegRef}
                  type="checkbox"
                  id="select-all-reg"
                  checked={allRegSelected}
                  onChange={toggleSelectAllReg}
                  disabled={bulkBusy}
                  className="h-3.5 w-3.5 rounded cursor-pointer accent-primary"
                />
                <label htmlFor="select-all-reg" className="text-[11px] text-muted-foreground cursor-pointer select-none">
                  Select all ({visibleReg.length})
                </label>
              </div>
              {visibleReg.map(reg => {
                const busy    = isBusy(reg.id)
                const checked = selectedIds.has(reg.id)
                const fading  = fadingIds.has(reg.id)  // Step 3
                const age     = slaAge(reg.created_at)
                return (
                  <div
                    key={reg.id}
                    className={cn(
                      'p-3 rounded-lg border border-border bg-card transition-all duration-200',
                      busy   ? 'opacity-60 pointer-events-none' : 'hover:border-border/80',
                      fading && 'opacity-0 pointer-events-none',  // Step 3
                      checked && !fading && 'border-primary/40 bg-primary/5',
                      age.critical && 'border-destructive/30',
                      !age.critical && age.breach && 'border-warning/30',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(reg.id)}
                        disabled={busy || bulkBusy}
                        className="h-3.5 w-3.5 rounded cursor-pointer accent-primary mt-1 flex-shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {reg.employees ? `${reg.employees.first_name} ${reg.employees.last_name}` : '—'}
                          </p>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            #{reg.employees?.employee_code}
                          </span>
                          {age.breach && (
                            <span className={cn(
                              'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                              age.critical
                                ? 'bg-destructive/10 text-destructive'
                                : 'bg-warning/10 text-warning',
                            )}>
                              {age.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtDate(reg.date)}
                          {' · '}In: {fmtTime(reg.requested_check_in)}
                          {' · '}Out: {fmtTime(reg.requested_check_out)}
                        </p>
                        {reg.reason && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">"{reg.reason}"</p>
                        )}
                        {!age.breach && (
                          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{age.label}</p>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0 mt-0.5">
                        <Button
                          size="sm"
                          className="h-7 text-xs px-2.5 min-w-[64px]"
                          disabled={anyActionPending || bulkBusy}
                          onClick={() => { setActionId(reg.id); approveRegMutation.mutate(reg.id) }}
                        >
                          {busy && approveRegMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : 'Approve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2.5 min-w-[56px]"
                          disabled={anyActionPending || bulkBusy}
                          onClick={() => { setActionId(reg.id); rejectRegMutation.mutate(reg.id) }}
                        >
                          {busy && rejectRegMutation.isPending
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : 'Reject'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── 5. Alerts — clickable anomaly count ──────────────────────────────── */}
      {!isLoading && anomalyCount === 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-success/8 border border-success/15">
          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
          <p className="text-sm text-success font-medium">No unresolved anomalies — great!</p>
        </div>
      )}

      {!isLoading && anomalyCount > 0 && (
        <div
          className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/20 cursor-pointer hover:bg-warning/15 transition-colors group"
          onClick={() => navigate('/admin/attendance/anomalies')}
          title="View anomalies"
        >
          <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-warning">
              {anomalyCount} unresolved anomal{anomalyCount === 1 ? 'y' : 'ies'} detected
            </p>
            <p className="text-xs text-warning/70 mt-0.5">
              Resolve attendance anomalies to ensure accurate payroll calculation.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-warning/30 text-warning hover:bg-warning/10 flex-shrink-0 pointer-events-none"
            tabIndex={-1}
          >
            View Anomalies
            <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
          </Button>
        </div>
      )}

      {/* ── 6. Team Snapshot ─────────────────────────────────────────────────── */}
      <SectionCard
        title={
          statusFilter
            ? `Team Snapshot — ${STATUS_LABEL[statusFilter] ?? statusFilter} (${filteredTeam.length})`
            : `Team Snapshot (${summary?.total ?? 0})`
        }
        icon={<Users className="h-4 w-4 text-muted-foreground" />}
        description={statusFilter ? undefined : 'Click any row to view employee details'}
        action={
          statusFilter ? (
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs gap-1.5 text-muted-foreground"
              onClick={() => setStatusFilter(null)}
            >
              <X className="h-3 w-3" />Clear filter
            </Button>
          ) : undefined
        }
      >
        {isLoading && (
          <div className="overflow-x-auto -mx-4 -mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Late (min)'].map(h => (
                    <th key={h} className="text-left text-xs text-muted-foreground font-semibold px-4 py-2.5 whitespace-nowrap first:pl-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}</tbody>
            </table>
          </div>
        )}

        {isError && (
          <div className="py-10 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive/50" />
            <p className="text-sm font-medium text-foreground mb-1">Failed to load dashboard</p>
            <p className="text-xs text-muted-foreground mb-3">Check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && filteredTeam.length === 0 && (
          <div className="py-10 text-center">
            <UserCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            {statusFilter ? (
              <>
                <p className="text-sm text-muted-foreground">
                  No team members with status "{STATUS_LABEL[statusFilter] ?? statusFilter}".
                </p>
                <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setStatusFilter(null)}>
                  Clear filter
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">No direct reports found.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Your employee record must be set as the manager of other employees.
                </p>
              </>
            )}
          </div>
        )}

        {/* Phase 5 — Team reliability summary strip */}
        {!isLoading && !isError && teamReliability.avg !== null && (
          <div className="flex items-center gap-4 mb-3 p-3 rounded-md bg-muted/30 border border-border/40 text-xs">
            <div className="flex items-center gap-1.5">
              <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Today's Reliability</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-lg font-bold tabular-nums',
                teamReliability.avg >= 90 ? 'text-success' :
                teamReliability.avg >= 70 ? 'text-warning' :
                'text-destructive',
              )}>
                {teamReliability.avg}
              </span>
              <span className="text-muted-foreground">/100</span>
            </div>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  teamReliability.avg >= 90 ? 'bg-success' :
                  teamReliability.avg >= 70 ? 'bg-warning' :
                  'bg-destructive',
                )}
                style={{ width: `${teamReliability.avg}%` }}
              />
            </div>
            <span className="text-muted-foreground/70 whitespace-nowrap">
              {teamReliability.total} member{teamReliability.total !== 1 ? 's' : ''} scored
            </span>
          </div>
        )}

        {/* Step 7: keep table visible (not skeleton) during background refetch */}
        {!isLoading && !isError && filteredTeam.length > 0 && (
          <div className={cn('overflow-x-auto -mx-4 -mb-4 transition-opacity duration-300', isRefetching && 'opacity-70')}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Employee', 'Status', 'Check In', 'Check Out', 'Hours', 'Late (min)', 'Score', ''].map((h, i) => (
                    <th key={i} className="text-left text-xs text-muted-foreground font-semibold px-4 py-2.5 whitespace-nowrap first:pl-5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTeam.map(member => (
                  <tr
                    key={member.employee_id}
                    className={cn(
                      'border-b border-border/40 last:border-0 hover:bg-muted/25 transition-colors cursor-pointer',
                      drawerMember?.employee_id === member.employee_id && drawerOpen && 'bg-primary/5',
                    )}
                    onClick={() => openDrawer(member)}
                  >
                    <td className="px-4 py-2.5 pl-5">
                      <div>
                        <p className="font-medium text-foreground leading-none">{member.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{member.employee_code}</p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={(STATUS_BADGE[member.status] ?? 'outline') as any}
                        className="rounded-full text-[10px] capitalize whitespace-nowrap"
                      >
                        {STATUS_LABEL[member.status] ?? member.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{fmtTime(member.check_in)}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-muted-foreground">{fmtTime(member.check_out)}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {member.work_hours > 0
                        ? <span className="text-foreground">{member.work_hours}h</span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {member.late_minutes > 0
                        ? <span className="text-warning font-medium">{member.late_minutes}</span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    {/* Phase 5 — per-member reliability score */}
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {(() => {
                        const s = teamReliability.scored.find(r => r.employee_id === member.employee_id)
                        if (!s) return <span className="text-muted-foreground/40">—</span>
                        return (
                          <span className={cn(
                            'font-semibold tabular-nums',
                            s.score >= 90 ? 'text-success' :
                            s.score >= 70 ? 'text-warning' :
                            'text-destructive',
                          )}>
                            {s.score}
                          </span>
                        )
                      })()}
                    </td>
                    {/* Forensics deep-link — stops row click propagation */}
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <Link
                        to={`/admin/attendance/forensics?employeeId=${member.employee_id}&date=${date}`}
                        className="text-[10px] px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors whitespace-nowrap hidden sm:inline-block"
                        title={`Forensics for ${member.name} on ${date}`}
                      >
                        Forensics
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {!isLoading && team.length > 0 && !statusFilter && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <Zap className="h-3 w-3" />
          <span>Click any stat card to filter the team table. Click a team row to see details.</span>
        </div>
      )}

      {/* ── Employee side drawer ─────────────────────────────────────────────── */}
      <EmployeeDrawer
        employee={drawerMember}
        open={drawerOpen}
        onClose={closeDrawer}
        onNavigate={(id) => navigate(`/admin/employees/${id}`)}
        pendingLeave={employeePendingLeave}
        pendingReg={employeePendingReg}
        actionId={actionId}
        onApproveLeave={drawerApproveLeave}
        onRejectLeave={drawerRejectLeave}
        onApproveReg={drawerApproveReg}
        onRejectReg={drawerRejectReg}
        approveLeaveLoading={approveLeaveMutation.isPending}
        rejectLeaveLoading={rejectLeaveMutation.isPending}
        approveRegLoading={approveRegMutation.isPending}
        rejectRegLoading={rejectRegMutation.isPending}
        anyActionPending={anyActionPending}
        dialogOpen={!!confirmState}
        hasPrevEmployee={hasPrevEmployee}
        hasNextEmployee={hasNextEmployee}
        onPrevEmployee={goDrawerPrev}
        onNextEmployee={goDrawerNext}
      />

      {/* ── Sticky bulk action bar ────────────────────────────────────────────── */}
      {(effectiveSelected.size > 0 || failedBulkState !== null) && (
        <div className="sticky bottom-4 z-30 flex justify-center pointer-events-none">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-primary/30 shadow-lg ring-1 ring-primary/10 pointer-events-auto">

            {/* Step 8: enhanced selection count with type breakdown */}
            <div>
              <span className="text-sm font-semibold text-foreground">
                {effectiveSelected.size > 0 ? `${effectiveSelected.size} selected` : 'Bulk action'}
              </span>
              {effectiveSelected.size > 0 && (selectedLeaveCount > 0 || selectedRegCount > 0) && (
                <span className="text-xs text-muted-foreground ml-1.5">
                  (
                  {selectedLeaveCount > 0 && `${selectedLeaveCount} leave`}
                  {selectedLeaveCount > 0 && selectedRegCount > 0 && ', '}
                  {selectedRegCount   > 0 && `${selectedRegCount} correction${selectedRegCount !== 1 ? 's' : ''}`}
                  )
                </span>
              )}
            </div>

            {/* Step 6: Retry failed items button */}
            {failedBulkState !== null && failedBulkState.ids.length > 0 && (
              <>
                <div className="w-px h-4 bg-border" />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={handleRetryFailed}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : `Retry failed (${failedBulkState.ids.length})`}
                </Button>
              </>
            )}

            {effectiveSelected.size > 0 && (
              <>
                <div className="w-px h-4 bg-border" />
                <Button
                  size="sm" variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={clearSelection}
                  disabled={bulkBusy}
                >
                  Clear
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={handleBulkReject}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : `Reject (${effectiveSelected.size})`}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleBulkApprove}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : `Approve (${effectiveSelected.size})`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm dialog ────────────────────────────────────────────────────── */}
      <Dialog
        open={!!confirmState}
        onOpenChange={(open) => { if (!open && !bulkMutation.isPending) setConfirmState(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmState?.action === 'approve' ? 'Approve' : 'Reject'}{' '}
              {confirmState?.count} Request{confirmState && confirmState.count !== 1 ? 's' : ''}?
            </DialogTitle>
            <DialogDescription>
              {confirmState?.action === 'approve'
                ? `This will approve all ${confirmState?.count} selected request${confirmState && confirmState.count !== 1 ? 's' : ''}. This action cannot be undone.`
                : `This will reject all ${confirmState?.count} selected request${confirmState && confirmState.count !== 1 ? 's' : ''}. This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmState(null)}
              disabled={bulkMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant={confirmState?.action === 'approve' ? 'default' : 'destructive'}
              onClick={confirmBulkAction}
              disabled={bulkMutation.isPending}
            >
              {bulkMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Processing…</>
                : confirmState?.action === 'approve'
                  ? `Approve All (${confirmState?.count ?? 0})`
                  : `Reject All (${confirmState?.count ?? 0})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
