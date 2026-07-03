/**
 * EssRecognition — ESS 2.0 "Rewards" pillar surface.
 * Give peer recognition (badge + message) and see the company recognition feed.
 * Backed by /recognition/* (migration 306) and /recognition/awards/* (migration 334).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star, PartyPopper, Trophy, Coins, Calendar,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Button } from '@/components/ui/button'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Badge {
  code: string; label: string; icon: string | null; description: string | null; points: number
}
interface RecognitionRow {
  id: string; from_name?: string; to_name?: string
  badge_code: string | null; message: string; points: number; created_at: string
}
interface Budget { monthly: number; spent: number; remaining: number }
interface MeSummary { received: number; given: number; points: number; recent: RecognitionRow[]; budget?: Budget }
interface LeaderRow { rank: number; employee_id: string; name: string; points: number; count: number }

interface AwardWinner {
  id: string; period_label: string; declared_at: string | null
  formal_awards: { id: string; name: string; award_type: string } | null
  employees: { id: string; first_name: string; last_name: string; employee_code: string; designation: string | null; department: string | null } | null
}

interface OpenRound {
  id: string; period_label: string; period_start: string | null; period_end: string | null; status: string; created_at: string
  formal_awards: { id: string; name: string; description: string | null; eligible_group: string | null; requires_nomination: boolean; monetary_value: number | null; monetary_description: string | null } | null
}

// ── Icon map (badge.icon stores a lucide name) ─────────────────────────────────
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star,
}
function BadgeIcon({ name, className }: { name: string | null; className?: string }) {
  const Cmp = (name && ICONS[name]) || Award
  return <Cmp className={className} />
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60_000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  } catch { return '' }
}

// ── Give-recognition dialog ────────────────────────────────────────────────────
function GiveDialog({ open, onOpenChange, badges, budget }: {
  open: boolean; onOpenChange: (o: boolean) => void; badges: Badge[]; budget?: Budget
}) {
  const qc = useQueryClient()
  const [toEmployee, setToEmployee] = useState<string>('')
  const [badgeCode, setBadgeCode]   = useState<string>('')
  const [message, setMessage]       = useState<string>('')

  const reset = () => { setToEmployee(''); setBadgeCode(''); setMessage('') }

  const remaining   = budget?.remaining ?? Infinity
  const selectedCost = badges.find(b => b.code === badgeCode)?.points ?? 0
  const overBudget  = selectedCost > remaining

  const give = useMutation({
    mutationFn: () => api.post('/recognition', {
      to_employee: toEmployee,
      badge_code:  badgeCode || undefined,
      message:     message.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recognition-feed'] })
      qc.invalidateQueries({ queryKey: ['recognition-me'] })
      qc.invalidateQueries({ queryKey: ['ess-home'] })
      toast.success('Recognition sent 🎉')
      reset(); onOpenChange(false)
    },
    onError: (e: Error) => toast.error('Could not send recognition', { description: e.message }),
  })

  const canSubmit = !!toEmployee && message.trim().length > 0 && !overBudget && !give.isPending

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Give recognition</DialogTitle>
          <DialogDescription>Appreciate a colleague — they'll see it in the company feed.</DialogDescription>
        </DialogHeader>

        {/* Monthly budget meter */}
        {budget && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between text-[11px] font-medium">
              <span className="text-muted-foreground">Your recognition budget this month</span>
              <span className={overBudget ? 'font-bold text-destructive' : 'font-bold text-primary'}>
                {budget.remaining} / {budget.monthly} pts left
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${budget.monthly ? Math.round((budget.remaining / budget.monthly) * 100) : 0}%` }} />
            </div>
          </div>
        )}

        <div className="space-y-4 py-1">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Colleague</label>
            <EmployeeSelector
              value={toEmployee}
              onChange={(v) => setToEmployee(Array.isArray(v) ? v[0] ?? '' : v)}
              placeholder="Search by name or code…"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Badge (optional)</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {badges.map(b => {
                const active = badgeCode === b.code
                const unaffordable = b.points > remaining && !active
                return (
                  <button
                    key={b.code}
                    type="button"
                    disabled={unaffordable}
                    title={unaffordable ? `Needs ${b.points} pts — only ${remaining} left this month` : undefined}
                    onClick={() => setBadgeCode(active ? '' : b.code)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                      active ? 'border-primary bg-primary/5'
                      : unaffordable ? 'cursor-not-allowed border-border opacity-40'
                      : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <BadgeIcon name={b.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold text-foreground">{b.label}</span>
                      <span className="block text-[10px] text-muted-foreground">+{b.points} pts</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="What did they do brilliantly?"
              className="w-full resize-none rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">{message.length}/500</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => give.mutate()}>
            {give.isPending ? 'Sending…' : 'Send recognition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Feed card ──────────────────────────────────────────────────────────────────
function FeedCard({ r, badges }: { r: RecognitionRow; badges: Badge[] }) {
  const badge = badges.find(b => b.code === r.badge_code)
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-card p-3.5">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BadgeIcon name={badge?.icon ?? null} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{r.from_name ?? 'Someone'}</span>
          {' recognized '}
          <span className="font-semibold">{r.to_name ?? 'a colleague'}</span>
          {badge && <span className="text-muted-foreground"> · {badge.label}</span>}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">“{r.message}”</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{timeAgo(r.created_at)}</p>
      </div>
    </div>
  )
}

// ── Award type colour map ──────────────────────────────────────────────────────
const AWARD_TYPE_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  employee_of_month: { bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-300', icon: 'text-amber-500' },
  long_service:      { bg: 'bg-teal-50 border-teal-200 dark:bg-teal-900/10 dark:border-teal-800/40',   text: 'text-teal-700 dark:text-teal-300',   icon: 'text-teal-500' },
  store_of_month:    { bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-800/40',   text: 'text-blue-700 dark:text-blue-300',   icon: 'text-blue-500' },
}
const defaultColor = { bg: 'bg-purple-50 border-purple-200 dark:bg-purple-900/10 dark:border-purple-800/40', text: 'text-purple-700 dark:text-purple-300', icon: 'text-purple-500' }

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Nominate Dialog ────────────────────────────────────────────────────────────
function NominateDialog({ open, onClose, round }: {
  open: boolean; onClose: () => void; round: OpenRound | null
}) {
  const qc = useQueryClient()
  const [nomineeId, setNomineeId] = useState('')
  const [justification, setJustification] = useState('')

  const reset = () => { setNomineeId(''); setJustification('') }
  const awardId = round?.formal_awards?.id ?? ''

  const nominateMut = useMutation({
    mutationFn: () => api.post(`/recognition/admin/awards/${awardId}/rounds/${round!.id}/nominations`, {
      nominee_id: nomineeId,
      justification: justification.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['awards-open'] })
      toast.success('Nomination submitted!')
      reset(); onClose()
    },
    onError: (e: Error) => toast.error('Could not submit nomination', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nominate for {round?.formal_awards?.name}</DialogTitle>
          <DialogDescription>{round?.period_label}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nominee *</label>
            <EmployeeSelector
              value={nomineeId}
              onChange={(v) => setNomineeId(Array.isArray(v) ? v[0] ?? '' : v)}
              placeholder="Search by name or code…"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Justification</label>
            <textarea
              value={justification}
              onChange={e => setJustification(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Why do you nominate this person?"
              className="w-full resize-none rounded-lg border border-border bg-card p-2.5 text-sm outline-none focus:border-primary"
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">{justification.length}/500</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button disabled={!nomineeId || nominateMut.isPending} onClick={() => nominateMut.mutate()}>
            {nominateMut.isPending ? 'Submitting…' : 'Submit Nomination'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type LeaderPeriod = 'monthly' | 'quarterly' | 'ytd' | 'all'

const PERIOD_LABELS: Record<LeaderPeriod, string> = {
  monthly:   'This Month',
  quarterly: 'This Quarter',
  ytd:       'This Year',
  all:       'All Time',
}

// ── Page ───────────────────────────────────────────────────────────────────────
export function EssRecognition() {
  const [giveOpen, setGiveOpen]         = useState(false)
  const [period, setPeriod]             = useState<LeaderPeriod>('monthly')
  const [nominateRound, setNominateRound] = useState<OpenRound | null>(null)

  const { data: badgesResp } = useQuery<{ data: Badge[] }>({
    queryKey: ['recognition-badges'],
    queryFn:  () => api.get('/recognition/badges'),
    staleTime: 10 * 60_000,
  })
  const { data: feedResp, isLoading: feedLoading } = useQuery<{ data: RecognitionRow[] }>({
    queryKey: ['recognition-feed'],
    queryFn:  () => api.get('/recognition/feed?limit=30'),
    staleTime: 30_000,
  })
  const { data: meResp } = useQuery<{ data: MeSummary }>({
    queryKey: ['recognition-me'],
    queryFn:  () => api.get('/recognition/me'),
    staleTime: 30_000,
  })
  const { data: leaderResp } = useQuery<{ data: LeaderRow[] }>({
    queryKey: ['recognition-leaderboard', period],
    queryFn:  () => api.get(`/recognition/leaderboard?period=${period}`),
    staleTime: 60_000,
  })

  const { data: winnersResp } = useQuery<{ data: AwardWinner[] }>({
    queryKey: ['awards-winners'],
    queryFn:  () => api.get('/recognition/awards/winners'),
    staleTime: 5 * 60_000,
  })

  const { data: openRoundsResp } = useQuery<{ data: OpenRound[] }>({
    queryKey: ['awards-open'],
    queryFn:  () => api.get('/recognition/awards/open'),
    staleTime: 2 * 60_000,
  })

  const badges     = badgesResp?.data ?? []
  const feed       = feedResp?.data ?? []
  const me         = meResp?.data
  const leaders    = leaderResp?.data ?? []
  const winners    = winnersResp?.data ?? []
  const openRounds = openRoundsResp?.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title="Recognition"
        subtitle="Celebrate the people who make work better"
        breadcrumb={[{ label: 'Recognition' }]}
        actions={
          <Button onClick={() => setGiveOpen(true)}>
            <PartyPopper className="mr-2 h-4 w-4" /> Give recognition
          </Button>
        }
      />

      <MetricRow cols={4}>
        <MetricCard label="Received" value={me?.received ?? 0} icon={Heart}  variant="success" />
        <MetricCard label="Given"    value={me?.given ?? 0}    icon={Gift}   variant="info" />
        <MetricCard label="Points"   value={me?.points ?? 0}   icon={Star}   variant="warning" />
        <MetricCard
          label="Budget left"
          value={me?.budget ? `${me.budget.remaining}/${me.budget.monthly}` : '—'}
          icon={Coins}
          variant="neutral"
        />
      </MetricRow>

      {(leaders.length > 0 || true) && (
        <SectionCard
          title="Top recognized"
          description="Most-appreciated colleagues by points"
          action={
            <div className="flex items-center gap-1">
              {(Object.keys(PERIOD_LABELS) as LeaderPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    period === p
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          }
        >
          {leaders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No recognitions in this period.</p>
          ) : (
          <div className="space-y-1">
            {leaders.slice(0, 5).map(l => (
              <div key={l.employee_id} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5">
                <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  l.rank === 1 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
                }`}>
                  {l.rank === 1 ? <Trophy className="h-3.5 w-3.5" /> : l.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{l.name}</span>
                <span className="text-xs text-muted-foreground">{l.count} kudos</span>
                <span className="w-10 text-right text-sm font-bold tabular-nums text-primary">{l.points}</span>
              </div>
            ))}
          </div>
          )}
        </SectionCard>
      )}

      <SectionCard title="Company feed" description="Recent recognition across the organization">
        {feedLoading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : feed.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <PartyPopper className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">No recognition yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">Be the first to appreciate a colleague — it only takes a moment.</p>
            <Button size="sm" className="mt-1" onClick={() => setGiveOpen(true)}>Give the first one</Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {feed.map(r => <FeedCard key={r.id} r={r} badges={badges} />)}
          </div>
        )}
      </SectionCard>

      {/* Open Nominations section — only if any open rounds exist */}
      {openRounds.length > 0 && (
        <SectionCard
          title="Open Nominations"
          description="Current award rounds accepting nominations"
          icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-2.5">
            {openRounds.map(r => {
              const award = r.formal_awards
              return (
                <div key={r.id} className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {award?.name ?? 'Award'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{r.period_label}</p>
                    {award?.description && (
                      <p className="text-[11px] text-muted-foreground">{award.description}</p>
                    )}
                    {award?.eligible_group && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Eligible: {award.eligible_group}</p>
                    )}
                  </div>
                  {award?.requires_nomination !== false && (
                    <Button size="sm" variant="outline" className="shrink-0 h-7 text-xs"
                      onClick={() => setNominateRound(r)}
                    >
                      Nominate
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Award Winners Wall */}
      {winners.length > 0 && (
        <SectionCard
          title="Award Winners"
          description="Recent formal award winners"
          icon={<Trophy className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {winners.slice(0, 10).map(w => {
              const awardType = w.formal_awards?.award_type ?? 'custom'
              const colors = AWARD_TYPE_COLORS[awardType] ?? defaultColor
              const emp = w.employees
              return (
                <div key={w.id} className={`rounded-xl border px-4 py-3 ${colors.bg}`}>
                  <div className="flex items-start gap-3">
                    <Trophy className={`h-5 w-5 shrink-0 mt-0.5 ${colors.icon}`} />
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>
                        {w.formal_awards?.name ?? 'Award'}
                      </p>
                      <p className="mt-1 text-sm font-bold text-foreground">
                        {emp ? `${emp.first_name} ${emp.last_name}` : 'Winner'}
                      </p>
                      {emp?.designation?.name && (
                        <p className="text-[11px] text-muted-foreground">{emp.designation.name}</p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {w.period_label}
                        {w.declared_at && ` · ${fmtDate(w.declared_at)}`}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      <GiveDialog open={giveOpen} onOpenChange={setGiveOpen} badges={badges} budget={me?.budget} />
      <NominateDialog open={!!nominateRound} onClose={() => setNominateRound(null)} round={nominateRound} />
    </PageContainer>
  )
}
