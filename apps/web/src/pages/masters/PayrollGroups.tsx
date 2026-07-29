import { useState }                               from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Layers, Plus, Pencil, Trash2, Loader2 }  from 'lucide-react'
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

interface PayrollGroup {
  id:               string
  code:             string
  name:             string
  cycle_type:       'monthly' | 'biweekly' | 'weekly'
  cycle_start_day:  number
  cutoff_day:       number
  payout_day:       number
  currency_code:    string
  is_active:        boolean
  created_at:       string
}

const CYCLE_LABELS: Record<string, string> = {
  monthly:  'Monthly',
  biweekly: 'Bi-Weekly',
  weekly:   'Weekly',
}

const EMPTY: Omit<PayrollGroup, 'id' | 'created_at'> = {
  code: '', name: '', cycle_type: 'monthly',
  cycle_start_day: 1, cutoff_day: 25, payout_day: 1, currency_code: 'INR', is_active: true,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st'
    : n % 10 === 2 ? 'nd'
    : n % 10 === 3 ? 'rd'
    : 'th'
  return `${n}${suffix}`
}

/**
 * Live preview of the payroll cycle based on current form values.
 *
 * Two models:
 *  · Calendar month  — startDay ≤ cutoffDay  (e.g. 1→31)
 *    "Period: 1st → 31st of the same month. Payout on 5th."
 *
 *  · Mid-month cycle — startDay > cutoffDay  (e.g. 21→20)
 *    "Period: 21st of prev month → 20th of current month. Payout on 1st."
 */
function CyclePreview({ startDay, cutoffDay, payoutDay }: {
  startDay:  number
  cutoffDay: number
  payoutDay: number
}) {
  const isMidMonth = startDay > cutoffDay

  const periodText = isMidMonth
    ? <><strong>{ordinal(startDay)}</strong> of prev month → <strong>{ordinal(cutoffDay)}</strong> of current month</>
    : <><strong>{ordinal(startDay)}</strong> → <strong>{ordinal(cutoffDay)}</strong> of the same month</>

  return (
    <div className="rounded-md bg-muted/40 border border-border/50 px-3 py-2 space-y-0.5">
      <p className="text-[11px] text-muted-foreground">
        📅 Period: {periodText}
      </p>
      <p className="text-[11px] text-muted-foreground">
        💰 Salary released on <strong>{ordinal(payoutDay)}</strong> of{' '}
        {isMidMonth ? 'the current month' : 'the following month'}
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PayrollGroups() {
  const qc                     = useQueryClient()
  const { profile }            = useAuthStore()
  const isAdmin                = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen, setDlgOpen]  = useState(false)
  const [editItem, setEditItem] = useState<PayrollGroup | null>(null)
  const [form, setForm]        = useState(EMPTY)
  const [err, setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PayrollGroup | null>(null)

  const { data: groupsData, isLoading } = useQuery<{ data: PayrollGroup[] }>({
    queryKey: ['payroll-groups'],
    queryFn:  () => api.get('/masters/payroll-groups'),
    staleTime: 60_000,
  })
  const groups = groupsData?.data ?? []

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(g: PayrollGroup) {
    setEditItem(g)
    setForm({
      code:             g.code,
      name:             g.name,
      cycle_type:       g.cycle_type,
      cycle_start_day:  g.cycle_start_day ?? 1,
      cutoff_day:       g.cutoff_day,
      payout_day:       g.payout_day,
      currency_code:    g.currency_code,
      is_active:        g.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY) =>
      editItem
        ? api.put(`/masters/payroll-groups/${editItem.id}`, body)
        : api.post('/masters/payroll-groups', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-groups'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Payroll group updated' : 'Payroll group created')
    },
    onError: (e: Error) => {
      setErr(e.message ?? 'Failed to save')
      toast.error('Save failed', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete<{ data?: { deactivated?: boolean } }>(`/masters/payroll-groups/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payroll-groups'] })
      toast.success(res?.data?.deactivated ? 'Group deactivated (in use)' : 'Payroll group deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Groups"
        subtitle="Group employees by payroll cycle, cutoff and payout schedule"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Group</Button>
            : undefined
        }
      />

      <SectionCard title="All Payroll Groups" icon={<Layers className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No payroll groups configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'Cycle', 'Start Day', 'Cutoff Day', 'Payout Day', 'Currency', 'Status', ''].map((h) => (
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
                    <td className="px-3 py-2.5">
                      <Badge variant="secondary" className="rounded-full text-xs">{CYCLE_LABELS[g.cycle_type]}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{g.cycle_start_day ?? 1}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{g.cutoff_day}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{g.payout_day}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{g.currency_code}</td>
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
            <DialogTitle>{editItem ? 'Edit Payroll Group' : 'New Payroll Group'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Code *</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="PG-MONTHLY"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Currency</label>
                <Input
                  value={form.currency_code}
                  onChange={(e) => setForm((p) => ({ ...p, currency_code: e.target.value.toUpperCase().slice(0, 3) }))}
                  placeholder="INR"
                  className="h-8 text-sm font-mono"
                  maxLength={3}
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Monthly Payroll"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cycle Type</label>
              <Select
                value={form.cycle_type}
                onValueChange={(v) => setForm((p) => ({ ...p, cycle_type: v as typeof form.cycle_type }))}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Start Day (1–28)</label>
                <Input
                  type="number"
                  min={1} max={28}
                  value={form.cycle_start_day}
                  onChange={(e) => setForm((p) => ({ ...p, cycle_start_day: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cutoff Day (1–31)</label>
                <Input
                  type="number"
                  min={1} max={31}
                  value={form.cutoff_day}
                  onChange={(e) => setForm((p) => ({ ...p, cutoff_day: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Payout Day (1–31)</label>
                <Input
                  type="number"
                  min={1} max={31}
                  value={form.payout_day}
                  onChange={(e) => setForm((p) => ({ ...p, payout_day: Number(e.target.value) }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <CyclePreview
              startDay={form.cycle_start_day}
              cutoffDay={form.cutoff_day}
              payoutDay={form.payout_day}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="pg-active"
                checked={form.is_active}
                onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5"
              />
              <label htmlFor="pg-active" className="text-xs text-muted-foreground">Active</label>
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
        title="Delete Payroll Group"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}" (${deleteTarget.code})? If no employees are currently assigned, this permanently deletes the group — there is no undo. If employees are assigned, it will be deactivated instead.`
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
