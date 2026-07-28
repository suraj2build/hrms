/**
 * RegularisationApproval — /attendance/regularisation
 *
 * HR governance layer: SLA-tracked approval, escalation, and payroll auditability.
 * Live attendance exception handling workflow with operational continuity features.
 *
 * Features:
 *  - 6-column DataTable (consolidated from 9)
 *  - Employee search (live, client-side)
 *  - Per-row payroll impact signal (derived from requested_check_in)
 *  - Bulk approve with governance confirmation dialog
 *  - Bulk reject with reason dialog
 *  - Recently actioned trail (last 5 single actions)
 *  - StatusStrip: pending + aging buckets + payroll impact count
 *  - SLA tracking, breach detection, policy configuration
 *
 * Access: hr_admin and super_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useEffect, useRef }  from 'react'
import type { ReactNode }              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                from 'sonner'
import {
  FileEdit, ShieldAlert, CheckCircle2, XCircle,
  Loader2, CalendarDays, CalendarRange, RefreshCw,
  Clock, Eye, ArrowRight, AlertTriangle, Settings2, GitBranch,
  Search, TrendingUp,
} from 'lucide-react'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { StatusStrip }      from '@/components/layout'
import { PeriodLockBanner } from '@/components/layout/PeriodLockBanner'
import { Badge }            from '@/components/ui/badge'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { DateInput }        from '@/components/ui/date-input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { ForensicsDrawer }   from '@/components/operational/ForensicsDrawer'
import {
  AttendanceDiff,
  DiffWarningBanner,
} from '@/components/operational/AttendanceDiff'
import type { AttendanceSnapshot } from '@/components/operational/AttendanceDiff'
import { cn }               from '@/lib/utils'
import { usePeriodLock }    from '@/hooks/usePeriodLock'
import {
  DataTable,
  TableToolbar,
  BulkActionBar,
  PaginationBar,
  EmptyTableState,
} from '@/components/table'
import type { DataTableColumn } from '@/components/table'
import type { StripItem } from '@/components/layout'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PendingRequest {
  id:                  string
  date:                string
  requested_check_in:  string | null
  requested_check_out: string | null
  reason:              string
  status:              'pending' | 'approved' | 'rejected'
  rejection_reason:    string | null
  sla_deadline:        string | null
  sla_breached:        boolean
  hours_remaining:     number | null
  created_at:          string
  approved_at:         string | null
  employee_id:         string | null
  employee_name:       string | null
  employee_code:       string | null
}

interface RegPolicy {
  id:                       string
  submission_window_days:   number
  max_per_month:            number
  sla_hours:                number
  auto_reject_on_sla_breach: boolean
  sla_breach_notify:        string | null
  limit_period:             'week' | 'month' | 'quarter' | 'year'
  exclude_rejected:         boolean
  per_type_limits:          Record<string, number>
}

// Employee-facing regularisation types eligible for per-type caps.
const REG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'missed_punch',    label: 'Missed punch' },
  { value: 'forgot_checkout', label: 'Forgot checkout' },
  { value: 'onsite_duty',     label: 'Onsite duty' },
  { value: 'biometric_issue', label: 'Biometric issue' },
  { value: 'client_visit',    label: 'Client visit' },
  { value: 'wfh',             label: 'Work from home' },
  { value: 'field_work',      label: 'Field work' },
  { value: 'system_issue',    label: 'System issue' },
]

const LIMIT_PERIOD_OPTIONS: { value: RegPolicy['limit_period']; label: string }[] = [
  { value: 'week',    label: 'Per week' },
  { value: 'month',   label: 'Per month' },
  { value: 'quarter', label: 'Per quarter' },
  { value: 'year',    label: 'Per year' },
]

interface DailyRecord {
  id:              string
  date:            string
  status:          string
  work_hours:      number
  late_minutes:    number
  overtime_minutes: number
  is_payable?:     boolean | null
}

interface AttendanceResp {
  daily: DailyRecord[]
  logs:  Array<{ id: string; check_in: string | null; check_out: string | null }>
}

interface ActionedItem {
  id:           string
  employeeName: string | null
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
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
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

/** Returns number of whole days elapsed since `iso` timestamp */
function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

type BadgeVariant = 'default' | 'secondary' | 'warning' | 'destructive' | 'outline' | 'success'

function ageBadgeVariant(days: number): BadgeVariant {
  if (days >= 3) return 'destructive'
  if (days >= 1) return 'warning'
  return 'secondary'
}

function ageLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

