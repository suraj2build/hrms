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
  LifeBuoy, Award, Inbox, Megaphone, PartyPopper, CalendarDays, Sparkles,
} from 'lucide-react'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'
import { SignalCard, type Signal } from '@/components/experience/SignalCard'
import { ActivityItem, type ActivityEvent } from '@/components/experience/ActivityItem'
import { QuickActions, type Capability } from '@/components/experience/QuickActions'
import { CelebrationCard } from '@/components/experience/CelebrationCard'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { AmbientLine } from '@/components/experience/AmbientLine'
import { Atmosphere } from '@/components/experience/Atmosphere'
import { Arrival } from '@/components/experience/Arrival'
import { Movement } from '@/components/experience/Movement'
import { FocusPanel } from '@/components/experience/FocusPanel'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand } from '@/components/experience/ProgressBand'
import { resolveGreeting, type DayContext } from '@/components/experience/resolveGreeting'
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-border/60 bg-card shadow-sm', className)}>{children}</div>
}

/** Conversational block heading — natural language, not a module label. */
function Heading({ children, action, onAction }: { children: React.ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
      {action && (
        <button onClick={onAction} className="text-xs font-medium text-primary hover:text-primary/80">{action}</button>
      )}
    </div>
  )
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

  // Dynamic, contextual greeting (EXPERIENCE_HOME_DESIGN.md §3.A) — context
  // (birthday / first day / payday / holiday) beats time-of-day.
  const ctx = data?.context
  const greet = resolveGreeting(fullName, ctx, new Date())

  // Memory touch (§3.D) — "earned, then shown": only render when genuinely true.
  // Phase 1 derives from data already on the payload; richer habitual-time and
  // pair-kudos lines arrive with /ess/progress + /ess/reflection.
  const memoryTouch = ctx?.is_back_from_leave
    ? null  // already carried by the greeting sub-line, don't repeat
    : null

  // ── Ambient intelligence: one sentence per block, from the employee's own data ──
  const dow = new Date().getDay()
  const isWeekend = dow === 0 || dow === 6

  const focalInsight = (() => {
    if (today && !today.check_in && !isWeekend)
      return 'You haven’t checked in yet — punch in, or regularize if you’re working remotely.'
    const urgent = signals.find((s) => s.severity !== 'info')
    if (urgent) return `Right now, the thing most worth your attention is to ${lowerFirst(urgent.title)}.`
    if (signals.length > 0) return 'A couple of things could use a glance, but nothing urgent today.'
    return 'You’re all set — nothing needs you right now. Enjoy the calm.'
  })()

  const dayInsight = (() => {
    if (events.length === 0) return 'A quiet start so far — your day will fill in here.'
    if (events.some((e) => e.type === 'payroll')) return 'Your salary landed today — and a few other things happened too.'
    if (events.some((e) => e.type === 'recognition')) return 'Someone recognized you today — the good news is just below.'
    return `${events.length} thing${events.length > 1 ? 's have' : ' has'} happened so far today.`
  })()

  const todayBdays = (data?.birthdays ?? []).filter((b) => b.days_until === 0)
  const todayAnnis = (data?.anniversaries ?? []).filter((a) => a.days_until === 0)
  const peopleInsight = (() => {
    if (todayBdays.length) return `It’s ${todayBdays[0]!.name}’s birthday today — a quick hello means more than you’d think.`
    if (todayAnnis.length) return `${todayAnnis[0]!.name} marks ${todayAnnis[0]!.years} years today — worth a word of congratulations.`
    if ((data?.recognition?.total_received ?? 0) > 0) return `You’ve been recognized ${data!.recognition.total_received}× — why not pass it on to someone today?`
    return 'Recognition is the easiest way to make someone’s day — try it today.'
  })()

  // Demoted KPIs → one calm contextual sentence (no tiles).
  const contextBits: string[] = []
  if (kpis?.leave_days_remaining != null) contextBits.push(`${kpis.leave_days_remaining} day${kpis.leave_days_remaining === 1 ? '' : 's'} of leave left`)
  if (kpis?.net_pay != null) contextBits.push(`last pay ₹${Number(kpis.net_pay).toLocaleString('en-IN')}`)
  if (today?.total_hours) contextBits.push(`${today.total_hours} worked today`)

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
      id: `bd_${b.name}`, kind: 'birthday' as const, name: b.name, title: `${b.name}’s birthday`, subtitle: b.days_until === 0 ? 'Today' : 'Tomorrow',
    })),
    ...(data?.anniversaries ?? []).filter((a) => a.days_until <= 1).map((a) => ({
      id: `an_${a.name}`, kind: 'anniversary' as const, name: a.name, title: `${a.name} · ${a.years}y`, subtitle: a.days_until === 0 ? 'Anniversary today' : 'Anniversary tomorrow',
    })),
  ].slice(0, 4)

  // Visual Language v2 — the "Dawn" atmosphere: a warm, time-aware ambient field with
  // a serif greeting hero, over a spine of movements that rise in on a tinted canvas.
  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
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
      <div id="ess-your-day" className="mx-auto max-w-[760px] py-4">
      {isLoading ? (
        <LoadingState rows={5} label="Putting your day together…" />
      ) : isError ? (
        <ErrorState title="Couldn’t load your day" onRetry={() => refetch()} />
      ) : (
      <>
      {/* Atmosphere — the Dawn field: serif greeting hero, punch, ambient, actions. */}
      <Atmosphere
        theme="dawn"
        eyebrow={dateLabel}
        title={greet.headline}
        subtitle={`${greet.subline}${data?.profile?.designation ? ` · ${data.profile.designation}` : ''}`}
        aside={today?.check_in ? (
          <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> In since {fmtTime(today.check_in)}
          </span>
        ) : (
          <button onClick={() => navigate(`${base}/attendance`)}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <Clock className="h-3.5 w-3.5" /> Punch in
          </button>
        )}
      >
        <AmbientLine>{focalInsight}</AmbientLine>
        {memoryTouch && <AmbientLine className="mt-2 text-xs">{memoryTouch}</AmbientLine>}
        {contextBits.length > 0 && (
          <p className="mt-2 pl-5 text-xs text-muted-foreground">{contextBits.join(' · ')}</p>
        )}
        <div className="mt-6">
          <QuickActions capabilities={capabilities} onAction={(href) => navigate(`${base}${href}`)} />
        </div>
      </Atmosphere>

      {/* The spine — movements rise in on the tinted canvas. */}
      <div className="mt-10 space-y-10">
        {signals.length > 0 && (
          <Movement eyebrow="Worth your attention" index={0} className="space-y-2.5">
            {signals.map((s) => <SignalCard key={s.id} signal={s} onAction={(href) => navigate(`${base}${href}`)} />)}
          </Movement>
        )}

        <Movement eyebrow="Here’s your day" index={1}
          action={{ label: 'Your story →', onClick: () => navigate(`${base}/timeline`) }}>
          <AmbientLine className="mb-4">{dayInsight}</AmbientLine>
          {activityQ.isLoading ? (
            <LoadingState rows={3} compact />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet — your check-ins, approvals and good news will appear here.</p>
          ) : (
            <div className="space-y-4">{events.map((e) => <ActivityItem key={e.id} event={e} />)}</div>
          )}
        </Movement>

        <Movement eyebrow="Your people" index={2}>
          <AmbientLine className="mb-4">{peopleInsight}</AmbientLine>
          {celebrations.length > 0 && (
            <div className="mb-4 space-y-2.5">
              {celebrations.map((c) => (
                <CelebrationCard key={c.id} kind={c.kind} title={c.title} subtitle={c.subtitle}
                  action={{ label: 'Wish', onClick: () => navigate(`${base}/community`) }} />
              ))}
            </div>
          )}
          {(data?.recognition?.recent ?? []).length === 0 ? (
            <button onClick={() => navigate(`${base}/recognition`)}
              className="flex items-center gap-2 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
              <Award className="h-4 w-4" /> Recognize a teammate
            </button>
          ) : (
            <div className="space-y-3">
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
                    {r.message && <p className="mt-0.5 line-clamp-2 text-xs italic text-foreground/70">“{r.message}”</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Movement>

        {(data?.feed_teaser ?? []).length > 0 && (
          <Movement eyebrow="Around the company" index={3}
            action={{ label: 'See all', onClick: () => navigate(`${base}/company`) }}>
            <div className="space-y-4">
              {(data?.feed_teaser ?? []).map((post) => (
                <div key={post.id} className="flex gap-3">
                  <PersonAvatar name={post.author} size="sm" className="mt-0.5" decorative />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{post.author}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{post.body}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(post.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Movement>
        )}

        {progress?.show && <Movement index={4}><ProgressBand data={progress} /></Movement>}

        {(data?.upcoming_holidays ?? []).length > 0 && (
          <Movement index={5}>
            <div className="flex items-center gap-2 text-sm">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="text-foreground">
                Next holiday: <span className="font-medium">{data!.upcoming_holidays[0]!.name}</span>
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {data!.upcoming_holidays[0]!.days_until === 0 ? 'Today'
                  : data!.upcoming_holidays[0]!.days_until === 1 ? 'Tomorrow'
                  : `in ${data!.upcoming_holidays[0]!.days_until}d`}
              </span>
            </div>
          </Movement>
        )}

        {reflection?.insight && (
          <Movement index={6}>
            <ReflectionCard insight={reflection.insight} action={reflection.action} onAction={(href) => navigate(`${base}${href}`)} />
          </Movement>
        )}

        {/* Done for today — the calm closer + the narration into Timeline. */}
        <Movement index={7} className="pt-2 text-center">
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            {pending
              ? `A couple of things are still waiting, ${firstName} — but nothing that can’t wait for coffee.`
              : `That’s everything, ${firstName}. You’re all set — have a great day.`}
          </p>
          <button onClick={() => navigate(`${base}/timeline`)}
            className="mx-auto mt-3 flex items-center gap-2 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <Sparkles className="h-3.5 w-3.5 text-brand-teal" />
            <span>{tenureLabel}. Revisit your story so far →</span>
          </button>
        </Movement>
      </div>
      </>
      )}
      </div>
    </>
  )
}
