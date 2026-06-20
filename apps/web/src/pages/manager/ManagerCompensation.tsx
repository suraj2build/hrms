/**
 * ManagerCompensation — Manager Console (Program 5 · P5.3)
 *
 * Read-only visibility into each direct report's compensation — current CTC, last
 * revision and effective date — plus the ability to raise an increment
 * recommendation. Recommendations flow through the EXISTING compensation revision
 * workflow (POST /compensation/revisions): they land as `pending` and HR retains
 * approval authority. The manager never approves or bypasses the workflow.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search, RefreshCw, Users, IndianRupee, History as HistoryIcon,
  TrendingUp, Loader2, ArrowRight,
} from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Input }         from '@/components/ui/input'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamComp {
  employee_id:    string
  name:           string
  employee_code:  string
  designation:    string | null
  grade:          string | null
  date_of_joining: string | null
  ctc_annual:     number | null
  ctc_monthly:    number | null
  comp_effective_from: string | null
  last_revision: {
    revision_type:  string
    status:         string
    effective_date: string
    delta_pct:      number | null
  } | null
  has_pending_revision: boolean
}

interface HistoryRow {
  id:                string
  revision_type:     string
  effective_date:    string
  status:            string
  reason:            string
  before_ctc_annual: number | null
  new_ctc_annual:    number | null
  delta_amount:      number | null
  delta_pct:         number | null
  submitted_at:      string
  decided_at:        string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  if (isNaN(d.getTime())) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

const STATUS_TONE: Record<string, 'success' | 'secondary' | 'destructive' | 'outline'> = {
  approved: 'success', pending: 'secondary', rejected: 'destructive', withdrawn: 'outline',
}

// ── Recommendation dialog ───────────────────────────────────────────────────────

function RecommendDialog({ member, onClose }: { member: TeamComp; onClose: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode]   = useState<'percentage' | 'amount'>('percentage')
  const [pct, setPct]     = useState('')
  const [amount, setAmount] = useState('')
  const [effective, setEffective] = useState('')
  const [reason, setReason] = useState('')

  const current = member.ctc_annual ?? 0
  const newCtc = useMemo(() => {
    if (mode === 'percentage') {
      const p = parseFloat(pct)
      return isFinite(p) && current > 0 ? Math.round(current * (1 + p / 100)) : null
    }
    const a = parseFloat(amount)
    return isFinite(a) && a > 0 ? Math.round(a) : null
  }, [mode, pct, amount, current])

  const delta = newCtc != null ? newCtc - current : null
  const deltaPct = delta != null && current > 0 ? (delta / current) * 100 : null

  const submit = useMutation({
    mutationFn: () => api.post('/compensation/revisions', {
      employee_id:    member.employee_id,
      revision_type:  'increment',
      effective_date: effective,
      reason:         reason.trim(),
      new_ctc_annual: newCtc,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manager-team-comp'] })
      qc.invalidateQueries({ queryKey: ['manager-comp-history', member.employee_id] })
      toast.success('Recommendation submitted to HR for approval')
      onClose()
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not submit recommendation'),
  })

  const canSubmit = newCtc != null && newCtc > 0 && !!effective && reason.trim().length >= 5 && !submit.isPending

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="pr-6">Recommend increment · {member.name}</DialogTitle></DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">Current CTC</span>
            <span className="font-semibold tabular-nums">{inr(current)}</span>
          </div>

          {/* mode toggle */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('percentage')}
              className={cn('flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
              By percentage
            </button>
            <button type="button" onClick={() => setMode('amount')}
              className={cn('flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'amount' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
              By new CTC
            </button>
          </div>

          {mode === 'percentage' ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Increase %</label>
              <Input type="number" min={0} step="0.5" value={pct} onChange={e => setPct(e.target.value)} placeholder="e.g. 10" />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground">New annual CTC</label>
              <Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 1200000" />
            </div>
          )}

          {newCtc != null && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{inr(current)}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold tabular-nums">{inr(newCtc)}</span>
              {deltaPct != null && (
                <Badge variant={deltaPct >= 0 ? 'success' : 'destructive'} className="ml-1 text-[10px]">
                  {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                </Badge>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Effective date</label>
            <Input type="date" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Justification</label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              rows={3} placeholder="Why is this increment recommended? (min 5 characters)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
            This is a recommendation. It is submitted to HR as a pending revision — HR reviews and approves it.
          </div>

          <Button className="w-full" disabled={!canSubmit} onClick={() => submit.mutate()}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            <span className="ml-1.5">Submit recommendation</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── History dialog ──────────────────────────────────────────────────────────────

function HistoryDialog({ member, onClose }: { member: TeamComp; onClose: () => void }) {
  const { data, isLoading } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ['manager-comp-history', member.employee_id],
    queryFn:  () => api.get(`/manager/team/compensation/${member.employee_id}/history`),
    staleTime: 60_000,
  })
  const rows = data?.data ?? []

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="pr-6">Compensation history · {member.name}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No compensation revisions on record.</p>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {rows.map(r => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">{r.revision_type.replace(/_/g, ' ')}</span>
                  <Badge variant={STATUS_TONE[r.status] ?? 'outline'} className="text-[10px] capitalize">{r.status}</Badge>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground">{inr(r.before_ctc_annual)}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-semibold tabular-nums">{inr(r.new_ctc_annual)}</span>
                  {r.delta_pct != null && (
                    <Badge variant={r.delta_pct >= 0 ? 'success' : 'destructive'} className="text-[9px]">
                      {r.delta_pct >= 0 ? '+' : ''}{r.delta_pct.toFixed(1)}%
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Effective {fmtDate(r.effective_date)} · {r.reason}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function ManagerCompensation({ embedded = false }: { embedded?: boolean }) {
  const [q, setQ] = useState('')
  const [recommend, setRecommend] = useState<TeamComp | null>(null)
  const [history, setHistory]     = useState<TeamComp | null>(null)

  const { data, isLoading, refetch } = useQuery<{ data: TeamComp[] }>({
    queryKey: ['manager-team-comp'],
    queryFn:  () => api.get('/manager/team/compensation'),
    staleTime: 120_000,
  })

  const team: TeamComp[] = useMemo(() => data?.data ?? [], [data])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return team
    return team.filter(m => m.name.toLowerCase().includes(s) || m.employee_code.toLowerCase().includes(s))
  }, [team, q])

  const totalCtc = team.reduce((s, m) => s + (m.ctc_annual ?? 0), 0)

  const body = (
    <>
      {embedded && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard>
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="rounded-xl bg-primary/10 p-2.5"><Users className="h-5 w-5 text-primary" /></div>
            <div><p className="text-xs text-muted-foreground">Direct reports</p><p className="text-xl font-semibold tabular-nums">{team.length}</p></div>
          </div>
        </SectionCard>
        <SectionCard>
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="rounded-xl bg-success/10 p-2.5"><IndianRupee className="h-5 w-5 text-success" /></div>
            <div><p className="text-xs text-muted-foreground">Team annual CTC</p><p className="text-xl font-semibold tabular-nums">{inr(totalCtc)}</p></div>
          </div>
        </SectionCard>
        <SectionCard>
          <div className="flex items-center gap-3 px-1 py-1">
            <div className="rounded-xl bg-warning/10 p-2.5"><TrendingUp className="h-5 w-5 text-warning" /></div>
            <div><p className="text-xs text-muted-foreground">Pending revisions</p><p className="text-xl font-semibold tabular-nums">{team.filter(m => m.has_pending_revision).length}</p></div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="My Team" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or code…" className="h-8 pl-8 text-xs" />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {team.length === 0 ? 'You have no direct reports.' : 'No team members match your search.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Employee</th>
                  <th className="px-3 py-2 text-left font-medium">Grade</th>
                  <th className="px-3 py-2 text-right font-medium">Annual CTC</th>
                  <th className="px-3 py-2 text-left font-medium">Last revision</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(m => (
                  <tr key={m.employee_id} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{m.name}</span>
                      <p className="text-[11px] text-muted-foreground">{m.employee_code}{m.designation ? ` · ${m.designation}` : ''}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{m.grade ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium">{inr(m.ctc_annual)}</td>
                    <td className="px-3 py-2.5">
                      {m.last_revision ? (
                        <div className="flex items-center gap-1.5">
                          <Badge variant={STATUS_TONE[m.last_revision.status] ?? 'outline'} className="text-[9px] capitalize">{m.last_revision.status}</Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {m.last_revision.delta_pct != null ? `${m.last_revision.delta_pct >= 0 ? '+' : ''}${m.last_revision.delta_pct.toFixed(1)}% · ` : ''}
                            {fmtDate(m.last_revision.effective_date)}
                          </span>
                        </div>
                      ) : <span className="text-[11px] text-muted-foreground">No revisions</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setHistory(m)}>
                          <HistoryIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1"
                          disabled={m.has_pending_revision || m.ctc_annual == null}
                          title={m.has_pending_revision ? 'A revision is already pending' : m.ctc_annual == null ? 'No active compensation' : 'Recommend an increment'}
                          onClick={() => setRecommend(m)}>
                          <TrendingUp className="h-3.5 w-3.5" /> Recommend
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          Recommendations are submitted to HR as pending revisions — HR retains final approval authority.
        </p>
      </SectionCard>

      {recommend && <RecommendDialog member={recommend} onClose={() => setRecommend(null)} />}
      {history   && <HistoryDialog   member={history}   onClose={() => setHistory(null)} />}
    </>
  )

  if (embedded) return body

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Manager' }, { label: 'Team Compensation' }]}
        title="Team Compensation"
        subtitle="Your direct reports' compensation · recommend increments for HR approval"
        actions={
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />
      {body}
    </PageContainer>
  )
}
