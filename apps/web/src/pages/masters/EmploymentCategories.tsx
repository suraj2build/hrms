import { useState }                               from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Briefcase, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
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
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

interface EmploymentCategory {
  id:                   string
  code:                 string
  name:                 string
  description:          string | null
  benefits_eligible:    boolean
  pf_applicable:        boolean
  esi_applicable:       boolean
  pt_applicable:        boolean
  gratuity_eligible:    boolean
  notice_period_days:   number
  probation_days:       number
  is_active:            boolean
  version:              number
  created_at:           string
}

const EMPTY: Omit<EmploymentCategory, 'id' | 'created_at' | 'version'> = {
  code: '', name: '', description: '',  // code populated by backend on create
  benefits_eligible: true, pf_applicable: true, esi_applicable: true,
  pt_applicable: true, gratuity_eligible: true,
  notice_period_days: 30, probation_days: 90,
  is_active: true,
}

const Bool = ({ val }: { val: boolean }) => (
  <Badge variant={val ? 'success' : 'secondary'} className="rounded-full text-xs">
    {val ? 'Yes' : 'No'}
  </Badge>
)

export function EmploymentCategories() {
  const qc                     = useQueryClient()
  const { profile }            = useAuthStore()
  const isAdmin                = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen, setDlgOpen]  = useState(false)
  const [editItem, setEditItem] = useState<EmploymentCategory | null>(null)
  const [form, setForm]        = useState(EMPTY)
  const [err, setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<EmploymentCategory | null>(null)

  const { data: catsData, isLoading } = useQuery<{ data: EmploymentCategory[] }>({
    queryKey: ['employment-categories'],
    queryFn:  () => api.get('/masters/employment-categories'),
    staleTime: 60_000,
  })
  const cats = catsData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(c: EmploymentCategory) {
    setEditItem(c)
    setForm({
      code:               c.code,
      name:               c.name,
      description:        c.description ?? '',
      benefits_eligible:  c.benefits_eligible,
      pf_applicable:      c.pf_applicable,
      esi_applicable:     c.esi_applicable,
      pt_applicable:      c.pt_applicable,
      gratuity_eligible:  c.gratuity_eligible,
      notice_period_days: c.notice_period_days,
      probation_days:     c.probation_days,
      is_active:          c.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const setBool = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.checked }))

  const versionConflict = useVersionConflict([['employment-categories']])

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) => {
      const payload = { ...body, description: body.description || null }
      return editItem
        ? api.put(`/masters/employment-categories/${editItem.id}`, withExpectedVersion(payload, editItem))
        : api.post('/masters/employment-categories', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employment-categories'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Category updated' : 'Category created')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete<{ deactivated?: boolean; message?: string }>(`/masters/employment-categories/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['employment-categories'] })
      // api.delete<T>() responses are not `.data`-wrapped — read the
      // top-level deactivated/message fields directly (see AssetCategories.tsx).
      toast.success(res?.message ?? (res?.deactivated ? 'Category deactivated (in use)' : 'Category deleted'))
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Employment Categories"
        subtitle="Define employment types with statutory applicability and entitlement rules"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Category</Button>
            : undefined
        }
      />

      <SectionCard title="All Employment Categories" icon={<Briefcase className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : cats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Briefcase className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No employment categories configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'PF', 'ESI', 'PT', 'Gratuity', 'Notice', 'Probation', 'Status', ''].map((h) => (
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
                    <td className="px-3 py-2.5"><Bool val={c.pf_applicable} /></td>
                    <td className="px-3 py-2.5"><Bool val={c.esi_applicable} /></td>
                    <td className="px-3 py-2.5"><Bool val={c.pt_applicable} /></td>
                    <td className="px-3 py-2.5"><Bool val={c.gratuity_eligible} /></td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{c.notice_period_days}d</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{c.probation_days}d</td>
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
            <DialogTitle>{editItem ? 'Edit Category' : 'New Employment Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Permanent Full-Time"
                className="h-8 text-sm"
              />
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
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notice Period (days)</label>
                <Input
                  type="number" min={0}
                  value={form.notice_period_days}
                  onChange={(e) => setForm((p) => ({ ...p, notice_period_days: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Probation (days)</label>
                <Input
                  type="number" min={0}
                  value={form.probation_days}
                  onChange={(e) => setForm((p) => ({ ...p, probation_days: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {([
                ['pf_applicable',     'PF Applicable'],
                ['esi_applicable',    'ESI Applicable'],
                ['pt_applicable',     'PT Applicable'],
                ['gratuity_eligible', 'Gratuity Eligible'],
                ['benefits_eligible', 'Benefits Eligible'],
                ['is_active',         'Active'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`ec-${key}`}
                    checked={form[key] as boolean}
                    onChange={setBool(key)}
                    className="h-3.5 w-3.5"
                  />
                  <label htmlFor={`ec-${key}`} className="text-xs text-muted-foreground">{label}</label>
                </div>
              ))}
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Employment Category"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}" (${deleteTarget.code})? If no employees are currently assigned, this permanently deletes the category — there is no undo. If employees are assigned, it will be deactivated instead.`
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
