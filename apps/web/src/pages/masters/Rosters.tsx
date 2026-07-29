import { useState }                               from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Plus, Pencil, Trash2, CalendarDays, Loader2 } from 'lucide-react'
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
import { cn }                                     from '@/lib/utils'
import { ConfirmDialog }                          from '@/components/ui/ConfirmDialog'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'

interface Roster {
  id:           string
  name:         string
  code:         string | null
  cycle_days:   number
  pattern_json: { weekly_off_days: number[] }
  created_at:   string
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EMPTY_FORM = {
  name:            '',
  code:            '',
  cycle_days:      7 as 7 | 14 | 28,
  weekly_off_days: [] as number[],
}

// Build a 14-day preview grid starting from the next Monday
function buildPreview(weeklyOffDays: number[]): { date: string; dow: number; isOff: boolean }[] {
  const today  = new Date()
  const monday = new Date(today)
  const diff   = (8 - monday.getUTCDay()) % 7 || 7
  monday.setUTCDate(monday.getUTCDate() + diff - (monday.getUTCDay() === 1 ? 7 : 0))

  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() + i)
    const dow = d.getUTCDay()
    return {
      date:  d.toISOString().slice(0, 10),
      dow,
      isOff: weeklyOffDays.includes(dow),
    }
  })
}

export function Rosters() {
  const qc                              = useQueryClient()
  const { profile }                     = useAuthStore()
  const isAdmin                         = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,   setDlgOpen]         = useState(false)
  const [editRoster, setEditRoster]     = useState<Roster | null>(null)
  const [form,      setForm]            = useState(EMPTY_FORM)
  const [err,       setErr]             = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Roster | null>(null)

  const { data: rostersData, isLoading } = useQuery<{ data: Roster[] }>({
    queryKey: ['rosters'],
    queryFn:  () => api.get('/masters/rosters'),
    staleTime: 60_000,
  })
  const rosters = rostersData?.data ?? []

  function openCreate() {
    setEditRoster(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(r: Roster) {
    setEditRoster(r)
    setForm({ name: r.name, code: r.code ?? '', cycle_days: r.cycle_days as 7 | 14 | 28, weekly_off_days: r.pattern_json?.weekly_off_days ?? [] })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (f: typeof EMPTY_FORM) => {
      const payload = {
        name:         f.name,
        code:         f.code?.trim() || null,
        cycle_days:   f.cycle_days,
        pattern_json: { weekly_off_days: f.weekly_off_days },
      }
      return editRoster
        ? api.put(`/masters/rosters/${editRoster.id}`, payload)
        : api.post('/masters/rosters', payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rosters'] }); setDlgOpen(false); toast.success('Roster saved') },
    onError:   (e: Error) => { setErr(e.message ?? 'Failed to save'); toast.error('Failed to save roster', { description: e.message }) },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/rosters/${id}`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['rosters'] }); toast.success('Roster deleted'); setDeleteTarget(null) },
    onError: (e: Error) => toast.error('Failed to delete roster', { description: e.message }),
  })

  function toggleDay(dow: number) {
    setForm((p) => ({
      ...p,
      weekly_off_days: p.weekly_off_days.includes(dow)
        ? p.weekly_off_days.filter((d) => d !== dow)
        : [...p.weekly_off_days, dow].sort((a, b) => a - b),
    }))
  }

  const preview = buildPreview(form.weekly_off_days)

  return (
    <PageContainer>
      <PageHeader
        title="Roster Templates"
        subtitle="Work cycle patterns with weekly-off days"
        actions={isAdmin ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Template</Button> : undefined}
      />

      <SectionCard title="All Templates" icon={<CalendarDays className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rosters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No rosters configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Name', 'Code', 'Cycle', 'Weekly Off', ''].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rosters.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-medium">{r.name}</td>
                    <td className="px-3 py-2.5">
                      {r.code
                        ? <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{r.code}</span>
                        : <span className="text-muted-foreground/40 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-full text-xs">{r.cycle_days}-day</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1 flex-wrap">
                        {(r.pattern_json?.weekly_off_days ?? []).length === 0
                          ? <span className="text-xs text-muted-foreground">None</span>
                          : (r.pattern_json?.weekly_off_days ?? []).map((d) => (
                              <Badge key={d} variant="secondary" className="rounded-full text-[10px]">{DOW_LABELS[d]}</Badge>
                            ))
                        }
                      </div>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(r)}>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editRoster ? 'Edit Roster' : 'New Roster'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="5-Day Standard" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Code <span className="text-muted-foreground/60">(optional)</span></label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. GEN-5DAY"
                  maxLength={20}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Cycle</label>
                <select
                  value={form.cycle_days}
                  onChange={(e) => setForm((p) => ({ ...p, cycle_days: Number(e.target.value) as 7 | 14 | 28 }))}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value={7}>7-day</option>
                  <option value={14}>14-day</option>
                  <option value={28}>28-day</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Weekly Off Days</label>
              <div className="flex gap-1.5 flex-wrap">
                {DOW_LABELS.map((label, dow) => (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => toggleDay(dow)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      form.weekly_off_days.includes(dow)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2-week preview */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">2-Week Preview</p>
              <div className="grid grid-cols-7 gap-0.5">
                {DOW_LABELS.map((d) => (
                  <div key={d} className="text-center text-[9px] text-muted-foreground font-semibold py-0.5">{d}</div>
                ))}
                {/* pad to first day */}
                {Array.from({ length: preview[0].dow }, (_, i) => <div key={`pad-${i}`} />)}
                {preview.map((p) => (
                  <div
                    key={p.date}
                    title={p.date}
                    className={cn(
                      'aspect-square rounded text-[9px] flex items-center justify-center font-medium',
                      p.isOff ? 'bg-destructive/20 text-destructive' : 'bg-success/15 text-success',
                    )}
                  >
                    {Number(p.date.slice(8))}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-success/30" />Work</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-destructive/20" />Off</span>
              </div>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMut.isPending || !form.name.trim()} onClick={() => saveMut.mutate(form)}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Roster"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteTarget && delMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageContainer>
  )
}
