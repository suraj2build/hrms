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
import { cn }             from '@/lib/utils'

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
    PENDING:      'bg-warning text-warning',
    APPROVED:     'bg-success text-success',
    AUTO_APPROVED: 'bg-success text-success',
    REJECTED:     'bg-destructive text-destructive',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', map[status] ?? 'bg-muted text-muted-foreground')}>
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Row component ─────────────────────────────────────────────────────────────

function OtRow({ req, onAction }: {
  req: OtRequest
  onAction: (id: string, action: 'approve' | 'reject') => void
}) {
  const [expanded, setExpanded] = useState(false)
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
          {req.approved_at && <p><span className="text-muted-foreground">Actioned:</span> {new Date(req.approved_at).toLocaleDateString()}</p>}
          {isPending && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="default" className="h-7 gap-1 bg-success hover:bg-success/90"
                onClick={e => { e.stopPropagation(); onAction(req.id, 'approve') }}>
                <Check className="h-3 w-3" /> Approve
              </Button>
              <Button size="sm" variant="destructive" className="h-7 gap-1"
                onClick={e => { e.stopPropagation(); onAction(req.id, 'reject') }}>
                <X className="h-3 w-3" /> Reject
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
    onSuccess:  () => { toast.success('OT request approved'); qc.invalidateQueries({ queryKey: ['manager-team-overtime'] }) },
    onError:    (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'Overtime approval is blocked — the attendance period has been finalized for payroll.' })
      } else {
        toast.error('Failed to approve')
      }
    },
  })

  const rejectMut = useMutation({
    mutationFn: (id: string) => api.post(`/overtime/requests/${id}/reject`, {}),
    onSuccess:  () => { toast.success('OT request rejected'); qc.invalidateQueries({ queryKey: ['manager-team-overtime'] }) },
    onError:    (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'Overtime rejection is blocked — the attendance period has been finalized for payroll.' })
      } else {
        toast.error('Failed to reject')
      }
    },
  })

  function onAction(id: string, action: 'approve' | 'reject') {
    if (action === 'approve') approveMut.mutate(id)
    else rejectMut.mutate(id)
  }

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
            {rows.map(r => <OtRow key={r.id} req={r} onAction={onAction} />)}
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
