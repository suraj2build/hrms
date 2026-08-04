import { useState }                             from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star,
  Plus, Trophy, TrendingUp, ToggleLeft, ToggleRight,
  Medal, Flame, UserCheck, ChevronRight, Gavel,
  CheckCircle, XCircle, Clock, Archive,
} from 'lucide-react'
import { toast }   from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button }  from '@/components/ui/button'
import { api }     from '@/lib/api/client'
import { fmtDate } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Analytics {
  total_30d:            number
  total_7d:             number
  unique_givers_30d:    number
  unique_receivers_30d: number
  monthly_budget:       number
  trend:                { date: string; count: number }[]
  top_givers:           { employee_id: string; name: string; points: number; count: number }[]
  top_receivers:        { employee_id: string; name: string; points: number; count: number }[]
}

interface AdminBadge {
  code:        string
  label:       string
  icon:        string | null
  description: string | null
  points:      number
  is_active:   boolean
}

interface FormalAward {
  id: string; name: string; description: string | null; frequency: string; award_type: string
  monetary_value: number | null; monetary_description: string | null; eligible_group: string | null
  is_active: boolean; requires_nomination: boolean
}

interface AwardRound {
  id: string; award_id: string; period_label: string; period_start: string | null; period_end: string | null
  status: string; winner_employee_id: string | null; winner_notes: string | null; declared_at: string | null
  nomination_count: number
  employees: { id: string; first_name: string; last_name: string; employee_code: string } | null
  formal_awards: { name: string } | null
}

interface Nomination {
  id: string; status: string; justification: string | null; created_at: string
  employees: { id: string; first_name: string; last_name: string; employee_code: string; designation: string | null; department: string | null } | null
  profiles: { full_name: string | null } | null
}

interface RnrSummary {
  active_award_programs: number; total_rounds: number; open_rounds: number; closed_rounds: number
  total_nominations: number; pending_nominations: number; spot_awards_given: number
  spot_awards_monetary_total: number; peer_recognitions_ytd: number; peer_points_ytd: number
}

interface LongServiceAlert {
  id: string; first_name: string; last_name: string; employee_code: string
  designation: string | null; department: string | null; date_of_joining: string; milestone_years: number
}

interface SpotAward {
  id: string; award_name: string; message: string | null; monetary_value: number | null; created_at: string
  'employees!spot_awards_from_employee_id_fkey': { first_name: string; last_name: string } | null
  'employees!spot_awards_to_employee_id_fkey': { id: string; first_name: string; last_name: string; employee_code: string; designation: string | null } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star,
}
const ICON_OPTIONS = Object.keys(ICONS)

function BadgeIcon({ name, className }: { name: string | null; className?: string }) {
  const Cmp = (name && ICONS[name]) || Award
  return <Cmp className={className} />
}

function shortDate(d: string) {
  const [, m, day] = d.split('-')
  return `${parseInt(day)}/${parseInt(m)}`
}

const FREQ_LABELS: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', ad_hoc: 'Ad Hoc' }
const TYPE_LABELS: Record<string, string> = {
  employee_of_month: 'Employee of Month', spot_award: 'Spot Award', long_service: 'Long Service',
  peer_choice: 'Peer Choice', store_of_month: 'Store of Month', custom: 'Custom',
}
const STATUS_COLORS: Record<string, string> = {
  open: 'bg-info text-info dark:bg-info/30 dark:text-info',
  review: 'bg-warning text-warning dark:bg-warning/30 dark:text-warning',
  closed: 'bg-success text-success dark:bg-success/30 dark:text-success',
  cancelled: 'bg-muted text-muted-foreground',
}
const NOM_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  shortlisted: 'bg-info text-info dark:bg-info/30 dark:text-info',
  winner: 'bg-warning text-warning dark:bg-warning/30 dark:text-warning',
  not_selected: 'bg-destructive text-destructive dark:bg-destructive/30 dark:text-destructive',
}

