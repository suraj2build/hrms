import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Users, Clock, AlertTriangle,
  Calendar, ArrowRight, ClipboardList,
} from 'lucide-react'
import { api }             from '@/lib/api/client'
import { Button }          from '@/components/ui/button'
import {
  DashboardShell, DashboardGrid, DashboardMain, DashboardRail,
  DashboardSection, MetricCard, MetricRow, ActionQueue,
  EmptyWorkspaceState,
} from '@/components/dashboard'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegItem {
  id: string; employee_name?: string; employee_code?: string
  date: string; reason: string; status: string; created_at: string
}

interface LeaveApp {
  id: string; employee_id: string
  from_date: string; to_date: string; status: string; reason?: string
  leave_types?: { name: string }
  profiles?: { full_name: string }
}

interface AnomalyResp { total?: number; data?: unknown[] }
interface CorrectionsResp { total?: number; data?: unknown[] }
interface Holiday { id: string; name: string; date: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ManagerDashboardPage() {
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const today    = new Date().toISOString().slice(0, 10)

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: regResp } = useQuery<{ data: RegItem[] }>({
    queryKey: ['mgr-reg-pending'],
    queryFn:  () => api.get('/attendance/regularisation/pending'),
    staleTime: 60_000,
  })

  const { data: leaveResp } = useQuery<{ data: LeaveApp[] }>({
    queryKey: ['mgr-leave-pending'],
    queryFn:  () => api.get('/attendance/leave/pending'),
    staleTime: 60_000,
  })

  const { data: anomalyResp } = useQuery<AnomalyResp>({
    queryKey: ['mgr-anomaly-count'],
    queryFn:  () => api.get('/attendance/anomalies?resolved=false&limit=1'),
    staleTime: 2 * 60_000,
  })

  const { data: correctionsResp } = useQuery<CorrectionsResp>({
    queryKey: ['mgr-corrections-count'],
    queryFn:  () => api.get('/attendance/corrections?status=pending&limit=1'),
    staleTime: 2 * 60_000,
  })

