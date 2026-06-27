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

  const celebLabel = (c: { kind: string; name: string; years?: number }) =>
    c.kind === 'birthday' ? `${c.name.split(' ')[0]}'s birthday`
    : c.kind === 'anniversary' ? `${c.name.split(' ')[0]} turns ${c.years ?? ''}`
    : `${c.name.split(' ')[0]} joined us`

  // ── Hero (time-based, no API needed) ────────────────────────────────────────
  const hour = new Date().getHours()
  const skyClass = isWeekend ? 'sky-weekend'
    : hour < 6 ? 'sky-night'
    : hour < 9 ? 'sky-dawn'
    : hour < 12 ? 'sky-morning'
    : hour < 17 ? 'sky-midday'
    : hour < 20 ? 'sky-evening'
    : 'sky-night'
  const greeting = isWeekend ? 'Happy weekend'
    : hour < 12 ? 'Good morning'
    : hour < 17 ? 'Good afternoon'
    : 'Good evening'
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const now = new Date()
  const heroDate = `${DAYS[now.getDay()]} · ${now.getDate()} ${M[now.getMonth()]}`
  const heroTagline = isWeekend ? 'Rest well — your work will be here on Monday.'
    : today?.check_in ? 'You\'re in. Have a great day.'
    : hour < 9 ? 'Make it a great day.'
    : hour < 17 ? 'You\'re doing great.'
    : 'Time to wrap up and rest.'

  return (
    <div className="w-full">

      {/* ── Compact hero — full-bleed sky gradient ── */}
      <div className={`sky-grain -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mx-8 lg:-mt-8 relative flex min-h-[260px] flex-col justify-end overflow-hidden px-6 pb-8 pt-6 sm:px-10 lg:px-12 ${skyClass}`}>
        {/* Punch in / check-in badge — top right */}
        <div className="absolute right-6 top-6">
          {today?.check_in ? (
            <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              In since {fmtTime(today.check_in)}
            </span>
          ) : !isWeekend && !isLoading ? (
            <button
              onClick={() => navigate(`${base}/attendance`)}
              className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/40 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-black/55"
            >
              <Clock className="h-4 w-4" /> Punch in
            </button>
          ) : null}
        </div>

        {/* Date */}
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">{heroDate}</p>

        {/* Greeting */}
        <h1 className="serif-hero text-[clamp(2rem,4.5vw,3rem)] leading-none text-white">
          {greeting}, <span className="serif-emph">{isLoading ? '…' : firstName}.</span>
        </h1>

        {/* Tagline */}
        <p className="mt-3 text-[15px] text-white/70">{heroTagline}</p>

        {/* Focus nudge */}
        {signals.length > 0 && (
          <p className="mt-4 flex items-center gap-2 text-sm text-white/80">
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
            Your focus today: {signals.length} item{signals.length > 1 ? 's' : ''} need{signals.length === 1 ? 's' : ''} your attention.
          </p>
        )}
      </div>

      {/* ── Body ── */}
      {isLoading ? (
        <div className="py-16"><LoadingState rows={5} label="Putting your day together…" /></div>
      ) : isError ? (
        <ErrorState title="Couldn't load your day" onRetry={() => refetch()} />
      ) : (
      <>

      {/* Quick actions */}
      <div className="border-b border-border/40 py-5">
        <QuickActions capabilities={capabilities} onAction={(href) => navigate(`${base}${href}`)} />
      </div>

      {/* ── Two-column body ── */}
      <div className="mt-8 grid grid-cols-1 gap-6 pb-8 lg:grid-cols-[1fr_360px]">

        {/* LEFT — large dark card, mirrors Lovable's TODAY, GENTLY panel */}
        <div className="rounded-2xl border border-border/60 bg-card p-8">
          {/* Card header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Today, gently</p>
              <h2 className="serif-hero mt-2 text-[clamp(1.8rem,3.5vw,2.6rem)] leading-tight text-foreground">
                A few things <span className="serif-emph text-primary">worth noticing.</span>
              </h2>
              <AmbientLine className="mt-3">{focalInsight}</AmbientLine>
            </div>
            {today?.check_in ? (
              <span className="ml-4 shrink-0 flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> In since {fmtTime(today.check_in)}
              </span>
            ) : !isWeekend && (
              <button onClick={() => navigate(`${base}/attendance`)}
                className="ml-4 shrink-0 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90">
                <Clock className="h-3.5 w-3.5" /> Punch in
              </button>
            )}
          </div>

          {/* Signals */}
          {signals.length > 0 && (
            <div className="mb-8">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Worth your attention</p>
              <div className="space-y-2">
                {signals.map((s) => <SignalCard key={s.id} signal={s} onAction={(href) => navigate(`${base}${href}`)} />)}
              </div>
            </div>
          )}

          {/* Your day activity river */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Your day</p>
              <button onClick={() => navigate(`${base}/timeline`)} className="text-[11px] font-medium text-primary hover:text-primary/80">
                Your story →
              </button>
            </div>
            <AmbientLine className="mb-4">{dayInsight}</AmbientLine>
            {activityQ.isLoading ? (
              <LoadingState rows={3} compact />
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">A quiet start — your check-ins and approvals will appear here.</p>
            ) : (
              <ul className="flex flex-col">
                {events.map((e) => (
                  <li key={e.id} className="border-b border-border/40 py-4 last:border-0">
                    <ActivityItem event={e} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Kind words — recognition */}
          {(data?.recognition?.recent ?? []).length > 0 && (
            <div className="mt-8 border-t border-border/40 pt-6">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Kind words</p>
              <div className="space-y-4">
                {(data?.recognition?.recent ?? []).map((r) => (
                  <div key={r.id} className="flex items-start gap-3">
                    <PersonAvatar name={r.from_name} size="sm" className="mt-0.5 shrink-0" decorative />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {r.from_name} <span className="font-normal text-muted-foreground">recognized you</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {BADGE_LABELS[r.badge_code] ?? r.badge_code}{r.points != null ? ` · +${r.points} pts` : ''}
                      </p>
                      {r.message && <p className="mt-1 line-clamp-2 text-xs italic text-foreground/60">"{r.message}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT column */}
        <div className="space-y-4">

          {/* Featured celebration — vivid coral→pink gradient, white text */}
          {celebrations.length > 0 ? (
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600 p-7 shadow-lg">
              <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">Today at CognixHR</p>
              <h3 className="serif-hero mt-3 text-[2rem] leading-tight text-white">
                {celebLabel(celebrations[0])}
              </h3>
              <div className="mt-5 flex items-center gap-3">
                <PersonAvatar name={celebrations[0].name} size="lg" className="ring-2 ring-white/30" />
                <div>
                  <p className="font-semibold text-white">{celebrations[0].name}</p>
                  <p className="text-sm text-white/70">{celebrations[0].subtitle}</p>
                </div>
              </div>
              <button
                onClick={() => navigate(`${base}/company`)}
                className="mt-6 w-full rounded-xl bg-white/20 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/30"
              >
                Send a note →
              </button>
            </div>
          ) : (
            /* No celebration today — show recognition stats */
            (data?.recognition?.total_received ?? 0) > 0 && (
              <div className="rounded-2xl border border-border/60 bg-card p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">You make people&apos;s day</p>
                <AmbientLine className="mt-3">{`You've recognised ${data!.recognition.total_received} teammates this month — more than last. People notice.`}</AmbientLine>
                <p className="mt-3 text-xs text-muted-foreground">Kudos given · <span className="font-semibold text-foreground">{data!.recognition.total_received} this month</span></p>
              </div>
            )
          )}

          {/* Also today */}
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
                    <span className="text-lg">{c.kind === 'birthday' ? '🎂' : c.kind === 'anniversary' ? '🎉' : '👋'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Upcoming holiday */}
          {(data?.upcoming_holidays ?? []).length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-5 py-4">
              <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 text-sm text-foreground">
                Next: <span className="font-medium">{data!.upcoming_holidays[0]!.name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
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

      {/* ── "Quietly alive" — people grid, like Lovable ── */}
      {(data?.feed_teaser ?? []).length > 0 && (
        <div className="mt-12 border-t border-border/40 pt-10">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quietly alive</p>
              <h3 className="serif-hero mt-2 text-[clamp(2rem,4vw,3rem)] leading-none text-foreground">
                The company, <span className="serif-emph">right now.</span>
              </h3>
            </div>
            <button onClick={() => navigate(`${base}/company`)} className="text-[11px] font-medium text-primary hover:text-primary/80">
              Visit Community →
            </button>
          </div>
          {/* People grid — face cards with name + snippet */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(data?.feed_teaser ?? []).slice(0, 8).map((post) => (
              <div key={post.id} className="flex flex-col items-center rounded-2xl border border-border/60 bg-card p-5 text-center">
                <PersonAvatar name={post.author} size="lg" decorative />
                <p className="mt-3 text-sm font-semibold text-foreground">{post.author}</p>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{post.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI reflection */}
      {reflection?.insight && (
        <div className="mt-10">
          <ReflectionCard insight={reflection.insight} action={reflection.action} onAction={(href) => navigate(`${base}${href}`)} />
        </div>
      )}

      {/* Closing quote — centered, large, like Lovable */}
      <div className="mt-16 pb-20 text-center">
        <p className="serif-emph mx-auto max-w-[32ch] text-[clamp(1.5rem,3vw,2.2rem)] leading-snug text-foreground/75">
          {pending
            ? `"A couple of things are still waiting — nothing that can't wait for coffee."`
            : `"The best workplaces don't summon you. They open for you."`}
        </p>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          CognixHR — Smarter Workforce. Stronger Future.
        </p>
        <button onClick={() => navigate(`${base}/timeline`)}
          className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-brand-teal" />
          <span>{tenureLabel}. Revisit your story →</span>
        </button>
      </div>

      </>
      )}
    </div>
  )
}
