/**
 * EssHome — ESS 2.0 Experience Cloud home page.
 *
 * Single aggregated query (GET /ess/home) → modern layout:
 *   Hero        — greeting + today's punch state
 *   Quick Acts  — Apply Leave · Regularize · Payslip · Reimburse · Helpdesk
 *   KPI strip   — Leave remaining · Net Pay · Open Actions
 *   Feed teaser — top 3 community posts
 *   Recognition — kudos received
 *   Holidays    — next upcoming
 *   My Requests — pending/approved/rejected summary
 */

import { useQuery }     from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Clock, CheckCircle2, CalendarCheck, ClipboardEdit, Receipt,
  CreditCard, LifeBuoy, Award, CalendarDays, Inbox, ArrowRight,
  ThumbsUp, PartyPopper, Megaphone, Star, Users, Cake,
} from 'lucide-react'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'
import { SignalCard, type Signal } from '@/components/experience/SignalCard'
import { ActivityItem, type ActivityEvent } from '@/components/experience/ActivityItem'
import { QuickActions, type Capability } from '@/components/experience/QuickActions'
import { CelebrationCard } from '@/components/experience/CelebrationCard'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState }   from '@/components/layout/ErrorState'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HomePayload {
  profile: {
    name: string | null
    employee_code: string | null
    joining_date: string | null
    tenure_months: number
    designation: string | null
    department: string | null
    grade: string | null
    manager: string | null
  }
  today: {
    check_in: string | null
    check_out: string | null
    total_hours: string | null
    status: string
  }
  kpis: {
    leave_days_remaining: number
    net_pay: number | null
    open_actions: number
    pending_approvals: number
  }
  leave_balance: { name: string; balance: number; used: number }[]
  upcoming_holidays: { id: string; name: string; date: string; days_until: number }[]
  recognition: { total_received: number; recent: { id: string; from_name: string; badge_code: string; message?: string; points?: number; created_at: string }[] }
  feed_teaser: { id: string; type: string; body: string; created_at: string; author: string }[]
  birthdays: { name: string; days_until: number }[]
  anniversaries: { name: string; years: number; days_until: number }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtTime(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z')
  return isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${M[d.getUTCMonth()]}`
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (h < 1)  return 'just now'
  if (h < 24) return `${h}h ago`
  if (d < 7)  return `${d}d ago`
  return fmtDate(iso)
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion',
  customer_hero:      'Customer Hero',
  team_player:        'Team Player',
  innovator:          'Innovator',
  problem_solver:     'Problem Solver',
  culture_ambassador: 'Culture Ambassador',
}

const FEED_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  recognition: Award,
  announcement: Megaphone,
  birthday:    Cake,
  new_joiner:  Users,
  milestone:   Star,
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card shadow-sm', className)}>
      {children}
    </div>
  )
}

function SectionTitle({ icon: Icon, label, action, onAction }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Icon className="h-4 w-4 text-primary" />{label}
      </h2>
      {action && (
        <button onClick={onAction} className="flex items-center gap-0.5 text-xs font-semibold text-primary hover:text-primary/80">
          {action} <ArrowRight className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssHome() {
  const navigate   = useNavigate()
  const { pathname } = useLocation()
  const { profile: auth } = useAuthStore()

  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  const { data, isLoading } = useQuery<HomePayload>({
    queryKey: ['ess-home'],
    queryFn:  () => api.get('/ess/home'),
    staleTime: 2 * 60_000,
  })

  // Experience Core: the "what needs you" signal layer (ranked server-side).
  // Loads independently of the home shell so the OS layer streams in.
  const signalsQ = useQuery<{ signals: Signal[] }>({
    queryKey: ['ess-signals'],
    queryFn:  () => api.get('/ess/signals'),
    staleTime: 60_000,
  })
  const signals = signalsQ.data?.signals ?? []

  // Experience Core: the "what happened" layer (today's events, ranked server-side).
  const activityQ = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ['ess-activity'],
    queryFn:  () => api.get('/ess/activity'),
    staleTime: 60_000,
  })
  const events = activityQ.data?.events ?? []

  const firstName = (data?.profile?.name ?? auth?.full_name ?? 'there').split(' ')[0]
  const today     = data?.today
  const kpis      = data?.kpis
  const isManager = ['manager', 'hr_admin', 'super_admin'].includes(auth?.role ?? '')

  // "What should I do next" — capabilities, not a hard-coded menu. Context-aware:
  // Regularize is promoted when the signals layer flags a missing check-in.
  const hasNoCheckIn = signals.some((s) => s.id === 'no_check_in')
  const capabilities: Capability[] = [
    { id: 'flowdesk',  label: 'FlowDesk',      icon: Inbox,        href: '/flowdesk',        badge: kpis?.open_actions, primary: !hasNoCheckIn },
    { id: 'regularize',label: 'Regularize',    icon: ClipboardEdit, href: '/attendance',      primary: hasNoCheckIn },
    { id: 'leave',     label: 'Apply Leave',   icon: CalendarCheck, href: '/leave/balance' },
    { id: 'payslip',   label: 'Payslip',       icon: Receipt,       href: '/compensation' },
    { id: 'reimburse', label: 'Reimbursement', icon: CreditCard,    href: '/reimbursements' },
    { id: 'helpdesk',  label: 'Helpdesk',      icon: LifeBuoy,      href: '/issues' },
  ].sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false))

  // Celebrations — composed from existing home data (peers to celebrate today/tomorrow).
  const celebrations = [
    ...((data?.birthdays ?? []).filter((b) => b.days_until <= 1).map((b) => ({
      id: `bd_${b.name}`, kind: 'birthday' as const, title: `${b.name}'s birthday`,
      subtitle: b.days_until === 0 ? 'Today' : 'Tomorrow',
    }))),
    ...((data?.anniversaries ?? []).filter((a) => a.days_until <= 1).map((a) => ({
      id: `an_${a.name}`, kind: 'anniversary' as const, title: `${a.name} · ${a.years}y anniversary`,
      subtitle: a.days_until === 0 ? 'Today' : 'Tomorrow',
    }))),
  ].slice(0, 4)

  if (isLoading) {
    return (
      <div className="space-y-5">
        {[1,2,3].map(i => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted/40" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Hero: greeting + punch ── */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-[#1A4D8F] to-[#15B8A6] p-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white/80">{greeting()},</p>
              <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight">{firstName} 👋</h1>
              {data?.profile?.designation && (
                <p className="mt-1 text-sm text-white/70">
                  {data.profile.designation}
                  {data.profile.department ? ` · ${data.profile.department}` : ''}
                </p>
              )}
            </div>
            {/* Punch state */}
            <div className="shrink-0 text-right">
              {today?.check_in ? (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Checked in {fmtTime(today.check_in)}
                  </span>
                  {today.check_out && (
                    <span className="text-xs text-white/60">Out {fmtTime(today.check_out)}</span>
                  )}
                  {today.total_hours && (
                    <span className="text-xs text-white/60">{today.total_hours} worked</span>
                  )}
                </div>
              ) : (
                <button onClick={() => navigate(`${base}/attendance`)}
                  className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30 transition-colors">
                  <Clock className="h-3.5 w-3.5" /> Punch in
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Profile strip */}
        <div className="flex items-center gap-4 px-5 py-3 bg-card border-t border-border/40">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {firstName.charAt(0)}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {data?.profile?.employee_code && <span className="font-mono font-medium text-foreground">{data.profile.employee_code}</span>}
            {data?.profile?.department    && <span>{data.profile.department}</span>}
            {data?.profile?.grade         && <span>Grade {data.profile.grade}</span>}
            {data?.profile?.manager       && <span>Reports to {data.profile.manager}</span>}
            {data?.profile?.tenure_months != null && (
              <span>{Math.floor(data.profile.tenure_months / 12)}y {data.profile.tenure_months % 12}m tenure</span>
            )}
          </div>
        </div>
      </Card>

      {/* ── What needs you (Experience Core signals, ranked) ── */}
      {signalsQ.isLoading ? (
        <LoadingState rows={2} />
      ) : signalsQ.isError ? (
        <ErrorState title="Couldn’t load your signals" onRetry={() => signalsQ.refetch()} compact />
      ) : signals.length > 0 ? (
        <div className="space-y-2.5">
          <SectionTitle icon={Inbox} label="What needs you" />
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} onAction={(href) => navigate(`${base}${href}`)} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
          You’re all caught up — nothing needs your attention right now.
        </div>
      )}

      {/* ── Quick Actions (capability-driven) ── */}
      <QuickActions capabilities={capabilities} onAction={(href) => navigate(`${base}${href}`)} />

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Leave remaining</p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {kpis?.leave_days_remaining ?? '—'}
            <span className="ml-1 text-xs font-normal text-muted-foreground">days</span>
          </p>
          <button onClick={() => navigate(`${base}/leave/balance`)} className="mt-1 text-[11px] text-primary hover:underline">View balance →</button>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Last net pay</p>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {kpis?.net_pay != null ? `₹${Number(kpis.net_pay).toLocaleString('en-IN')}` : '—'}
          </p>
          <button onClick={() => navigate(`${base}/compensation`)} className="mt-1 text-[11px] text-primary hover:underline">View payslip →</button>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Open actions</p>
          <p className={cn('mt-1 text-2xl font-extrabold', (kpis?.open_actions ?? 0) > 0 ? 'text-warning' : 'text-foreground')}>
            {kpis?.open_actions ?? 0}
          </p>
          <button onClick={() => navigate(`${base}/flowdesk`)} className="mt-1 text-[11px] text-primary hover:underline">View FlowDesk →</button>
        </Card>
      </div>

      {/* ── Main two-column grid ── */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Community feed teaser — wider column */}
        <div className="lg:col-span-3 space-y-5">

          {/* What happened today (Experience Core activity) */}
          <Card className="p-5">
            <SectionTitle icon={Clock} label="What happened today" />
            {activityQ.isLoading ? (
              <LoadingState rows={3} compact />
            ) : events.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing yet today — your activity will show up here.</p>
            ) : (
              <div className="space-y-3.5">
                {events.map((e) => <ActivityItem key={e.id} event={e} />)}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle icon={Megaphone} label="Community" action="View all" onAction={() => navigate(`${base}/community`)} />
            {(data?.feed_teaser ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No posts yet.</p>
            ) : (
              <div className="space-y-4">
                {(data?.feed_teaser ?? []).map((post) => {
                  const Icon = FEED_ICON[post.type] ?? Megaphone
                  return (
                    <div key={post.id} className="flex gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{post.author}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{post.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground/60">{timeAgo(post.created_at)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Manager approvals nudge */}
          {isManager && (kpis?.pending_approvals ?? 0) > 0 && (
            <Card className="flex items-center justify-between gap-4 p-4 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10">
                  <Inbox className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{kpis!.pending_approvals} approvals waiting</p>
                  <p className="text-xs text-muted-foreground">Team leave + attendance corrections</p>
                </div>
              </div>
              <button onClick={() => navigate(`${base}/flowdesk`)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
                Review <ArrowRight className="h-3 w-3" />
              </button>
            </Card>
          )}
        </div>

        {/* Right column: Celebrations + Recognition + Holidays */}
        <div className="lg:col-span-2 space-y-5">

          {/* Celebrations — composed from existing data, premium & subtle */}
          {celebrations.length > 0 && (
            <Card className="p-5">
              <SectionTitle icon={PartyPopper} label="Celebrations" />
              <div className="space-y-2.5">
                {celebrations.map((c) => (
                  <CelebrationCard
                    key={c.id} kind={c.kind} title={c.title} subtitle={c.subtitle}
                    action={{ label: 'Wish', onClick: () => navigate(`${base}/community`) }}
                  />
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle icon={Award} label="Recognition" action="View all" onAction={() => navigate(`${base}/recognition`)} />
            {(data?.recognition?.recent ?? []).length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-xs text-muted-foreground">No kudos yet.</p>
                <button onClick={() => navigate(`${base}/recognition`)}
                  className="mt-2 flex items-center gap-1 mx-auto text-xs font-semibold text-primary hover:text-primary/80">
                  <ThumbsUp className="h-3.5 w-3.5" /> Give recognition
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {data?.recognition?.total_received != null && data.recognition.total_received > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-[#15B8A6]/8 border border-[#15B8A6]/20 px-3 py-2">
                    <PartyPopper className="h-4 w-4 text-[#15B8A6]" />
                    <span className="text-xs font-semibold text-foreground">
                      Recognised {data.recognition.total_received}× so far
                    </span>
                  </div>
                )}
                {(data?.recognition?.recent ?? []).map((r) => (
                  <div key={r.id} className="rounded-lg border border-border/40 bg-background p-3">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-semibold text-foreground">
                        {BADGE_LABELS[r.badge_code] ?? r.badge_code ?? 'Kudos'}
                      </p>
                      {r.points != null && (
                        <span className="text-[10px] font-bold text-[#15B8A6]">+{r.points}pts</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">from {r.from_name}</p>
                    {r.message && (
                      <p className="mt-1 line-clamp-2 text-[11px] italic text-foreground/70">"{r.message}"</p>
                    )}
                  </div>
                ))}
                <button onClick={() => navigate(`${base}/recognition`)}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80">
                  <ThumbsUp className="h-3 w-3" /> Give recognition →
                </button>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle icon={CalendarDays} label="Upcoming Holidays" action="All" onAction={() => navigate(`${base}/company-holidays`)} />
            {(data?.upcoming_holidays ?? []).length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No holidays in the next 60 days.</p>
            ) : (
              <div className="space-y-2">
                {(data?.upcoming_holidays ?? []).slice(0, 4).map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{h.name}</p>
                    <div className="text-right">
                      <p className="text-[11px] font-semibold text-primary">{fmtDate(h.date)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {h.days_until === 0 ? 'Today' : h.days_until === 1 ? 'Tomorrow' : `in ${h.days_until}d`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

        </div>
      </div>

    </div>
  )
}
