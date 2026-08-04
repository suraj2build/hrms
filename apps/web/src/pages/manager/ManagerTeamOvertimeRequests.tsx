/**
 * ManagerTeamOvertimeRequests — P6.3
 *
 * Manager workspace for team overtime requests. Pending queue with inline
 * approve/reject; history tab for approved/rejected requests.
 * Reuses GET /overtime/requests (scoped to direct reports in P6.0b),
 * POST /overtime/requests/:id/approve, POST /overtime/requests/:id/reject.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                 from 'sonner'
import {
  Clock, Check, X, RefreshCw, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api, ApiError }  from '@/lib/api/client'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { cn, fmtDate }    from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OtRequest {
  id:               string
  attendance_date:  string
  raw_ot_minutes:   number
  approved_minutes: number | null
  status:           string
  rate_type:        string
  extra_rate:       number
  is_weekend_day:   boolean
  is_holiday_day:   boolean
  rejection_reason: string | null
  approved_at:      string | null
  created_at:       string
  employees:        { id: string; first_name: string; last_name: string; employee_code: string }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMins(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:      'bg-warning/15 text-warning',
    APPROVED:     'bg-success/15 text-success',
    AUTO_APPROVED: 'bg-success/15 text-success',
    REJECTED:     'bg-destructive/15 text-destructive',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', map[status] ?? 'bg-muted text-muted-foreground')}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function OtRow({ req, onApprove, onReject, busy }: {
  req: OtRequest
  onApprove: (id: string) => void
  onReject: (id: string, reason: string) => void
  busy: boolean
}) {
  const [expanded, setExpanded]   = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const isPending = req.status === 'PENDING'

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {req.employees.first_name} {req.employees.last_name}
            <span className="ml-2 text-xs text-muted-foreground">{req.employees.employee_code}</span>
          </p>
          <p className="text-xs text-muted-foreground">{req.attendance_date}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums">{fmtMins(req.raw_ot_minutes)}</p>
          {req.is_weekend_day && <p className="text-[10px] text-warning">Weekend</p>}
          {req.is_holiday_day && <p className="text-[10px] text-destructive">Holiday</p>}
        </div>
        <StatusBadge status={req.status} />
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-muted/20 text-xs space-y-1">
          <p><span className="text-muted-foreground">Rate:</span> {req.rate_type} × {req.extra_rate}</p>
          {req.approved_minutes != null && <p><span className="text-muted-foreground">Approved:</span> {fmtMins(req.approved_minutes)}</p>}
          {req.rejection_reason && <p><span className="text-muted-foreground">Reason:</span> {req.rejection_reason}</p>}
          {req.approved_at && <p><span className="text-muted-foreground">Actioned:</span> {fmtDate(req.approved_at)}</p>}
          {isPending && !rejecting && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="default" className="h-7 gap-1 bg-success hover:bg-success/90"
                disabled={busy}
                onClick={e => { e.stopPropagation(); onApprove(req.id) }}>
                <Check className="h-3 w-3" /> Approve
              </Button>
              <Button size="sm" variant="destructive" className="h-7 gap-1"
                disabled={busy}
                onClick={e => { e.stopPropagation(); setRejecting(true) }}>
                <X className="h-3 w-3" /> Reject
              </Button>
            </div>
          )}
          {isPending && rejecting && (
            // The backend requires a non-empty rejection_reason
            // (z.string().min(1)) — this page previously called reject with
            // an empty body, so every click 400'd and the request stayed
            // pending forever.
            <div className="flex items-center gap-2 pt-2" onClick={e => e.stopPropagation()}>
              <Input
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for rejection…"
                className="h-7 text-xs flex-1 max-w-xs"
                autoFocus
              />
              <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs"
                disabled={busy || !rejectReason.trim()}
                onClick={() => onReject(req.id, rejectReason.trim())}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Confirm Reject
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => { setRejecting(false); setRejectReason('') }}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ManagerTeamOvertimeRequests({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const qc = useQueryClient()

  const { data, isFetching, refetch } = useQuery<{ data: OtRequest[] }>({
    queryKey: ['manager-team-overtime', tab],
    queryFn:  () => api.get(`/overtime/requests${tab === 'pending' ? '?status=PENDING' : ''}`),
    staleTime: 60_000,
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/overtime/requests/${id}/approve`, {}),
    // The admin OvertimeManagement.tsx "Requests" tab reads the same
    // /overtime/requests endpoint under ['ot-requests'] — invalidate both so
    // approving here doesn't leave that queue stale.
    onSuccess:  () => {
      toast.success('OT request approved')
      qc.invalidateQueries({ queryKey: ['manager-team-overtime'] })
      qc.invalidateQueries({ queryKey: ['ot-requests'] })
      // The manager sidebar's persistent "Approvals" badge count aggregates
      // pending overtime (among others) under this separate key.
      qc.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
    },
    onError:    (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'Overtime approval is blocked — the attendance period has been finalized for payroll.' })
      } else {
        toast.error('Failed to approve')
      }
    },
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/overtime/requests/${id}/reject`, { rejection_reason: reason }),
    onSuccess:  () => {
      toast.success('OT request rejected')
      qc.invalidateQueries({ queryKey: ['manager-team-overtime'] })
      qc.invalidateQueries({ queryKey: ['ot-requests'] })
      qc.invalidateQueries({ queryKey: ['manager-pending-approvals-count'] })
    },
    onError:    (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'Overtime rejection is blocked — the attendance period has been finalized for payroll.' })
      } else {
        toast.error('Failed to reject', { description: e.message })
      }
    },
  })

  const actioningId = approveMut.isPending ? approveMut.variables
    : rejectMut.isPending ? rejectMut.variables?.id
    : null

  const rows = data?.data ?? []
  const pending = rows.filter(r => r.status === 'PENDING')

  const body = (
    <>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'pending' ? `Pending${pending.length > 0 ? ` (${pending.length})` : ''}` : 'History'}
          </button>
        ))}
      </div>

      <SectionCard>
        {isFetching && rows.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Clock className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">{tab === 'pending' ? 'No pending OT requests' : 'No OT history'}</p>
          </div>
        ) : (
          <div className="divide-y-0">
            {rows.map(r => (
              <OtRow
                key={r.id}
                req={r}
                onApprove={id => approveMut.mutate(id)}
                onReject={(id, reason) => rejectMut.mutate({ id, reason })}
                busy={actioningId === r.id}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </>
  )

  if (embedded) return body

  return (
    <PageContainer>
      <PageHeader
        title="Team Overtime"
        subtitle="Review and approve overtime requests for your team."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />
      {body}
    </PageContainer>
  )
}

export default ManagerTeamOvertimeRequests
