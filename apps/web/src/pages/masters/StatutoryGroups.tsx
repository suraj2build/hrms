import { useState }                               from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Landmark, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
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
import { ConfirmDialog }                          from '@/components/ui/ConfirmDialog'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'

interface StatutoryGroup {
  id:               string
  code:             string
  name:             string
  state:            string | null
  pf_enabled:       boolean
  esi_enabled:      boolean
  pt_enabled:       boolean
  lwf_enabled:      boolean
  pf_ceiling_mode:  'capped' | 'actual' | 'default'
  pf_wage_ceiling:  number | null
  esi_wage_ceiling: number | null
  is_active:        boolean
  created_at:       string
}

const EMPTY: Omit<StatutoryGroup, 'id' | 'created_at'> = {
  code: '', name: '', state: '',
  pf_enabled: true, esi_enabled: true, pt_enabled: false, lwf_enabled: false,
  pf_ceiling_mode: 'default',
  pf_wage_ceiling: null, esi_wage_ceiling: null,
  is_active: true,
}

const fmtWage = (v: number | null) => (v ? `₹${v.toLocaleString('en-IN')}` : '—')

const Flag = ({ val }: { val: boolean }) => (
  <Badge variant={val ? 'success' : 'secondary'} className="rounded-full text-xs">
    {val ? 'Yes' : 'No'}
  </Badge>
)

export function StatutoryGroups() {
  const qc                     = useQueryClient()
  const { profile }            = useAuthStore()
  const isAdmin                = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen, setDlgOpen]  = useState(false)
  const [editItem, setEditItem] = useState<StatutoryGroup | null>(null)
  const [form, setForm]        = useState(EMPTY)
  const [err, setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<StatutoryGroup | null>(null)

  const { data: groupsData, isLoading } = useQuery<{ data: StatutoryGroup[] }>({
    queryKey: ['statutory-groups'],
    queryFn:  () => api.get('/masters/statutory-groups'),
    staleTime: 60_000,
  })
  const groups = groupsData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(g: StatutoryGroup) {
    setEditItem(g)
    setForm({
      code:             g.code,
      name:             g.name,
      state:            g.state ?? '',
      pf_enabled:       g.pf_enabled,
      esi_enabled:      g.esi_enabled,
      pt_enabled:       g.pt_enabled,
      lwf_enabled:      g.lwf_enabled,
      pf_ceiling_mode:  g.pf_ceiling_mode ?? 'default',
      pf_wage_ceiling:  g.pf_wage_ceiling,
      esi_wage_ceiling: g.esi_wage_ceiling,
      is_active:        g.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const setBool = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.checked }))

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) => {
      const payload = {
        ...body,
        state:            body.state            || null,
        pf_wage_ceiling:  body.pf_wage_ceiling  || null,
        esi_wage_ceiling: body.esi_wage_ceiling || null,
      }
      return editItem
        ? api.put(`/masters/statutory-groups/${editItem.id}`, payload)
        : api.post('/masters/statutory-groups', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statutory-groups'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Statutory group updated' : 'Statutory group created')
    },
    onError: (e: Error) => {
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete<{ deactivated?: boolean; message?: string }>(`/masters/statutory-groups/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['statutory-groups'] })
      // api.delete<T>() responses are not `.data`-wrapped — read the
      // top-level deactivated/message fields directly (see AssetCategories.tsx).
      toast.success(res?.message ?? (res?.deactivated ? 'Group deactivated (in use)' : 'Statutory group deleted'))
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Statutory Groups"
        subtitle="State-specific statutory applicability (PF, ESI, PT, LWF) and wage ceilings"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Group</Button>
            : undefined
        }
      />

      <SectionCard title="All Statutory Groups" icon={<Landmark className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Landmark className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No statutory groups configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'State', 'PF', 'ESI', 'PT', 'LWF', 'PF Ceiling', 'ESI Ceiling', 'Status', ''].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-full text-xs font-mono">{g.code}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{g.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{g.state ?? '—'}</td>
                    <td className="px-3 py-2.5"><Flag val={g.pf_enabled} /></td>
                    <td className="px-3 py-2.5"><Flag val={g.esi_enabled} /></td>
                    <td className="px-3 py-2.5"><Flag val={g.pt_enabled} /></td>
                    <td className="px-3 py-2.5"><Flag val={g.lwf_enabled} /></td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{fmtWage(g.pf_wage_ceiling)}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{fmtWage(g.esi_wage_ceiling)}</td>
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
                            onClick={() => setDeleteTarget(g)}
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
            <DialogTitle>{editItem ? 'Edit Statutory Group' : 'New Statutory Group'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Code *</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="STAT-MH"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">State</label>
                <Input
                  value={form.state ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))}
                  placeholder="Maharashtra"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Maharashtra Statutory"
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">PF Wage Ceiling (₹)</label>
                <Input
                  type="number" min={0}
                  value={form.pf_wage_ceiling ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, pf_wage_ceiling: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="15000"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">ESI Wage Ceiling (₹)</label>
                <Input
                  type="number" min={0}
                  value={form.esi_wage_ceiling ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, esi_wage_ceiling: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="21000"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">PF Wage-Ceiling Mode</label>
              <select
                value={form.pf_ceiling_mode}
                onChange={(e) => setForm((p) => ({ ...p, pf_ceiling_mode: e.target.value as 'capped' | 'actual' | 'default' }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="default">Follow tenant default</option>
                <option value="capped">Capped — restrict PF wages to the ceiling</option>
                <option value="actual">Actual — PF on full wages (no ceiling)</option>
              </select>
              <p className="text-[10px] text-muted-foreground">
                Applies to every employee tagged to this group, unless they have a per-employee override.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([
                ['pf_enabled',  'PF Enabled'],
                ['esi_enabled', 'ESI Enabled'],
                ['pt_enabled',  'PT Enabled'],
                ['lwf_enabled', 'LWF Enabled'],
                ['is_active',   'Active'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`sg-${key}`}
                    checked={form[key] as boolean}
                    onChange={setBool(key)}
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`sg-${key}`} className="text-xs text-muted-foreground">{label}</label>
                </div>
              ))}
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.code.trim() || !form.name.trim()}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Statutory Group"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}" (${deleteTarget.code})? If no employee records reference it, this permanently deletes the group — there is no undo. If any do, it will be deactivated instead.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteTarget && delMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  )
}