// ── Nominations Dialog ────────────────────────────────────────────────────────
function NominationsDialog({ open, onClose, awardId, round }: {
  open: boolean; onClose: () => void; awardId: string; round: AwardRound | null
}) {
  const qc = useQueryClient()
  const [declareOpen, setDeclareOpen] = useState(false)
  const [winnerId, setWinnerId] = useState('')

  const { data: nomsResp, isLoading } = useQuery<{ data: Nomination[] }>({
    queryKey: ['award-nominations', round?.id],
    queryFn:  () => api.get(`/recognition/admin/awards/${awardId}/rounds/${round!.id}/nominations`),
    enabled:  !!round && open,
    staleTime: 10_000,
  })
  const noms = nomsResp?.data ?? []

  const patchNomMut = useMutation({
    mutationFn: ({ nomId, status }: { nomId: string; status: string }) =>
      api.patch(`/recognition/admin/awards/${awardId}/rounds/${round!.id}/nominations/${nomId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['award-nominations', round?.id] })
      toast.success('Nomination updated')
    },
    onError: () => toast.error('Could not update nomination'),
  })

  const declareWinnerMut = useMutation({
    mutationFn: () => api.post(`/recognition/admin/awards/${awardId}/rounds/${round!.id}/declare-winner`, { winner_employee_id: winnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['award-nominations', round?.id] })
      qc.invalidateQueries({ queryKey: ['award-rounds', awardId] })
      qc.invalidateQueries({ queryKey: ['admin-rnr-summary'] })
      setDeclareOpen(false)
      setWinnerId('')
      toast.success('Winner declared!')
      onClose()
    },
    onError: () => toast.error('Could not declare winner'),
  })

  const shortlistable = noms.filter(n => n.status === 'pending' || n.status === 'shortlisted')
  const canDeclare = round?.status !== 'closed'

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Nominations — {round?.formal_awards?.name ?? ''} · {round?.period_label}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />)}
          </div>
        ) : noms.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No nominations yet for this round.</p>
        ) : (
          <div className="space-y-2 py-2">
            {noms.map(n => {
              const emp = n.employees
              const fullName = emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'
              return (
                <div key={n.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{fullName}</span>
                      {emp?.employee_code && (
                        <span className="text-[10px] text-muted-foreground font-mono">{emp.employee_code}</span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${NOM_STATUS_COLORS[n.status] ?? ''}`}>
                        {n.status.replace('_', ' ')}
                      </span>
                    </div>
                    {(emp?.designation || emp?.department) && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{emp.designation}{emp.designation && emp.department ? ' · ' : ''}{emp.department}</p>
                    )}
                    {n.justification && (
                      <p className="mt-1 text-xs text-muted-foreground italic">"{n.justification}"</p>
                    )}
                    {n.profiles?.full_name && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Nominated by: {n.profiles.full_name}</p>
                    )}
                  </div>
                  {canDeclare && n.status !== 'winner' && n.status !== 'not_selected' && (
                    <div className="flex gap-1.5 shrink-0">
                      {n.status !== 'shortlisted' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => patchNomMut.mutate({ nomId: n.id, status: 'shortlisted' })}
                          disabled={patchNomMut.isPending}
                        >
                          <CheckCircle className="mr-1 h-3 w-3" /> Shortlist
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => patchNomMut.mutate({ nomId: n.id, status: 'not_selected' })}
                        disabled={patchNomMut.isPending}
                      >
                        <XCircle className="mr-1 h-3 w-3" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {canDeclare && shortlistable.length > 0 && (
          <div className="border-t border-border/40 pt-4">
            {declareOpen ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Select the winner:</p>
                <div className="space-y-1.5">
                  {shortlistable.map(n => {
                    const emp = n.employees
                    const name = emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown'
                    return (
                      <label key={n.id} className={`flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors ${
                        winnerId === emp?.id ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/50'
                      }`}>
                        <input type="radio" name="winner" value={emp?.id ?? ''} checked={winnerId === emp?.id}
                          onChange={() => setWinnerId(emp?.id ?? '')} className="sr-only" />
                        <span className={`h-3.5 w-3.5 rounded-full border-2 flex-shrink-0 ${winnerId === emp?.id ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                        <span className="text-sm font-medium">{name}</span>
                        {emp?.employee_code && <span className="text-[10px] text-muted-foreground font-mono">{emp.employee_code}</span>}
                      </label>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => declareWinnerMut.mutate()} disabled={!winnerId || declareWinnerMut.isPending}>
                    <Gavel className="mr-1.5 h-3.5 w-3.5" />
                    {declareWinnerMut.isPending ? 'Declaring…' : 'Declare Winner'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setDeclareOpen(false); setWinnerId('') }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={() => setDeclareOpen(true)}>
                <Gavel className="mr-1.5 h-3.5 w-3.5" /> Declare Winner
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Rounds Panel ──────────────────────────────────────────────────────────────
function RoundsPanel({ award, onClose }: { award: FormalAward; onClose: () => void }) {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [selectedRound, setSelectedRound] = useState<AwardRound | null>(null)
  const [nomOpen, setNomOpen] = useState(false)

  const { data: roundsResp, isLoading } = useQuery<{ data: AwardRound[] }>({
    queryKey: ['award-rounds', award.id],
    queryFn:  () => api.get(`/recognition/admin/awards/${award.id}/rounds`),
    staleTime: 15_000,
  })
  const rounds = roundsResp?.data ?? []

  const createRoundMut = useMutation({
    mutationFn: () => api.post(`/recognition/admin/awards/${award.id}/rounds`, {
      period_label: newLabel.trim(),
      period_start: newStart || undefined,
      period_end: newEnd || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['award-rounds', award.id] })
      qc.invalidateQueries({ queryKey: ['admin-rnr-summary'] })
      setCreateOpen(false)
      setNewLabel(''); setNewStart(''); setNewEnd('')
      toast.success('Round created')
    },
    onError: () => toast.error('Could not create round'),
  })

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rounds — {award.name}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-end mb-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New Round
          </Button>
        </div>

        {createOpen && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 mb-3">
            <p className="text-sm font-medium text-foreground">Create New Round</p>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Period Label *</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. June 2026"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Period Start</label>
                <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Period End</label>
                <input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createRoundMut.mutate()} disabled={!newLabel.trim() || createRoundMut.isPending}>
                {createRoundMut.isPending ? 'Creating…' : 'Create Round'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1,2].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/40" />)}
          </div>
        ) : rounds.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No rounds yet. Create one above to start nominations.</p>
        ) : (
          <div className="space-y-2">
            {rounds.map(r => {
              const winner = r.employees
              return (
                <div key={r.id} className="rounded-xl border border-border/60 bg-card px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{r.period_label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_COLORS[r.status] ?? ''}`}>
                          {r.status}
                        </span>
                      </div>
                      {(r.period_start || r.period_end) && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                        </p>
                      )}
                      {r.status === 'closed' && winner && (
                        <p className="text-xs text-warning dark:text-warning mt-0.5 flex items-center gap-1">
                          <Trophy className="h-3 w-3" /> Winner: {winner.first_name} {winner.last_name}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {r.status !== 'closed' && r.status !== 'cancelled' && (
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => { setSelectedRound(r); setNomOpen(true) }}
                        >
                          <UserCheck className="mr-1 h-3 w-3" />
                          Nominations ({r.nomination_count})
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {nomOpen && selectedRound && (
        <NominationsDialog
          open={nomOpen}
          onClose={() => { setNomOpen(false); setSelectedRound(null) }}
          awardId={award.id}
          round={selectedRound}
        />
      )}
    </Dialog>
  )
}

// ── Create Award Dialog ───────────────────────────────────────────────────────
function CreateAwardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [freq, setFreq] = useState('monthly')
  const [awardType, setAwardType] = useState('custom')
  const [monetary, setMonetary] = useState('')
  const [monetaryDesc, setMonetaryDesc] = useState('')
  const [eligibleGroup, setEligibleGroup] = useState('')
  const [requiresNom, setRequiresNom] = useState(true)

  const reset = () => { setName(''); setDesc(''); setFreq('monthly'); setAwardType('custom'); setMonetary(''); setMonetaryDesc(''); setEligibleGroup(''); setRequiresNom(true) }

  const createMut = useMutation({
    mutationFn: () => api.post('/recognition/admin/awards', {
      name: name.trim(), description: desc.trim() || undefined,
      frequency: freq, award_type: awardType,
      monetary_value: monetary ? parseFloat(monetary) : undefined,
      monetary_description: monetaryDesc.trim() || undefined,
      eligible_group: eligibleGroup.trim() || undefined,
      requires_nomination: requiresNom,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-awards'] })
      qc.invalidateQueries({ queryKey: ['admin-rnr-summary'] })
      toast.success('Award program created')
      reset(); onClose()
    },
    onError: () => toast.error('Could not create award program'),
  })

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { reset(); onClose() } }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Award Program</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Employee of the Month"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Purpose of this award…"
              className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Frequency</label>
              <select value={freq} onChange={e => setFreq(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
                <option value="ad_hoc">Ad Hoc</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Award Type</label>
              <select value={awardType} onChange={e => setAwardType(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                <option value="employee_of_month">Employee of Month</option>
                <option value="store_of_month">Store of Month</option>
                <option value="long_service">Long Service</option>
                <option value="peer_choice">Peer Choice</option>
                <option value="spot_award">Spot Award</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Monetary Value (₹)</label>
              <input type="number" min={0} value={monetary} onChange={e => setMonetary(e.target.value)} placeholder="500"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Monetary Description</label>
              <input value={monetaryDesc} onChange={e => setMonetaryDesc(e.target.value)} placeholder="e.g. Gift voucher"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Eligible Group</label>
            <input value={eligibleGroup} onChange={e => setEligibleGroup(e.target.value)} placeholder="e.g. All store employees"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={requiresNom} onChange={e => setRequiresNom(e.target.checked)}
              className="h-4 w-4 rounded accent-primary" />
            <span className="text-sm text-foreground">Requires nomination workflow</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Award'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'analytics' | 'badges' | 'budget' | 'awards' | 'spot'

export function AdminRecognition() {
  const qc  = useQueryClient()
  const [tab, setTab] = useState<Tab>('analytics')

  // Badge create state
  const [createOpen, setCreateOpen]         = useState(false)
  const [newCode, setNewCode]               = useState('')
  const [newLabel, setNewLabel]             = useState('')
  const [newDesc, setNewDesc]               = useState('')
  const [newIcon, setNewIcon]               = useState('Award')
  const [newPoints, setNewPoints]           = useState(10)

  // Budget edit state
  const [budgetEdit, setBudgetEdit]         = useState<number | null>(null)

  // Awards tab state
  const [createAwardOpen, setCreateAwardOpen] = useState(false)
  const [selectedAward, setSelectedAward]     = useState<FormalAward | null>(null)

  // Spot awards filter
  const [spotFilter, setSpotFilter] = useState<'month' | 'all'>('month')

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: analytics, isLoading: aLoading } = useQuery<Analytics>({
    queryKey:  ['admin-r-analytics'],
    queryFn:   () => api.get<{ data: Analytics }>('/recognition/admin/analytics').then(r => r.data),
    staleTime: 2 * 60_000,
  })

  const { data: badgesRaw } = useQuery<AdminBadge[]>({
    queryKey:  ['admin-r-badges'],
    queryFn:   () => api.get<{ data: AdminBadge[] }>('/recognition/admin/badges').then(r => r.data),
    staleTime: 60_000,
  })

  const { data: budgetData } = useQuery<{ monthly_points: number }>({
    queryKey:  ['admin-r-budget'],
    queryFn:   () => api.get<{ data: { monthly_points: number } }>('/recognition/admin/budget').then(r => r.data),
    staleTime: 60_000,
  })

  const { data: rnrSummaryResp } = useQuery<{ data: RnrSummary }>({
    queryKey:  ['admin-rnr-summary'],
    queryFn:   () => api.get('/recognition/admin/rnr-summary'),
    staleTime: 60_000,
  })

  const { data: awardsResp } = useQuery<{ data: FormalAward[] }>({
    queryKey:  ['admin-awards'],
    queryFn:   () => api.get('/recognition/admin/awards'),
    staleTime: 30_000,
    enabled:   tab === 'awards',
  })

  const { data: longServiceResp } = useQuery<{ data: LongServiceAlert[] }>({
    queryKey:  ['admin-long-service'],
    queryFn:   () => api.get('/recognition/admin/long-service-alerts'),
    staleTime: 5 * 60_000,
    enabled:   tab === 'awards',
  })

  const { data: spotAwardsResp } = useQuery<{ data: SpotAward[] }>({
    queryKey:  ['admin-spot-awards'],
    queryFn:   () => api.get('/recognition/admin/spot-awards'),
    staleTime: 30_000,
    enabled:   tab === 'spot',
  })

  const badges     = badgesRaw ?? []
  const rnrSummary = rnrSummaryResp?.data
  const awards     = awardsResp?.data ?? []
  const longAlerts = longServiceResp?.data ?? []
  const spotAwards = spotAwardsResp?.data ?? []

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createBadgeMut = useMutation({
    mutationFn: () => api.post('/recognition/admin/badges', {
      code: newCode.trim().toLowerCase().replace(/\s+/g, '_'),
      label: newLabel.trim(),
      description: newDesc.trim() || undefined,
      icon: newIcon,
      points: newPoints,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-badges'] })
      qc.invalidateQueries({ queryKey: ['recognition-badges'] })
      setCreateOpen(false)
      setNewCode(''); setNewLabel(''); setNewDesc(''); setNewIcon('Award'); setNewPoints(10)
      toast.success('Badge created')
    },
    onError: () => toast.error('Could not create badge'),
  })

  const toggleBadgeMut = useMutation({
    mutationFn: ({ code, is_active }: { code: string; is_active: boolean }) =>
      api.patch(`/recognition/admin/badges/${code}`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-badges'] })
      qc.invalidateQueries({ queryKey: ['recognition-badges'] })
    },
    onError: () => toast.error('Could not update badge'),
  })

  const saveBudgetMut = useMutation({
    mutationFn: (monthly_points: number) =>
      api.patch('/recognition/admin/budget', { monthly_points }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-r-budget'] })
      qc.invalidateQueries({ queryKey: ['recognition-me'] })
      setBudgetEdit(null)
      toast.success('Budget updated')
    },
    onError: () => toast.error('Could not update budget'),
  })

  const toggleAwardMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/recognition/admin/awards/${id}`, { is_active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-awards'] })
      qc.invalidateQueries({ queryKey: ['admin-rnr-summary'] })
    },
    onError: () => toast.error('Could not update award'),
  })

  // ── Filtered spot awards ──────────────────────────────────────────────────

  const now = new Date()
  const filteredSpot = spotFilter === 'month'
    ? spotAwards.filter(s => {
        const d = new Date(s.created_at)
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      })
    : spotAwards

  const spotMonthlyTotal = filteredSpot.reduce((s, a) => s + (a.monetary_value ?? 0), 0)

  // ── Render ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string }[] = [
    { key: 'analytics', label: 'Analytics' },
    { key: 'badges',    label: 'Badge Library' },
    { key: 'budget',    label: 'Budget Settings' },
    { key: 'awards',    label: 'Award Programs' },
    { key: 'spot',      label: 'Spot Awards' },
  ]

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Recognition & Rewards</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage badges, budgets and recognition analytics</p>
        </div>
        {tab === 'badges' && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Badge
          </Button>
        )}
        {tab === 'awards' && (
          <Button size="sm" onClick={() => setCreateAwardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Award Program
          </Button>
        )}
      </div>

      {/* R&R Summary strip */}
      {rnrSummary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Trophy className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Award Programs</span>
            </div>
            <p className="text-xl font-bold text-foreground">{rnrSummary.active_award_programs}</p>
          </div>
          <div className="rounded-2xl border border-info bg-info dark:border-info/40 dark:bg-info/10 p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-info dark:text-info">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Open Rounds</span>
            </div>
            <p className="text-xl font-bold text-foreground">{rnrSummary.open_rounds}</p>
          </div>
          <div className="rounded-2xl border border-warning bg-warning dark:border-warning/40 dark:bg-warning/10 p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-warning dark:text-warning">
              <UserCheck className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Pending Nominations</span>
            </div>
            <p className="text-xl font-bold text-foreground">{rnrSummary.pending_nominations}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Medal className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Spot Awards Given</span>
            </div>
            <p className="text-xl font-bold text-foreground">{rnrSummary.spot_awards_given}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
              <Heart className="h-3.5 w-3.5" />
              <span className="text-[10px] font-medium">Peer Recs YTD</span>
            </div>
            <p className="text-xl font-bold text-foreground">{rnrSummary.peer_recognitions_ytd}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border/40 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Analytics tab ───────────────────────────────────────────────────── */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          {/* Stats strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {aLoading ? (
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/40" />
              ))
            ) : ([
              { label: 'Given (30d)',         value: analytics?.total_30d ?? 0,            icon: Gift },
              { label: 'Given (7d)',           value: analytics?.total_7d ?? 0,             icon: TrendingUp },
              { label: 'Unique givers (30d)', value: analytics?.unique_givers_30d ?? 0,    icon: Users },
              { label: 'Unique receivers (30d)', value: analytics?.unique_receivers_30d ?? 0, icon: Heart },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <s.icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{s.label}</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
              </div>
            )))}
          </div>

          {/* 30-day trend */}
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              30-Day Recognition Trend
            </p>
            {aLoading ? (
              <div className="h-40 animate-pulse rounded-xl bg-muted/40" />
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={analytics?.trend ?? []} barSize={8} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={4}
                  />
                  <Tooltip
                    formatter={(v: number) => [v, 'Recognitions']}
                    labelFormatter={shortDate}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {(analytics?.trend ?? []).map((_, i) => (
                      <Cell key={i} fill="#15B8A6" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top givers + receivers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Top givers */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Top Givers (30d)
              </p>
              {aLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />)}
                </div>
              ) : !analytics?.top_givers?.length ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-1">
                  {analytics.top_givers.map((g, i) => (
                    <div key={g.employee_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        i === 0 ? 'bg-warning text-warning dark:bg-warning/30 dark:text-warning' : 'bg-muted text-muted-foreground'
                      }`}>
                        {i === 0 ? <Trophy className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{g.count}×</span>
                      <span className="w-12 text-right text-sm font-bold text-primary tabular-nums">{g.points} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top receivers */}
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Top Receivers (30d)
              </p>
              {aLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />)}
                </div>
              ) : !analytics?.top_receivers?.length ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <div className="space-y-1">
                  {analytics.top_receivers.map((r, i) => (
                    <div key={r.employee_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        i === 0 ? 'bg-warning text-warning dark:bg-warning/30 dark:text-warning' : 'bg-muted text-muted-foreground'
                      }`}>
                        {i === 0 ? <Trophy className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{r.count} kudos</span>
                      <span className="w-12 text-right text-sm font-bold text-primary tabular-nums">{r.points} pts</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Badges tab ──────────────────────────────────────────────────────── */}
      {tab === 'badges' && (
        <div className="space-y-3">
          {badges.length === 0 ? (
            <p className="text-sm text-muted-foreground">No badges yet.</p>
          ) : badges.map(b => (
            <div
              key={b.code}
              className={`flex items-center gap-4 rounded-2xl border bg-card px-5 py-4 transition-opacity ${
                b.is_active ? 'border-border/60' : 'border-border/30 opacity-60'
              }`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                b.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                <BadgeIcon name={b.icon} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{b.label}</p>
                  {!b.is_active && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Inactive</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.description ?? b.code} · {b.points} pts
                </p>
              </div>
              <button
                onClick={() => toggleBadgeMut.mutate({ code: b.code, is_active: !b.is_active })}
                disabled={toggleBadgeMut.isPending}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                title={b.is_active ? 'Deactivate badge' : 'Activate badge'}
              >
                {b.is_active
                  ? <ToggleRight className="h-6 w-6 text-primary" />
                  : <ToggleLeft className="h-6 w-6" />
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Budget tab ──────────────────────────────────────────────────────── */}
      {tab === 'budget' && (
        <div className="max-w-sm space-y-4">
          <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-1">
                Monthly Recognition Budget
              </p>
              <p className="text-xs text-muted-foreground">
                Points each employee can give per calendar month. Resets on the 1st of each month.
              </p>
            </div>

            {budgetEdit !== null ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Points per month</label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={budgetEdit}
                    onChange={e => setBudgetEdit(parseInt(e.target.value) || 0)}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveBudgetMut.mutate(budgetEdit)}
                    disabled={saveBudgetMut.isPending}
                  >
                    {saveBudgetMut.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBudgetEdit(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-foreground">
                    {budgetData?.monthly_points ?? 100}
                    <span className="ml-1.5 text-base font-normal text-muted-foreground">pts / month</span>
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setBudgetEdit(budgetData?.monthly_points ?? 100)}>
                  Edit
                </Button>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Message-only kudos (no badge) are always allowed regardless of budget. Only points-bearing badges consume budget.
          </p>
        </div>
      )}

      {/* ── Awards tab ──────────────────────────────────────────────────────── */}
      {tab === 'awards' && (
        <div className="space-y-6">
          {/* Long Service Alerts */}
          {longAlerts.length > 0 && (
            <div className="rounded-2xl border border-warning bg-warning dark:border-warning/40 dark:bg-warning/10 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-warning dark:text-warning" />
                <p className="text-sm font-semibold text-warning dark:text-warning">Long Service Milestones This Month</p>
              </div>
              <div className="space-y-2">
                {longAlerts.map(a => (
                  <div key={`${a.id}-${a.milestone_years}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground">{a.first_name} {a.last_name}</span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground font-mono">{a.employee_code}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {a.designation ?? 'Employee'} · {a.department ?? '—'} · completing <span className="font-semibold text-warning">{a.milestone_years} year{a.milestone_years > 1 ? 's' : ''}</span> on {fmtDate(a.date_of_joining.replace(/(\d{4})-(\d{2})-(\d{2})/, `${new Date().getFullYear()}-$2-$3`))}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0">
                      Give Award
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Award Programs list */}
          {awards.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 py-16 text-center">
              <Trophy className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No award programs yet</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">Create your first award program to start recognising excellence.</p>
              <Button size="sm" onClick={() => setCreateAwardOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Award Program
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {awards.map(award => (
                <div key={award.id} className={`rounded-2xl border bg-card px-5 py-4 transition-opacity ${
                  award.is_active ? 'border-border/60' : 'border-border/30 opacity-60'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Trophy className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">{award.name}</p>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {FREQ_LABELS[award.frequency] ?? award.frequency}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary font-medium">
                          {TYPE_LABELS[award.award_type] ?? award.award_type}
                        </span>
                        {!award.is_active && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Archive className="h-2.5 w-2.5" /> Inactive
                          </span>
                        )}
                      </div>
                      {award.description && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{award.description}</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                        {award.monetary_value && (
                          <span>₹{award.monetary_value.toLocaleString('en-IN')} {award.monetary_description ? `— ${award.monetary_description}` : ''}</span>
                        )}
                        {award.eligible_group && <span>Eligible: {award.eligible_group}</span>}
                        {award.requires_nomination && <span className="text-primary">Nomination required</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setSelectedAward(award)}
                      >
                        Manage Rounds <ChevronRight className="ml-1 h-3 w-3" />
                      </Button>
                      <button
                        onClick={() => toggleAwardMut.mutate({ id: award.id, is_active: !award.is_active })}
                        disabled={toggleAwardMut.isPending}
                        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title={award.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {award.is_active
                          ? <ToggleRight className="h-6 w-6 text-primary" />
                          : <ToggleLeft className="h-6 w-6" />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Spot Awards tab ─────────────────────────────────────────────────── */}
      {tab === 'spot' && (
        <div className="space-y-4">
          {/* Summary + filter */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-border/60 bg-card px-4 py-2.5">
                <p className="text-[10px] text-muted-foreground">
                  {spotFilter === 'month' ? 'This month' : 'All time'} — {filteredSpot.length} awards
                  {spotMonthlyTotal > 0 && ` · ₹${spotMonthlyTotal.toLocaleString('en-IN')} monetary`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(['month', 'all'] as const).map(f => (
                <button key={f} onClick={() => setSpotFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    spotFilter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {f === 'month' ? 'This Month' : 'All Time'}
                </button>
              ))}
            </div>
          </div>

          {filteredSpot.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 py-16 text-center">
              <Medal className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-foreground">No spot awards {spotFilter === 'month' ? 'this month' : 'yet'}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSpot.map(s => {
                const from = s['employees!spot_awards_from_employee_id_fkey']
                const to   = s['employees!spot_awards_to_employee_id_fkey']
                return (
                  <div key={s.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Medal className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{from ? `${from.first_name} ${from.last_name}` : 'Unknown'}</span>
                        {' gave '}
                        <span className="font-semibold text-primary">{s.award_name}</span>
                        {' to '}
                        <span className="font-semibold">{to ? `${to.first_name} ${to.last_name}` : 'Unknown'}</span>
                        {to?.employee_code && <span className="ml-1 text-[11px] text-muted-foreground font-mono">{to.employee_code}</span>}
                      </p>
                      {to?.designation && <p className="text-[11px] text-muted-foreground">{to.designation}</p>}
                      {s.message && <p className="mt-0.5 text-xs text-muted-foreground italic">"{s.message}"</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {s.monetary_value && (
                        <p className="text-sm font-bold text-primary">₹{s.monetary_value.toLocaleString('en-IN')}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">{fmtDate(s.created_at)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Create badge dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Badge</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Label *</label>
              <input
                type="text"
                value={newLabel}
                onChange={e => {
                  setNewLabel(e.target.value)
                  if (!newCode) setNewCode(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))
                }}
                placeholder="e.g. Rising Star"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Code *</label>
              <input
                type="text"
                value={newCode}
                onChange={e => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="e.g. rising_star"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Lowercase letters, numbers, underscores only.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="When to give this badge…"
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICON_OPTIONS.map(name => {
                  const Ic = ICONS[name]!
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setNewIcon(name)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                        newIcon === name
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:bg-muted'
                      }`}
                      title={name}
                    >
                      <Ic className="h-4 w-4" />
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Points</label>
              <input
                type="number"
                min={0}
                max={500}
                value={newPoints}
                onChange={e => setNewPoints(parseInt(e.target.value) || 0)}
                className="w-28 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createBadgeMut.mutate()}
              disabled={!newLabel.trim() || !newCode.trim() || createBadgeMut.isPending}
            >
              Create Badge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Award dialog */}
      <CreateAwardDialog open={createAwardOpen} onClose={() => setCreateAwardOpen(false)} />

      {/* Rounds panel */}
      {selectedAward && (
        <RoundsPanel award={selectedAward} onClose={() => setSelectedAward(null)} />
      )}
    </div>
  )
}
