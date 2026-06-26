/**
 * EssRecognition — ESS 2.0 "Rewards" pillar surface.
 * Give peer recognition (badge + message) and see the company recognition feed.
 * Backed by /recognition/* (migration 306).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles, Gift, Star, PartyPopper, Trophy, Coins,
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

// ── Page ───────────────────────────────────────────────────────────────────────
export function EssRecognition() {
  const [giveOpen, setGiveOpen] = useState(false)

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
    queryKey: ['recognition-leaderboard'],
    queryFn:  () => api.get('/recognition/leaderboard'),
    staleTime: 60_000,
  })

  const badges  = badgesResp?.data ?? []
  const feed    = feedResp?.data ?? []
  const me      = meResp?.data
  const leaders = leaderResp?.data ?? []

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

      {leaders.length > 0 && (
        <SectionCard title="Top recognized" description="Most-appreciated colleagues by points">
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

      <GiveDialog open={giveOpen} onOpenChange={setGiveOpen} badges={badges} budget={me?.budget} />
    </PageContainer>
  )
}
