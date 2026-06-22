/**
 * EssWfh — /ess/wfh
 * Request work-from-home in advance + track status. Managers/HR also see and
 * action their team's pending WFH requests on the same page.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Home, Plus } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Textarea }      from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

interface WfhReq {
  id: string; from_date: string; to_date: string; days: number; reason: string | null
  status: string; decision_remarks: string | null
  employee_name?: string | null; employee_code?: string | null
}

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning', approved: 'bg-success/10 text-success',
  rejected: 'bg-destructive/10 text-destructive', cancelled: 'bg-muted text-muted-foreground',
}
const fmt = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function EssWfh() {
  const qc = useQueryClient()
  const [from, setFrom] = useState('')
  const [to, setTo]     = useState('')
  const [reason, setReason] = useState('')

  const { data: mine } = useQuery<{ data: WfhReq[] }>({ queryKey: ['wfh-my'], queryFn: () => api.get('/attendance/wfh/my') })
  const { data: pending } = useQuery<{ data: WfhReq[] }>({ queryKey: ['wfh-pending'], queryFn: () => api.get('/attendance/wfh/pending') })

  const myReqs = mine?.data ?? []
  const pend   = pending?.data ?? []

  const submitMut = useMutation({
    mutationFn: () => api.post('/attendance/wfh/my', { from_date: from, to_date: to || from, reason: reason || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wfh-my'] }); setFrom(''); setTo(''); setReason(''); toast.success('WFH request submitted') },
    onError: (e: Error) => toast.error('Failed to submit', { description: e.message }),
  })
  const decideMut = useMutation({
    mutationFn: (p: { id: string; decision: 'approved' | 'rejected' }) => api.patch(`/attendance/wfh/${p.id}/decide`, { decision: p.decision }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wfh-pending'] }); toast.success('Updated') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader title="Work From Home" subtitle="Request WFH in advance and track approvals" />

      <SectionCard title="Request WFH" icon={<Plus className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why are you working from home?" className="text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={() => submitMut.mutate()} disabled={submitMut.isPending || !from}>
            {submitMut.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </SectionCard>

      {pend.length > 0 && (
        <SectionCard title="Pending approvals" icon={<Home className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-2">
            {pend.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.employee_name} {r.employee_code ? `· ${r.employee_code}` : ''}</p>
                  <p className="text-xs text-muted-foreground">{fmt(r.from_date)} – {fmt(r.to_date)} · {r.days} day{r.days !== 1 ? 's' : ''}</p>
                  {r.reason && <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" className="h-7 text-xs" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: r.id, decision: 'approved' })}>Approve</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: r.id, decision: 'rejected' })}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="My WFH requests">
        {myReqs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No WFH requests yet.</p>
        ) : (
          <div className="space-y-2">
            {myReqs.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{fmt(r.from_date)} – {fmt(r.to_date)} · {r.days} day{r.days !== 1 ? 's' : ''}</p>
                  {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  {r.decision_remarks && <p className="text-xs text-muted-foreground mt-0.5">Note: {r.decision_remarks}</p>}
                </div>
                <Badge variant="outline" className={cn('text-[10px] capitalize shrink-0', STATUS_CLS[r.status])}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}

export default EssWfh
