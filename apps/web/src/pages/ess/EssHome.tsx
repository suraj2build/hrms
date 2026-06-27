/**
 * EssHome — the digital front door of the company.
 *
 * Home is authored as the STORY of the employee's workday, not a grid of modules
 * (EXPERIENCE_REVIEW_HOME.md → E1 Narrative Design). It answers, in five seconds:
 *   What matters today · What happened · Who matters · What I should do next.
 *
 * Every block: one conversational title + one ambient AI sentence (explain /
 * recommend / reassure) + people's faces over icons. Composed from Experience
 * Core services (/ess/home, /ess/signals, /ess/activity) — no Home-specific logic.
 */

import { useQuery }     from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Clock, CheckCircle2, CalendarCheck, ClipboardEdit, Receipt, CreditCard,
  LifeBuoy, Award, Inbox, CalendarDays, Sparkles,
} from 'lucide-react'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { SignalCard, type Signal } from '@/components/experience/SignalCard'
import { ActivityItem, type ActivityEvent } from '@/components/experience/ActivityItem'
import { QuickActions, type Capability } from '@/components/experience/QuickActions'
import { CelebrationCard } from '@/components/experience/CelebrationCard'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { AmbientLine } from '@/components/experience/AmbientLine'
import { Arrival } from '@/components/experience/Arrival'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand } from '@/components/experience/ProgressBand'
import { type DayContext } from '@/components/experience/resolveGreeting'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState }   from '@/components/layout/ErrorState'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HomePayload {
  profile: { name: string | null; employee_code: string | null; joining_date: string | null; tenure_months: number; designation: string | null; department: string | null; grade: string | null; manager: string | null }
  context?: DayContext
  today:   { check_in: string | null; check_out: string | null; total_hours: string | null; status: string }
  kpis:    { leave_days_remaining: number; net_pay: number | null; open_actions: number; pending_approvals: number }
  leave_balance: { name: string; balance: number; used: number }[]
  upcoming_holidays: { id: string; name: string; date: string; days_until: number }[]
  recognition: { total_received: number; recent: { id: string; from_name: string; badge_code: string; message?: string; points?: number; created_at: string }[] }
  feed_teaser: { id: string; type: string; body: string; created_at: string; author: string }[]
  birthdays: { name: string; days_until: number }[]
  anniversaries: { name: string; years: number; days_until: number }[]
}

/** GET /ess/progress — the motivational "My Progress" band (Movement 7). */
interface ProgressPayload {
  show:    boolean
  heading: string
  ambient: string
  hints:   { label: string; value: string }[]
}

/** GET /ess/reflection — the memory-aware AI insight (Movement 9). */
interface Reflection {
  insight: string | null
  action?: { label: string; href: string }
  kind?:   'pay' | 'break' | 'attendance'
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
  const h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'yesterday'
  return fmtDate(iso)
}
function lowerFirst(s: string) { return s.charAt(0).toLowerCase() + s.slice(1) }

