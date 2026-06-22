/**
 * Track where a requisition has been posted across external job boards.
 * Manual entry today; automated posting/import is pluggable once a board's API
 * credentials are configured (job_board_connectors).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface Posting { id: string; board: string; external_url: string | null; status: string; posted_at: string }
const BOARDS = ['Naukri', 'LinkedIn', 'Indeed', 'Company site', 'Referral', 'Other']

export function JobBoardPostingsDialog({ requisitionId, title, open, onOpenChange }: {
  requisitionId: string; title: string; open: boolean; onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [board, setBoard] = useState('Naukri')
  const [url, setUrl] = useState('')

  const { data } = useQuery<{ data: Posting[] }>({
    queryKey: ['req-postings', requisitionId], queryFn: () => api.get(`/recruitment/requisitions/${requisitionId}/postings`), enabled: open,
  })
  const postings = data?.data ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['req-postings', requisitionId] })

  const addMut = useMutation({
    mutationFn: () => api.post(`/recruitment/requisitions/${requisitionId}/postings`, { board, external_url: url || undefined }),
    onSuccess: () => { invalidate(); setUrl(''); toast.success('Posting recorded') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/recruitment/requisitions/postings/${id}`),
    onSuccess: () => { invalidate(); toast.success('Removed') },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Job-board postings — {title}</DialogTitle></DialogHeader>

        <div className="space-y-2 py-1">
          {postings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No postings recorded yet.</p>
          ) : postings.map(p => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
              <span className="text-sm font-medium flex-1">{p.board}</span>
              {p.external_url && (
                <a href={p.external_url} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs inline-flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />open
                </a>
              )}
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => delMut.mutate(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select value={board} onChange={e => setBoard(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="Posting URL (optional)" className="h-8 text-sm flex-1" />
          <Button size="sm" disabled={addMut.isPending} onClick={() => addMut.mutate()}>Add</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Automated posting & applicant import per board can be enabled once that board's API credentials are configured.</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
