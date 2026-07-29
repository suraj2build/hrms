import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { glossy } from '../glossy'

interface RegReq {
  id: string
  date: string
  reason: string
  status: string
  employee_name: string | null
  employee_code: string | null
}
interface BulkResult { results: Array<{ id: string; ok: boolean; error?: string }> }

/** Manager "Team" persona — pending team regularisations with approve/reject. */
export function MobileTeam() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<{ data: RegReq[] }>({
    queryKey: ['mobile-team-reg'],
    queryFn: () => api.get('/attendance/regularisation/team'),
  })

  const pending = (data?.data ?? []).filter((r) => r.status === 'pending')

  // Same underlying regularisation requests are also read by desktop's
  // ManagerTeamRegularisation, the various admin/manager pending queues, and
  // the employee's own approval tracker — all must refresh together.
  function invalidateRegularisationViews() {
    qc.invalidateQueries({ queryKey: ['mobile-team-reg'] })
    qc.invalidateQueries({ queryKey: ['manager-team-regularisation'] })
    qc.invalidateQueries({ queryKey: ['reg-pending'] })
    qc.invalidateQueries({ queryKey: ['reg-queue'] })
    qc.invalidateQueries({ queryKey: ['ess-approvals-corrections'] })
    qc.invalidateQueries({ queryKey: ['regularization-my'] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => api.post('/attendance/regularisation/bulk-approve', { ids: [id] }) as Promise<BulkResult>,
    onSuccess: () => { toast.success('Approved'); invalidateRegularisationViews() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const reject = useMutation({
    mutationFn: (id: string) => api.post('/attendance/regularisation/bulk-reject', { ids: [id] }) as Promise<BulkResult>,
    onSuccess: () => { toast.success('Rejected'); invalidateRegularisationViews() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <span className="grid h-12 w-12 mx-auto place-items-center rounded-2xl text-white" style={glossy('#B07B18', '#D9A441')}>
          <Users className="h-5 w-5" />
        </span>
        <p className="mt-2 text-sm font-bold text-[#0F172A]">{pending.length} team requests to review</p>
        <p className="text-[11px] text-muted-foreground">Attendance regularisations from your team</p>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">Loading…</p>}
        {!isLoading && pending.length === 0 && <p className="rounded-xl bg-white px-3 py-5 text-center text-xs text-muted-foreground shadow-sm">All caught up — nothing pending. 🎉</p>}
        {pending.map((r) => (
          <div key={r.id} className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">{r.employee_name ?? '—'}</p>
              <span className="text-[10px] text-muted-foreground">{r.date?.slice(0, 10)}</span>
            </div>
            {r.reason && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{r.reason}</p>}
            <div className="mt-3 flex gap-2">
              <button
                disabled={approve.isPending}
                onClick={() => approve.mutate(r.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-60"
                style={glossy('#1A8050', '#34B27B')}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                disabled={reject.isPending}
                onClick={() => reject.mutate(r.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 py-2 text-xs font-bold text-destructive disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
