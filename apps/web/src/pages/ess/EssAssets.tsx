/**
 * EssAssets — /ess/assets
 * Employee view of assigned assets + raise and track asset requests.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Package, Plus, Loader2 } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Card, CardContent } from '@/components/ui/card'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Textarea }      from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

interface AssetItem { id: string; asset_code: string | null; name: string; serial_number: string | null; status: string }
interface AssetRequest { id: string; category_name: string | null; item_name: string | null; reason: string | null; status: string; requested_at: string; decision_remarks: string | null }
interface Category { id: string; name: string }

const REQ_STATUS: Record<string, string> = {
  pending: 'bg-warning/10 text-warning', approved: 'bg-info/10 text-info',
  rejected: 'bg-destructive/10 text-destructive', fulfilled: 'bg-success/10 text-success',
  cancelled: 'bg-muted text-muted-foreground',
}
const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function EssAssets() {
  const qc = useQueryClient()
  const [categoryId, setCategoryId] = useState('')
  const [itemName, setItemName]     = useState('')
  const [reason, setReason]         = useState('')

  const { data: assetsData, isLoading } = useQuery<{ data: AssetItem[]; outstanding_count?: number }>({
    queryKey: ['ess-me-assets'], queryFn: () => api.get('/ess/me/assets'),
  })
  const { data: reqData } = useQuery<{ data: AssetRequest[] }>({
    queryKey: ['ess-me-asset-requests'], queryFn: () => api.get('/ess/me/asset-requests'),
  })
  const { data: catsData } = useQuery<{ data: Category[] }>({
    queryKey: ['asset-categories'], queryFn: () => api.get('/masters/asset-categories'),
  })

  const assets   = assetsData?.data ?? []
  const requests = reqData?.data ?? []
  const cats     = catsData?.data ?? []

  const submitMut = useMutation({
    mutationFn: () => api.post('/ess/me/asset-requests', {
      category_id: categoryId || undefined, item_name: itemName || undefined, reason: reason || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ess-me-asset-requests'] })
      // The admin AssetRequestsDialog reads the same pending queue.
      qc.invalidateQueries({ queryKey: ['asset-requests'] })
      setCategoryId(''); setItemName(''); setReason('')
      toast.success('Request submitted')
    },
    onError: (e: Error) => toast.error('Failed to submit request', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader title="My Assets" subtitle="Assets assigned to you, and your asset requests" />

      <SectionCard title="Assigned to me" icon={<Package className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : assets.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No assets are currently assigned to you.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assets.map(a => (
              <Card key={a.id}><CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.asset_code}{a.serial_number ? ` · ${a.serial_number}` : ''}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] capitalize shrink-0">{a.status}</Badge>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Request an asset" icon={<Plus className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              <option value="">— Select —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Or describe the item</label>
            <Input value={itemName} onChange={e => setItemName(e.target.value)} placeholder="e.g. External monitor" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why do you need this?" className="text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={() => submitMut.mutate()} disabled={submitMut.isPending || (!categoryId && !itemName.trim())}>
            {submitMut.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="My requests">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">You haven't raised any asset requests yet.</p>
        ) : (
          <div className="space-y-2">
            {requests.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.category_name ?? r.item_name ?? 'Asset'}</p>
                  {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  {r.decision_remarks && <p className="text-xs text-muted-foreground mt-0.5">HR: {r.decision_remarks}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">Requested {fmtDate(r.requested_at)}</p>
                </div>
                <Badge variant="outline" className={cn('text-[10px] capitalize shrink-0', REQ_STATUS[r.status])}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}

export default EssAssets