/** Format hours remaining into a human label */
function slaLabel(hours: number | null, breached: boolean): string {
  if (breached) return 'SLA breached'
  if (hours === null) return 'No SLA'
  if (hours <= 0) return 'SLA breached'
  if (hours < 1) return '< 1h left'
  if (hours < 24) return `${hours}h left`
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`
}

function slaBadgeVariant(hours: number | null, breached: boolean): BadgeVariant {
  if (breached || (hours !== null && hours <= 0)) return 'destructive'
  if (hours !== null && hours < 8) return 'warning'
  return 'secondary'
}


// ── Main component ─────────────────────────────────────────────────────────────

export function RegularisationApproval() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const queryClient = useQueryClient()

  // Track which row is being actioned (to show per-row spinner)
  const [actionRowId, setActionRowId] = useState<string | null>(null)

  // Row selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // ── Detail drawer ──────────────────────────────────────────────────────────
  const [drawerRequest, setDrawerRequest] = useState<PendingRequest | null>(null)

  // ── Forensics timeline drawer ──────────────────────────────────────────────
  const [forensicsTarget, setForensicsTarget] = useState<{
    employeeId: string; date: string; employeeName?: string
  } | null>(null)

  // ── Single rejection dialog ────────────────────────────────────────────────
  const [rejectTarget, setRejectTarget] = useState<PendingRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // ── Bulk operation dialogs ─────────────────────────────────────────────────
  const [bulkConfirmOpen,  setBulkConfirmOpen]  = useState(false)
  const [bulkRejectOpen,   setBulkRejectOpen]   = useState(false)
  const [bulkRejectReason, setBulkRejectReason] = useState('')

  // ── Recently actioned trail (last 5 single approve/reject actions) ─────────
  const [recentlyActioned, setRecentlyActioned] = useState<ActionedItem[]>([])

  // ── Policy panel ───────────────────────────────────────────────────────────
  const [showPolicy, setShowPolicy] = useState(false)
  const [policyForm, setPolicyForm] = useState<Partial<RegPolicy>>({})
  const [policyDirty, setPolicyDirty] = useState(false)

  // ── Filter state ───────────────────────────────────────────────────────────
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [filterFrom,     setFilterFrom]     = useState('')
  const [filterTo,       setFilterTo]       = useState('')
  const [appliedFrom,    setAppliedFrom]    = useState('')
  const [appliedTo,      setAppliedTo]      = useState('')

  // ── Pagination state ───────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  // ── Bulk leave state ───────────────────────────────────────────────────────
  const [bulkLeaveTypeId, setBulkLeaveTypeId] = useState('')
  const [bulkEmpIds,      setBulkEmpIds]      = useState<string[]>([])
  const [bulkFrom,        setBulkFrom]        = useState('')
  const [bulkTo,          setBulkTo]          = useState('')
  const [bulkMsg,         setBulkMsg]         = useState('')

  // ── Period lock ────────────────────────────────────────────────────────────
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { isLocked: periodLocked, state: periodState } = usePeriodLock(currentMonth)

  // ── Auto-refresh state ─────────────────────────────────────────────────────
  const AUTO_REFRESH_MS = 60_000   // 60-second polling interval
  const [lastUpdated, setLastUpdated]  = useState<Date | null>(null)
  const [isStale,     setIsStale]      = useState(false)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mark data as stale if it hasn't been refreshed in >90 seconds
  useEffect(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    if (!lastUpdated) return
    setIsStale(false)
    staleTimerRef.current = setTimeout(() => setIsStale(true), 90_000)
    return () => { if (staleTimerRef.current) clearTimeout(staleTimerRef.current) }
  }, [lastUpdated])

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: leaveTypesData } = useQuery<{ data: Array<{ id: string; name: string; is_active: boolean }> }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const activeLeaveTypes = (leaveTypesData?.data ?? []).filter(lt => lt.is_active)

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<PendingRequest[]>({
    queryKey: ['regularisation-pending'],
    queryFn:  () => api.get<PendingRequest[]>('/attendance/regularisation/pending'),
    enabled:  isAdmin,
    // staleTime == AUTO_REFRESH_MS — prevents the mount + interval double-fetch
    // pattern where a remount within the 30–60 s window triggers both a
    // mount-refetch (stale at 30 s) AND the next interval fire (at 60 s).
    staleTime:       AUTO_REFRESH_MS,
    refetchInterval: AUTO_REFRESH_MS,
  })

  const { data: policyResp, refetch: refetchPolicy } = useQuery<{ data: RegPolicy }>({
    queryKey: ['regularisation-policy'],
    queryFn:  () => api.get('/attendance/regularisation/policy'),
    enabled:  isAdmin,
    staleTime: 300_000,
  })
  const policy = policyResp?.data

  const updatePolicyMutation = useMutation({
    mutationFn: (body: Partial<RegPolicy>) => api.put('/attendance/regularisation/policy', body),
    onSuccess: () => {
      refetchPolicy()
      setPolicyDirty(false)
      toast.success('Regularisation policy updated')
    },
    onError: (err) => toast.error('Failed to update policy', { description: (err as Error).message }),
  })

  const breachCheckMutation = useMutation({
    mutationFn: () => api.post<{ breached_count: number; auto_rejected_count: number }>('/attendance/regularisation/breach-check', {}),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['regularisation-pending'] })
      toast.success(`SLA breach scan complete`, {
        description: `${r.breached_count} breached, ${r.auto_rejected_count} auto-rejected.`,
      })
    },
    onError: (err) => toast.error('Breach check failed', { description: (err as Error).message }),
  })

  // Update last-fetched timestamp whenever fresh data arrives
  useEffect(() => {
    if (dataUpdatedAt) setLastUpdated(new Date(dataUpdatedAt))
  }, [dataUpdatedAt])

  const rows = data ?? []

  // ── Drawer: current attendance for requested date ──────────────────────────
  const { data: dailyResp, isLoading: dailyLoading } = useQuery<AttendanceResp>({
    queryKey: ['reg-daily', drawerRequest?.employee_id, drawerRequest?.date],
    queryFn:  () => api.get(
      `/attendance/${drawerRequest!.employee_id}?from=${drawerRequest!.date}&to=${drawerRequest!.date}`
    ),
    enabled:  !!drawerRequest?.employee_id && !!drawerRequest?.date,
    staleTime: 30_000,
  })
  const currentDailyRecord: DailyRecord | null = dailyResp?.daily?.[0] ?? null

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filteredRows = rows.filter(r => {
    if (appliedFrom && r.date < appliedFrom) return false
    if (appliedTo   && r.date > appliedTo)   return false
    if (employeeSearch) {
      const q = employeeSearch.toLowerCase()
      const nameMatch = r.employee_name?.toLowerCase().includes(q)
      const codeMatch = r.employee_code?.toLowerCase().includes(q)
      if (!nameMatch && !codeMatch) return false
    }
    return true
  })

  // ── Pagination ─────────────────────────────────────────────────────────────
  const paginatedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── Derived counts ─────────────────────────────────────────────────────────
  const freshCount         = rows.filter(r => ageDays(r.created_at) < 1).length
  const agingCount         = rows.filter(r => { const d = ageDays(r.created_at); return d >= 1 && d < 3 }).length
  const overdueCount       = rows.filter(r => ageDays(r.created_at) >= 3).length
  const payrollImpactCount = rows.filter(r => !!r.requested_check_in).length

  // ── Filter helpers ─────────────────────────────────────────────────────────
  function applyFilters() {
    setAppliedFrom(filterFrom)
    setAppliedTo(filterTo)
    setPage(1)
    setSelectedIds(new Set())   // H2: clear phantom selections when filter changes
  }

  function clearFilters() {
    setFilterFrom('')
    setFilterTo('')
    setAppliedFrom('')
    setAppliedTo('')
    setEmployeeSearch('')
    setPage(1)
    setSelectedIds(new Set())   // H2: clear phantom selections when filter resets
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const bulkApproveMutation = useMutation({
    mutationFn: () =>
      Promise.all([...selectedIds].map(id =>
        api.post(`/attendance/regularisation/${id}/approve`, {})
      )),
    onSuccess: () => {
      const count = selectedIds.size
      queryClient.invalidateQueries({ queryKey: ['regularisation-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      // The employees' own ESS approvals tracker reads these same records.
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      setSelectedIds(new Set())
      setBulkConfirmOpen(false)   // L2: close dialog after success so loading state is visible
      toast.success(`${count} request${count !== 1 ? 's' : ''} approved`, {
        description: 'Attendance records have been recomputed.',
      })
    },
    onError: (err) => {
      // L2: keep dialog open on error so operator sees the failure and can retry
      toast.error('Bulk approval failed', { description: (err as Error).message })
    },
  })

  const bulkRejectMutation = useMutation({
    mutationFn: (reason: string) =>
      Promise.all([...selectedIds].map(id =>
        api.post(`/attendance/regularisation/${id}/reject`, { rejection_reason: reason })
      )),
    onSuccess: () => {
      const count = selectedIds.size
      queryClient.invalidateQueries({ queryKey: ['regularisation-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      setSelectedIds(new Set())
      setBulkRejectOpen(false)
      setBulkRejectReason('')
      toast('Bulk rejection complete', {
        description: `${count} request${count !== 1 ? 's' : ''} rejected.`,
      })
    },
    onError: (err) => {
      toast.error('Bulk rejection failed', { description: (err as Error).message })
    },
  })

  const bulkLeaveMutation = useMutation({
    mutationFn: (body: { employee_ids: string[]; leave_type_id: string; from_date: string; to_date: string }) =>
      api.post<{ employees_count: number; days_count: number }>('/attendance/leave/bulk-assign', body),
    onSuccess: (r) => {
      toast.success(`Leave assigned to ${r.employees_count} employee${r.employees_count !== 1 ? 's' : ''}`, {
        description: `${r.days_count} day${r.days_count !== 1 ? 's' : ''} of leave applied.`,
      })
      setBulkMsg('')
      setBulkEmpIds([])
      setBulkFrom('')
      setBulkTo('')
    },
    onError: (e) => {
      const msg = (e as Error).message ?? 'Bulk leave assignment failed'
      setBulkMsg(msg)
      toast.error('Bulk leave failed', { description: msg })
    },
  })

  function handleBulkLeave() {
    const ids = bulkEmpIds
    if (!ids.length || !bulkLeaveTypeId || !bulkFrom || !bulkTo) {
      setBulkMsg('All fields are required')
      return
    }
    setBulkMsg('')
    bulkLeaveMutation.mutate({ employee_ids: ids, leave_type_id: bulkLeaveTypeId, from_date: bulkFrom, to_date: bulkTo })
  }

  async function action(id: string, type: 'approve' | 'reject', rejectionReason?: string) {
    setActionRowId(id)
    const row = rows.find(r => r.id === id)
    try {
      const body = type === 'reject' ? { rejection_reason: rejectionReason ?? '' } : {}
      await api.post(`/attendance/regularisation/${id}/${type}`, body)
      queryClient.invalidateQueries({ queryKey: ['regularisation-pending'] })
      queryClient.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
      // The employees' own ESS approvals tracker reads these same records.
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      // Close dialogs if they were open for this row
      if (drawerRequest?.id === id) setDrawerRequest(null)
      if (rejectTarget?.id === id) { setRejectTarget(null); setRejectReason('') }
      // Append to recently actioned trail (cap at 5)
      const actionedType = (type === 'approve' ? 'approved' : 'rejected') as 'approved' | 'rejected'
      setRecentlyActioned(prev => [
        { id, employeeName: row?.employee_name ?? null, date: row?.date ?? '', type: actionedType, timestamp: new Date() },
        ...prev,
      ].slice(0, 5))
      if (type === 'approve') {
        toast.success('Request approved', {
          description: row ? `${row.employee_name ?? 'Employee'} · ${fmtDate(row.date)}` : undefined,
        })
      } else {
        toast('Request rejected', {
          description: row ? `${row.employee_name ?? 'Employee'} · ${fmtDate(row.date)}` : undefined,
        })
      }
    } catch (err) {
      toast.error(`Failed to ${type} request`, {
        description: (err as Error).message,
      })
    } finally {
      setActionRowId(null)
    }
  }

  function openRejectDialog(row: PendingRequest) {
    setRejectTarget(row)
    setRejectReason('')
  }

  // ── 6-column DataTable ─────────────────────────────────────────────────────
  const columns: DataTableColumn<PendingRequest>[] = [
    // ① Employee — name + code + reason preview + compact timeline/detail icons
    {
      id: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="min-w-[155px]">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-foreground leading-tight text-sm">{row.employee_name ?? '—'}</p>
            {row.employee_code && (
              <span className="text-[10px] text-muted-foreground font-mono">{row.employee_code}</span>
            )}
          </div>
          {row.reason && (
            <p
              className="text-[10px] text-muted-foreground italic line-clamp-1 mt-0.5"
              title={row.reason}
            >
              {row.reason}
            </p>
          )}
          {/* Detail drawer trigger — kept in employee cell for contextual access */}
          <div className="flex items-center gap-0.5 mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              title="View full request details"
              onClick={() => setDrawerRequest(row)}
            >
              <Eye className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ),
    },

    // ② Date
    {
      id: 'date',
      header: 'Date',
      cell: (row) => (
        <div className="flex items-center gap-1.5 text-foreground whitespace-nowrap">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm">{fmtDate(row.date)}</span>
        </div>
      ),
    },

    // ③ Requested Times — merged IN + OUT
    {
      id: 'requested_times',
      header: 'Requested Times',
      cell: (row) => (
        <div className="space-y-0.5 text-xs whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-6 flex-shrink-0 font-mono">IN</span>
            <span className={cn('font-medium tabular-nums', row.requested_check_in ? 'text-foreground' : 'text-muted-foreground')}>
              {fmtTime(row.requested_check_in)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-6 flex-shrink-0 font-mono">OUT</span>
            <span className={cn('font-medium tabular-nums', row.requested_check_out ? 'text-foreground' : 'text-muted-foreground')}>
              {fmtTime(row.requested_check_out)}
            </span>
          </div>
        </div>
      ),
    },

    // ④ Payroll Impact — inferred from requested_check_in presence
    {
      id: 'impact',
      header: 'Impact',
      cell: (row) => {
        if (!row.requested_check_in) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <div className="flex items-center gap-1 text-warning whitespace-nowrap">
            <TrendingUp className="h-3 w-3 flex-shrink-0" />
            <span className="text-[10px] font-medium">Payroll</span>
          </div>
        )
      },
    },

    // ⑤ Age / SLA — merged
    {
      id: 'age_sla',
      header: 'Age / SLA',
      cell: (row) => {
        const days = ageDays(row.created_at)
        return (
          <div className="space-y-1">
            <Badge variant={ageBadgeVariant(days)} className="rounded-full text-[10px] whitespace-nowrap">
              {ageLabel(days)}
            </Badge>
            {(row.sla_deadline || row.sla_breached) && (
              <div className="flex items-center gap-0.5">
                {row.sla_breached && (
                  <AlertTriangle className="h-2.5 w-2.5 text-destructive flex-shrink-0" />
                )}
                <Badge
                  variant={slaBadgeVariant(row.hours_remaining, row.sla_breached)}
                  className="rounded-full text-[9px] whitespace-nowrap"
                >
                  {slaLabel(row.hours_remaining, row.sla_breached)}
                </Badge>
              </div>
            )}
          </div>
        )
      },
    },

    // ⑥ Actions — Approve + Reject + Timeline (forensics moved here from employee cell)
    {
      id: 'actions',
      header: 'Actions',
      className: 'min-w-[175px]',
      cell: (row) => {
        const isActioning = actionRowId === row.id
        if (isActioning) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        return (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success/10"
              onClick={() => action(row.id, 'approve')}
              disabled={!!actionRowId || periodLocked}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => openRejectDialog(row)}
              disabled={!!actionRowId}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
            {/* Q2 — forensics trigger in actions column (consistent placement) */}
            {row.employee_id && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-info"
                title="View attendance timeline"
                onClick={() => setForensicsTarget({
                  employeeId:   row.employee_id!,
                  date:         row.date,
                  employeeName: row.employee_name ?? undefined,
                })}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </Button>
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
        breadcrumb={[{ label: 'Attendance Operations', href: '/admin/attendance/center' }, { label: 'Regularisation' }]}
        title="Regularisation Requests"
        subtitle="HR governance layer — SLA-tracked approval, escalation, and payroll auditability"
        actions={isAdmin ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => breachCheckMutation.mutate()}
              disabled={breachCheckMutation.isPending}
            >
              {breachCheckMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <AlertTriangle className="h-3.5 w-3.5" />
              }
              Check SLA
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => { setShowPolicy(p => !p); if (policy) setPolicyForm(policy) }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Policy
            </Button>
          </div>
        ) : undefined}
      />

      {/* Access guard */}
      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can review regularisation requests.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <StatusStrip items={[
          { label: 'Pending',        value: rows.length,         variant: rows.length > 0 ? 'warning' : 'default' },
          { label: 'Fresh',          value: freshCount,          variant: 'default',     hideWhenZero: true },
          { label: 'Aging',          value: agingCount,          variant: 'warning',     hideWhenZero: true },
          { label: 'Overdue',        value: overdueCount,        variant: 'destructive', hideWhenZero: true },
          { label: 'Payroll Impact', value: payrollImpactCount,  variant: 'warning',     hideWhenZero: true },
          { label: 'Selected',       value: selectedIds.size,    variant: 'info',        hideWhenZero: true },
        ] as StripItem[]} />
      )}

      {/* ── Policy Configuration ──────────────────────────────────────────── */}
      {isAdmin && showPolicy && (
        <SectionCard
          title="Regularisation Policy"
          icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
        >
          <p className="text-xs text-muted-foreground mb-4">Configure submission rules, frequency limits, and SLA targets for attendance correction requests.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Submission Window (days)</label>
              <Input
                type="number"
                min={1}
                max={90}
                value={policyForm.submission_window_days ?? policy?.submission_window_days ?? 7}
                onChange={e => { setPolicyForm(p => ({ ...p, submission_window_days: +e.target.value })); setPolicyDirty(true) }}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Max days after attendance date that an employee can submit a request.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max Requests / Period</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={policyForm.max_per_month ?? policy?.max_per_month ?? 5}
                onChange={e => { setPolicyForm(p => ({ ...p, max_per_month: +e.target.value })); setPolicyDirty(true) }}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Maximum regularisation requests per employee in each limit period.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Limit Period</label>
              <select
                value={policyForm.limit_period ?? policy?.limit_period ?? 'month'}
                onChange={e => { setPolicyForm(p => ({ ...p, limit_period: e.target.value as RegPolicy['limit_period'] })); setPolicyDirty(true) }}
                className="h-8 text-xs w-full border border-border rounded-md px-2 bg-background text-foreground"
              >
                {LIMIT_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground">Window the request cap is counted over.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Exclude rejected from limit</label>
              <div className="flex items-center gap-2 h-8">
                <input
                  type="checkbox"
                  id="exclude-rejected"
                  checked={policyForm.exclude_rejected ?? policy?.exclude_rejected ?? true}
                  onChange={e => { setPolicyForm(p => ({ ...p, exclude_rejected: e.target.checked })); setPolicyDirty(true) }}
                  className="h-4 w-4 rounded accent-primary"
                />
                <label htmlFor="exclude-rejected" className="text-xs text-foreground">Don't count rejected requests</label>
              </div>
              <p className="text-[10px] text-muted-foreground">Rejected requests won't consume an employee's quota. (Cancelled never counts.)</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">SLA (hours)</label>
              <Input
                type="number"
                min={1}
                max={720}
                value={policyForm.sla_hours ?? policy?.sla_hours ?? 48}
                onChange={e => { setPolicyForm(p => ({ ...p, sla_hours: +e.target.value })); setPolicyDirty(true) }}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Target resolution time from submission to approve/reject.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Auto-reject on SLA breach</label>
              <div className="flex items-center gap-2 h-8">
                <input
                  type="checkbox"
                  id="auto-reject"
                  checked={policyForm.auto_reject_on_sla_breach ?? policy?.auto_reject_on_sla_breach ?? false}
                  onChange={e => { setPolicyForm(p => ({ ...p, auto_reject_on_sla_breach: e.target.checked })); setPolicyDirty(true) }}
                  className="h-4 w-4 rounded accent-primary"
                />
                <label htmlFor="auto-reject" className="text-xs text-foreground">Enable</label>
              </div>
              <p className="text-[10px] text-muted-foreground">Automatically reject requests that breach SLA when "Check SLA" is run.</p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">SLA Breach Notify (emails, comma-separated)</label>
              <Input
                type="text"
                placeholder="hr@company.com, admin@company.com"
                value={policyForm.sla_breach_notify ?? policy?.sla_breach_notify ?? ''}
                onChange={e => { setPolicyForm(p => ({ ...p, sla_breach_notify: e.target.value || null })); setPolicyDirty(true) }}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* ── Per-type sub-limits ──────────────────────────────────────────── */}
          <div className="mt-5 pt-4 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground">Per-type limits (optional)</label>
            <p className="text-[10px] text-muted-foreground mb-3">Cap specific request types within the limit period. Leave blank or 0 for no per-type cap (only the overall cap applies).</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {REG_TYPE_OPTIONS.map(t => {
                const current = policyForm.per_type_limits ?? policy?.per_type_limits ?? {}
                const val = current[t.value]
                return (
                  <div key={t.value} className="space-y-1">
                    <label className="text-[11px] text-foreground">{t.label}</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="—"
                      value={val ?? ''}
                      onChange={e => {
                        const next: Record<string, number> = { ...(policyForm.per_type_limits ?? policy?.per_type_limits ?? {}) }
                        const n = e.target.value === '' ? 0 : Math.max(0, Math.min(100, +e.target.value))
                        if (n > 0) next[t.value] = n; else delete next[t.value]
                        setPolicyForm(p => ({ ...p, per_type_limits: next }))
                        setPolicyDirty(true)
                      }}
                      className="h-8 text-xs"
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setShowPolicy(false); setPolicyDirty(false) }}>Cancel</Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!policyDirty || updatePolicyMutation.isPending}
              onClick={() => updatePolicyMutation.mutate(policyForm)}
            >
              {updatePolicyMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</> : 'Save Policy'}
            </Button>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <SectionCard
          title={`Pending Requests${filteredRows.length > 0 ? ` (${filteredRows.length})` : ''}`}
          icon={<FileEdit className="h-4 w-4 text-muted-foreground" />}
          noPadding
        >
          <TableToolbar
            left={
              <div className="flex items-center gap-2 flex-wrap">
                {/* Employee search */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search employee…"
                    value={employeeSearch}
                    onChange={e => { setEmployeeSearch(e.target.value); setPage(1) }}
                    className="h-7 text-xs pl-6 w-40"
                  />
                </div>
                {/* Date range */}
                <DateInput
                  value={filterFrom}
                  onChange={setFilterFrom}
                  className="h-7 text-xs w-32"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <DateInput
                  value={filterTo}
                  onChange={setFilterTo}
                  className="h-7 text-xs w-32"
                />
                <Button size="sm" className="h-7 text-xs" onClick={applyFilters}>Apply</Button>
                {(appliedFrom || appliedTo || employeeSearch) && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearFilters}>Clear</Button>
                )}
              </div>
            }
            right={
              <div className="flex items-center gap-2">
                {/* Stale indicator */}
                {isStale && (
                  <span className="text-[10px] text-warning flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Data may be stale
                  </span>
                )}
                {/* Last updated timestamp */}
                {lastUpdated && !isStale && (
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
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
              </div>
            }
            filterChips={[
              ...(appliedFrom    ? [{ key: 'from',   label: `From: ${appliedFrom}` }]        : []),
              ...(appliedTo      ? [{ key: 'to',     label: `To: ${appliedTo}` }]             : []),
              ...(employeeSearch ? [{ key: 'search', label: `Employee: ${employeeSearch}` }] : []),
            ]}
            onRemoveChip={(key) => {
              if (key === 'from')   { setFilterFrom(''); setAppliedFrom(''); setPage(1) }
              if (key === 'to')     { setFilterTo('');   setAppliedTo('');   setPage(1) }
              if (key === 'search') { setEmployeeSearch('');                 setPage(1) }  // M1: was missing setPage(1)
            }}
            onClearAllChips={clearFilters}
          />

          {periodState !== 'OPEN' && (
            <div className="px-4 pb-0 pt-3">
              <PeriodLockBanner state={periodState} month={currentMonth} />
            </div>
          )}

          {selectedIds.size > 0 && (
            <BulkActionBar
              selectedCount={selectedIds.size}
              actions={[
                {
                  id:      'approve',
                  label:   'Approve Selected',
                  icon:    CheckCircle2,
                  onClick: () => setBulkConfirmOpen(true),
                  loading: bulkApproveMutation.isPending,
                },
                {
                  id:      'reject',
                  label:   'Reject Selected',
                  icon:    XCircle,
                  onClick: () => setBulkRejectOpen(true),
                  loading: bulkRejectMutation.isPending,
                },
              ]}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          )}

          {isError && (
            <div className="flex flex-col items-center gap-2 py-12">
              <p className="text-sm text-destructive">Failed to load requests</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          <DataTable<PendingRequest>
            columns={columns}
            data={paginatedRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            skeletonRows={6}
            emptyState={
              rows.length > 0 && filteredRows.length === 0
                ? <EmptyTableState
                    title="No matching requests"
                    description="Try clearing your search or adjusting the date range."
                  />
                : <EmptyTableState
                    preset="no-approvals"
                    title="No pending requests"
                    description="All regularisation requests have been reviewed."
                  />
            }
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            getRowId={(r) => r.id}
          />

          {/* M2: PaginationBar directly after DataTable — before the actioned trail */}
          <PaginationBar
            total={filteredRows.length}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />

          {/* ── Recently actioned trail ──────────────────────────────────── */}
          {recentlyActioned.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/20">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3" />
                Recently Actioned
              </p>
              <div className="flex flex-wrap gap-2">
                {recentlyActioned.map((item) => (
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
                      : <XCircle className="h-2.5 w-2.5 flex-shrink-0" />
                    }
                    <span className="font-medium">{item.employeeName ?? 'Employee'}</span>
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
      )}

      {/* ── Bulk Leave Assignment ─────────────────────────────────────────── */}
      {isAdmin && (
        <SectionCard
          title="Bulk Leave Assignment"
          icon={<CalendarRange className="h-4 w-4 text-muted-foreground" />}
        >
          <p className="text-xs text-muted-foreground mb-4">Assign leave to multiple employees for a date range. This auto-approves and applies to attendance records.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: employee IDs textarea */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Employees
              </label>
              <EmployeeSelector
                multiple
                value={bulkEmpIds}
                onChange={v => setBulkEmpIds(Array.isArray(v) ? v : (v ? [v] : []))}
                placeholder="Select employees…"
                className="w-full"
              />
            </div>

            {/* Right: leave type + dates + submit */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Leave Type</label>
                <select
                  value={bulkLeaveTypeId}
                  onChange={e => setBulkLeaveTypeId(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">Select type…</option>
                  {activeLeaveTypes.map(lt => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <DateInput
                    value={bulkFrom}
                    onChange={setBulkFrom}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <DateInput
                    value={bulkTo}
                    min={bulkFrom}
                    onChange={setBulkTo}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <Button
                className="h-8 text-xs w-full"
                onClick={handleBulkLeave}
                disabled={bulkLeaveMutation.isPending}
              >
                {bulkLeaveMutation.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Assigning…</>
                  : 'Assign Leave'
                }
              </Button>

              {bulkMsg && (
                <p className={cn(
                  'text-xs',
                  bulkLeaveMutation.isError ? 'text-destructive' : 'text-success',
                )}>
                  {bulkMsg}
                </p>
              )}
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Bulk Approve Confirmation Dialog ─────────────────────────────── */}
      <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">Confirm Bulk Approval</DialogTitle>
            <DialogDescription className="text-xs">
              You are about to approve{' '}
              <strong>{selectedIds.size} correction request{selectedIds.size !== 1 ? 's' : ''}</strong>.
              This will recompute attendance for each affected employee and may affect payroll calculations.
              {payrollImpactCount > 0 && (
                <span className="block mt-1 text-warning font-medium">
                  ⚠ {payrollImpactCount} of the pending requests may add a payable day.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => setBulkConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs border-success/40 text-success hover:bg-success/10"
              disabled={bulkApproveMutation.isPending}
              onClick={() => bulkApproveMutation.mutate()}
            >
              {bulkApproveMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Approving…</>
                : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve {selectedIds.size}</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Reject Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={bulkRejectOpen}
        onOpenChange={(open) => { if (!open) { setBulkRejectOpen(false); setBulkRejectReason('') } }}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">
              Reject {selectedIds.size} Request{selectedIds.size !== 1 ? 's' : ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Provide an optional reason. The same reason will be applied to all selected requests.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Rejection Reason <span className="text-muted-foreground/60">(optional)</span>
              </label>
              <textarea
                value={bulkRejectReason}
                onChange={e => setBulkRejectReason(e.target.value)}
                placeholder="Explain why these requests are being rejected…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => { setBulkRejectOpen(false); setBulkRejectReason('') }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={bulkRejectMutation.isPending}
              onClick={() => bulkRejectMutation.mutate(bulkRejectReason)}
            >
              {bulkRejectMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Rejecting…</>
                : <><XCircle className="h-3.5 w-3.5 mr-1" />Reject {selectedIds.size}</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Single Rejection Reason Dialog ───────────────────────────────── */}
      <Dialog open={!!rejectTarget} onOpenChange={(open: boolean) => { if (!open) { setRejectTarget(null); setRejectReason('') } }}>
        <DialogContent className="max-w-[400px]">
          {rejectTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Reject Request</DialogTitle>
                <DialogDescription className="text-xs">
                  {rejectTarget.employee_name} · {fmtDate(rejectTarget.date)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Rejection Reason <span className="text-muted-foreground/60">(optional)</span></label>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Explain why this request is being rejected…"
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 ring-primary/50 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => { setRejectTarget(null); setRejectReason('') }}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={!!actionRowId}
                  onClick={() => action(rejectTarget.id, 'reject', rejectReason)}
                >
                  {actionRowId === rejectTarget.id
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Rejecting…</>
                    : <><XCircle className="h-3.5 w-3.5 mr-1" />Confirm Reject</>
                  }
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Forensics Timeline Drawer ─────────────────────────────────────── */}
      <ForensicsDrawer
        target={forensicsTarget}
        onClose={() => setForensicsTarget(null)}
      />

      {/* ── Request Detail Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!drawerRequest} onOpenChange={(open: boolean) => { if (!open) setDrawerRequest(null) }}>
        <DialogContent className="max-w-[480px] max-h-[90vh] overflow-y-auto">
          {drawerRequest && (
            <>
              <DialogHeader className="mb-4">
                <DialogTitle className="text-base">Correction Request</DialogTitle>
                <DialogDescription className="text-xs">
                  Review the full details before approving or rejecting.
                </DialogDescription>
              </DialogHeader>

              {/* Employee */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 mb-4">
                <p className="text-xs text-muted-foreground mb-0.5">Employee</p>
                <p className="font-semibold text-sm text-foreground">
                  {drawerRequest.employee_name ?? '—'}
                </p>
                {drawerRequest.employee_code && (
                  <p className="text-xs font-mono text-muted-foreground">{drawerRequest.employee_code}</p>
                )}
              </div>

              {/* Request details */}
              <div className="space-y-3 mb-4">
                <DetailRow
                  label="Requested Date"
                  value={
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{fmtDate(drawerRequest.date)}</span>
                    </div>
                  }
                />
                <DetailRow
                  label="Requested Check-in"
                  value={
                    <span className={cn('font-medium', drawerRequest.requested_check_in ? 'text-foreground' : 'text-muted-foreground')}>
                      {fmtTime(drawerRequest.requested_check_in)}
                    </span>
                  }
                />
                <DetailRow
                  label="Requested Check-out"
                  value={
                    <span className={cn('font-medium', drawerRequest.requested_check_out ? 'text-foreground' : 'text-muted-foreground')}>
                      {fmtTime(drawerRequest.requested_check_out)}
                    </span>
                  }
                />
                <DetailRow
                  label="Submitted"
                  value={
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{fmtDatetime(drawerRequest.created_at)}</span>
                      <Badge variant={ageBadgeVariant(ageDays(drawerRequest.created_at))} className="rounded-full text-[10px]">
                        {ageLabel(ageDays(drawerRequest.created_at))} ago
                      </Badge>
                    </div>
                  }
                />
                {drawerRequest.sla_deadline && (
                  <DetailRow
                    label="SLA Deadline"
                    value={
                      <div className="flex items-center gap-1.5">
                        {drawerRequest.sla_breached && (
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                        )}
                        <span className={drawerRequest.sla_breached ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                          {fmtDatetime(drawerRequest.sla_deadline)}
                        </span>
                        <Badge
                          variant={slaBadgeVariant(drawerRequest.hours_remaining, drawerRequest.sla_breached)}
                          className="rounded-full text-[10px]"
                        >
                          {slaLabel(drawerRequest.hours_remaining, drawerRequest.sla_breached)}
                        </Badge>
                      </div>
                    }
                  />
                )}
              </div>

              {/* Reason */}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1.5">Reason</p>
                <p className="text-sm text-foreground rounded-md bg-muted/40 border border-border px-3 py-2 leading-relaxed">
                  {drawerRequest.reason}
                </p>
              </div>

              {/* Attendance diff — before/after using AttendanceDiff component */}
              {(() => {
                // "Before" = current daily record from the API
                const beforeSnap: AttendanceSnapshot = currentDailyRecord
                  ? {
                      status:           currentDailyRecord.status,
                      work_hours:       currentDailyRecord.work_hours,
                      late_minutes:     currentDailyRecord.late_minutes,
                      overtime_minutes: currentDailyRecord.overtime_minutes,
                      is_payable:       currentDailyRecord.is_payable ?? null,
                    }
                  : {}

                // "After" = projected snapshot — approving will trigger recompute,
                // but we can infer the broad direction from the requested times.
                const hasIn  = !!drawerRequest.requested_check_in
                const hasOut = !!drawerRequest.requested_check_out
                const afterSnap: AttendanceSnapshot = {
                  status:     hasIn ? 'present' : null,
                  is_payable: hasIn ? true : null,
                  // Work hours can't be known without the engine; leave null to show "recomputed"
                  work_hours: null,
                }

                return (
                  <div className="mb-5 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <ArrowRight className="h-3.5 w-3.5" />
                      Impact Preview
                    </p>

                    {dailyLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading current record…
                      </div>
                    ) : currentDailyRecord ? (
                      <>
                        {/* Payroll impact banner — shown when the correction would flip payability */}
                        {!beforeSnap.is_payable && hasIn && (
                          <DiffWarningBanner
                            before={beforeSnap}
                            after={afterSnap}
                            context="Approving this correction"
                          />
                        )}

                        {/* Side-by-side diff */}
                        <AttendanceDiff
                          before={beforeSnap}
                          after={afterSnap}
                          beforeLabel="Current"
                          afterLabel="Projected (on approve)"
                          showPayrollImpact={false}
                          showNoChanges
                        />

                        <p className="text-[10px] text-muted-foreground/70 italic">
                          * Hours and late minutes will be exact-recomputed by the attendance engine on approval.
                          {!hasOut && ' No check-out was requested — engine will use existing or leave incomplete.'}
                        </p>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center">
                        <p className="text-xs text-muted-foreground">No attendance record for this date yet.</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">Approving will create one.</p>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Drawer actions */}
              <div className="flex gap-2 pt-3 border-t border-border">
                <Button
                  className="flex-1 gap-1.5 border-success/40 text-success hover:bg-success/10"
                  variant="outline"
                  disabled={!!actionRowId || periodLocked}
                  onClick={() => action(drawerRequest.id, 'approve')}
                >
                  {actionRowId === drawerRequest.id
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Processing…</>
                    : <><CheckCircle2 className="h-3.5 w-3.5" />Approve</>
                  }
                </Button>
                <Button
                  className="flex-1 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  variant="outline"
                  disabled={!!actionRowId}
                  onClick={() => { setDrawerRequest(null); openRejectDialog(drawerRequest) }}
                >
                  <XCircle className="h-3.5 w-3.5" />Reject
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-muted-foreground flex-shrink-0 pt-0.5 min-w-[110px]">{label}</span>
      <div className="text-xs text-right">{value}</div>
    </div>
  )
}
