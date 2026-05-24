// REFERENCE IMPLEMENTATION — see docs/table-patterns.md
/**
 * AttendanceCorrections — /admin/attendance/corrections
 *
 * Admin / Manager view for reviewing attendance correction requests submitted
 * by employees. Unlike Regularisation (HR-only), corrections can also be
 * approved by the employee's direct manager.
 *
 * Access: super_admin, hr_admin, manager
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState }                                  from 'react'
import { useQuery, useMutation, useQueryClient }     from '@tanstack/react-query'
import {
  ClipboardEdit, ShieldAlert, CheckCircle2, XCircle,
  Loader2, CalendarDays, RefreshCw, Search,
  RotateCcw, AlertCircle, GitBranch, TrendingUp, Clock,
}                                                    from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { StatusStrip }      from '@/components/layout/StatusStrip'
import { PeriodLockBanner } from '@/components/layout/PeriodLockBanner'
import { Badge }            from '@/components/ui/badge'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { toast }            from 'sonner'
import { FormSection, FormActions, FieldHint } from '@/components/form'
import { usePeriodLock }    from '@/hooks/usePeriodLock'
import { ForensicsDrawer }  from '@/components/operational/ForensicsDrawer'

import {
  DataTable,
  TableToolbar,
  BulkActionBar,
  PaginationBar,
  EmptyTableState,
}                         from '@/components/table'
import type { DataTableColumn } from '@/components/table'

// ── Types ─────────────────────────────────────────────────────────────────────

// 'approved' is no longer a persisted state — rows move directly from
// pending → processing (async recompute in flight) → applied | failed.
type CorrectionStatus = 'pending' | 'processing' | 'applied' | 'failed' | 'rejected'

interface CorrectionRow {
  id:                     string
  date:                   string
  corrected_in:           string | null
  corrected_out:          string | null
  reason:                 string
  status:                 CorrectionStatus
  rejection_reason:       string | null
  created_at:             string
  approved_at:            string | null
  applied_at:             string | null
  processing_started_at:  string | null
  failure_reason:         string | null
  retry_count:            number
  employees: {
    id:            string
    first_name:    string
    last_name:     string
    employee_code: string
  }
}

interface CorrectionsResponse {
  data:  CorrectionRow[]
  total: number
}

interface StaleRow {
  id:                      string
  date:                    string
  processing_started_at:   string
  processing_duration_min: number
  retry_count:             number
  employee_id:             string | null
  employee_name:           string | null
  employee_code:           string | null
}

interface StaleResponse {
  data:                    StaleRow[]
  total:                   number
  stale_threshold_minutes: number
}

// ── Operational constants ─────────────────────────────────────────────────────

/** Maximum automatic retries before surfacing a "requires manual review" escalation */
const MAX_AUTO_RETRIES = 3

// ── ActionedItem — recently actioned trail ────────────────────────────────────

interface ActionedItem {
  id:           string
  employeeName: string
  date:         string
  type:         'approved' | 'rejected'
  timestamp:    Date
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_BADGE: Record<CorrectionStatus, 'warning' | 'success' | 'destructive' | 'outline' | 'secondary'> = {
  pending:    'warning',
  processing: 'secondary',
  applied:    'outline',
  failed:     'destructive',
  rejected:   'destructive',
}

/** Days elapsed since ISO date-string (date only, no time component) */
function ageDays(isoDate: string): number {
  return Math.floor((Date.now() - new Date(`${isoDate}T00:00:00`).getTime()) / 86_400_000)
}

/** Age badge variant for pending corrections by days old */
function pendingAgeVariant(days: number): 'destructive' | 'warning' | 'secondary' {
  if (days >= 7) return 'destructive'
  if (days >= 3) return 'warning'
  return 'secondary'
}

function pendingAgeLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return '1 day old'
  return `${days}d old`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Inline error row with retry affordance */
function ErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16">
      <p className="text-sm text-destructive">Failed to load correction requests</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  )
}

