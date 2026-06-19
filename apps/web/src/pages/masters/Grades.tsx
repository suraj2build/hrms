import { useState }                                from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { TrendingUp, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { PageContainer }                          from '@/components/layout/PageContainer'
import { PageHeader }                             from '@/components/layout/PageHeader'
import { SectionCard }                            from '@/components/layout/SectionCard'
import { Button }                                 from '@/components/ui/button'
import { Input }                                  from '@/components/ui/input'
import { Badge }                                  from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                                                 from '@/components/ui/dialog'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'
import { MergeDeleteDialog }                      from '@/components/ui/merge-delete-dialog'

interface Grade {
  id:             string
  code:           string
  name:           string
  description:    string | null
  level_order:    number
  ctc_min_annual: number | null
  ctc_max_annual: number | null
  is_active:      boolean
  created_at:     string
}

const EMPTY: Omit<Grade, 'id' | 'created_at'> = {
  code: '', name: '', description: '', level_order: 0,
  ctc_min_annual: null, ctc_max_annual: null, is_active: true,
}

const fmtCTC = (v: number | null) =>
  v ? `₹${(v / 100000).toFixed(1)}L` : '—'

export function Grades() {
  const qc                     = useQueryClient()
  const { profile }            = useAuthStore()
  const isAdmin                = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,      setDlgOpen]      = useState(false)
  const [editItem,     setEditItem]     = useState<Grade | null>(null)
  const [form,         setForm]         = useState(EMPTY)
  const [err,          setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: gradesData, isLoading } = useQuery<{ data: Grade[] }>({
    queryKey: ['grades'],
    queryFn:  () => api.get('/masters/grades'),
    staleTime: 60_000,
  })
  const grades = gradesData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(g: Grade) {
    setEditItem(g)
    setForm({
      code:           g.code,
      name:           g.name,
      description:    g.description ?? '',
      level_order:    g.level_order,
      ctc_min_annual: g.ctc_min_annual,
      ctc_max_annual: g.ctc_max_annual,
      is_active:      g.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) => {
      const payload = {
        ...body,
        description:    body.description    || null,
        ctc_min_annual: body.ctc_min_annual || null,
        ctc_max_annual: body.ctc_max_annual || null,
      }
      return editItem
        ? api.put(`/masters/grades/${editItem.id}`, payload)
        : api.post('/masters/grades', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Grade updated' : 'Grade created')
    },
    onError: (e: Error) => {
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/grades/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grades'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Grade deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Grades / Bands"
        subtitle="Seniority bands with CTC ranges — referenced on employee job history"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Grade</Button>
            : undefined
        }
      />

      <SectionCard title="All Grades" icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : grades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <TrendingUp className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No grades configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Order', 'Code', 'Name', 'CTC Range', 'Status', ''].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{g.level_order}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-full text-xs font-mono">{g.code}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{g.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                      {(g.ctc_min_annual || g.ctc_max_annual)
                        ? `${fmtCTC(g.ctc_min_annual)} – ${fmtCTC(g.ctc_max_annual)}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={g.is_active ? 'success' : 'secondary'} className="rounded-full text-xs">
                        {g.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(g)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: g.id, name: g.name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Grade' : 'New Grade'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Level Order</label>
              <Input
                type="number"
                value={form.level_order}
                onChange={(e) => setForm((p) => ({ ...p, level_order: Number(e.target.value) }))}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Level 1"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Junior individual contributor"
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Min CTC (Annual ₹)</label>
                <Input
                  type="number"
                  value={form.ctc_min_annual ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, ctc_min_annual: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="300000"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Max CTC (Annual ₹)</label>
                <Input
                  type="number"
                  value={form.ctc_max_annual ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, ctc_max_annual: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="600000"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="grade-active"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5"
              />
              <label htmlFor="grade-active" className="text-xs text-muted-foreground">Active</label>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.name.trim()}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deleteTarget && (
        <MergeDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          entityType="Grade"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/grades/${deleteTarget.id}/usage`}
          usageLabel="employee records"
          mergeOptions={grades.filter(g => g.id !== deleteTarget.id).map(g => ({ id: g.id, name: `${g.name} (${g.code})` }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}
    </PageContainer>
  )
}
