/**
 * ApprovalInbox — /approvals/inbox
 *
 * Manager & HR admin view showing ALL pending items requiring approval:
 *   - Leave requests (from leave_requests table)
 *   - Attendance regularisation corrections (from attendance_regularisation table)
 *
 * Access: any authenticated user. Backend filters by role:
 *   - HR admin / super_admin → ALL tenant-wide pending items
 *   - Manager → only direct-reports' pending items
 *   - Regular employee → empty lists (they have no reports)
 *
 * Design: design-system tokens only — no raw hex / bg-gray-* colors.
 */

import { useState, Fragment }                                        from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  Inbox, CheckCircle2, XCircle, Loader2,
  CalendarDays, Clock, Filter, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { ApprovalChainStepper } from '@/components/approvals/ApprovalChainStepper'
import { LeaveContextDrawer, type LeaveContextTarget } from '@/components/operational/LeaveContextDrawer'
import { RegularisationContextDrawer, type RegularisationContextTarget } from '@/components/operational/RegularisationContextDrawer'
import {
  IntelligenceLoadingSkeleton,
  IntelligenceEmptyState,
} from '@/components/ui/intelligence/index.js'
import { ManagerTeamOvertimeRequests } from '@/pages/manager/ManagerTeamOvertimeRequests'
import { ManagerTeamCompOff }          from '@/pages/manager/ManagerTeamCompOff'
import { ManagerLoanApprovals }        from '@/pages/manager/ManagerLoanApprovals'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveRequestItem {
  id:            string
  from_date:     string
  to_date:       string
  computed_days: number
  half_day:      boolean
  reason:        string | null
  status:        string
  created_at:    string
  leave_types:   { id: string; name: string; is_paid: boolean } | null
  employees:     { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface RegularisationItem {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  status:              string
  created_at:          string
  rejection_reason?:   string | null
  employees:           { id: string; first_name: string; last_name: string; employee_code: string } | null
}

interface PendingPagination {
  page:        number
  limit:       number
  leave_total: number
  reg_total:   number
}

interface PendingResponse {
  leave_requests:  LeaveRequestItem[]
  regularisations: RegularisationItem[]
  pagination:      PendingPagination
}

type FilterTab = 'all' | 'leave' | 'regularisation' | 'overtime' | 'comp-off' | 'loans'

const PAGE_LIMIT = 20

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function employeeName(emp: { first_name: string; last_name: string } | null) {
  if (!emp) return '—'
  return `${emp.first_name} ${emp.last_name}`
}

function ageDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function slaStatus(createdAt: string): { label: string; color: string } {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000
  if (hours > 48) return { label: 'SLA breach', color: 'text-destructive' }
  if (hours > 24) return { label: 'Near SLA',   color: 'text-warning dark:text-warning' }
  return                 { label: 'On time',     color: 'text-success dark:text-success' }
}

type SortOrder = 'none' | 'asc' | 'desc'

/** Sort items by submitted date. 'asc' = oldest first (most urgent), 'desc' = newest first. */
function sortByCreatedAt<T extends { created_at: string }>(items: T[], order: Exclude<SortOrder, 'none'>): T[] {
  return [...items].sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    return order === 'asc' ? diff : -diff
  })
}

function AgeBadge({ createdAt }: { createdAt: string }) {
  const days = ageDays(createdAt)
  if (days < 1) return null
  const variant = days >= 7 ? 'destructive' : days >= 3 ? 'warning' : 'secondary'
  return (
    <Badge variant={variant} className="rounded-full text-[9px] px-1.5 py-0 mt-0.5 whitespace-nowrap">
      {days}d ago
    </Badge>
  )
}


// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingState() {
  return <IntelligenceLoadingSkeleton rows={6} />
}

function EmptyState({ filter }: { filter: FilterTab }) {
  const titles: Record<FilterTab, string> = {
    all:            'No pending approvals',
    leave:          'No pending leave requests',
    regularisation: 'No pending regularisation requests',
    overtime:       'No pending overtime requests',
    'comp-off':     'No pending comp-off requests',
    loans:          'No pending loan or advance requests',
  }
  return (
    <IntelligenceEmptyState
      title={titles[filter]}
      description="All items have been reviewed."
    />
  )
}