// ── Reject dialog (inline) ────────────────────────────────────────────────────

interface RejectPanelProps {
  correctionId: string
  onDone:   () => void
  onCancel: () => void
}

function RejectPanel({ correctionId, onDone, onCancel }: RejectPanelProps) {
  const qc                  = useQueryClient()
  const [reason, setReason] = useState('')

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.post(`/attendance/corrections/${correctionId}/reject`, {
        rejection_reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corrections'] })
      toast.success('Correction rejected')
      onDone()
    },
    onError: (e: Error) => toast.error('Rejection failed', { description: e.message }),
  })

  return (
    <div className="p-3 rounded-md border border-destructive/30 bg-destructive/5">
      <FormSection title="Rejection reason">
        <div>
          <Input
            className="h-7 text-xs"
            placeholder="e.g. Punch log confirms correct time"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <FieldHint message="Optional — leave blank to reject without a reason." />
        </div>
        <FormActions
          align="left"
          primary={{
            label: 'Confirm Reject',
            icon: XCircle,
            variant: 'outline',
            loading: rejectMutation.isPending,
            disabled: rejectMutation.isPending,
            onClick: () => rejectMutation.mutate(),
          }}
          cancel={{
            label: 'Cancel',
            onClick: onCancel,
          }}
        />
      </FormSection>
    </div>
  )
}

// ── Access denied state ────────────────────────────────────────────────────────

