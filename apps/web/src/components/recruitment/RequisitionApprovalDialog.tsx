/**
 * Multi-stage requisition approval — submit a draft into the chain, then
 * approve/reject each step in order. Final approval opens the requisition.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Circle } from 'lucide-react'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Step { id: string; step_order: number; label: string; status: string; remarks: string | null }

export function RequisitionApprovalDialog({ requisitionId, title, status, open, onOpenChange }: {
  requisitionId: string; title: string; status: string; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: Step[] }>({
    queryKey: ['req-approvals', requisitionId],
    queryFn: () => api.get(`/recruitment/requisitions/${requisitionId}/approvals`),
    enabled: open,
  })
  const steps = data?.data ?? []
  const firstPending = steps.find(s => s.status === 'pending')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['req-approvals', requisitionId] })
    qc.invalidateQueries({ queryKey: ['recruitment', 'requisitions'] })
  }
  const submitMut = useMutation({
    mutationFn: () => api.post(`/recruitment/requisitions/${requisitionId}/submit-approval`),
    onSuccess: () => { invalidate(); toast.success('Submitted for approval') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const decideMut = useMutation({
    mutationFn: (p: { id: string; decision: 'approved' | 'rejected' }) => api.patch(`/recruitment/requisitions/approvals/${p.id}/decide`, { decision: p.decision }),
    onSuccess: (res: any) => { invalidate(); toast.success(res?.opened ? 'Requisition opened' : 'Step updated') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Approval — {title}</DialogTitle></DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : steps.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This requisition hasn't been submitted for approval yet. Submitting routes it through Reporting Manager → HR Head → Finance Head; it opens once all approve.
            </p>
            {status === 'draft' ? (
              <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
                {submitMut.isPending ? 'Submitting…' : 'Submit for approval'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Requisition is <span className="capitalize font-medium">{status}</span>.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2 py-1">
            {steps.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                {s.status === 'approved' ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  : s.status === 'rejected' ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{s.step_order}. {s.label}</p>
                  <p className={cn('text-xs capitalize', s.status === 'approved' ? 'text-success' : s.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground')}>{s.status}</p>
                </div>
                {firstPending?.id === s.id && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" className="h-7 text-xs" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: s.id, decision: 'approved' })}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: s.id, decision: 'rejected' })}>Reject</Button>
                  </div>
                )}
              </div>
            ))}
            {steps.some(s => s.status === 'rejected') && status === 'draft' && (
              <Button size="sm" variant="outline" onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>Resubmit (reset chain)</Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