const BADGE_LABELS: Record<string, string> = {
  ownership_champion: 'Ownership Champion', customer_hero: 'Customer Hero', team_player: 'Team Player',
  innovator: 'Innovator', problem_solver: 'Problem Solver', culture_ambassador: 'Culture Ambassador',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function EssHome() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { profile: auth } = useAuthStore()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  const { data, isLoading, isError, refetch } = useQuery<HomePayload>({
    queryKey: ['ess-home'], queryFn: () => api.get('/ess/home'), staleTime: 2 * 60_000,
  })
  const signalsQ = useQuery<{ signals: Signal[] }>({
    queryKey: ['ess-signals'], queryFn: () => api.get('/ess/signals'), staleTime: 60_000,
  })
  const activityQ = useQuery<{ events: ActivityEvent[] }>({
    queryKey: ['ess-activity'], queryFn: () => api.get('/ess/activity'), staleTime: 60_000,
  })
  const progressQ = useQuery<ProgressPayload>({
    queryKey: ['ess-progress'], queryFn: () => api.get('/ess/progress'), staleTime: 5 * 60_000,
  })
  const reflectionQ = useQuery<Reflection>({
    queryKey: ['ess-reflection'], queryFn: () => api.get('/ess/reflection'), staleTime: 5 * 60_000,
  })

  const signals = signalsQ.data?.signals ?? []
  const events  = activityQ.data?.events ?? []
  const progress   = progressQ.data
  const reflection = reflectionQ.data
  const today   = data?.today
  const kpis    = data?.kpis
  const fullName  = data?.profile?.name ?? auth?.full_name ?? 'there'

  // ── Ambient intelligence: one sentence per block, from the employee's own data ──
  const dow = new Date().getDay()
  const isWeekend = dow === 0 || dow === 6

  const focalInsight = (() => {
    if (today && !today.check_in && !isWeekend)
      return `You haven't checked in yet — punch in, or regularize if you're working remotely.`
    const urgent = signals.find((s) => s.severity !== 'info')
    if (urgent) return `Right now, the thing most worth your attention is to ${lowerFirst(urgent.title)}.`
    if (signals.length > 0) return 'A couple of things could use a glance, but nothing urgent today.'
    return `You're all set — nothing needs you right now. Enjoy the calm.`
  })()

  const dayInsight = (() => {
    if (events.length === 0) return 'A quiet start so far — your day will fill in here.'
    if (events.some((e) => e.type === 'payroll')) return 'Your salary landed today — and a few other things happened too.'
    if (events.some((e) => e.type === 'recognition')) return 'Someone recognized you today — the good news is just below.'
    return `${events.length} thing${events.length > 1 ? 's have' : ' has'} happened so far today.`
  })()

  // "What should I do next" — capabilities, context-aware (Regularize promoted on missing punch).
  const hasNoCheckIn = signals.some((s) => s.id === 'no_check_in')
  const capabilities: Capability[] = [
    { id: 'flowdesk',  label: 'FlowDesk',      icon: Inbox,        href: '/flowdesk',        badge: kpis?.open_actions, primary: !hasNoCheckIn },
    { id: 'regularize',label: 'Regularize',    icon: ClipboardEdit, href: '/attendance',      primary: hasNoCheckIn },
    { id: 'leave',     label: 'Apply Leave',   icon: CalendarCheck, href: '/leave/balance' },
    { id: 'payslip',   label: 'Payslip',       icon: Receipt,       href: '/compensation' },
    { id: 'reimburse', label: 'Reimbursement', icon: CreditCard,    href: '/reimbursements' },
    { id: 'helpdesk',  label: 'Helpdesk',      icon: LifeBuoy,      href: '/issues' },
  ].sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false))

  // Celebrations — composed from existing data (peers to celebrate today/tomorrow).
  const celebrations = [
    ...(data?.birthdays ?? []).filter((b) => b.days_until <= 1).map((b) => ({
      id: `bd_${b.name}`, kind: 'birthday' as const, name: b.name, title: `${b.name}'s birthday`, subtitle: b.days_until === 0 ? 'Today' : 'Tomorrow',
    })),
    ...(data?.anniversaries ?? []).filter((a) => a.days_until <= 1).map((a) => ({
      id: `an_${a.name}`, kind: 'anniversary' as const, name: a.name, title: `${a.name} · ${a.years}y`, subtitle: a.days_until === 0 ? 'Anniversary today' : 'Anniversary tomorrow', years: a.years,
    })),
  ].slice(0, 4)

  const firstName = fullName.split(' ')[0]
  const pending   = signals.length > 0 || (kpis?.open_actions ?? 0) > 0
  const tenureM   = data?.profile?.tenure_months ?? 0
  const tenureLabel = tenureM < 1 ? 'Today is day one'
    : tenureM < 12 ? `${tenureM} month${tenureM > 1 ? 's' : ''} in`
    : `${Math.floor(tenureM / 12)} year${Math.floor(tenureM / 12) > 1 ? 's' : ''} and counting`

  // The Arrival (the threshold) always paints first and stays mounted across the day's
  // loading/error states, so the door never shows a spinner (EXPERIENCE_ARRIVAL_SPEC.md).
  // The "deeper" day below is untouched in this pass — you cross into it from the door.
  return (
    <>
      <Arrival dayAnchorId="ess-your-day" />
      {/* ── "Today, gently" section — the editorial deeper room ── */}
      <div id="ess-your-day" className="w-full">
      {isLoading ? (
        <div className="py-16"><LoadingState rows={5} label="Putting your day together…" /></div>
      ) : isError ? (
        <ErrorState title="Couldn't load your day" onRetry={() => refetch()} />
      ) : (
      <>
      {/* Section header — quiet editorial intro after crossing the Arrival. */}
      <div className="border-b border-border/50 pb-8 pt-10">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">TODAY, GENTLY</p>
          {today?.check_in ? (
            <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> In since {fmtTime(today.check_in)}
            </span>
          ) : !isWeekend && (
            <button onClick={() => navigate(`${base}/attendance`)}
              className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <Clock className="h-3.5 w-3.5" /> Punch in
            </button>
          )}
        </div>
        <h2 className="serif-hero mt-3 text-[clamp(1.8rem,4vw,2.8rem)] text-foreground">
          A few things <span className="serif-emph text-primary">worth noticing.</span>
        </h2>
        <AmbientLine className="mt-3">{focalInsight}</AmbientLine>
      </div>

      {/* Quick actions strip */}
      <div className="py-6">
        <QuickActions capabilities={capabilities} onAction={(href) => navigate(`${base}${href}`)} />
      </div>

      {/* 2-column grid layout */}
      <div className="mt-2 grid grid-cols-1 gap-8 pb-4 lg:grid-cols-[1fr_360px]">

        {/* LEFT column */}
        <div className="space-y-10">

          {/* Signals — only when present */}
          {signals.length > 0 && (
            <section>
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Worth your attention</p>
              <div className="space-y-2.5">
                {signals.map((s) => <SignalCard key={s.id} signal={s} onAction={(href) => navigate(`${base}${href}`)} />)}
              </div>
            </section>
          )}

          {/* Your day — the activity moment river */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your day</p>
              <button onClick={() => navigate(`${base}/timeline`)}
                className="text-[11px] font-medium text-primary hover:text-primary/80">
                Your story →
              </button>
            </div>
            <AmbientLine className="mb-5">{dayInsight}</AmbientLine>
            {activityQ.isLoading ? (
              <LoadingState rows={3} compact />
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">A quiet start — your check-ins and approvals will appear here.</p>
            ) : (
              <ul className="flex flex-col">
                {events.map((e) => (
                  <li key={e.id} className="border-b border-border/50 py-5 last:border-0">
                    <ActivityItem event={e} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Recognition from teammates */}
          {(data?.recognition?.recent ?? []).length > 0 && (
            <section>
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Kind words</p>
              <div className="space-y-4">
                {(data?.recognition?.recent ?? []).map((r) => (
                  <div key={r.id} className="flex items-start gap-3">
                    <PersonAvatar name={r.from_name} size="sm" className="mt-0.5" decorative />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {r.from_name} <span className="font-normal text-muted-foreground">recognized you</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {BADGE_LABELS[r.badge_code] ?? r.badge_code}{r.points != null ? ` · +${r.points} pts` : ''}
                      </p>
                      {r.message && <p className="mt-0.5 line-clamp-2 text-xs italic text-foreground/70">"{r.message}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* RIGHT column */}
        <div className="space-y-4">

          {/* Featured celebration card — first celebration */}
          {celebrations.length > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-orange-200/60 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-500/80">Today at CognixHR</p>
              <h3 className="serif-hero mt-2 text-[1.8rem] leading-tight text-foreground">
                {celebrations[0].name.split(' ')[0]}{celebrations[0].kind === 'birthday' ? "'s birthday" : celebrations[0].kind === 'anniversary' ? `'s ${'years' in celebrations[0] ? (celebrations[0] as { years: number }).years : ''}yr anniversary` : ' joined us'}
              </h3>
              <div className="mt-4 flex items-center gap-3">
                <PersonAvatar name={celebrations[0].name} size="lg" />
                <div>
                  <p className="font-semibold text-foreground">{celebrations[0].name}</p>
                  <p className="text-xs text-muted-foreground">{celebrations[0].subtitle}</p>
                </div>
              </div>
              <button onClick={() => navigate(`${base}/company`)} className="mt-5 w-full rounded-xl bg-white/70 px-4 py-2.5 text-sm font-semibold text-foreground/80 transition hover:bg-white/90">
                Send a note →
              </button>
            </div>
          )}

          {/* Also today card — remaining celebrations */}
          {celebrations.length > 1 && (
            <div className="rounded-2xl border border-border/60 bg-card p-5">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Also today</p>
              <ul className="space-y-3">
                {celebrations.slice(1).map((c) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <PersonAvatar name={c.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.subtitle}</p>
                    </div>
                    <span className="text-base">
                      {c.kind === 'birthday' ? '🎂' : c.kind === 'anniversary' ? '🎉' : '👋'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Upcoming holiday pill */}
          {(data?.upcoming_holidays ?? []).length > 0 && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-card px-5 py-4 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-foreground">
                Next holiday: <span className="font-medium">{data!.upcoming_holidays[0]!.name}</span>
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {data!.upcoming_holidays[0]!.days_until === 0 ? 'Today'
                  : data!.upcoming_holidays[0]!.days_until === 1 ? 'Tomorrow'
                  : `in ${data!.upcoming_holidays[0]!.days_until}d`}
              </span>
            </div>
          )}

          {/* Progress band */}
          {progress?.show && <ProgressBand data={progress} />}

        </div>
      </div>

      {/* "Quietly alive" section — full width company feed */}
      {(data?.feed_teaser ?? []).length > 0 && (
        <div className="mt-16 border-t border-border/40 pt-12">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quietly alive</p>
              <h3 className="serif-hero mt-2 text-[clamp(1.6rem,3vw,2.2rem)] text-foreground">
                The company, <span className="serif-emph">right now.</span>
              </h3>
            </div>
            <button onClick={() => navigate(`${base}/company`)}
              className="mt-1 text-[11px] font-medium text-primary hover:text-primary/80">
              Visit Community →
            </button>
          </div>
          <ul className="flex flex-col">
            {(data?.feed_teaser ?? []).map((post) => (
              <li key={post.id} className="group flex items-start gap-4 border-b border-border/50 py-5 last:border-0">
                <PersonAvatar name={post.author} size="md" className="mt-0.5 shrink-0" decorative />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug text-foreground">
                    <span className="font-medium">{post.author}</span>{' '}
                    <span className="text-muted-foreground">{post.body}</span>
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{timeAgo(post.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI reflection */}
      {reflection?.insight && (
        <div className="mt-8">
          <ReflectionCard insight={reflection.insight} action={reflection.action} onAction={(href) => navigate(`${base}${href}`)} />
        </div>
      )}

      {/* Closing quote */}
      <div className="mt-14 border-t border-border/40 pb-16 pt-10">
        <p className="serif-emph text-[clamp(1.3rem,2.5vw,1.8rem)] leading-snug text-foreground/75 max-w-[40ch]">
          {pending
            ? `A couple of things are still waiting — nothing that can't wait for coffee.`
            : `That's everything. You're all set — have a great day.`}
        </p>
        <p className="mt-3 text-[13px] text-muted-foreground">CognixHR · {tenureLabel}</p>
        <button onClick={() => navigate(`${base}/timeline`)}
          className="mt-4 flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-brand-teal" />
          <span>Revisit your story →</span>
        </button>
      </div>

      </>
      )}
      </div>
    </>
  )
}
