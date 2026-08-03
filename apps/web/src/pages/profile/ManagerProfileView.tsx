/**
 * ManagerProfileView — Manager's Operational View of a Subordinate
 *
 * This is the MANAGER lens on an employee record. It surfaces:
 *   • Who this employee is (compact identity header)
 *   • What needs the manager's action (pending approvals from this employee)
 *   • How the employee has been attending (current month stats)
 *   • What leave they have remaining (leave balance)
 *   • Recent request history with outcome
 *
 * NOT: the full HR admin edit form, NOT the employee's self-service hub.
 * This view is operationally-focused — everything the manager needs to approve,
 * investigate, or escalate for this specific person.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useMemo }                       from 'react'
import { Link }                          from 'react-router-dom'
import { SignedImage }                   from '@/components/SignedImage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                         from 'sonner'
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Clock,
  CalendarDays, CalendarOff, Users, Building2, MapPin,
  Award, ArrowRight, ChevronRight, BookOpen, TrendingUp,
  UserCheck, MessageSquare,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmployeeBasic {
  employee: {
    id:            string
    first_name:    string
    last_name:     string
    email:         string
    employee_code: string
    joining_date:  string | null
    status:        string
  }
  personal_info: {
    profile_photo: string | null
  } | null
  job_info: {
    departments:   { name: string } | null
    designations:  { name: string } | null
    work_locations:{ name: string; city: string } | null
    shifts:        { name: string } | null
    manager:       { first_name: string; last_name: string } | null
  } | null
}

interface PendingApproval {
  id:              string
  type:            'leave' | 'regularization'
  status:          string
  employee_id:     string
  employee_name:   string
  from_date?:      string
  to_date?:        string
  date?:           string
  days_requested?: number
  reason:          string | null
  created_at:      string
  leave_type?:     { name: string } | null
  regularization_type?: string
}

interface AttendanceRecord {
  date:     string
  status:   string
  is_late:  boolean
}

interface LeaveBalance {
  leave_type_id:   string
  leave_type_name: string | null
  balance_days:    number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!s) return '—'
  if (opts) return new Date(`${s}T12:00:00Z`).toLocaleDateString([], opts)
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function cap(s: string | null | undefined) {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function monthRange() {
  const today     = new Date().toISOString().slice(0, 10)
  const monthStart = today.slice(0, 7) + '-01'
  return { from: monthStart, to: today, today }
}

function ageHours(createdAt: string) {
  return (Date.now() - new Date(createdAt).getTime()) / 3_600_000
}

// ── SLA badge ─────────────────────────────────────────────────────────────────

function SLABadge({ createdAt }: { createdAt: string }) {
  const h = ageHours(createdAt)
  if (h < 24) return null
  return (
    <span className={cn(
      'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
      h >= 48 ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning',
    )}>
      {h >= 48 ? 'SLA critical' : 'SLA breached'}
    </span>
  )
}

// ── Pending request card ──────────────────────────────────────────────────────

function PendingCard({
  req,
  onApprove,
  onReject,
  approving,
  rejecting,
}: {
  req:       PendingApproval
  onApprove: (id: string, type: 'leave' | 'regularization') => void
  onReject:  (id: string, type: 'leave' | 'regularization') => void
  approving: boolean
  rejecting: boolean
}) {
  const title = req.type === 'leave'
    ? (req.leave_type?.name ?? 'Leave')
    : cap(req.regularization_type)

  const dateStr = req.type === 'leave' && req.from_date
    ? req.from_date === req.to_date
      ? fmtDate(req.from_date, { day: 'numeric', month: 'short' })
      : `${fmtDate(req.from_date, { day: 'numeric', month: 'short' })} – ${fmtDate(req.to_date, { day: 'numeric', month: 'short' })}`
    : fmtDate(req.date, { day: 'numeric', month: 'short' })

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {dateStr}
            {req.days_requested ? ` · ${req.days_requested}d` : ''}
            {' · '}Submitted {fmtDate(req.created_at, { day: 'numeric', month: 'short' })}
          </p>
        </div>
        <SLABadge createdAt={req.created_at} />
      </div>

      {req.reason && (
        <p className="text-[10px] text-muted-foreground/80 italic pl-1 border-l-2 border-border">"{req.reason}"</p>
      )}

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] text-success border-success/30 hover:bg-success/8 hover:border-success/50"
          disabled={approving || rejecting}
          onClick={() => onApprove(req.id, req.type)}
        >
          {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[11px] text-destructive border-destructive/30 hover:bg-destructive/8 hover:border-destructive/50"
          disabled={approving || rejecting}
          onClick={() => onReject(req.id, req.type)}
        >
          {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
          Reject
        </Button>
        <Link
          to="/manager/team/attendance"
          className="ml-auto text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
        >
          Full inbox <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ManagerProfileView({ employeeId }: { employeeId: string }) {
  const qc          = useQueryClient()
  const { from, to } = monthRange()

  // ── Employee info ──────────────────────────────────────────────────────────
  const { data: empData, isLoading: empLoading } = useQuery<EmployeeBasic>({
    queryKey: ['mgr-profile-emp', employeeId],
    queryFn:  () => api.get(`/employees/${employeeId}`),
    enabled:  !!employeeId,
    staleTime: 5 * 60_000,
  })

  // ── Pending approvals (all, filter by employeeId) ──────────────────────────
  const { data: approvalsData } = useQuery<{
    data: { leave: PendingApproval[]; regularizations: PendingApproval[] }
  }>({
    queryKey: ['mgr-approvals-pending'],
    queryFn:  () => api.get('/approvals/pending?limit=100'),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  // ── Attendance for current month ───────────────────────────────────────────
  const { data: attData } = useQuery<{
    records: AttendanceRecord[]
  }>({
    queryKey: ['mgr-attendance', employeeId, from, to],
    queryFn:  () => api.get(`/attendance/${employeeId}?from=${from}&to=${to}`),
    enabled:  !!employeeId,
    staleTime: 3 * 60_000,
  })

  // ── Leave balance ──────────────────────────────────────────────────────────
  const { data: leaveBalanceData } = useQuery<{
    data: LeaveBalance[]
  }>({
    queryKey: ['mgr-leave-balance', employeeId],
    queryFn:  () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:  !!employeeId,
    staleTime: 5 * 60_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  const pendingFromEmployee = useMemo(() => {
    const leave = (approvalsData?.data?.leave ?? []).filter(r => r.employee_id === employeeId)
    const regs  = (approvalsData?.data?.regularizations ?? []).filter(r => r.employee_id === employeeId)
    return [...leave.map(r => ({ ...r, type: 'leave' as const })), ...regs.map(r => ({ ...r, type: 'regularization' as const }))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [approvalsData, employeeId])

  const attStats = useMemo(() => {
    const records = attData?.records ?? []
    const present = records.filter(r => r.status === 'present' || r.status === 'half_day').length
    const absent  = records.filter(r => r.status === 'absent').length
    const late    = records.filter(r => r.is_late).length
    const lop     = records.filter(r => r.status === 'lop').length
    return { present, absent, late, lop, total: records.length }
  }, [attData])

  const leaveBalances = leaveBalanceData?.data ?? []

  const criticalSLA = pendingFromEmployee.filter(r => ageHours(r.created_at) >= 48).length
  const warningSLA  = pendingFromEmployee.filter(r => {
    const h = ageHours(r.created_at)
    return h >= 24 && h < 48
  }).length

  // ── Mutations ──────────────────────────────────────────────────────────────

  // Mirrors the invalidation set used by the full attendance/ApprovalInbox.tsx
  // for the same endpoints — this embed (reached via MobileFlowDesk) previously
  // only invalidated its own local caches, leaving the standalone Approval
  // Inbox, notification bell, and leave-balance display stale after an
  // approve/reject performed here.
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['mgr-approvals-pending'] })
    qc.invalidateQueries({ queryKey: ['approvals-pending'] })
    qc.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
    // The employee's own ESS approvals tracker reads the same leave/
    // regularisation records under separate keys.
    qc.invalidateQueries({ queryKey: ['ess-approvals-leave'] })
    qc.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
  }

  const approveLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/approve`, {}),
    onSuccess:  () => {
      toast.success('Leave approved')
      invalidate()
      qc.invalidateQueries({ queryKey: ['leave-balance'] })
    },
    onError:    () => toast.error('Failed to approve'),
  })
  const rejectLeaveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave-requests/${id}/reject`, {}),
    onSuccess:  () => { toast.success('Leave rejected'); invalidate() },
    onError:    () => toast.error('Failed to reject'),
  })
  const approveRegMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess:  () => {
      toast.success('Regularisation approved')
      invalidate()
      qc.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
    },
    onError:    () => toast.error('Failed to approve'),
  })
  const rejectRegMutation = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess:  () => {
      toast.success('Regularisation rejected')
      invalidate()
      qc.invalidateQueries({ queryKey: ['attendance-ops-stats'] })
    },
    onError:    () => toast.error('Failed to reject'),
  })

  function handleApprove(id: string, type: 'leave' | 'regularization') {
    type === 'leave' ? approveLeaveMutation.mutate(id) : approveRegMutation.mutate(id)
  }
  function handleReject(id: string, type: 'leave' | 'regularization') {
    type === 'leave' ? rejectLeaveMutation.mutate(id) : rejectRegMutation.mutate(id)
  }

  const anyMutating =
    approveLeaveMutation.isPending || rejectLeaveMutation.isPending ||
    approveRegMutation.isPending   || rejectRegMutation.isPending

  // ── Loading guard ──────────────────────────────────────────────────────────

  if (empLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </PageContainer>
    )
  }

  const emp  = empData?.employee
  const job  = empData?.job_info
  const pers = empData?.personal_info

  if (!emp) {
    return (
      <PageContainer>
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Employee not found.</p>
        </div>
      </PageContainer>
    )
  }

  const fullName = `${emp.first_name} ${emp.last_name}`
  const initials = `${emp.first_name[0] ?? ''}${emp.last_name[0] ?? ''}`.toUpperCase()

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <div className="space-y-4">

        {/* ── SLA alert bar ───────────────────────────────────────────── */}
        {(criticalSLA > 0 || warningSLA > 0) && (
          <div className={cn(
            'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm',
            criticalSLA > 0
              ? 'bg-destructive/8 border-destructive/25 text-destructive'
              : 'bg-warning/8 border-warning/25 text-warning',
          )}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">
              {criticalSLA > 0
                ? `${criticalSLA} request${criticalSLA > 1 ? 's' : ''} past critical SLA (48h+)`
                : `${warningSLA} request${warningSLA > 1 ? 's' : ''} past warning SLA (24h+)`}
              {' — '}action needed
            </span>
          </div>
        )}

        {/* ── Employee identity card ──────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <SignedImage
              path={pers?.profile_photo}
              alt={fullName}
              className="w-14 h-14 rounded-full object-cover ring-2 ring-border flex-shrink-0"
              fallback={
                <div className="w-14 h-14 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-primary font-bold text-lg">{initials}</span>
                </div>
              }
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <p className="text-sm font-bold text-foreground">{fullName}</p>
                <Badge
                  variant={emp.status === 'active' ? 'success' : 'secondary'}
                  className="rounded-full text-[10px] capitalize"
                >
                  {emp.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{emp.employee_code}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {job?.designations?.name && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Award className="h-3 w-3" />{job.designations.name}
                  </span>
                )}
                {job?.departments?.name && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Building2 className="h-3 w-3" />{job.departments.name}
                  </span>
                )}
                {job?.work_locations && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3" />{job.work_locations.name}
                  </span>
                )}
                {emp.joining_date && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />Joined {fmtDate(emp.joining_date, { month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            {/* Quick nav */}
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Link to={`/manager/team/attendance`}>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                  <UserCheck className="h-3.5 w-3.5" />
                  Approval Inbox
                </Button>
              </Link>
              <Link to={`/admin/employees/${employeeId}`}>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground">
                  <ArrowRight className="h-3.5 w-3.5" />
                  Full HR Profile
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* ── Two-column layout ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Left: Pending approvals (3/5 width) */}
          <div className="lg:col-span-3 space-y-4">

            <SectionCard
              title={pendingFromEmployee.length > 0
                ? `${pendingFromEmployee.length} Pending Request${pendingFromEmployee.length > 1 ? 's' : ''}`
                : 'Pending Requests'}
              icon={<Clock className={cn('h-4 w-4', pendingFromEmployee.length > 0 ? 'text-warning' : 'text-muted-foreground')} />}
            >
              {pendingFromEmployee.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-7 w-7 opacity-30" />
                  <p className="text-xs">No pending requests from {emp.first_name}.</p>
                </div>
              ) : (
                pendingFromEmployee.map(req => (
                  <PendingCard
                    key={req.id}
                    req={req}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    approving={anyMutating}
                    rejecting={anyMutating}
                  />
                ))
              )}
            </SectionCard>

          </div>

          {/* Right: Stats (2/5 width) */}
          <div className="lg:col-span-2 space-y-4">

            {/* Attendance this month */}
            <SectionCard
              title="This Month"
              icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}
              action={
                <Link to={`/manager/team/attendance`} className="text-[10px] text-primary hover:underline">
                  View all
                </Link>
              }
            >
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Present',  value: attStats.present, color: 'text-success',     bg: 'bg-success/10'      },
                  { label: 'Absent',   value: attStats.absent,  color: 'text-destructive', bg: 'bg-destructive/8'   },
                  { label: 'Late',     value: attStats.late,    color: 'text-warning',     bg: 'bg-warning/8'       },
                  { label: 'LOP',      value: attStats.lop,     color: 'text-destructive', bg: 'bg-destructive/5'   },
                ].map(s => (
                  <div key={s.label} className={cn('rounded-lg p-2.5', s.bg)}>
                    <p className={cn('text-lg font-bold', s.color)}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Leave balances */}
            <SectionCard
              title="Leave Balance"
              icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
            >
              {leaveBalances.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">No balances available.</p>
              ) : (
                leaveBalances.slice(0, 5).map((lb, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                    <span className="text-[11px] text-muted-foreground truncate">{lb.leave_type_name ?? 'Leave'}</span>
                    <span className={cn(
                      'text-xs font-bold',
                      lb.balance_days <= 1 ? 'text-destructive' : lb.balance_days <= 3 ? 'text-warning' : 'text-success',
                    )}>
                      {lb.balance_days}d
                    </span>
                  </div>
                ))
              )}
            </SectionCard>

            {/* Quick links */}
            <SectionCard
              title="Manager Tools"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="space-y-1">
                {[
                  { label: 'View full attendance',     href: `/manager/team/attendance`, icon: CalendarDays },
                  { label: 'All team requests',        href: `/manager/team/attendance`, icon: Users        },
                  { label: 'Leave conflict check',     href: `/admin/attendance`,   icon: CalendarOff  },
                  { label: 'Send message (HR)',        href: `/ess/hr-support`,     icon: MessageSquare },
                ].map(item => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href + item.label}
                      to={item.href}
                      className="flex items-center gap-2.5 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors group"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-foreground group-hover:text-primary transition-colors">{item.label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-auto" />
                    </Link>
                  )
                })}
              </div>
            </SectionCard>

          </div>
        </div>
      </div>
    </PageContainer>
  )
}
