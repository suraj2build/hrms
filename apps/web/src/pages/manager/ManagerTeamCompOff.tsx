/**
 * ManagerTeamCompOff — P6.4
 *
 * Manager workspace for team compensatory-off requests. Pending queue with
 * inline approve/reject; history tab.
 * Reuses GET /attendance/comp-off (scoped to direct reports in P6.0c),
 * POST /attendance/comp-off/:id/approve, POST /attendance/comp-off/:id/reject.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                 from 'sonner'
import {
  CalendarPlus, Check, X, RefreshCw, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { api, ApiError } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CoRequest {
  id:             string
  worked_date:    string
  worked_reason:  string
  days_to_credit: number
  status:         string
  notes:          string | null
  created_at:     string
  reviewed_at:    string | null
  leave_type:     { id: string; name: string } | null
  employee:       { id: string; name: string; employee_code: string } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize', map[status] ?? 'bg-gray-100 text-gray-700')}>
      {status}
    </span>
  )
}

function CoRow({ req, onAction }: {
  req: CoRequest
  onAction: (id: string, action: 'approve' | 'reject') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isPending = req.status === 'pending'

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {req.employee?.name ?? '—'}
            <span className="ml-2 text-xs text-muted-foreground">{req.employee?.employee_code}</span>
          </p>
          <p className="text-xs text-muted-foreground">Worked on {req.worked_date}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold">{req.days_to_credit} day{req.days_to_credit !== 1 ? 's' : ''}</p>
          <p className="text-[10px] text-muted-foreground capitalize">{req.worked_reason.replace('_', ' ')}</p>
        </div>
        <StatusBadge status={req.status} />
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 bg-muted/20 text-xs space-y-1">
          {req.leave_type && <p><span className="text-muted-foreground">Leave type:</span> {req.leave_type.name}</p>}
          {req.notes && <p><span className="text-muted-foreground">Notes:</span> {req.notes}</p>}
          {req.reviewed_at && <p><span className="text-muted-foreground">Reviewed:</span> {new Date(req.reviewed_at).toLocaleDateString()}</p>}
          {isPending && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700"
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

export function ManagerTeamCompOff() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const qc = useQueryClient()

  const { data, isFetching, refetch } = useQuery<{ data: CoRequest[] }>({
    queryKey: ['manager-team-compoff', tab],
    queryFn:  () => api.get(tab === 'pending' ? '/attendance/comp-off?status=pending' : '/attendance/comp-off'),
    staleTime: 60_000,
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/comp-off/${id}/approve`, {}),
    onSuccess:  () => { toast.success('Comp-off approved'); qc.invalidateQueries({ queryKey: ['manager-team-compoff'] }) },
    onError:    (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'This request belongs to a locked attendance period and can no longer be modified.' })
      } else {
        toast.error('Failed to approve')
      }
    },
  })

  const rejectMut = useMutation({
    mutationFn: (id: string) => api.post(`/attendance/comp-off/${id}/reject`, {}),
    onSuccess:  () => { toast.success('Comp-off rejected'); qc.invalidateQueries({ queryKey: ['manager-team-compoff'] }) },
    onError:    () => toast.error('Failed to reject'),
  })

  const rows = data?.data ?? []
  const pendingCount = rows.filter(r => r.status === 'pending').length

  return (
    <PageContainer>
      <PageHeader
        title="Team Comp-Off"
        subtitle="Review compensatory off requests for employees who worked on holidays or weekly offs."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex gap-1 mb-4 border-b border-border">
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'pending' ? `Pending${pendingCount > 0 && tab === 'pending' ? ` (${pendingCount})` : ''}` : 'History'}
          </button>
        ))}
      </div>

      <SectionCard>
        {isFetching && rows.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <CalendarPlus className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">{tab === 'pending' ? 'No pending comp-off requests' : 'No comp-off history'}</p>
          </div>
        ) : (
          rows.map(r => (
            <CoRow
              key={r.id}
              req={r}
              onAction={(id, action) => action === 'approve' ? approveMut.mutate(id) : rejectMut.mutate(id)}
            />
          ))
        )}
      </SectionCard>
    </PageContainer>
  )
}

export default ManagerTeamCompOff
