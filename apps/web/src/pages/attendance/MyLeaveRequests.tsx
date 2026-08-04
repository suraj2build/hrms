/**
 * MyLeaveRequests — /leave/my-requests
 *
 * Employee self-service leave request history.
 *
 * Features:
 *  · Table of all own leave requests with status badges
 *  · Status filter (All / Pending / Approved / Rejected / Cancelled)
 *  · Cancel button for PENDING requests (POST /leave/:id/cancel)
 *  · Pagination (page-based, 10 per page)
 *  · "Apply for Leave" shortcut in page header
 *
 * Design: design-system tokens only.
 */

import { useState }                                      from 'react'
import { Link }                                          from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  CalendarDays, Plus, Loader2, SearchX, AlertTriangle,
  ChevronLeft, ChevronRight, XCircle,
} from 'lucide-react'
import { toast }                                         from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn, fmtDate }   from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

interface LeaveType {
  id:      string
  name:    string
  is_paid: boolean
}

interface LeaveRequestItem {
  id:               string
  leave_type_id:    string
  from_date:        string
  to_date:          string
  computed_days:    number
  half_day:         boolean
  status:           LeaveStatus
  reason:           string | null
  rejection_reason: string | null
  created_at:       string
  leave_types:      LeaveType | null
}

interface MyRequestsResponse {
  data:       LeaveRequestItem[]
  pagination: { page: number; limit: number; has_more: boolean }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 10

const STATUS_BADGE: Record<LeaveStatus, { variant: 'success' | 'warning' | 'destructive' | 'secondary'; label: string }> = {
  PENDING:   { variant: 'warning',     label: 'Pending' },
  APPROVED:  { variant: 'success',     label: 'Approved' },
  REJECTED:  { variant: 'destructive', label: 'Rejected' },
  CANCELLED: { variant: 'secondary',   label: 'Cancelled' },
}

const STATUS_FILTERS: Array<{ value: '' | LeaveStatus; label: string }> = [
  { value: '',           label: 'All' },
  { value: 'PENDING',    label: 'Pending' },
  { value: 'APPROVED',   label: 'Approved' },
  { value: 'REJECTED',   label: 'Rejected' },
  { value: 'CANCELLED',  label: 'Cancelled' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDays(days: number, halfDay: boolean) {
  if (halfDay) return '0.5 day'
  return `${days} day${days !== 1 ? 's' : ''}`
}

// ── Pagination bar ────────────────────────────────────────────────────────────

function PaginationBar({
  page, hasMore, onPage,
}: { page: number; hasMore: boolean; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between pt-3 border-t border-border text-xs text-muted-foreground">
      <span>Page {page}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon" variant="ghost" className="h-7 w-7"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MyLeaveRequests() {
  const qc          = useQueryClient()
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null

  const [page,           setPage]           = useState(1)
  const [statusFilter,   setStatusFilter]   = useState<'' | LeaveStatus>('')
  const [cancellingId,   setCancellingId]   = useState<string | null>(null)
  const [confirmCancel,  setConfirmCancel]  = useState<string | null>(null)  // id to confirm

  // ── Query ───────────────────────────────────────────────────────────────────

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) })
  if (statusFilter) params.set('status', statusFilter)

  const { data, isLoading, isError, refetch } = useQuery<MyRequestsResponse>({
    queryKey: ['my-leave-requests', page, statusFilter],
    queryFn:  () => api.get(`/leave/my-requests?${params}`),
    enabled:  !!employeeId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const requests = data?.data ?? []
  const hasMore  = data?.pagination.has_more ?? false

  // ── Cancel mutation ─────────────────────────────────────────────────────────

  const { mutate: cancelRequest } = useMutation({
    mutationFn: (id: string) => api.post(`/leave/${id}/cancel`, {}),
    onMutate:   (id) => setCancellingId(id),
    onSuccess:  () => {
      toast.success('Leave request cancelled')
      qc.invalidateQueries({ queryKey: ['my-leave-requests'] })
      // Cancelling an approved leave restores the balance server-side —
      // EmployeeDashboard.tsx reads it under this same key.
      qc.invalidateQueries({ queryKey: ['leave-balance'] })
      setConfirmCancel(null)
    },
    onError:    (err: Error) => toast.error('Cancellation failed', { description: err.message }),
    onSettled:  () => setCancellingId(null),
  })

  function handleStatusChange(value: '' | LeaveStatus) {
    setStatusFilter(value)
    setPage(1)
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="My Leave Requests" />
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="My Leave Requests"
        subtitle="Track and manage your submitted leave requests"
        actions={
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/ess/leave/apply">
              <Plus className="h-3.5 w-3.5" />
              Apply for Leave
            </Link>
          </Button>
        }
      />

      <SectionCard
        title="Leave History"
        icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            {/* Status filter tabs */}
            <div className="flex items-center gap-0.5 bg-muted/40 rounded-lg p-0.5">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => handleStatusChange(f.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                    statusFilter === f.value
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        }
        noPadding
      >
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 justify-center py-12 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center gap-3 py-10 text-center p-6">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Failed to load requests</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && requests.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center p-6">
            <SearchX className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {statusFilter ? `No ${statusFilter.toLowerCase()} requests` : 'No leave requests yet'}
            </p>
            <p className="text-xs text-muted-foreground">
              {statusFilter
                ? 'Try a different filter above.'
                : 'Click "Apply for Leave" to submit your first request.'}
            </p>
            {!statusFilter && (
              <Button asChild size="sm" variant="outline">
                <Link to="/ess/leave/apply">Apply for Leave</Link>
              </Button>
            )}
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && requests.length > 0 && (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {['Leave Type', 'Date Range', 'Days', 'Reason', 'Status', 'Applied On', ''].map(h => (
                    <th key={h} className="text-left text-xs text-muted-foreground font-semibold px-4 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map(req => {
                  const badge   = STATUS_BADGE[req.status] ?? { variant: 'secondary' as const, label: req.status }
                  const isCanc  = cancellingId === req.id
                  const isConf  = confirmCancel === req.id

                  return (
                    <tr
                      key={req.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      {/* Leave type */}
                      <td className="px-4 py-3">
                        <div className="font-medium">{req.leave_types?.name ?? '—'}</div>
                        {req.leave_types && (
                          <Badge
                            variant={req.leave_types.is_paid ? 'success' : 'secondary'}
                            className="rounded-full text-[9px] mt-0.5"
                          >
                            {req.leave_types.is_paid ? 'Paid' : 'Unpaid'}
                          </Badge>
                        )}
                      </td>

                      {/* Date range */}
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium">{fmtDate(req.from_date)}</div>
                        {req.from_date !== req.to_date && (
                          <div className="text-muted-foreground">to {fmtDate(req.to_date)}</div>
                        )}
                      </td>

                      {/* Days */}
                      <td className="px-4 py-3">
                        <span className="font-semibold text-foreground">
                          {fmtDays(req.computed_days, req.half_day)}
                        </span>
                      </td>

                      {/* Reason */}
                      <td className="px-4 py-3 max-w-[80px] sm:max-w-[120px] lg:max-w-[200px]">
                        <p className="text-xs text-foreground truncate" title={req.reason ?? ''}>
                          {req.reason ?? <span className="text-muted-foreground">—</span>}
                        </p>
                        {req.rejection_reason && (
                          <p
                            className="text-[10px] text-destructive truncate mt-0.5"
                            title={req.rejection_reason}
                          >
                            Rejected: {req.rejection_reason}
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge variant={badge.variant} className="rounded-full text-[10px]">
                          {badge.label}
                        </Badge>
                      </td>

                      {/* Applied on */}
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(req.created_at.slice(0, 10))}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        {req.status === 'PENDING' && (
                          isConf ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Confirm?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-6 text-[10px] px-2"
                                disabled={isCanc}
                                onClick={() => cancelRequest(req.id)}
                              >
                                {isCanc
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : 'Yes, cancel'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] px-2"
                                onClick={() => setConfirmCancel(null)}
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                              onClick={() => setConfirmCancel(req.id)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Cancel
                            </Button>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="px-4 py-3">
              <PaginationBar
                page={page}
                hasMore={hasMore}
                onPage={setPage}
              />
            </div>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
