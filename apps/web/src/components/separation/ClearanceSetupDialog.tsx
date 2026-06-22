/**
 * Configure the clearance departments used when initiating separation clearance.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Dept { id: string; code: string; label: string; is_active: boolean; display_order: number }

export function ClearanceSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')

  const { data } = useQuery<{ data: Dept[] }>({
    queryKey: ['clearance-departments'], queryFn: () => api.get('/settlement/clearance-departments'), enabled: open,
  })
  const depts = data?.data ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['clearance-departments'] })

  const addMut = useMutation({
    mutationFn: () => api.post('/settlement/clearance-departments', { code: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label }),
    onSuccess: () => { invalidate(); setLabel(''); toast.success('Department added') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const toggleMut = useMutation({
    mutationFn: (p: { id: string; is_active: boolean }) => api.patch(`/settlement/clearance-departments/${p.id}`, { is_active: p.is_active }),
    onSuccess: invalidate,
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settlement/clearance-departments/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Clearance departments</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">These departments are created as clearance items when a separation's clearance is initiated.</p>

        <div className="space-y-2 py-1">
          {depts.map(d => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
              <span className="flex-1 text-sm font-medium">{d.label}</span>
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={d.is_active} onChange={e => toggleMut.mutate({ id: d.id, is_active: e.target.checked })} />
                active
              </label>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delMut.mutate(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="New department (e.g. Library)" className="h-8 text-sm" />
          <Button size="sm" disabled={!label.trim() || addMut.isPending} onClick={() => addMut.mutate()}>Add</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
