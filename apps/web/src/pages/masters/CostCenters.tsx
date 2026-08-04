/**
 * Cost Centers — /masters/cost-centers
 *
 * Manage financial cost centers used for payroll allocation.
 * Cost centers are independent of the Sites / Work Locations hierarchy.
 */
import { useState }                                from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { DollarSign, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
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
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

interface CostCenter {
  id:          string
  name:        string
  code:        string | null
  description: string | null
  is_active:   boolean
  version:     number
  created_at:  string
}

const EMPTY_FORM = {
  name:        '',
  code:        '',
  description: '',
  is_active:   true,
}

export function CostCenters() {
  const qc              = useQueryClient()
  const { profile }     = useAuthStore()
  const isAdmin         = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,      setDlgOpen]      = useState(false)
  const [editItem,     setEditItem]     = useState<CostCenter | null>(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [err,          setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: ccData, isLoading } = useQuery<{ data: CostCenter[] }>({
    queryKey: ['cost-centers'],
    queryFn:  () => api.get('/masters/cost-centers'),
    staleTime: 60_000,
  })
  const costCenters = ccData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }

  function openEdit(cc: CostCenter) {
    setEditItem(cc)
    setForm({
      name:        cc.name,
      code:        cc.code        ?? '',
      description: cc.description ?? '',
      is_active:   cc.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const versionConflict = useVersionConflict([['cost-centers']])

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        name:        body.name,
        code:        body.code        || undefined,
        description: body.description || null,
        is_active:   body.is_active,
      }
      return editItem
        ? api.put(`/masters/cost-centers/${editItem.id}`, withExpectedVersion(payload, editItem))
        : api.post('/masters/cost-centers', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-centers'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Cost center updated' : 'Cost center created')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      setErr(e.message ?? 'Failed to save')
      toast.error('Failed to save cost center')
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/cost-centers/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-centers'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Cost center deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Cost Centers"
        subtitle="Financial cost centers for payroll allocation"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Cost Center</Button>
            : undefined
        }
      />

      <SectionCard
        title="All Cost Centers"
        icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : costCenters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <DollarSign className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No cost centers configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'Description', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costCenters.map(cc => (
                  <tr key={cc.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{cc.code ?? '—'}</td>
                    <td className="px-3 py-2.5 font-medium">{cc.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-xs truncate">
                      {cc.description ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={cc.is_active ? 'success' : 'outline'}
                        className="rounded-full text-xs"
                      >
                        {cc.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(cc)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: cc.id, name: cc.name })}
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

      {/* Create / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Cost Center' : 'New Cost Center'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Engineering"
                className="h-8 text-sm"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Covers all engineering teams"
                className="h-8 text-sm"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cc-active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="cc-active" className="text-xs text-muted-foreground select-none">Active</label>
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
          entityType="Cost Center"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/cost-centers/${deleteTarget.id}/usage`}
          usageLabel="employee records"
          mergeOptions={costCenters.filter(c => c.id !== deleteTarget.id).map(c => ({ id: c.id, name: c.name }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}
    </PageContainer>
  )
}
