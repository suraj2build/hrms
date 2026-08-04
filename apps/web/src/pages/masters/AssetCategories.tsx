import { useState }                               from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Package, Plus, Pencil, Trash2, Loader2 }  from 'lucide-react'
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
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
}                                                 from '@/components/ui/select'
import { ConfirmDialog }                          from '@/components/ui/ConfirmDialog'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

interface AssetCategory {
  id:                   string
  code:                 string
  name:                 string
  description:          string | null
  depreciation_method:  'straight_line' | 'declining_balance' | 'none'
  useful_life_years:    number | null
  salvage_value_pct:    number | null
  requires_return:      boolean
  is_trackable:         boolean
  is_active:            boolean
  version:              number
  created_at:           string
}

const DEPR_LABELS: Record<string, string> = {
  straight_line:     'Straight Line',
  declining_balance: 'Declining Balance',
  none:              'None',
}

const EMPTY: Omit<AssetCategory, 'id' | 'created_at' | 'version'> = {
  code: '', name: '', description: '',
  depreciation_method: 'straight_line',
  useful_life_years: null, salvage_value_pct: null,
  requires_return: true, is_trackable: true,
  is_active: true,
}

export function AssetCategories() {
  const qc                     = useQueryClient()
  const { profile }            = useAuthStore()
  const isAdmin                = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen, setDlgOpen]  = useState(false)
  const [editItem, setEditItem] = useState<AssetCategory | null>(null)
  const [form, setForm]        = useState(EMPTY)
  const [err, setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AssetCategory | null>(null)

  const { data: catsData, isLoading } = useQuery<{ data: AssetCategory[] }>({
    queryKey: ['asset-categories'],
    queryFn:  () => api.get('/masters/asset-categories'),
    staleTime: 60_000,
  })
  const cats = catsData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(c: AssetCategory) {
    setEditItem(c)
    setForm({
      code:                c.code,
      name:                c.name,
      description:         c.description ?? '',
      depreciation_method: c.depreciation_method,
      useful_life_years:   c.useful_life_years,
      salvage_value_pct:   c.salvage_value_pct,
      requires_return:     c.requires_return,
      is_trackable:        c.is_trackable,
      is_active:           c.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const setBool = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.checked }))

  const versionConflict = useVersionConflict([['asset-categories']])

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) => {
      const payload = {
        ...body,
        description:       body.description       || null,
        useful_life_years: body.useful_life_years  || null,
        salvage_value_pct: body.salvage_value_pct  || null,
      }
      return editItem
        ? api.put(`/masters/asset-categories/${editItem.id}`, withExpectedVersion(payload, editItem))
        : api.post('/masters/asset-categories', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset-categories'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Asset category updated' : 'Asset category created')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete<{ deactivated?: boolean; message?: string }>(`/masters/asset-categories/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['asset-categories'] })
      // Backend always soft-deactivates (never hard-deletes asset categories) —
      // the response is { deactivated, message } at the top level, not nested
      // under `data`, so the old `res?.data?.deactivated` check was always
      // undefined and the toast always claimed "deleted" even though the
      // category was actually just deactivated and reversible via edit.
      toast.success(res?.message ?? (res?.deactivated ? 'Asset category deactivated' : 'Asset category deleted'))
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Asset Categories"
        subtitle="Define asset types with depreciation method, tracking and return requirements"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Category</Button>
            : undefined
        }
      />

      <SectionCard title="All Asset Categories" icon={<Package className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : cats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Package className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No asset categories configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'Depreciation', 'Life (yrs)', 'Salvage %', 'Trackable', 'Return Req.', 'Status', ''].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-full text-xs font-mono">{c.code}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="secondary" className="rounded-full text-xs">
                        {DEPR_LABELS[c.depreciation_method]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {c.useful_life_years ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {c.salvage_value_pct != null ? `${c.salvage_value_pct}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={c.is_trackable ? 'success' : 'secondary'} className="rounded-full text-xs">
                        {c.is_trackable ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={c.requires_return ? 'success' : 'secondary'} className="rounded-full text-xs">
                        {c.requires_return ? 'Yes' : 'No'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={c.is_active ? 'success' : 'secondary'} className="rounded-full text-xs">
                        {c.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(c)}
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
            <DialogTitle>{editItem ? 'Edit Asset Category' : 'New Asset Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Code *</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="LAPTOP"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Laptop"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional description"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Depreciation Method</label>
              <Select
                value={form.depreciation_method}
                onValueChange={(v) => setForm((p) => ({ ...p, depreciation_method: v as typeof form.depreciation_method }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_line">Straight Line</SelectItem>
                  <SelectItem value="declining_balance">Declining Balance</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Useful Life (years)</label>
                <Input
                  type="number" min={0}
                  value={form.useful_life_years ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, useful_life_years: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="3"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Salvage Value %</label>
                <Input
                  type="number" min={0} max={100}
                  value={form.salvage_value_pct ?? ''}
                  onChange={(e) => setForm((p) => ({ ...p, salvage_value_pct: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="10"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([
                ['is_trackable',    'Trackable'],
                ['requires_return', 'Requires Return'],
                ['is_active',       'Active'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`ac-${key}`}
                    checked={form[key] as boolean}
                    onChange={setBool(key)}
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`ac-${key}`} className="text-xs text-muted-foreground">{label}</label>
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
        title="Deactivate Asset Category"
        message={deleteTarget ? `Deactivate "${deleteTarget.name}" (${deleteTarget.code})? It will no longer be selectable for new assets.` : ''}
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => deleteTarget && delMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  )
}
