/**
 * EmployeeResolutionWorkspace — right-side Sheet drawer with comprehensive
 * employee context for a queue item.
 */

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, X, Clock, ArrowUpRight, AlertTriangle, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SEVERITY_META } from '@/lib/queue/types'
import type { OperationalQueueItem, RelatedEntity } from '@/lib/queue/types'
import { useAuthStore } from '@/stores/authStore'
import { ExplainIssuePanel } from '@/components/advanced/ExplainIssuePanel'

// ── types ─────────────────────────────────────────────────────────────────

export interface EmployeeResolutionWorkspaceProps {
  open:       boolean
  onClose:    () => void
  employeeId: string | null
  queueItem:  OperationalQueueItem | null
}

type TabId = 'summary' | 'attendance' | 'ot' | 'leave' | 'payroll' | 'actions'

// ── helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function toStringRecord(item: unknown): Record<string, string> {
  if (typeof item !== 'object' || item === null) return {}
  return Object.fromEntries(
    Object.entries(item as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]),
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────

function TabSkeleton() {
  return (
    <div className="flex flex-col gap-3 pt-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-4 bg-muted animate-pulse rounded" />
      ))}
    </div>
  )
}

// ── Attendance status badge ────────────────────────────────────────────────

function AttendanceBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    present:  'bg-success/15 text-success',
    absent:   'bg-destructive/15 text-destructive',
    half_day: 'bg-warning/15 text-warning',
    holiday:  'bg-info/15 text-info',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', map[status] ?? 'bg-muted text-muted-foreground')}>
      {status}
    </span>
  )
}

// ── Summary tab ────────────────────────────────────────────────────────────

interface SummaryTabProps {
  queueItem:       OperationalQueueItem
  onApprove:       () => void
  onReject:        () => void
  onSnooze:        () => void
  onEscalate:      () => void
  approvePending:  boolean
  rejectPending:   boolean
  onExplainClick:  () => void
}

function SummaryTab({
  queueItem,
  onApprove,
  onReject,
  onSnooze,
  onEscalate,
  approvePending,
  rejectPending,
  onExplainClick,
}: SummaryTabProps) {
  const meta = SEVERITY_META[queueItem.severity]

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full shrink-0', meta.dot)} />
        <div>
          <p className="text-sm font-semibold text-foreground leading-snug">{queueItem.title}</p>
          <span className={cn('text-[11px] font-medium', meta.color)}>{meta.label}</span>
        </div>
      </div>

      {/* Reason */}
      <p className="text-xs text-muted-foreground leading-relaxed">{queueItem.reason}</p>

      {/* Action required */}
      <div className="bg-primary/5 border border-primary/20 rounded p-3">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1">Action Required</p>
        <p className="text-xs text-foreground">{queueItem.action_required}</p>
      </div>

      {/* Explain This Issue */}
      <button
        type="button"
        onClick={onExplainClick}
        className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        Why was this flagged? Explain this issue
      </button>

      {/* Related entities */}
      {queueItem.related_entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {queueItem.related_entities.map((e: RelatedEntity) => (
            <span
              key={`${e.type}-${e.id}`}
              className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground border border-border px-2 py-0.5 text-[11px]"
            >
              <span className="text-muted-foreground mr-1">{e.type}:</span>
              {e.label}
            </span>
          ))}
        </div>
      )}

      {/* Payroll blocking badge */}
      {queueItem.payroll_blocking && (
        <Badge variant="destructive" className="w-fit">
          <AlertTriangle className="h-3 w-3" /> Payroll Blocking
        </Badge>
      )}

      {/* Due / overdue / estimated resolution */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {queueItem.due_at && (
          <span>
            Due:{' '}
            <span className={cn('font-medium', queueItem.overdue ? 'text-destructive' : 'text-foreground')}>
              {(() => { const _d = new Date(queueItem.due_at); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })()}
              {queueItem.overdue && ' (overdue)'}
            </span>
          </span>
        )}
        <span>
          Est. resolution:{' '}
          <span className="font-medium text-foreground">{queueItem.estimated_resolution_time} min</span>
        </span>
      </div>

      {/* Quick action buttons */}
      <div className="flex gap-2 flex-wrap pt-1">
        <Button size="sm" variant="success" onClick={onApprove} disabled={approvePending}>
          <Check className="h-3.5 w-3.5" /> Approve
        </Button>
        <Button size="sm" variant="destructive" onClick={onReject} disabled={rejectPending}>
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
        <Button size="sm" variant="outline" onClick={onSnooze}>
          <Clock className="h-3.5 w-3.5" /> Snooze 24h
        </Button>
        <Button size="sm" variant="secondary" onClick={onEscalate}>
          <ArrowUpRight className="h-3.5 w-3.5" /> Escalate
        </Button>
      </div>
    </div>
  )
}