// Rejection reason inline form — expanded per-row
function RejectionForm({
  onConfirm,
  onCancel,
  isPending,
}: {
  onConfirm: (reason: string) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="mt-2 space-y-2 p-3 rounded-md bg-muted/40 border border-border">
      <p className="text-xs font-medium text-muted-foreground">Rejection reason (optional)</p>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={2}
        placeholder="Briefly explain why this is being rejected…"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={() => onConfirm(reason)}
          disabled={isPending}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          Confirm Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Leave Requests Table ──────────────────────────────────────────────────────

function LeaveRequestsTable({
  items,
  onRefresh,
  onLeaveContext,
}: {
  items:          LeaveRequestItem[]
  onRefresh:      () => void
  onLeaveContext: (t: LeaveContextTarget) => void
}) {
  const queryClient = useQueryClient()
  const [actionRowId,   setActionRowId]   = useState<string | null>(null)
  const [rejectRowId,   setRejectRowId]   = useState<string | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/approve`, {}),
    onSuccess: (_, id) => {
      const item = items.find(i => i.id === id)
      toast.success('Leave request approved', {
        description: item ? `${employeeName(item.employees)} · ${fmtDate(item.from_date)}` : undefined,
      })
      setActionRowId(null)
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] })
      // Invalidate notification inbox — leave approval may generate an employee notification
      queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
      // Invalidate leave balance — approved leave reduces available balance
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] })
      // The employee's own ESS approvals tracker reads the same record.
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-leave'] })
      // The manager sidebar's persistent "Approvals" badge count aggregates
      // this same pending set under a separate key.
      queryClient.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
      onRefresh()
    },
    onError: (err: unknown) => {
      toast.error('Approval failed', { description: (err as Error).message })
      setActionRowId(null)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/leave-requests/${id}/reject`, { rejection_reason: reason || undefined }),
    onSuccess: (_, { id }) => {
      const item = items.find(i => i.id === id)
      toast.success('Leave request rejected', {
        description: item ? `${employeeName(item.employees)} · ${fmtDate(item.from_date)}` : undefined,
      })
      setActionRowId(null)
      setRejectRowId(null)
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] })
      // Invalidate notification inbox — rejection generates an employee notification
      queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-leave'] })
      queryClient.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
      onRefresh()
    },
    onError: (err: unknown) => {
      toast.error('Rejection failed', { description: (err as Error).message })
      setActionRowId(null)
    },
  })

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Employee', 'Leave Type', 'Period', 'Days', 'Reason', 'Submitted', 'Actions'].map(h => (
              <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(row => {
            const isActioning = actionRowId === row.id
            const isRejecting = rejectRowId === row.id
            const isExpanded  = expandedRowId === row.id

            return (
              <Fragment key={row.id}>
                <tr
                  className={cn(
                    'border-b border-border/50 transition-colors hover:bg-muted/30',
                    isActioning ? 'opacity-60 pointer-events-none' : 'cursor-pointer',
                  )}
                  title="View leave context — balance, team overlap & history"
                  onClick={() => row.employees?.id && onLeaveContext({
                    employeeId:   row.employees.id,
                    from:         row.from_date,
                    to:           row.to_date,
                    employeeName: employeeName(row.employees),
                  })}
                >
                  {/* Employee */}
                  <td className="py-2 px-3">
                    <p className="font-medium text-foreground leading-tight">
                      {employeeName(row.employees)}
                    </p>
                    {row.employees?.employee_code && (
                      <p className="text-[10px] text-muted-foreground">{row.employees.employee_code}</p>
                    )}
                  </td>

                  {/* Leave Type */}
                  <td className="py-2 px-3">
                    <div className="space-y-0.5">
                      <span className="text-xs font-medium text-foreground">
                        {row.leave_types?.name ?? '—'}
                      </span>
                      {row.leave_types && (
                        <div>
                          <Badge
                            variant={row.leave_types.is_paid ? 'success' : 'secondary'}
                            className="rounded-full text-[9px] px-1.5 py-0"
                          >
                            {row.leave_types.is_paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Period */}
                  <td className="py-2 px-3 whitespace-nowrap text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span>
                        {fmtDate(row.from_date)}
                        {row.from_date !== row.to_date && (
                          <> → {fmtDate(row.to_date)}</>
                        )}
                      </span>
                    </div>
                    {row.half_day && (
                      <span className="text-[10px] text-muted-foreground">Half day</span>
                    )}
                  </td>

                  {/* Days */}
                  <td className="py-2 px-3 text-center text-foreground font-medium text-sm">
                    {row.computed_days}
                  </td>

                  {/* Reason */}
                  <td className="py-2 px-3 max-w-[100px] sm:max-w-[150px] lg:max-w-[200px]">
                    {row.reason ? (
                      <button
                        className="text-left text-xs text-foreground line-clamp-2 hover:line-clamp-none"
                        title={row.reason}
                        onClick={(e) => { e.stopPropagation(); setExpandedRowId(isExpanded ? null : row.id) }}
                      >
                        {row.reason}
                        {row.reason.length > 60 && (
                          <span className="ml-1 text-muted-foreground">
                            {isExpanded ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Submitted */}
                  <td className="py-2 px-3 whitespace-nowrap text-muted-foreground text-xs">
                    <div>{fmtDatetime(row.created_at)}</div>
                    <AgeBadge createdAt={row.created_at} />
                    {(() => {
                      const sla = slaStatus(row.created_at)
                      return (
                        <span className={cn('text-[10px] font-medium', sla.color)}>
                          {sla.label}
                        </span>
                      )
                    })()}
                  </td>

                  {/* Actions */}
                  <td className="py-2 px-3">
                    {isActioning ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success/10"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActionRowId(row.id)
                            setRejectRowId(null)
                            approveMutation.mutate(row.id)
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); setRejectRowId(isRejecting ? null : row.id) }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Expanded approval-chain row (multi-level chains only) */}
                {isExpanded && (
                  <tr className="border-b border-border/50 bg-muted/10">
                    <td colSpan={7} className="px-3 pb-2 pt-0">
                      <ApprovalChainStepper entityType="leave_request" entityId={row.id} />
                    </td>
                  </tr>
                )}

                {/* Inline rejection form row */}
                {isRejecting && !isActioning && (
                  <tr className="border-b border-border/50 bg-muted/10">
                    <td colSpan={7} className="px-3 pb-3">
                      <RejectionForm
                        isPending={rejectMutation.isPending}
                        onConfirm={(reason) => {
                          setActionRowId(row.id)
                          rejectMutation.mutate({ id: row.id, reason })
                        }}
                        onCancel={() => setRejectRowId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Regularisation Table ──────────────────────────────────────────────────────

function RegularisationTable({
  items,
  onRefresh,
  onRegContext,
}: {
  items:        RegularisationItem[]
  onRefresh:    () => void
  onRegContext: (t: RegularisationContextTarget) => void
}) {
  const queryClient = useQueryClient()
  const [actionRowId,   setActionRowId]   = useState<string | null>(null)
  const [rejectRowId,   setRejectRowId]   = useState<string | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: (_, id) => {
      const item = items.find(i => i.id === id)
      toast.success('Correction approved', {
        description: item ? `${employeeName(item.employees)} · ${fmtDate(item.date)}` : undefined,
      })
      setActionRowId(null)
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      // Invalidate notification inbox — attendance correction approval generates employee notification
      queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
      // The employee's own ESS approvals tracker reads the same record.
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      queryClient.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
      onRefresh()
    },
    onError: (err: unknown) => {
      toast.error('Approval failed', { description: (err as Error).message })
      setActionRowId(null)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/attendance/regularisation/${id}/reject`, { rejection_reason: reason || undefined }),
    onSuccess: (_, { id }) => {
      const item = items.find(i => i.id === id)
      toast.success('Correction rejected', {
        description: item ? `${employeeName(item.employees)} · ${fmtDate(item.date)}` : undefined,
      })
      setActionRowId(null)
      setRejectRowId(null)
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      // Invalidate notification inbox — rejection generates employee notification
      queryClient.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      queryClient.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
      onRefresh()
    },
    onError: (err: unknown) => {
      toast.error('Rejection failed', { description: (err as Error).message })
      setActionRowId(null)
    },
  })

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Employee', 'Date', 'Requested In', 'Requested Out', 'Reason', 'Submitted', 'Actions'].map(h => (
              <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(row => {
            const isActioning = actionRowId === row.id
            const isRejecting = rejectRowId === row.id
            const isExpanded  = expandedRowId === row.id

            return (
              <Fragment key={row.id}>
                <tr
                  className={cn(
                    'border-b border-border/50 transition-colors hover:bg-muted/30',
                    isActioning ? 'opacity-60 pointer-events-none' : 'cursor-pointer',
                  )}
                  title="View regularisation context — attendance trend & history"
                  onClick={() => row.employees?.id && onRegContext({
                    employeeId:   row.employees.id,
                    date:         row.date,
                    employeeName: employeeName(row.employees),
                    requestedIn:  row.requested_check_in,
                    requestedOut: row.requested_check_out,
                    reason:       row.reason,
                  })}
                >
                  {/* Employee — Q4: payroll badge · Q7: rejection reason */}
                  <td className="py-2 px-3">
                    <p className="font-medium text-foreground leading-tight">
                      {employeeName(row.employees)}
                    </p>
                    {row.employees?.employee_code && (
                      <p className="text-[10px] text-muted-foreground">{row.employees.employee_code}</p>
                    )}
                    {/* Q4 — payroll impact signal: adding a check-in flips absent→present */}
                    {row.requested_check_in && (
                      <div className="mt-0.5">
                        <Badge variant="warning" className="rounded-full text-[9px] px-1.5 py-0 gap-0.5">
                          <TrendingUp className="h-2.5 w-2.5" />
                          Payroll
                        </Badge>
                      </div>
                    )}
                    {/* Q7 — rejection reason (defensive: pending items normally have none) */}
                    {row.rejection_reason && (
                      <p className="text-[10px] text-muted-foreground/70 italic mt-0.5 leading-tight">
                        Rejected: {row.rejection_reason}
                      </p>
                    )}
                  </td>

                  {/* Date */}
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs text-foreground">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      {fmtDate(row.date)}
                    </div>
                  </td>

                  {/* Requested In */}
                  <td className="py-2 px-3 whitespace-nowrap text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {fmtTime(row.requested_check_in)}
                    </div>
                  </td>

                  {/* Requested Out */}
                  <td className="py-2 px-3 whitespace-nowrap text-xs text-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {fmtTime(row.requested_check_out)}
                    </div>
                  </td>

                  {/* Reason — Q7: expandable on hover/click (mirrors LeaveRequestsTable) */}
                  <td className="py-2 px-3 max-w-[100px] sm:max-w-[150px] lg:max-w-[200px]">
                    {row.reason ? (
                      <button
                        className="text-left text-xs text-foreground line-clamp-2 hover:line-clamp-none"
                        title={row.reason}
                        onClick={(e) => { e.stopPropagation(); setExpandedRowId(isExpanded ? null : row.id) }}
                      >
                        {row.reason}
                        {row.reason.length > 60 && (
                          <span className="ml-1 text-muted-foreground">
                            {isExpanded
                              ? <ChevronUp   className="inline h-3 w-3" />
                              : <ChevronDown className="inline h-3 w-3" />}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Submitted */}
                  <td className="py-2 px-3 whitespace-nowrap text-muted-foreground text-xs">
                    <div>{fmtDatetime(row.created_at)}</div>
                    <AgeBadge createdAt={row.created_at} />
                    {(() => {
                      const sla = slaStatus(row.created_at)
                      return (
                        <span className={cn('text-[10px] font-medium', sla.color)}>
                          {sla.label}
                        </span>
                      )
                    })()}
                  </td>

                  {/* Actions */}
                  <td className="py-2 px-3">
                    {isActioning ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success/10"
                          onClick={(e) => {
                            e.stopPropagation()
                            setActionRowId(row.id)
                            setRejectRowId(null)
                            approveMutation.mutate(row.id)
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={(e) => { e.stopPropagation(); setRejectRowId(isRejecting ? null : row.id) }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>

                {/* Expanded approval-chain row (multi-level chains only) */}
                {isExpanded && (
                  <tr className="border-b border-border/50 bg-muted/10">
                    <td colSpan={7} className="px-3 pb-2 pt-0">
                      <ApprovalChainStepper entityType="attendance_regularisation" entityId={row.id} />
                    </td>
                  </tr>
                )}

                {/* Inline rejection form */}
                {isRejecting && !isActioning && (
                  <tr className="border-b border-border/50 bg-muted/10">
                    <td colSpan={7} className="px-3 pb-3">
                      <RejectionForm
                        isPending={rejectMutation.isPending}
                        onConfirm={(reason) => {
                          setActionRowId(row.id)
                          rejectMutation.mutate({ id: row.id, reason })
                        }}
                        onCancel={() => setRejectRowId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Pagination bar ─────────────────────────────────────────────────────────────

function PaginationBar({
  page,
  limit,
  total,
  onPage,
  label,
}: {
  page:   number
  limit:  number
  total:  number
  onPage: (n: number) => void
  label:  string
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  if (totalPages <= 1) return null
  const from = (page - 1) * limit + 1
  const to   = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
      <span>{from}–{to} of {total} {label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 tabular-nums">{page} / {totalPages}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ApprovalInbox() {
  const [activeTab,  setActiveTab]  = useState<FilterTab>('all')
  const [leavePage,  setLeavePage]  = useState(1)
  const [regPage,    setRegPage]    = useState(1)
  // Q3 — sort-by-age: cycles none → asc (oldest first) → desc (newest first)
  const [sortOrder,       setSortOrder]       = useState<SortOrder>('none')
  // Regularisation-context drawer target; null = closed (regularisation tab)
  const [regContextTarget, setRegContextTarget] = useState<RegularisationContextTarget | null>(null)
  // Leave-context drawer target; null = closed (leave tab)
  const [leaveContextTarget, setLeaveContextTarget] = useState<LeaveContextTarget | null>(null)

  // Reset pages when switching tabs
  function switchTab(tab: FilterTab) {
    setActiveTab(tab)
    setLeavePage(1)
    setRegPage(1)
  }

  function cycleSortOrder() {
    setSortOrder(prev =>
      prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'
    )
  }

  // Use whichever page is appropriate for the active tab
  const page = activeTab === 'regularisation' ? regPage : leavePage

  const { data, isLoading, isError, refetch } = useQuery<PendingResponse>({
    queryKey: ['approvals-pending', page],
    queryFn:  () => api.get<PendingResponse>(`/approvals/pending?page=${page}&limit=${PAGE_LIMIT}`),
    staleTime:       30_000,
    placeholderData: keepPreviousData,   // H3: v5 API — holds previous page data during page transitions
  })

  const leaveItems   = data?.leave_requests  ?? []
  const regItems     = data?.regularisations ?? []
  const pagination   = data?.pagination

  const leaveTotal   = pagination?.leave_total ?? leaveItems.length
  const regTotal     = pagination?.reg_total   ?? regItems.length
  const totalPending = leaveTotal + regTotal

  // Pending counts for the embedded approval tabs. Same query keys as the panels
  // so the cache is shared (no double-fetch); any error degrades to 0.
  const { data: otData } = useQuery<{ data?: unknown[] }>({
    queryKey:  ['manager-team-overtime', 'pending'],
    queryFn:   () => api.get('/overtime/requests?status=PENDING'),
    staleTime: 30_000,
  })
  const overtimeCount = (otData?.data ?? []).length

  const { data: coData } = useQuery<{ data?: unknown[] }>({
    queryKey:  ['manager-team-compoff', 'pending'],
    queryFn:   () => api.get('/attendance/comp-off?status=pending'),
    staleTime: 30_000,
  })
  const compOffCount = (coData?.data ?? []).length

  const { data: loanData } = useQuery<{ advances?: unknown[]; loans?: unknown[] }>({
    queryKey:  ['manager-loan-pending'],
    queryFn:   () => api.get('/payroll/ess/manager/pending'),
    staleTime: 30_000,
  })
  const loansCount = (loanData?.advances ?? []).length + (loanData?.loans ?? []).length

  const showLeave = activeTab === 'all' || activeTab === 'leave'
  const showReg   = activeTab === 'all' || activeTab === 'regularisation'

  const filteredLeave = showLeave ? leaveItems : []
  const filteredReg   = showReg   ? regItems   : []
  const filteredTotal = filteredLeave.length + filteredReg.length

  // Q3 — apply age sort for display; counts remain based on unsorted originals
  const displayLeave = sortOrder !== 'none' ? sortByCreatedAt(filteredLeave, sortOrder) : filteredLeave
  const displayReg   = sortOrder !== 'none' ? sortByCreatedAt(filteredReg,   sortOrder) : filteredReg

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all',            label: 'All',            count: totalPending },
    { key: 'leave',          label: 'Leave',          count: leaveTotal },
    { key: 'regularisation', label: 'Regularisation', count: regTotal },
    { key: 'overtime',       label: 'Overtime',       count: overtimeCount },
    { key: 'comp-off',       label: 'Comp-Off',       count: compOffCount },
    { key: 'loans',          label: 'Loans',          count: loansCount },
  ]

  // The three new tabs embed the dedicated manager approval pages; the
  // leave/regularisation lists, SLA sort and pagination apply only to the
  // built-in approval types below.
  const isEmbeddedTab = activeTab === 'overtime' || activeTab === 'comp-off' || activeTab === 'loans'

  return (
    <PageContainer>
      {/* Q1 — breadcrumb back to Operations Center */}
      <PageHeader
        breadcrumb={[
          { label: 'Attendance Operations', href: '/admin/attendance/center' },
          { label: 'Approval Inbox' },
        ]}
        title="Approval Inbox"
        subtitle="Review and action pending approvals from your team"
      />

      {/* Filter tabs + Q3 sort-by-age toggle */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg">
          <Filter className="h-3.5 w-3.5 text-muted-foreground ml-1.5 mr-0.5 flex-shrink-0" />
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5',
                activeTab === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 py-0 text-[10px] font-semibold',
                  activeTab === tab.key
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Q3 — sort-by-age button; active state lights up in primary.
            Only applies to the built-in leave/regularisation lists. */}
        {!isEmbeddedTab && (
        <button
          onClick={cycleSortOrder}
          title={
            sortOrder === 'none' ? 'Sort by submission age'
            : sortOrder === 'asc' ? 'Oldest first — click for newest first'
            : 'Newest first — click to clear sort'
          }
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors',
            sortOrder === 'none'
              ? 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
              : 'border-primary/30 text-primary bg-primary/[0.06] hover:bg-primary/[0.10]',
          )}
        >
          {sortOrder === 'asc'  ? <ArrowUp   className="h-3.5 w-3.5" /> :
           sortOrder === 'desc' ? <ArrowDown className="h-3.5 w-3.5" /> :
                                  <ArrowUpDown className="h-3.5 w-3.5" />}
          {sortOrder === 'asc' ? 'Oldest first' : sortOrder === 'desc' ? 'Newest first' : 'Age'}
        </button>
        )}
      </div>

      {/* Embedded manager approval pages — overtime / comp-off / loans */}
      {activeTab === 'overtime' && <ManagerTeamOvertimeRequests embedded />}
      {activeTab === 'comp-off' && <ManagerTeamCompOff embedded />}
      {activeTab === 'loans'    && <ManagerLoanApprovals embedded />}

      {/* Loading */}
      {!isEmbeddedTab && isLoading && (
        <SectionCard>
          <LoadingState />
        </SectionCard>
      )}

      {/* Error */}
      {!isEmbeddedTab && isError && !isLoading && (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-16">
            <p className="text-sm text-destructive">Failed to load pending approvals</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        </SectionCard>
      )}

      {/* Empty state */}
      {!isEmbeddedTab && !isLoading && !isError && filteredTotal === 0 && (
        <SectionCard>
          <EmptyState filter={activeTab} />
        </SectionCard>
      )}

      {/* Leave Requests section */}
      {!isEmbeddedTab && !isLoading && !isError && showLeave && filteredLeave.length > 0 && (
        <SectionCard
          title={`Leave Requests (${leaveTotal})`}
          icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
          action={
            <div className="flex items-center gap-2">
              <Badge variant="warning" className="rounded-full text-[10px]">
                {leaveTotal} pending
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()}>
                Refresh
              </Button>
            </div>
          }
        >
          <LeaveRequestsTable items={displayLeave} onRefresh={refetch} onLeaveContext={t => setLeaveContextTarget(t)} />

          <PaginationBar
            page={leavePage}
            limit={PAGE_LIMIT}
            total={leaveTotal}
            onPage={setLeavePage}
            label="leave requests"
          />
        </SectionCard>
      )}

      {/* Regularisation section */}
      {!isLoading && !isError && showReg && (regTotal > 0 || filteredReg.length > 0) && (
        <SectionCard
          title={`Attendance Corrections (${regTotal})`}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          action={
            <div className="flex items-center gap-2">
              <Badge variant="warning" className="rounded-full text-[10px]">
                {regTotal} pending
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()}>
                Refresh
              </Button>
            </div>
          }
        >
          <RegularisationTable items={displayReg} onRefresh={refetch} onRegContext={t => setRegContextTarget(t)} />

          <PaginationBar
            page={regPage}
            limit={PAGE_LIMIT}
            total={regTotal}
            onPage={setRegPage}
            label="corrections"
          />
        </SectionCard>
      )}

      {/* Summary footer when showing all */}
      {!isLoading && !isError && totalPending > 0 && activeTab === 'all' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Inbox className="h-3.5 w-3.5" />
          <span>
            {totalPending} item{totalPending !== 1 ? 's' : ''} pending your review
            {' '}·{' '}
            {leaveTotal} leave · {regTotal} regularisation
          </span>
        </div>
      )}

      {/* Regularisation-context drawer — attendance trend, current record & history */}
      <RegularisationContextDrawer
        target={regContextTarget}
        onClose={() => setRegContextTarget(null)}
      />

      {/* Leave-context drawer — leave tab (balance, team overlap & history) */}
      <LeaveContextDrawer
        target={leaveContextTarget}
        onClose={() => setLeaveContextTarget(null)}
      />
    </PageContainer>
  )
}
