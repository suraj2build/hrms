/**
 * HR review of employee asset requests — approve / reject, then fulfill an
 * approved request by allocating an available asset.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Req {
  id: string; status: string; category_name: string | null; item_name: string | null
  reason: string | null; requested_at: string; employee_name: string | null; employee_code: string | null
}
interface FreeAsset { id: string; asset_code: string | null; name: string }

const STATUS_CLS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning', approved: 'bg-info/10 text-info',
  rejected: 'bg-destructive/10 text-destructive', fulfilled: 'bg-success/10 text-success',
  cancelled: 'bg-muted text-muted-foreground',
}
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function AssetRequestsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const [fulfilling, setFulfilling] = useState<string | null>(null)
  const [pickedAsset, setPickedAsset] = useState('')

  const { data, isLoading } = useQuery<{ data: Req[] }>({
    queryKey: ['asset-requests'], queryFn: () => api.get('/asset-requests'), enabled: open,
  })
  const { data: freeData } = useQuery<{ data: FreeAsset[] }>({
    queryKey: ['assets', 'available'], queryFn: () => api.get('/assets?status=available'), enabled: open,
  })
  const requests = data?.data ?? []
  const free = freeData?.data ?? []

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['asset-requests'] })
    qc.invalidateQueries({ queryKey: ['assets'] })
    // Fulfilling/deciding a request also changes what the requesting
    // employee, their manager, and the employee's HR profile tab see —
    // each reads the same data under a separate key.
    qc.invalidateQueries({ queryKey: ['ess-me-asset-requests'] })
    qc.invalidateQueries({ queryKey: ['ess-me-assets'] })
    qc.invalidateQueries({ queryKey: ['manager-team-assets'] })
    qc.invalidateQueries({ queryKey: ['emp-assets'] })
  }
  const decideMut = useMutation({
    mutationFn: (p: { id: string; decision: 'approved' | 'rejected' }) => api.patch(`/asset-requests/${p.id}/decide`, { decision: p.decision }),
    onSuccess: () => { invalidate(); toast.success('Updated') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const fulfillMut = useMutation({
    mutationFn: (p: { id: string; asset_id: string }) => api.post(`/asset-requests/${p.id}/fulfill`, { asset_id: p.asset_id }),
    onSuccess: () => { invalidate(); setFulfilling(null); setPickedAsset(''); toast.success('Asset allocated') },
    onError: (e: Error) => toast.error('Failed to fulfill', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Asset Requests</DialogTitle></DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No asset requests.</p>
        ) : (
          <div className="space-y-2 py-1">
            {requests.map(r => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.category_name ?? r.item_name ?? 'Asset'}</p>
                    <p className="text-xs text-muted-foreground">{r.employee_name} {r.employee_code ? `· ${r.employee_code}` : ''}</p>
                    {r.reason && <p className="text-xs text-muted-foreground mt-0.5">{r.reason}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">Requested {fmtDate(r.requested_at)}</p>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] capitalize shrink-0', STATUS_CLS[r.status])}>{r.status}</Badge>
                </div>

                {r.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" className="h-7 text-xs" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: r.id, decision: 'approved' })}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ id: r.id, decision: 'rejected' })}>Reject</Button>
                  </div>
                )}

                {r.status === 'approved' && (
                  fulfilling === r.id ? (
                    <div className="flex items-center gap-2 mt-2">
                      <select value={pickedAsset} onChange={e => setPickedAsset(e.target.value)} className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs">
                        <option value="">Pick an available asset…</option>
                        {free.map(a => <option key={a.id} value={a.id}>{a.asset_code} — {a.name}</option>)}
                      </select>
                      <Button size="sm" className="h-7 text-xs" disabled={!pickedAsset || fulfillMut.isPending} onClick={() => fulfillMut.mutate({ id: r.id, asset_id: pickedAsset })}>Allocate</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setFulfilling(null); setPickedAsset('') }}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs mt-2" onClick={() => { setFulfilling(r.id); setPickedAsset('') }}>Allocate asset</Button>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