  const { data: holidaysResp } = useQuery<{ data: Holiday[] }>({
    queryKey: ['holidays'],
    queryFn:  () => api.get('/masters/holidays'),
    staleTime: 60 * 60_000,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const { mutate: approveReg, variables: approvingRegId } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mgr-reg-pending'] })
      toast.success('Correction request approved')
    },
    onError: (e: Error) => toast.error('Failed to approve correction request', { description: e.message }),
  })
  const { mutate: rejectReg } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/regularisation/${id}/reject`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mgr-reg-pending'] })
      toast.success('Correction request rejected')
    },
    onError: (e: Error) => toast.error('Failed to reject correction request', { description: e.message }),
  })
  const { mutate: approveLeave, variables: approvingLeaveId } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/leave/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mgr-leave-pending'] })
      toast.success('Leave request approved')
    },
    onError: (e: Error) => toast.error('Failed to approve leave request', { description: e.message }),
  })
  const { mutate: rejectLeave } = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/leave/${id}/reject`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mgr-leave-pending'] })
      toast.success('Leave request rejected')
    },
    onError: (e: Error) => toast.error('Failed to reject leave request', { description: e.message }),
  })

  // ── Derived ───────────────────────────────────────────────────────────────────
  const regList          = regResp?.data ?? []
  const leaveList        = leaveResp?.data ?? []
  const anomalyCount     = anomalyResp?.total ?? (Array.isArray(anomalyResp?.data) ? anomalyResp!.data.length : 0)
  const correctionsCount = correctionsResp?.total ?? (Array.isArray(correctionsResp?.data) ? correctionsResp!.data.length : 0)
  const totalPending     = regList.length + leaveList.length
  const upcomingHolidays = (holidaysResp?.data ?? []).filter(h => h.date >= today).slice(0, 5)

  // Build action queues
  const leaveQueue = leaveList.slice(0, 8).map(l => ({
    id: l.id,
    title: l.profiles?.full_name ?? 'Team member',
    subtitle: `${l.leave_types?.name ?? 'Leave'} · ${fmtDate(l.from_date)} – ${fmtDate(l.to_date)}`,
    meta: l.reason ?? undefined,
    status: 'pending',
    statusVariant: 'warning' as const,
    primaryAction: {
      label: approvingLeaveId === l.id ? '…' : 'Approve',
      loading: approvingLeaveId === l.id,
      onClick: () => approveLeave(l.id),
    },
    secondaryAction: {
      label: 'Reject',
      onClick: () => rejectLeave(l.id),
    },
  }))

  const regQueue = regList.slice(0, 8).map(r => ({
    id: r.id,
    title: r.employee_name ? `${r.employee_name} · ${r.employee_code ?? ''}` : 'Team correction',
    subtitle: r.reason.slice(0, 60),
    meta: fmtDate(r.date),
    status: 'pending',
    statusVariant: 'warning' as const,
    primaryAction: {
      label: approvingRegId === r.id ? '…' : 'Approve',
      loading: approvingRegId === r.id,
      onClick: () => approveReg(r.id),
    },
    secondaryAction: {
      label: 'Reject',
      onClick: () => rejectReg(r.id),
    },
  }))

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DashboardShell>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">Team Overview</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/admin/manager-dashboard')}>
          <Users className="h-3 w-3 mr-1.5" />
          Full team view
        </Button>
      </div>

      {/* ── Metrics ──────────────────────────────────────────────────────── */}
      <MetricRow cols={4}>
        <MetricCard
          label="Pending Approvals"
          value={totalPending}
          icon={ClipboardList}
          variant={totalPending > 0 ? 'warning' : 'neutral'}
          subtitle="Leave + corrections"
        />
        <MetricCard
          label="Leave Requests"
          value={leaveList.length}
          icon={Calendar}
          variant={leaveList.length > 0 ? 'info' : 'neutral'}
          subtitle="Awaiting approval"
          onClick={() => navigate('/admin/approvals/inbox')}
        />
        <MetricCard
          label="Anomalies"
          value={anomalyCount}
          icon={AlertTriangle}
          variant={anomalyCount > 0 ? 'warning' : 'neutral'}
          subtitle="Unresolved"
          onClick={() => navigate('/admin/attendance/anomalies')}
        />
        <MetricCard
          label="Corrections"
          value={correctionsCount}
          icon={Clock}
          variant={correctionsCount > 0 ? 'destructive' : 'neutral'}
          subtitle="Pending review"
          onClick={() => navigate('/admin/attendance/corrections')}
        />
      </MetricRow>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <DashboardGrid>
        <DashboardMain>

          {/* Leave approval queue */}
          <DashboardSection
            title="Leave Approvals"
            subtitle={leaveList.length > 0 ? `${leaveList.length} pending` : 'No pending requests'}
            action={
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => navigate('/admin/approvals/inbox')}>
                Inbox <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          >
            {leaveQueue.length > 0 ? (
              <ActionQueue items={leaveQueue} />
            ) : (
              <EmptyWorkspaceState context="no-approvals" />
            )}
          </DashboardSection>

          {/* Regularisation queue */}
          <DashboardSection
            title="Correction Requests"
            subtitle={regList.length > 0 ? `${regList.length} pending` : 'No pending requests'}
            action={
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => navigate('/admin/attendance/regularisation')}>
                All <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            }
          >
            {regQueue.length > 0 ? (
              <ActionQueue items={regQueue} />
            ) : (
              <EmptyWorkspaceState context="no-corrections" />
            )}
          </DashboardSection>

        </DashboardMain>

        {/* ── Right rail ───────────────────────────────────────────────────── */}
        <DashboardRail>

          {/* Attention strip */}
          {(anomalyCount > 0 || correctionsCount > 0) && (
            <DashboardSection title="Needs Attention">
              <div className="space-y-2">
                {anomalyCount > 0 && (
                  <button
                    onClick={() => navigate('/admin/attendance/anomalies')}
                    className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-warning/20 bg-warning/[0.06] hover:bg-warning/10 transition-colors text-left"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{anomalyCount} unresolved anomalies</p>
                      <p className="text-[10px] text-muted-foreground">Review and resolve</p>
                    </div>
                  </button>
                )}
                {correctionsCount > 0 && (
                  <button
                    onClick={() => navigate('/admin/attendance/corrections')}
                    className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-destructive/20 bg-destructive/[0.06] hover:bg-destructive/10 transition-colors text-left"
                  >
                    <Clock className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{correctionsCount} stale corrections</p>
                      <p className="text-[10px] text-muted-foreground">Awaiting review</p>
                    </div>
                  </button>
                )}
              </div>
            </DashboardSection>
          )}

          {/* Upcoming holidays */}
          {upcomingHolidays.length > 0 && (
            <DashboardSection title="Upcoming Holidays">
              <div className="space-y-2">
                {upcomingHolidays.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground truncate">{h.name}</span>
                    <span className="text-muted-foreground ml-2 flex-shrink-0">{fmtDate(h.date)}</span>
                  </div>
                ))}
              </div>
            </DashboardSection>
          )}

          {/* Quick links */}
          <DashboardSection title="Team">
            <div className="space-y-1.5">
              {[
                { label: 'Muster Roll',    href: '/admin/attendance/muster' },
                { label: 'Roster Planner', href: '/admin/roster' },
                { label: 'Approval Inbox', href: '/admin/approvals/inbox' },
                { label: 'Employee Shifts',href: '/admin/employee-shifts' },
              ].map(a => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.href)}
                  className="w-full text-left text-xs text-primary hover:text-primary/80 flex items-center gap-1.5 py-1"
                >
                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                  {a.label}
                </button>
              ))}
            </div>
          </DashboardSection>

        </DashboardRail>
      </DashboardGrid>

    </DashboardShell>
  )
}
