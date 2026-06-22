/**
 * Background Verification (BGV) management for a candidate's application.
 * HR initiates the case, records each check's status / vendor ref / remarks,
 * and finalizes the verdict (clear / flagged).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface BgvCheck {
  id: string
  check_type: string
  status: string
  vendor_ref: string | null
  remarks: string | null
}
interface BgvCase {
  id: string
  status: string
  vendor: string | null
  initiated_at: string
  completed_at: string | null
  overall_remarks: string | null
  checks: BgvCheck[]
}

const CHECK_LABEL: Record<string, string> = {
  identity: 'Identity', education: 'Education', employment: 'Employment',
  criminal: 'Criminal record', address: 'Address', reference: 'Reference',
}
const CHECK_STATUSES = ['pending', 'initiated', 'in_progress', 'clear', 'flagged', 'not_applicable']
const STATUS_CLS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground', initiated: 'bg-info/10 text-info',
  in_progress: 'bg-info/10 text-info', clear: 'bg-success/10 text-success',
  flagged: 'bg-destructive/10 text-destructive', not_applicable: 'bg-muted text-muted-foreground',
  not_started: 'bg-muted text-muted-foreground', cancelled: 'bg-muted text-muted-foreground',
}

export function bgvStatusClass(status: string) { return STATUS_CLS[status] ?? 'bg-muted text-muted-foreground' }

export function BgvDialog({ appId, candidateName, open, onOpenChange }: {
  appId: string; candidateName: string; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [vendor, setVendor] = useState('')

  const { data, isLoading } = useQuery<{ data: BgvCase | null }>({
    queryKey: ['bgv', appId],
    queryFn: () => api.get(`/recruitment/applications/${appId}/bgv`),
    enabled: open && !!appId,
  })
  const bgv = data?.data ?? null

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bgv', appId] })
    qc.invalidateQueries({ queryKey: ['recruitment', 'hired'] })
  }

  const initiateMut = useMutation({
    mutationFn: () => api.post(`/recruitment/applications/${appId}/bgv/initiate`, { vendor: vendor || undefined }),
    onSuccess: () => { invalidate(); toast.success('BGV initiated') },
    onError: (e: Error) => toast.error('Failed to initiate BGV', { description: e.message }),
  })
  const updateCheckMut = useMutation({
    mutationFn: (p: { id: string; patch: Partial<BgvCheck> }) => api.patch(`/recruitment/bgv/checks/${p.id}`, p.patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error('Failed to update check', { description: e.message }),
  })
  const finalizeMut = useMutation({
    mutationFn: (status: 'clear' | 'flagged') => api.post(`/recruitment/bgv/cases/${bgv!.id}/finalize`, { status }),
    onSuccess: () => { invalidate(); toast.success('BGV finalized') },
    onError: (e: Error) => toast.error('Failed to finalize', { description: e.message }),
  })

  const anyFlagged = bgv?.checks.some(c => c.status === 'flagged')
  const allResolved = bgv?.checks.every(c => ['clear', 'flagged', 'not_applicable'].includes(c.status))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Background Verification — {candidateName}
            {bgv && <Badge variant="outline" className={cn('text-[10px] capitalize', bgvStatusClass(bgv.status))}>{bgv.status.replace('_', ' ')}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : !bgv ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              No verification opened yet. Initiating BGV creates the standard checks (identity, education, employment,
              criminal record, address, reference) for HR or your vendor to fill in.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Vendor (optional)</label>
              <Input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. AuthBridge, IDfy…" className="h-9 text-sm" />
            </div>
            <Button onClick={() => initiateMut.mutate()} disabled={initiateMut.isPending}>
              {initiateMut.isPending ? 'Initiating…' : 'Initiate BGV'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {bgv.vendor && <p className="text-xs text-muted-foreground">Vendor: <span className="font-medium text-foreground">{bgv.vendor}</span></p>}
            {bgv.checks.map(c => (
              <div key={c.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{CHECK_LABEL[c.check_type] ?? c.check_type}</span>
                  <select
                    value={c.status}
                    onChange={e => updateCheckMut.mutate({ id: c.id, patch: { status: e.target.value } })}
                    className={cn('h-7 rounded-md border border-input px-2 text-xs capitalize', bgvStatusClass(c.status))}
                  >
                    {CHECK_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    defaultValue={c.vendor_ref ?? ''}
                    placeholder="Vendor reference #"
                    className="h-7 text-xs"
                    onBlur={e => { if (e.target.value !== (c.vendor_ref ?? '')) updateCheckMut.mutate({ id: c.id, patch: { vendor_ref: e.target.value } }) }}
                  />
                  <Input
                    defaultValue={c.remarks ?? ''}
                    placeholder="Remarks"
                    className="h-7 text-xs"
                    onBlur={e => { if (e.target.value !== (c.remarks ?? '')) updateCheckMut.mutate({ id: c.id, patch: { remarks: e.target.value } }) }}
                  />
                </div>
              </div>
            ))}

            {bgv.status !== 'clear' && bgv.status !== 'flagged' && (
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground"
                  disabled={!allResolved || anyFlagged || finalizeMut.isPending}
                  onClick={() => finalizeMut.mutate('clear')}>
                  Mark Clear
                </Button>
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5"
                  disabled={finalizeMut.isPending}
                  onClick={() => finalizeMut.mutate('flagged')}>
                  Mark Flagged
                </Button>
                {!allResolved && <span className="text-[11px] text-muted-foreground">Resolve all checks to mark clear.</span>}
              </div>
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
