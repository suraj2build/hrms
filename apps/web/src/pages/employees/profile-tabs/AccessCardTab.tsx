/**
 * EmployeeProfile › Access Card tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Plus, CreditCard, Package, Loader2 } from 'lucide-react'
import {
  EmptySection,
  type AccessCardRow, type AssetRow, type AssetHistoryRow, type BadgeVariant, type FormBag, type Section,
} from './shared'
import { fmtDate } from './format-helpers'

interface AccessCardTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
}

export function AccessCardTab({ id, isAdmin, subTab, visited }: AccessCardTabProps) {
  const qc = useQueryClient()

  const { data: accessCardsData } = useQuery<{ data: AccessCardRow[] }>({
    queryKey: ['access-cards', id], queryFn: () => api.get(`/employees/${id}/access-cards`),
    enabled: !!id && visited.has('assets'), staleTime: 30_000,
  })
  const { data: empAssetsData } = useQuery<{ data: { assigned: AssetRow[]; history: AssetHistoryRow[] } }>({
    queryKey: ['emp-assets', id], queryFn: () => api.get(`/employees/${id}/assets`),
    enabled: !!id && visited.has('assets'), staleTime: 30_000,
  })

  const [addCardOpen, setAddCardOpen] = useState(false)
  const [cardForm, setCardForm]       = useState<FormBag>({})
  const addCardMutation = useMutation({
    mutationFn: (d: FormBag) => api.post(`/employees/${id}/access-cards`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['access-cards', id] }); setAddCardOpen(false); toast.success('Card issued') },
    onError:   () => toast.error('Failed'),
  })
  const updateCardMutation = useMutation({
    mutationFn: ({ cardId, status }: { cardId: string; status: string }) =>
      api.put(`/employees/${id}/access-cards/${cardId}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['access-cards', id] }); toast.success('Card status updated') },
    onError:   (e: Error) => toast.error('Failed to update card status', { description: e.message }),
  })

  return (
    <>
      {subTab === 'access-card' && (
        <div className="space-y-3">
          {isAdmin && !(accessCardsData?.data ?? []).some((c) => c.status === 'active') && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setCardForm({ issued_date: new Date().toISOString().slice(0,10) }); setAddCardOpen(true) }}><Plus className="h-3.5 w-3.5" />Issue Card</Button>
            </div>
          )}
          {!(accessCardsData?.data?.length)
            ? <Card><CardContent className="pt-6"><EmptySection icon={CreditCard} title="No access cards" /></CardContent></Card>
            : accessCardsData!.data.map((card: AccessCardRow) => {
                const STATUS_MAP: Record<string, BadgeVariant> = { active: 'success', returned: 'secondary', deactivated: 'secondary', lost: 'destructive' }
                const v: BadgeVariant = STATUS_MAP[card.status as string] ?? 'secondary'
                return (
                  <Card key={card.id}>
                    <CardContent className="pt-4 pb-4 flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold font-mono">{card.card_number}</p>
                        <p className="text-xs text-muted-foreground">Issued: {fmtDate(card.issued_date)}</p>
                        {card.returned_date && <p className="text-xs text-muted-foreground">Returned: {fmtDate(card.returned_date)}</p>}
                        <Badge variant={v} className="rounded-full text-[10px] mt-1 capitalize">{card.status}</Badge>
                      </div>
                      {isAdmin && card.status === 'active' && (
                        <div className="flex gap-1">
                          {(['returned','lost','deactivated'] as const).map(s => (
                            <Button key={s} size="sm" variant="outline" className="h-6 text-[10px] capitalize"
                              onClick={() => updateCardMutation.mutate({ cardId: card.id, status: s })}>{s}</Button>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}

          {/* Assigned company assets (read-only) */}
          <div className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Assigned Assets</p>
            {!(empAssetsData?.data?.assigned?.length)
              ? <Card><CardContent className="pt-6"><EmptySection icon={Package} title="No assets assigned" /></CardContent></Card>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['Asset Code', 'Name', 'Status', 'Assigned'].map(h => (
                          <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {empAssetsData!.data.assigned.map((a) => {
                        const lastAssigned = (empAssetsData?.data?.history ?? [])
                          .find((h) => h.asset_id === a.id && h.action === 'assigned')
                        return (
                          <tr key={a.id} className="border-b border-border/50">
                            <td className="px-3 py-2"><Badge variant="outline" className="rounded-full text-xs font-mono">{a.asset_code}</Badge></td>
                            <td className="px-3 py-2 font-medium">{a.name}</td>
                            <td className="px-3 py-2"><Badge variant="secondary" className="rounded-full text-xs capitalize">{a.status}</Badge></td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{lastAssigned ? fmtDate(lastAssigned.action_date) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </div>
      )}

      <Dialog open={addCardOpen} onOpenChange={setAddCardOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Issue Access Card</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Card Number</Label><Input className="mt-1 h-8 text-xs" value={cardForm.card_number??''} onChange={e=>setCardForm((p)=>({...p,card_number:e.target.value}))}/></div>
            <div><Label className="text-xs">Issued Date</Label><DateInput className="mt-1 h-8 text-xs" value={cardForm.issued_date??''} onChange={v=>setCardForm((p)=>({...p,issued_date:v}))}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddCardOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addCardMutation.mutate(cardForm)} disabled={addCardMutation.isPending}>
              {addCardMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