// ── Attendance tab ─────────────────────────────────────────────────────────

function AttendanceTab({ employeeId, activeTab }: { employeeId: string; activeTab: TabId }) {
  const { data, isLoading } = useQuery({
    queryKey:  ['emp-attendance-queue', employeeId],
    queryFn:   () => api.get<unknown[]>(`/employees/${employeeId}/attendance?limit=14`).then(r => r),
    enabled:   !!employeeId && activeTab === 'attendance',
    staleTime: 30_000,
  })

  if (isLoading) return <TabSkeleton />

  const rows = Array.isArray(data) ? data.map(toStringRecord) : []

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4">No attendance records found.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2 text-left font-medium">Date</th>
            <th className="py-2 text-left font-medium">In</th>
            <th className="py-2 text-left font-medium">Out</th>
            <th className="py-2 text-left font-medium">Hours</th>
            <th className="py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-3 text-foreground">{row['date'] ?? '—'}</td>
              <td className="py-1.5 pr-3 text-foreground">{row['check_in'] ?? row['in'] ?? '—'}</td>
              <td className="py-1.5 pr-3 text-foreground">{row['check_out'] ?? row['out'] ?? '—'}</td>
              <td className="py-1.5 pr-3 text-foreground">{row['hours'] ?? row['total_hours'] ?? '—'}</td>
              <td className="py-1.5"><AttendanceBadge status={row['status'] ?? 'unknown'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── OT tab ─────────────────────────────────────────────────────────────────

function OtTab({ employeeId, activeTab }: { employeeId: string; activeTab: TabId }) {
  const { data, isLoading } = useQuery({
    queryKey:  ['emp-ot-queue', employeeId],
    queryFn:   () => api.get<unknown[]>(`/employees/${employeeId}/overtime?limit=30`).then(r => r),
    enabled:   !!employeeId && activeTab === 'ot',
    staleTime: 30_000,
  })

  if (isLoading) return <TabSkeleton />

  const rows = Array.isArray(data) ? data.map(toStringRecord) : []

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4">No overtime records in the last 30 days.</p>
  }

  const allHours     = rows.map(r => parseFloat(r['ot_hours'] ?? r['hours'] ?? '0'))
  const totalOtHours = allHours.reduce((s, h) => s + h, 0)
  const maxHours     = Math.max(...allHours, 1)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Total OT this month:{' '}
        <span className="font-semibold text-foreground">{totalOtHours.toFixed(1)} hrs</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {rows.map((row, idx) => {
          const hrs     = allHours[idx] ?? 0
          const pct     = Math.round((hrs / maxHours) * 100)
          const flagged = row['flagged'] === 'true' || row['status'] === 'flagged'
          return (
            <div key={idx} className={cn('flex items-center gap-2', flagged && 'bg-warning/10 rounded px-1')}>
              <span className="text-[11px] text-muted-foreground w-20 shrink-0">
                {row['date'] ?? `Day ${idx + 1}`}
              </span>
              <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                <div
                  className={cn('h-3 rounded transition-all', flagged ? 'bg-warning' : 'bg-primary')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-foreground w-10 text-right shrink-0">{hrs.toFixed(1)}h</span>
              {flagged && <span className="text-[10px] text-warning font-medium">flagged</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Leave tab ──────────────────────────────────────────────────────────────

function LeaveTab({
  employeeId,
  activeTab,
  queueItemCreatedAt,
}: {
  employeeId:          string
  activeTab:           TabId
  queueItemCreatedAt:  string
}) {
  const { data, isLoading } = useQuery({
    queryKey:  ['emp-leave-queue', employeeId],
    queryFn:   () =>
      api.get<unknown[]>(`/leave/requests?employee_id=${employeeId}&status=approved&limit=20`).then(r => r),
    enabled:   !!employeeId && activeTab === 'leave',
    staleTime: 30_000,
  })

  if (isLoading) return <TabSkeleton />

  const rows = Array.isArray(data) ? data.map(toStringRecord) : []

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4">No approved leave found.</p>
  }

  const anomalyDate = queueItemCreatedAt.slice(0, 10)

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, idx) => {
        const from     = row['from_date'] ?? row['start_date'] ?? ''
        const to       = row['to_date']   ?? row['end_date']   ?? ''
        const conflict = from !== '' && to !== '' && anomalyDate >= from && anomalyDate <= to
        return (
          <div
            key={idx}
            className={cn(
              'rounded border px-3 py-2 text-xs',
              conflict ? 'border-warning/40 bg-warning/10' : 'border-border bg-card',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">
                {row['leave_type'] ?? row['type'] ?? 'Leave'}
              </span>
              {conflict && (
                <span className="text-[10px] font-semibold text-warning bg-warning/15 rounded-full px-2 py-0.5">
                  Conflict detected
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-0.5">
              {from || '?'} → {to || '?'}
              {row['days'] ? ` · ${row['days']} days` : ''}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Payroll tab ────────────────────────────────────────────────────────────

function PayrollTab({
  employeeId,
  activeTab,
  payrollBlocking,
}: {
  employeeId:     string
  activeTab:      TabId
  payrollBlocking: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey:  ['emp-payroll-queue', employeeId],
    queryFn:   () => api.get<unknown>(`/employees/${employeeId}/payroll-summary`).then(r => r),
    enabled:   !!employeeId && activeTab === 'payroll',
    staleTime: 30_000,
  })

  if (isLoading) return <TabSkeleton />

  const pd = data ? toStringRecord(data) : null

  return (
    <div className="flex flex-col gap-3">
      {payrollBlocking && (
        <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive font-semibold">
            ⚠ Payroll run blocked pending resolution.
          </p>
        </div>
      )}
      {pd ? (
        <div className="flex flex-col gap-0">
          <PayrollRow label="Current CTC (monthly)" value={pd['ctc_monthly'] ?? pd['ctc'] ?? '—'} />
          <PayrollRow label="Last Payslip Month"    value={pd['last_payslip_month'] ?? '—'} />
          <PayrollRow label="Pending Deductions"    value={pd['pending_deductions'] ?? '—'} />
          <PayrollRow label="Advances"              value={pd['advances'] ?? '—'} />
          <PayrollRow label="Payroll Period Status" value={pd['period_status'] ?? pd['status'] ?? '—'} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No payroll data available.</p>
      )}
    </div>
  )
}

function PayrollRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium text-foreground">{value}</span>
    </div>
  )
}

// ── Actions tab ────────────────────────────────────────────────────────────

interface ActivityLogEntry {
  id:         string
  action:     string
  actor:      string
  created_at: string
  note?:      string
}

function isActivityLogEntry(v: unknown): v is ActivityLogEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    'action' in v &&
    'actor' in v &&
    'created_at' in v
  )
}

function ActionsTab({
  employeeId,
  queueItemId,
  onClose,
}: {
  employeeId:  string
  queueItemId: string
  onClose:     () => void
}) {
  const queryClient = useQueryClient()
  const profile     = useAuthStore(s => s.profile)
  const [note, setNote] = useState('')

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey:  ['emp-activity-log', employeeId],
    queryFn:   () =>
      api
        .get<unknown[]>(`/employees/${employeeId}/activity-log?types=queue_action&limit=20`)
        .catch((): unknown[] => []),
    enabled:   !!employeeId,
    staleTime: 15_000,
  })

  const noteMutation = useMutation({
    mutationFn: () =>
      api.post('/notifications/notes', {
        employee_id:   employeeId,
        queue_item_id: queueItemId,
        note,
        created_by:    profile?.id ?? '',
      }),
    onSuccess: () => {
      toast.success('Note saved')
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['emp-activity-log', employeeId] })
    },
    onError: () => toast.error('Failed to save note'),
  })

  const resolveMutation = useMutation({
    mutationFn: () => api.post(`/attendance/queue/${queueItemId}/resolve`, {}),
    onSuccess:  () => {
      toast.success('Marked as resolved')
      // My Work Queue (useOperationalQueue) reads the same queue items under
      // this key — without it, the resolved item keeps showing as open there
      // for up to the 60s refetch interval.
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to resolve'),
  })

  const escalateMutation = useMutation({
    mutationFn: () => api.post(`/attendance/queue/${queueItemId}/escalate`, {}),
    onSuccess:  () => {
      toast.success('Escalated to manager')
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to escalate'),
  })

  const activityLog = Array.isArray(logData) ? logData.filter(isActivityLogEntry) : []

  return (
    <div className="flex flex-col gap-4">
      {/* Activity log */}
      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-2">Action Log</p>
        {logLoading ? (
          <TabSkeleton />
        ) : activityLog.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No actions recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {activityLog.map(entry => (
              <div key={entry.id} className="rounded border border-border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{entry.action}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(entry.created_at)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">by {entry.actor}</p>
                {entry.note && (
                  <p className="text-[11px] text-foreground mt-1 italic">{entry.note}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add note */}
      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Add Note</p>
        <textarea
          className="w-full rounded border border-input bg-background text-xs text-foreground p-2 min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          placeholder="Write a note..."
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <Button
          size="sm"
          className="mt-1.5"
          onClick={() => noteMutation.mutate()}
          disabled={noteMutation.isPending || note.trim().length === 0}
        >
          Save Note
        </Button>
      </div>

      {/* Resolve / escalate */}
      <div className="flex gap-3 pt-2">
        <Button
          className="flex-1"
          onClick={() => resolveMutation.mutate()}
          disabled={resolveMutation.isPending}
        >
          Mark Resolved
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => escalateMutation.mutate()}
          disabled={escalateMutation.isPending}
        >
          Escalate to Manager
        </Button>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function EmployeeResolutionWorkspace({
  open,
  onClose,
  employeeId,
  queueItem,
}: EmployeeResolutionWorkspaceProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('summary')
  const [explainOpen, setExplainOpen] = useState(false)

  useEffect(() => {
    setActiveTab('summary')
  }, [employeeId])

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/attendance/regularisation/${queueItem?.id}/approve`, {}),
    onSuccess:  () => {
      toast.success('Approved')
      queryClient.invalidateQueries({ queryKey: ['emp-attendance-queue', employeeId] })
      // The employee's own ESS approvals tracker reads the same record.
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      // My Work Queue (useOperationalQueue) reads the same queue item under
      // this separate key.
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to approve'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/attendance/regularisation/${queueItem?.id}/reject`, {}),
    onSuccess:  () => {
      toast.success('Rejected')
      queryClient.invalidateQueries({ queryKey: ['emp-attendance-queue', employeeId] })
      queryClient.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to reject'),
  })

  const snoozeMutation = useMutation({
    mutationFn: () => api.post(`/attendance/queue/${queueItem?.id}/snooze`, { hours: 24 }),
    onSuccess:  () => {
      toast.success('Snoozed for 24h')
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to snooze'),
  })

  const escalateSummaryMutation = useMutation({
    mutationFn: () => api.post(`/attendance/queue/${queueItem?.id}/escalate`, {}),
    onSuccess:  () => {
      toast.success('Escalated')
      queryClient.invalidateQueries({ queryKey: ['operational-queue'] })
      onClose()
    },
    onError:    () => toast.error('Failed to escalate'),
  })

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent className="w-[520px]">
        <SheetHeader>
          <SheetTitle>
            {queueItem?.employee_name ?? 'Employee'} — Resolution Workspace
          </SheetTitle>
          {queueItem?.site_name && (
            <p className="text-xs text-muted-foreground">{queueItem.site_name}</p>
          )}
        </SheetHeader>

        <SheetBody>
          {!queueItem || !employeeId ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No item selected.</p>
          ) : (
            <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
              <TabsList className="w-full grid grid-cols-6 mb-4">
                <TabsTrigger value="summary"    className="text-[11px] px-1">Summary</TabsTrigger>
                <TabsTrigger value="attendance" className="text-[11px] px-1">Attendance</TabsTrigger>
                <TabsTrigger value="ot"         className="text-[11px] px-1">OT</TabsTrigger>
                <TabsTrigger value="leave"      className="text-[11px] px-1">Leave</TabsTrigger>
                <TabsTrigger value="payroll"    className="text-[11px] px-1">Payroll</TabsTrigger>
                <TabsTrigger value="actions"    className="text-[11px] px-1">Actions</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                <SummaryTab
                  queueItem={queueItem}
                  onApprove={()       => approveMutation.mutate()}
                  onReject={()        => rejectMutation.mutate()}
                  onSnooze={()        => snoozeMutation.mutate()}
                  onEscalate={()      => escalateSummaryMutation.mutate()}
                  approvePending={approveMutation.isPending}
                  rejectPending={rejectMutation.isPending}
                  onExplainClick={()  => setExplainOpen(true)}
                />
              </TabsContent>

              <TabsContent value="attendance">
                <AttendanceTab employeeId={employeeId} activeTab={activeTab} />
              </TabsContent>

              <TabsContent value="ot">
                <OtTab employeeId={employeeId} activeTab={activeTab} />
              </TabsContent>

              <TabsContent value="leave">
                <LeaveTab
                  employeeId={employeeId}
                  activeTab={activeTab}
                  queueItemCreatedAt={queueItem.created_at}
                />
              </TabsContent>

              <TabsContent value="payroll">
                <PayrollTab
                  employeeId={employeeId}
                  activeTab={activeTab}
                  payrollBlocking={queueItem.payroll_blocking}
                />
              </TabsContent>

              <TabsContent value="actions">
                <ActionsTab
                  employeeId={employeeId}
                  queueItemId={queueItem.id}
                  onClose={onClose}
                />
              </TabsContent>
            </Tabs>
          )}
        </SheetBody>
      </SheetContent>

      <ExplainIssuePanel
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        item={queueItem}
      />
    </Sheet>
  )
}
