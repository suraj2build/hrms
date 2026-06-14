/**
 * WeeklyOffCredit — /admin/attendance/wo-credit
 *
 * Retail floating weekly-off (WO) credit configuration + monthly review.
 *   · Structures tab — define the present-days → WO ladder, cap, expiry,
 *     holiday-work reward; attach a structure to rosters (the applicability tag).
 *   · Review tab     — per-employee monthly snapshot (worked / earned / applied
 *     / pending / carried), with a "Run reconciliation now" action.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Play, Lock, CalendarClock } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api/client'

interface LadderRow { present_days: number; wo_credit: number }
interface WoStructure {
  id: string
  name: string
  is_active: boolean
  monthly_cap: 'sundays' | 'none'
  rollover_expiry_days: number
  holiday_work_reward: 'wo_credit' | 'extra_pay'
  holiday_pay_multiplier: number
  ladder: LadderRow[]
}
interface Roster { id: string; name: string; wo_credit_structure_id: string | null }
interface ReviewRow {
  employee_id: string
  employee_name: string
  worked_days: number
  holiday_worked_days: number
  earned_credit: number
  auto_applied: number
  pending_absent_days: number
  carried_out: number
  lop_days: number
  extra_pay_days: number
  extra_pay_amount: number
  status: string
}

const DEFAULT_LADDER: LadderRow[] = [
  { present_days: 6,  wo_credit: 1 },
  { present_days: 12, wo_credit: 2 },
  { present_days: 18, wo_credit: 3 },
  { present_days: 24, wo_credit: 4 },
  { present_days: 30, wo_credit: 5 },
]

type Tab = 'structures' | 'review'

export function WeeklyOffCredit() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('structures')
  const now = new Date()
  const [year, setYear]   = useState(now.getUTCFullYear())
  const [month, setMonth] = useState(now.getUTCMonth() + 1)

  // Editor state for a new/edited structure
  const [editing, setEditing] = useState<Partial<WoStructure> | null>(null)

  const { data: structures = [] } = useQuery<WoStructure[]>({
    queryKey: ['wo-credit', 'structures'],
    queryFn: () => api.get('/attendance/wo-credit/structures').then((r: any) => r.data),
  })

  const { data: rosters = [] } = useQuery<Roster[]>({
    queryKey: ['rosters'],
    queryFn: () => api.get('/masters/rosters').then((r: any) => r.data ?? r),
  })

  const { data: review } = useQuery<{ data: ReviewRow[] }>({
    queryKey: ['wo-credit', 'review', year, month],
    queryFn: () => api.get(`/attendance/wo-credit/review?year=${year}&month=${month}`),
    enabled: tab === 'review',
  })

  const saveStructure = useMutation({
    mutationFn: (s: Partial<WoStructure>) =>
      s.id ? api.put(`/attendance/wo-credit/structures/${s.id}`, s) : api.post('/attendance/wo-credit/structures', s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wo-credit', 'structures'] }); setEditing(null); toast.success('Structure saved') },
    onError: (e: Error) => toast.error('Save failed', { description: e.message }),
  })

  const deleteStructure = useMutation({
    mutationFn: (id: string) => api.delete(`/attendance/wo-credit/structures/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wo-credit', 'structures'] }); toast.success('Structure deleted') },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  const attachRoster = useMutation({
    mutationFn: ({ rosterId, structureId }: { rosterId: string; structureId: string | null }) =>
      api.put(`/masters/rosters/${rosterId}`, { wo_credit_structure_id: structureId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rosters'] }); toast.success('Roster updated') },
    onError: (e: Error) => toast.error('Update failed', { description: e.message }),
  })

  const reconcile = useMutation({
    mutationFn: () => api.post('/attendance/wo-credit/reconcile', { year, month }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['wo-credit', 'review'] })
      const d = r?.data
      toast.success('Reconciliation complete', { description: d ? `${d.applied} applied · ${d.pending} pending · ${d.carried} carried` : undefined })
    },
    onError: (e: Error) => toast.error('Reconcile failed', { description: e.message }),
  })

  const finalize = useMutation({
    mutationFn: () => api.post('/attendance/wo-credit/finalize', { year, month }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['wo-credit', 'review'] })
      const d = r?.data
      toast.success('Month finalised', { description: d ? `${d.credited} carried-over · ${d.lop} LOP day(s)` : undefined })
    },
    onError: (e: Error) => toast.error('Finalise failed', { description: e.message }),
  })

  function newStructure() {
    setEditing({ name: '', monthly_cap: 'sundays', rollover_expiry_days: 60, holiday_work_reward: 'wo_credit', holiday_pay_multiplier: 1, is_active: true, ladder: DEFAULT_LADDER })
  }

  const reviewRows = review?.data ?? []

  return (
    <PageContainer>
      <PageHeader title="Weekly-Off Credit" subtitle="Retail floating weekly-off — earn offs from worked days, auto-applied each month" />

      <div className="flex gap-2 mb-4 border-b border-border">
        {(['structures', 'review'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
            {t === 'structures' ? 'Structures' : 'Monthly Review'}
          </button>
        ))}
      </div>

      {/* ── Structures ─────────────────────────────────────────────────────── */}
      {tab === 'structures' && (
        <div className="space-y-4">
          <SectionCard title="WO-Credit Structures" action={<Button size="sm" onClick={newStructure}><Plus className="h-4 w-4 mr-1" />New Structure</Button>}>
            {structures.length === 0 && !editing ? (
              <p className="text-sm text-muted-foreground py-4">No structures yet. Create one, then attach it to a roster below.</p>
            ) : (
              <div className="space-y-2">
                {structures.map(s => (
                  <div key={s.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{s.name}</span>
                        {!s.is_active && <Badge variant="secondary">inactive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Cap: {s.monthly_cap === 'sundays' ? 'Sundays/month' : 'none'} · Expiry: {s.rollover_expiry_days}d ·
                        Holiday work → {s.holiday_work_reward === 'wo_credit' ? 'WO credit' : `extra pay (${s.holiday_pay_multiplier}×)`} ·
                        Ladder: {s.ladder.map(l => `${l.present_days}→${l.wo_credit}`).join(', ')}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteStructure.mutate(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editing && <StructureEditor value={editing} onChange={setEditing} onSave={() => saveStructure.mutate(editing)} onCancel={() => setEditing(null)} saving={saveStructure.isPending} />}
          </SectionCard>

          <SectionCard title="Roster Tagging" >
            <p className="text-xs text-muted-foreground mb-3">Attach a structure to a roster. Employees on that roster follow the WO-credit model (and are excluded from Comp-Off). Tag a site's default roster to cover a whole store.</p>
            <div className="space-y-2">
              {rosters.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-2.5">
                  <span className="text-sm text-foreground">{r.name}</span>
                  <select
                    value={r.wo_credit_structure_id ?? ''}
                    onChange={e => attachRoster.mutate({ rosterId: r.id, structureId: e.target.value || null })}
                    className="text-xs border border-border rounded-md px-2 py-1.5 bg-background text-foreground"
                  >
                    <option value="">— Fixed weekly-off (normal) —</option>
                    {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              ))}
              {rosters.length === 0 && <p className="text-sm text-muted-foreground py-2">No rosters found. Create rosters in Masters → Rosters first.</p>}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Review ─────────────────────────────────────────────────────────── */}
      {tab === 'review' && (
        <SectionCard
          title="Monthly Review"
          action={
            <div className="flex items-center gap-2">
              <Input type="number" value={year} onChange={e => setYear(+e.target.value)} className="h-8 w-20 text-xs" />
              <select value={month} onChange={e => setMonth(+e.target.value)} className="h-8 text-xs border border-border rounded-md px-2 bg-background text-foreground">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
                <Play className="h-3.5 w-3.5 mr-1" />Run now
              </Button>
              <Button size="sm" onClick={() => finalize.mutate()} disabled={finalize.isPending}>
                <Lock className="h-3.5 w-3.5 mr-1" />Finalise
              </Button>
            </div>
          }
        >
          {reviewRows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              <CalendarClock className="h-5 w-5 mx-auto mb-2 opacity-50" />
              No reconciliation data for this month yet. Click "Run now" to reconcile.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground uppercase tracking-wider text-[10px]">
                    <th className="text-left py-2 pr-3">Employee</th>
                    <th className="text-right py-2 px-2">Worked</th>
                    <th className="text-right py-2 px-2">Hol. worked</th>
                    <th className="text-right py-2 px-2">Earned</th>
                    <th className="text-right py-2 px-2">Applied</th>
                    <th className="text-right py-2 px-2">Pending</th>
                    <th className="text-right py-2 px-2">Carried</th>
                    <th className="text-right py-2 px-2">LOP</th>
                    <th className="text-right py-2 px-2">Extra pay (d)</th>
                    <th className="text-right py-2 px-2">Extra pay (₹)</th>
                    <th className="text-center py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map(r => (
                    <tr key={r.employee_id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="py-2 pr-3 text-foreground">{r.employee_name}</td>
                      <td className="py-2 px-2 text-right">{r.worked_days}</td>
                      <td className="py-2 px-2 text-right">{r.holiday_worked_days}</td>
                      <td className="py-2 px-2 text-right font-semibold">{r.earned_credit}</td>
                      <td className="py-2 px-2 text-right text-success">{r.auto_applied}</td>
                      <td className="py-2 px-2 text-right text-amber-600">{r.pending_absent_days}</td>
                      <td className="py-2 px-2 text-right">{r.carried_out}</td>
                      <td className="py-2 px-2 text-right text-destructive">{r.lop_days}</td>
                      <td className="py-2 px-2 text-right">{r.extra_pay_days}</td>
                      <td className="py-2 px-2 text-right">{r.extra_pay_amount > 0 ? `₹${r.extra_pay_amount.toLocaleString()}` : '—'}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge variant={r.status === 'finalized' ? 'secondary' : 'outline'} className="text-[10px]">{r.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </PageContainer>
  )
}

// ── Structure editor (inline) ─────────────────────────────────────────────────
function StructureEditor({ value, onChange, onSave, onCancel, saving }: {
  value: Partial<WoStructure>
  onChange: (v: Partial<WoStructure>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const ladder = value.ladder ?? []
  const setLadder = (l: LadderRow[]) => onChange({ ...value, ladder: l })

  return (
    <div className="border border-primary/30 rounded-lg p-4 mt-3 bg-muted/10 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
          <Input value={value.name ?? ''} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="e.g. Retail – Earned WO" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Rollover expiry (days)</label>
          <Input type="number" value={value.rollover_expiry_days ?? 60} onChange={e => onChange({ ...value, rollover_expiry_days: +e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Monthly cap</label>
          <select value={value.monthly_cap ?? 'sundays'} onChange={e => onChange({ ...value, monthly_cap: e.target.value as any })}
            className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
            <option value="sundays">Number of Sundays</option>
            <option value="none">No cap</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Working a holiday earns</label>
          <select value={value.holiday_work_reward ?? 'wo_credit'} onChange={e => onChange({ ...value, holiday_work_reward: e.target.value as any })}
            className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground">
            <option value="wo_credit">Extra WO credit</option>
            <option value="extra_pay">Extra pay day</option>
          </select>
        </div>
        {value.holiday_work_reward === 'extra_pay' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Pay multiplier (× daily rate)</label>
            <Input type="number" step="0.1" min={0.1} value={value.holiday_pay_multiplier ?? 1}
              onChange={e => onChange({ ...value, holiday_pay_multiplier: +e.target.value })} />
            <p className="text-[10px] text-muted-foreground mt-1">1.0 = one day's pay per worked holiday. Posted as a pending payroll adjustment.</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Present-days → WO ladder</label>
          <Button size="sm" variant="ghost" onClick={() => setLadder([...ladder, { present_days: 0, wo_credit: 0 }])}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add row
          </Button>
        </div>
        <div className="space-y-1.5">
          {ladder.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="number" value={row.present_days} className="h-8 w-24 text-xs"
                onChange={e => setLadder(ladder.map((r, j) => j === i ? { ...r, present_days: +e.target.value } : r))} />
              <span className="text-xs text-muted-foreground">present →</span>
              <Input type="number" value={row.wo_credit} className="h-8 w-20 text-xs"
                onChange={e => setLadder(ladder.map((r, j) => j === i ? { ...r, wo_credit: +e.target.value } : r))} />
              <span className="text-xs text-muted-foreground">WO</span>
              <Button size="sm" variant="ghost" onClick={() => setLadder(ladder.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={saving || !value.name}>{saving ? 'Saving…' : 'Save Structure'}</Button>
      </div>
    </div>
  )
}

export default WeeklyOffCredit