function AccessDeniedState() {
  return (
    <SectionCard>
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
        <p className="text-sm font-medium text-foreground">Access restricted</p>
        <p className="text-xs">Only managers and HR admins can review correction requests.</p>
      </div>
    </SectionCard>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AttendanceCorrections() {
  const { profile } = useAuthStore()
  const ALLOWED_ROLES = ['super_admin', 'hr_admin', 'manager']
  const HR_ROLES      = ['super_admin', 'hr_admin']
  const canAccess = profile?.role ? ALLOWED_ROLES.includes(profile.role) : false
  const canRetry  = profile?.role ? HR_ROLES.includes(profile.role)      : false

  const queryClient = useQueryClient()

  // ── Filters ────────────────────────────────────────────────────────────────
  const [statusFilter,  setStatusFilter]  = useState<CorrectionStatus | ''>('pending')
  const [dateFilter,    setDateFilter]    = useState('')
  const [appliedStatus, setAppliedStatus] = useState<CorrectionStatus | ''>('pending')
  const [appliedDate,   setAppliedDate]   = useState('')
  // Live employee search — applied client-side on current page rows
  const [employeeSearch, setEmployeeSearch] = useState('')

  // ── Pagination ─────────────────────────────────────────────────────────────
  const [page,     setPage]     = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // ── Selection ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Action state ───────────────────────────────────────────────────────────
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [retryingId,  setRetryingId]  = useState<string | null>(null)
  const [forensicsTarget, setForensicsTarget] = useState<{
    employeeId: string; date: string; employeeName?: string
  } | null>(null)

  // ── Bulk action dialogs ────────────────────────────────────────────────────
  const [bulkApproveOpen,  setBulkApproveOpen]  = useState(false)
  const [bulkRejectOpen,   setBulkRejectOpen]   = useState(false)
  const [bulkRejectReason, setBulkRejectReason] = useState('')

  // ── Recently actioned trail (capped at 5) ──────────────────────────────────
  const [recentlyActioned, setRecentlyActioned] = useState<ActionedItem[]>([])

  // ── Period lock ────────────────────────────────────────────────────────────
  const lockMonth = appliedDate
    ? appliedDate.slice(0, 7)
    : new Date().toISOString().slice(0, 7)
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(lockMonth)

  // ── Query: main corrections list ──────────────────────────────────────────
  const params = new URLSearchParams()
  if (appliedStatus) params.set('status', appliedStatus)
  if (appliedDate)   params.set('date',   appliedDate)
  params.set('limit', String(pageSize))
  params.set('offset', String((page - 1) * pageSize))

  const { data, isLoading, isError, refetch } = useQuery<CorrectionsResponse>({
    queryKey: ['corrections', appliedStatus, appliedDate, page, pageSize],
    queryFn:  () => api.get<CorrectionsResponse>(`/attendance/corrections?${params}`),
    enabled:  canAccess,
    staleTime: 30_000,
    // Auto-refresh every 8 s when any visible row is still recomputing so
    // approvers see applied/failed outcomes without a manual page refresh.
    refetchInterval: (query) => {
      const rows = (query.state.data as CorrectionsResponse | undefined)?.data ?? []
      return rows.some((r) => r.status === 'processing') ? 8_000 : false
    },
  })

  // ── Queries: operational health counts (HR only) ───────────────────────────
  const { data: processingData } = useQuery<CorrectionsResponse>({
    queryKey: ['corrections-count-processing'],
    queryFn:  () => api.get<CorrectionsResponse>('/attendance/corrections?status=processing&limit=1'),
    enabled:  canRetry,
    staleTime: 15_000,
    refetchInterval: 20_000,   // poll while page is open — processing rows change quickly
  })

  const { data: failedData } = useQuery<CorrectionsResponse>({
    queryKey: ['corrections-count-failed'],
    queryFn:  () => api.get<CorrectionsResponse>('/attendance/corrections?status=failed&limit=1'),
    enabled:  canRetry,
    staleTime: 30_000,
  })

  const { data: staleData, refetch: refetchStale } = useQuery<StaleResponse>({
    queryKey: ['corrections-stale'],
    queryFn:  () => api.get<StaleResponse>('/attendance/corrections/operations/stale'),
    enabled:  canRetry,
    staleTime: 60_000,
  })

  const processingCount = processingData?.total ?? 0
  const failedCount     = failedData?.total     ?? 0
  const staleCount      = staleData?.total       ?? 0

  const allRows = data?.data  ?? []
  const total   = data?.total ?? 0

  // Client-side employee name/code filter (live, no server round-trip)
  const rows = employeeSearch.trim()
    ? allRows.filter(r => {
        const q = employeeSearch.toLowerCase()
        const name = `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.toLowerCase()
        return name.includes(q) || (r.employees?.employee_code ?? '').toLowerCase().includes(q)
      })
    : allRows

  // Payroll impact: pending corrections with a corrected_in may flip absent→present (+1 payable day)
  const payrollImpactCount = rows.filter(r => r.status === 'pending' && !!r.corrected_in).length

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['corrections'] })
    queryClient.invalidateQueries({ queryKey: ['corrections-count-processing'] })
    queryClient.invalidateQueries({ queryKey: ['corrections-count-failed'] })
    queryClient.invalidateQueries({ queryKey: ['corrections-stale'] })
  }

  // ── Approve mutation ───────────────────────────────────────────────────────
  // Server responds immediately with status='processing'; recompute is async.
  const approveMutation = useMutation({
    mutationFn: (payload: { id: string; employeeName: string; date: string }) =>
      api.post(`/attendance/corrections/${payload.id}/approve`, {}),
    onSuccess: (_, payload) => {
      invalidateAll()
      setApprovingId(null)
      setRecentlyActioned(prev => ([{
        id: payload.id, employeeName: payload.employeeName,
        date: payload.date, type: 'approved' as const, timestamp: new Date(),
      }, ...prev] as ActionedItem[]).slice(0, 5))
      toast.success('Correction approved', {
        description: `${payload.employeeName} · ${fmtDate(payload.date)}`,
      })
    },
    onError: (e: Error) => {
      setApprovingId(null)
      toast.error('Approval failed', { description: e.message })
    },
  })

  // ── Retry mutation — HR only, resets failed → processing ─────────────────
  const retryMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/attendance/corrections/${id}/retry`, {}),
    onSuccess: () => {
      invalidateAll()
      setRetryingId(null)
      toast.success('Correction retry queued')
    },
    onError: (e: Error) => {
      setRetryingId(null)
      toast.error('Retry failed', { description: e.message })
    },
  })

  // ── Bulk approve mutation ──────────────────────────────────────────────────
  const bulkApproveMutation = useMutation({
    mutationFn: () =>
      Promise.all([...selectedIds].map(id =>
        api.post(`/attendance/corrections/${id}/approve`, {})
      )),
    onSuccess: () => {
      invalidateAll()
      const count = selectedIds.size
      setSelectedIds(new Set())
      setBulkApproveOpen(false)
      toast.success(`${count} correction${count !== 1 ? 's' : ''} approved`)
    },
    onError: (e: Error) => toast.error('Bulk approval failed', { description: e.message }),
  })

  // ── Bulk reject mutation ───────────────────────────────────────────────────
  const bulkRejectMutation = useMutation({
    mutationFn: () =>
      Promise.all([...selectedIds].map(id =>
        api.post(`/attendance/corrections/${id}/reject`, {
          rejection_reason: bulkRejectReason.trim() || undefined,
        })
      )),
    onSuccess: () => {
      invalidateAll()
      const count = selectedIds.size
      setSelectedIds(new Set())
      setBulkRejectOpen(false)
      setBulkRejectReason('')
      toast.success(`${count} correction${count !== 1 ? 's' : ''} rejected`)
    },
    onError: (e: Error) => toast.error('Bulk rejection failed', { description: e.message }),
  })

  function handleApprove(row: CorrectionRow) {
    setApprovingId(row.id)
    approveMutation.mutate({
      id:           row.id,
      employeeName: `${row.employees?.first_name ?? ''} ${row.employees?.last_name ?? ''}`.trim() || 'Employee',
      date:         row.date,
    })
  }

  function handleRetry(id: string) {
    setRetryingId(id)
    retryMutation.mutate(id)
  }

  function applyFilters() {
    setAppliedStatus(statusFilter)
    setAppliedDate(dateFilter)
    setPage(1)
  }

  function clearFilters() {
    setStatusFilter('pending')
    setDateFilter('')
    setAppliedStatus('pending')
    setAppliedDate('')
    setEmployeeSearch('')
    setPage(1)
  }

  function handleRemoveChip(key: string) {
    if (key === 'status') {
      setStatusFilter('pending')
      setAppliedStatus('pending')
    }
    if (key === 'date') {
      setDateFilter('')
      setAppliedDate('')
    }
    setPage(1)
  }

  const isFiltered = appliedStatus !== 'pending' || !!appliedDate

  // ── Filter chips ──────────────────────────────────────────────────────────
  const activeFilterChips: { key: string; label: string }[] = []
  if (appliedStatus && appliedStatus !== 'pending') {
    activeFilterChips.push({ key: 'status', label: `Status: ${appliedStatus}` })
  }
  if (appliedDate) {
    activeFilterChips.push({ key: 'date', label: `Date: ${appliedDate}` })
  }

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS: DataTableColumn<CorrectionRow>[] = [
    {
      id: 'employee',
      header: 'Employee',
      cell: (row) => {
        const empName = `${row.employees?.first_name ?? ''} ${row.employees?.last_name ?? ''}`.trim() || '—'
        const empCode = row.employees?.employee_code ?? ''
        return (
          <div>
            <p className="font-medium text-foreground leading-tight">{empName}</p>
            {empCode && (
              <p className="text-xs text-muted-foreground">{empCode}</p>
            )}
          </div>
        )
      },
    },
    {
      id: 'date',
      header: 'Date',
      cell: (row) => (
        <div className="flex items-center gap-1.5 text-foreground whitespace-nowrap">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          {fmtDate(row.date)}
        </div>
      ),
    },
    {
      id: 'corrected_in',
      header: 'Corrected In',
      cell: (row) => (
        <span className="whitespace-nowrap text-foreground">{fmtTime(row.corrected_in)}</span>
      ),
    },
    {
      id: 'corrected_out',
      header: 'Corrected Out',
      cell: (row) => (
        <span className="whitespace-nowrap text-foreground">{fmtTime(row.corrected_out)}</span>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (row) => (
        <p
          className="text-foreground text-xs line-clamp-2 max-w-[200px]"
          title={row.reason}
        >
          {row.reason}
        </p>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge
          variant={STATUS_BADGE[row.status]}
          className="rounded-full text-[10px] capitalize"
        >
          {row.status}
        </Badge>
      ),
    },
    {
      id: 'submitted',
      header: 'Submitted',
      cell: (row) => (
        <span className="whitespace-nowrap text-muted-foreground text-xs">
          {fmtDatetime(row.created_at)}
        </span>
      ),
    },
    {
      id: 'age',
      header: 'Age / SLA',
      cell: (row) => {
        if (row.status !== 'pending') return null
        const days = ageDays(row.date)
        return (
          <div className="flex flex-col gap-1">
            <Badge
              variant={pendingAgeVariant(days)}
              className="rounded-full text-[10px] px-1.5 whitespace-nowrap"
            >
              <Clock className="h-2.5 w-2.5 mr-0.5 inline-block" />
              {pendingAgeLabel(days)}
            </Badge>
            {/* Payroll impact signal — corrected_in present → may flip absent→present */}
            {row.corrected_in && (
              <div className="flex items-center gap-0.5 text-[10px] text-warning whitespace-nowrap">
                <TrendingUp className="h-2.5 w-2.5 flex-shrink-0" />
                <span>Payroll</span>
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      minWidth: '180px',
      cell: (row) => {
        const isApproving = approvingId === row.id
        const isRetrying  = retryingId  === row.id
        const isRejecting = rejectingId === row.id
        const maxRetriesReached = row.retry_count >= MAX_AUTO_RETRIES

        return (
          <div className={cn(
            'space-y-1',
            (isApproving || isRejecting || isRetrying) && 'opacity-60 pointer-events-none'
          )}>
            {/* Processing: async recompute in flight */}
            {row.status === 'processing' && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
                <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                Recomputing…
              </div>
            )}

            {/* Applied */}
            {row.status === 'applied' && (
              <span className="text-xs text-muted-foreground italic">
                Applied {fmtDatetime(row.applied_at)}
              </span>
            )}

            {/* Rejected */}
            {row.status === 'rejected' && (
              <span className="text-xs text-muted-foreground italic">
                Rejected{row.rejection_reason ? ` — ${row.rejection_reason}` : ''}
              </span>
            )}

            {/* Failed: show reason + retry count + Retry button (HR only) */}
            {row.status === 'failed' && (
              <div className="space-y-1.5">
                {row.failure_reason && (
                  <div className="flex items-start gap-1 text-[10px] text-destructive">
                    <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2" title={row.failure_reason}>
                      {row.failure_reason}
                    </span>
                  </div>
                )}
                {row.retry_count > 0 && !maxRetriesReached && (
                  <p className="text-[10px] text-muted-foreground">
                    Attempt {row.retry_count + 1}
                  </p>
                )}
                {maxRetriesReached ? (
                  <Badge variant="destructive" className="rounded-full text-[10px] px-1.5">
                    Max retries — manual review needed
                  </Badge>
                ) : canRetry && (
                  isRetrying ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-warning/40 text-warning hover:bg-warning/10"
                      onClick={() => handleRetry(row.id)}
                      disabled={!!approvingId || !!rejectingId}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  )
                )}
              </div>
            )}

            {/* Timeline deep-link — always available */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs gap-1 text-info hover:text-info hover:bg-info/10"
              title="Open attendance timeline"
              onClick={() => setForensicsTarget({
                employeeId:   row.employees.id,
                date:         row.date,
                employeeName: `${row.employees.first_name} ${row.employees.last_name}`.trim(),
              })}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Timeline</span>
            </Button>

            {/* Pending: approve / reject */}
            {row.status === 'pending' && (
              isApproving ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success/10"
                    onClick={() => handleApprove(row)}
                    disabled={!!rejectingId || periodLocked}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                  {!isRejecting && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={() => setRejectingId(row.id)}
                      disabled={!!approvingId}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Reject
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        )
      },
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Attendance', href: '/admin/attendance' }, { label: 'Corrections' }]}
        title="Corrections"
        subtitle="Employee-submitted punch corrections — approvable by managers or HR"
      />

      {/* Access guard */}
      {!canAccess && <AccessDeniedState />}

      {canAccess && (
        <>
          {/* Stale lock warning strip (HR only, actionable alert) */}
          {canRetry && staleCount > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/25 text-xs text-warning">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                <strong>{staleCount}</strong> correction{staleCount !== 1 ? 's' : ''} appear stuck in
                processing (&gt;15 min). They will be automatically marked failed on next check.{' '}
                <button className="underline hover:no-underline" onClick={() => refetchStale()}>
                  Recover now
                </button>
              </span>
            </div>
          )}

          {/* Forensics drawer — slides in when "Timeline" is clicked */}
          <ForensicsDrawer
            target={forensicsTarget}
            onClose={() => setForensicsTarget(null)}
          />

          <SectionCard
            title={isLoading ? 'Correction Requests' : `Correction Requests${total > 0 ? ` (${total})` : ''}`}
            icon={<ClipboardEdit className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1.5"
                onClick={() => refetch()}
                disabled={isLoading}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                Refresh
              </Button>
            }
            noPadding
          >
            {/* Operational summary strip (HR only) */}
            {canRetry && (
              <StatusStrip
                items={[
                  { label: 'Pending',    value: rows.filter(r => r.status === 'pending').length, variant: 'warning' },
                  { label: 'Processing', value: processingCount, variant: 'info',       hideWhenZero: true },
                  { label: 'Failed',     value: failedCount,     variant: 'destructive', hideWhenZero: true },
                  { label: 'Stale',      value: staleCount,      variant: 'warning',     hideWhenZero: true },
                ]}
              />
            )}

            {/* Toolbar */}
            <TableToolbar
              left={
                <>
                  {/* Live employee search */}
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search employee…"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      className="h-8 text-xs pl-7 w-44"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as CorrectionStatus | '')}
                    className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                  >
                    <option value="">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="applied">Applied</option>
                    <option value="failed">Failed</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <Input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="h-8 text-xs w-36"
                  />
                  <Button size="sm" className="h-8 text-xs" onClick={applyFilters}>
                    Apply
                  </Button>
                </>
              }
              right={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                  Refresh
                </Button>
              }
              filterChips={activeFilterChips}
              onRemoveChip={handleRemoveChip}
              onClearAllChips={clearFilters}
            />

            {/* Period lock banner */}
            {periodState !== 'OPEN' && (
              <div className="px-4 pb-0 pt-3">
                <PeriodLockBanner state={periodState} month={lockMonth} />
              </div>
            )}

            {/* Payroll impact signal — shown when pending+corrected_in rows exist */}
            {payrollImpactCount > 0 && appliedStatus === 'pending' && (
              <div className="mx-4 mt-2 flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-3 py-2">
                <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  <strong>{payrollImpactCount}</strong> pending correction{payrollImpactCount !== 1 ? 's' : ''} may change payable day count if approved.
                </span>
              </div>
            )}

            {/* Bulk action bar — shown when rows are selected */}
            {selectedIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                actions={[
                  {
                    id: 'approve',
                    label: 'Approve Selected',
                    icon: CheckCircle2,
                    onClick: () => setBulkApproveOpen(true),
                    loading: bulkApproveMutation.isPending,
                  },
                  {
                    id: 'reject',
                    label: 'Reject Selected',
                    icon: XCircle,
                    variant: 'destructive' as const,
                    onClick: () => setBulkRejectOpen(true),
                    loading: bulkRejectMutation.isPending,
                  },
                ]}
                onClearSelection={() => setSelectedIds(new Set())}
              />
            )}

            {/* Error state */}
            {isError && <ErrorRow onRetry={refetch} />}

            {/* Data table */}
            <DataTable<CorrectionRow>
              columns={COLUMNS}
              data={rows}
              getRowKey={(r) => r.id}
              loading={isLoading}
              skeletonRows={8}
              emptyState={
                <EmptyTableState
                  preset={isFiltered ? 'no-results' : 'no-corrections'}
                  title={isFiltered ? 'No matching requests' : undefined}
                  description={
                    isFiltered
                      ? 'Try adjusting your filters.'
                      : 'All correction requests have been reviewed.'
                  }
                  action={
                    isFiltered
                      ? (
                        <Button size="sm" variant="outline" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      )
                      : undefined
                  }
                />
              }
              selectable={true}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              getRowId={(r) => r.id}
              renderRowExpansion={(row) =>
                rejectingId === row.id
                  ? (
                    <RejectPanel
                      correctionId={row.id}
                      onDone={() => setRejectingId(null)}
                      onCancel={() => setRejectingId(null)}
                    />
                  )
                  : null
              }
            />

            {/* Pagination */}
            <PaginationBar
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            />

            {/* Recently actioned trail */}
            {recentlyActioned.length > 0 && (
              <div className="px-4 py-3 border-t border-border bg-muted/20">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" />
                  Recently Actioned
                </p>
                <div className="flex flex-wrap gap-2">
                  {recentlyActioned.map(item => (
                    <div
                      key={`${item.id}-${item.timestamp.getTime()}`}
                      className={cn(
                        'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border',
                        item.type === 'approved'
                          ? 'bg-success/10 border-success/20 text-success'
                          : 'bg-muted border-border text-muted-foreground',
                      )}
                    >
                      {item.type === 'approved'
                        ? <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0" />
                        : <XCircle className="h-2.5 w-2.5 flex-shrink-0" />}
                      <span className="font-medium">{item.employeeName}</span>
                      <span className="opacity-50">·</span>
                      <span>{fmtDate(item.date)}</span>
                      <span className="opacity-40 ml-0.5">
                        {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Bulk approve confirmation dialog ────────────────────────── */}
          {bulkApproveOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Approve {selectedIds.size} correction{selectedIds.size !== 1 ? 's' : ''}?
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Each correction will be queued for attendance recompute. This action cannot be undone.
                  </p>
                  {payrollImpactCount > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-2.5 py-1.5">
                      <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
                      {payrollImpactCount} correction{payrollImpactCount !== 1 ? 's' : ''} may increase payable day count.
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setBulkApproveOpen(false)}
                    disabled={bulkApproveMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1 bg-success hover:bg-success/90 text-success-foreground"
                    onClick={() => bulkApproveMutation.mutate()}
                    disabled={bulkApproveMutation.isPending}
                  >
                    {bulkApproveMutation.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Approving…</>
                      : <><CheckCircle2 className="h-3.5 w-3.5" /> Approve All</>}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Bulk reject dialog ───────────────────────────────────────── */}
          {bulkRejectOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Reject {selectedIds.size} correction{selectedIds.size !== 1 ? 's' : ''}?
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All selected corrections will be rejected. Employees will be notified.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Rejection reason <span className="font-normal opacity-60">(optional, shared for all)</span>
                  </label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Punch logs confirm correct times"
                    value={bulkRejectReason}
                    onChange={(e) => setBulkRejectReason(e.target.value)}
                    disabled={bulkRejectMutation.isPending}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => { setBulkRejectOpen(false); setBulkRejectReason('') }}
                    disabled={bulkRejectMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => bulkRejectMutation.mutate()}
                    disabled={bulkRejectMutation.isPending}
                  >
                    {bulkRejectMutation.isPending
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Rejecting…</>
                      : <><XCircle className="h-3.5 w-3.5" /> Reject All</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
