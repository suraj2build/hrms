/**
 * States — /admin/masters/states
 *
 * India state/UT master: the statutory axis for sites. GST state code plus
 * Professional Tax (PT) and Labour Welfare Fund (LWF) applicability. Seeded
 * per tenant; HR admins may edit flags or add rows.
 */
import { useState }                                from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Globe, Plus, Pencil, Trash2, Loader2 }   from 'lucide-react'
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
import { useOpenOnParam }                         from '@/lib/runbooks/useOpenOnParam'

interface State {
  id:             string
  code:           string
  name:           string
  region:         string | null
  country:        string | null
  pt_applicable:  boolean
  lwf_applicable: boolean
  lwf_frequency:  string | null
  min_wage_zone:  string | null
  is_active:      boolean
  created_at:     string
}

const EMPTY_FORM = {
  code:           '',
  name:           '',
  region:         '',
  pt_applicable:  false,
  lwf_applicable: false,
  lwf_frequency:  '',
  is_active:      true,
}

export function States() {
  const qc              = useQueryClient()
  const { profile }     = useAuthStore()
  const isAdmin         = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,      setDlgOpen]      = useState(false)
  const [editItem,     setEditItem]     = useState<State | null>(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [err,          setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: stData, isLoading } = useQuery<{ data: State[] }>({
    queryKey: ['states'],
    queryFn:  () => api.get('/masters/states'),
    staleTime: 60_000,
  })
  const states = stData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }

  // Auto-open the create dialog when arriving from a runbook deep-link (?new=1)
  useOpenOnParam('new', openCreate)

  function openEdit(s: State) {
    setEditItem(s)
    setForm({
      code:           s.code,
      name:           s.name,
      region:         s.region        ?? '',
      pt_applicable:  s.pt_applicable,
      lwf_applicable: s.lwf_applicable,
      lwf_frequency:  s.lwf_frequency  ?? '',
      is_active:      s.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        code:           body.code,
        name:           body.name,
        region:         body.region || null,
        pt_applicable:  body.pt_applicable,
        lwf_applicable: body.lwf_applicable,
        lwf_frequency:  body.lwf_applicable && body.lwf_frequency ? body.lwf_frequency : null,
        is_active:      body.is_active,
      }
      return editItem
        ? api.put(`/masters/states/${editItem.id}`, payload)
        : api.post('/masters/states', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['states'] })
      setDlgOpen(false)
      toast.success(editItem ? 'State updated' : 'State created')
    },
    onError: (e: Error) => {
      setErr(e.message ?? 'Failed to save')
      toast.error('Failed to save state')
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/states/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['states'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('State deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="States"
        subtitle="India state/UT master — GST code and PT/LWF statutory applicability"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add State</Button>
            : undefined
        }
      />

      <SectionCard
        title="All States"
        icon={<Globe className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : states.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Globe className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No states configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['GST Code', 'Name', 'Region', 'PT', 'LWF', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {states.map(s => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{s.code}</td>
                    <td className="px-3 py-2.5 font-medium">{s.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.region ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={s.pt_applicable ? 'success' : 'outline'} className="rounded-full text-xs">
                        {s.pt_applicable ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={s.lwf_applicable ? 'success' : 'outline'} className="rounded-full text-xs">
                        {s.lwf_applicable ? (s.lwf_frequency ?? 'Yes') : 'No'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={s.is_active ? 'success' : 'outline'} className="rounded-full text-xs">
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: s.id, name: s.name })}
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
            <DialogTitle>{editItem ? 'Edit State' : 'New State'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">GST Code *</label>
                <Input
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                  placeholder="29"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Region</label>
                <Input
                  value={form.region}
                  onChange={e => setForm(p => ({ ...p, region: e.target.value }))}
                  placeholder="South"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Karnataka"
                className="h-8 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="st-pt"
                checked={form.pt_applicable}
                onChange={e => setForm(p => ({ ...p, pt_applicable: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="st-pt" className="text-xs text-muted-foreground select-none">Professional Tax applicable</label>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="st-lwf"
                checked={form.lwf_applicable}
                onChange={e => setForm(p => ({ ...p, lwf_applicable: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="st-lwf" className="text-xs text-muted-foreground select-none">Labour Welfare Fund applicable</label>
            </div>

            {form.lwf_applicable && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">LWF Frequency</label>
                <select
                  value={form.lwf_frequency}
                  onChange={e => setForm(p => ({ ...p, lwf_frequency: e.target.value }))}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">— Not set —</option>
                  <option value="monthly">Monthly</option>
                  <option value="half_yearly">Half-yearly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="st-active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="st-active" className="text-xs text-muted-foreground select-none">Active</label>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.name.trim() || !form.code.trim()}
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
          entityType="State"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/states/${deleteTarget.id}/usage`}
          usageLabel="sites"
          mergeOptions={states.filter(s => s.id !== deleteTarget.id).map(s => ({ id: s.id, name: s.name }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}
    </PageContainer>
  )
}
