import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Fingerprint, CalendarDays, Wallet, RefreshCw, Receipt,
  Megaphone, MessageCircle, Plus, Award, Heart, Users, Lightbulb, Wrench, Sparkles, Trophy,
  AlertCircle, CheckCircle2,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import type { Signal } from '@/components/experience/SignalCard'
import { useAuthStore } from '@/stores/authStore'
import { glossy } from '../glossy'
import { UpcomingHolidays } from './parts'
import { MobileWishButton, type WishKind } from './MobileWish'
import { timeAgo, initials } from '../format'

type Reaction = 'like' | 'celebrate' | 'appreciate' | 'support'
interface CommunityPost {
  id: string; author_name?: string | null; subject_name?: string | null; subject_employee?: string | null
  type: string; title?: string | null
  body: string; pinned?: boolean; created_at: string
  reaction_count: number; comment_count: number; my_reaction?: Reaction | null
}

// Celebration post types render with festive chrome + a Wish affordance.
const CELEBRATION: Record<string, { emoji: string; label: string }> = {
  birthday:    { emoji: '🎂', label: 'Birthday' },
  anniversary: { emoji: '🎉', label: 'Work Anniversary' },
}
interface Kudos { id: string; from_name?: string; to_name?: string; badge_code?: string; message: string; points: number; created_at: string }
interface LeaderRow { rank: number; employee_id: string; name: string; points: number }
interface ProgressPayload { show: boolean; heading: string; ambient: string; hints: { label: string; value: string }[] }
interface Reflection { insight: string | null; action?: { label: string; href: string } }

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const todayStr = () => new Date().toLocaleDateString('en-CA')
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : null

const REACTIONS: { key: Reaction; emoji: string }[] = [
  { key: 'like', emoji: '👍' }, { key: 'celebrate', emoji: '🎉' },
  { key: 'appreciate', emoji: '👏' }, { key: 'support', emoji: '💪' },
]

const BADGE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Heart, Users, Lightbulb, Wrench, Sparkles,
}
const ICON_BY_BADGE: Record<string, string> = {
  ownership_champion: 'Award', customer_hero: 'Heart', team_player: 'Users',
  innovator: 'Lightbulb', problem_solver: 'Wrench', culture_ambassador: 'Sparkles',
}
const kudosIcon = (code?: string) => BADGE_ICONS[(code && ICON_BY_BADGE[code]) || 'Award'] ?? Award

export function MobileHome({ base }: { base: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const employeeId = profile?.employee_id ?? ''
  const today = todayStr()

  const chips = [
    { label: 'Punch', icon: Fingerprint, from: '#2E6FE6', to: '#5C9AFF', to_path: `${base}/attendance` },
    { label: 'Leave', icon: CalendarDays, from: '#15B8A6', to: '#2DD4BF', to_path: `${base}/leave/balance` },
    { label: 'Payslip', icon: Wallet, from: '#7C3AED', to: '#A78BFA', to_path: `${base}/compensation` },
    { label: 'Regularize', icon: RefreshCw, from: '#B07B18', to: '#D9A441', to_path: `${base}/attendance` },
    { label: 'Claims', icon: Receipt, from: '#1A8050', to: '#34B27B', to_path: `${base}/reimbursements` },
  ]

  const { data: att } = useQuery<{ logs: { check_in: string | null; check_out: string | null; date: string }[] }>({
    queryKey: ['mobile-home-att', employeeId, today],
    queryFn: () => api.get(`/attendance/${employeeId}?from=${today}&to=${today}`),
    enabled: !!employeeId, staleTime: 30_000,
  })
  const { data: leaderData } = useQuery<{ data: LeaderRow[] }>({
    queryKey: ['mobile-home-leaderboard'], queryFn: () => api.get('/recognition/leaderboard'),
  })
  const { data: kudosData } = useQuery<{ data: Kudos[] }>({
    queryKey: ['mobile-home-kudos'], queryFn: () => api.get('/recognition/feed?limit=15'),
  })
  const { data: communityData } = useQuery<{ data: CommunityPost[] }>({
    queryKey: ['mobile-home-community'], queryFn: () => api.get('/community/feed?limit=15'),
  })
  // Experience Core narrative services (shared cache keys with desktop Home).
  const { data: signalsData } = useQuery<{ signals: Signal[] }>({
    queryKey: ['ess-signals'], queryFn: () => api.get('/ess/signals'), staleTime: 60_000,
  })
  const { data: progress } = useQuery<ProgressPayload>({
    queryKey: ['ess-progress'], queryFn: () => api.get('/ess/progress'), staleTime: 5 * 60_000,
  })
  const { data: reflection } = useQuery<Reflection>({
    queryKey: ['ess-reflection'], queryFn: () => api.get('/ess/reflection'), staleTime: 5 * 60_000,
  })

  const react = useMutation({
    mutationFn: ({ id, reaction }: { id: string; reaction: Reaction }) => api.post(`/community/posts/${id}/react`, { reaction }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobile-home-community'] }),
    onError: (e: Error) => toast.error('Could not react', { description: e.message }),
  })

  const todayLog = (att?.logs ?? []).find((l) => (l.check_in ?? l.check_out)?.slice(0, 10) === today)
  const inTime = fmtTime(todayLog?.check_in ?? null)
  const leaders = (leaderData?.data ?? []).slice(0, 8)

  // Today's Focus (Movement 2) — surfaced ONLY when something genuinely needs
  // attention, so it never duplicates the punch card with empty reassurance.
  const signals = signalsData?.signals ?? []
  const urgentSignal = signals.find((s) => s.severity !== 'info')
  const focusHref = urgentSignal?.action?.href ?? '/flowdesk'

  // Interleave community posts + recognition kudos into one feed, newest first.
  const feed = useMemo(() => {
    const posts = (communityData?.data ?? []).map((p) => ({ kind: 'post' as const, at: p.created_at, post: p }))
    const kudos = (kudosData?.data ?? []).map((k) => ({ kind: 'kudos' as const, at: k.created_at, kudos: k }))
    return [...posts, ...kudos].sort((a, b) => (a.at < b.at ? 1 : -1))
  }, [communityData, kudosData])

  return (
    <div className="space-y-4">
      {/* Today's Focus (Movement 2) — only when something needs attention */}
      {urgentSignal && (
        <button onClick={() => navigate(`${base}${focusHref}`)}
          className="flex w-full items-start gap-3 rounded-2xl p-4 text-left text-white shadow-sm active:scale-[0.99] transition-transform"
          style={{ background: 'linear-gradient(120deg,#1A4D8F,#2E6FE6)' }}>
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-white/90" />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-white/70">Today's focus</span>
            <span className="mt-0.5 block text-sm font-semibold leading-snug">
              The thing most worth your attention: {lowerFirst(urgentSignal.title)}.
            </span>
            <span className="mt-1.5 inline-block text-[11px] font-bold text-white/90">Review now →</span>
          </span>
        </button>
      )}

      {/* Today punch — compact */}
      <button onClick={() => navigate(`${base}/attendance`)} className="flex w-full items-center justify-between rounded-2xl bg-white p-3.5 text-left shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)] active:scale-[0.99] transition-transform">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={glossy(inTime ? '#1A8050' : '#2E6FE6', inTime ? '#34B27B' : '#5C9AFF')}>
            <Fingerprint className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] text-muted-foreground">Today · In Time</p>
            <p className="text-lg font-extrabold leading-tight text-[#0F172A]">{inTime ?? '--:--'}</p>
          </div>
        </div>
        <span className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={glossy('#2E6FE6', '#15B8A6')}>
          {inTime ? 'Open' : 'Punch in'}
        </span>
      </button>

      {/* Quick action chips — horizontal scroll */}
      <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => (
          <button key={c.label} onClick={() => navigate(c.to_path)} className="flex shrink-0 flex-col items-center gap-1.5 active:scale-95 transition-transform">
            <span className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={glossy(c.from, c.to)}>
              <c.icon className="h-5 w-5" />
            </span>
            <span className="text-[9px] font-semibold text-foreground/70">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Spotlight — stories-style row */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-[#0F172A]">
          <Trophy className="h-3.5 w-3.5 text-[#B07B18]" /> Spotlight
        </p>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Give recognition — first bubble */}
          <button onClick={() => navigate(`${base}/recognition`)} className="flex w-14 shrink-0 flex-col items-center gap-1 active:scale-95 transition-transform">
            <span className="grid h-14 w-14 place-items-center rounded-full text-white ring-2 ring-white" style={glossy('#7C3AED', '#A78BFA')}>
              <Plus className="h-6 w-6" />
            </span>
            <span className="truncate text-[9px] font-semibold text-foreground/70">Give 👏</span>
          </button>
          {leaders.map((l) => (
            <button key={l.employee_id} onClick={() => navigate(`${base}/recognition`)} className="flex w-14 shrink-0 flex-col items-center gap-1 active:scale-95 transition-transform">
              <span className="relative grid h-14 w-14 place-items-center rounded-full text-sm font-extrabold text-white ring-2 ring-[#2DD4BF]" style={glossy('#2E6FE6', '#1A4D8F')}>
                {initials(l.name)}
                {l.rank === 1 && <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-white"><Trophy className="h-3 w-3 text-[#B07B18]" /></span>}
              </span>
              <span className="w-full truncate text-center text-[9px] font-medium text-foreground/70">{(l.name ?? '').split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* My Progress (Movement 7) — motivates, never reports; silent when empty */}
      {progress?.show && (
        <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
          <p className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
            <Sparkles className="h-3.5 w-3.5 text-[#15B8A6]" /> {progress.heading || 'You’re doing well'}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">{progress.ambient}</p>
          {progress.hints.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {progress.hints.map((h) => (
                <span key={h.label}>{h.label} · <span className="font-semibold text-foreground">{h.value}</span></span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live feed */}
      <div className="flex items-center justify-between px-1">
        <p className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
          <span className="grid h-4 w-4 place-items-center rounded-full bg-[#15B8A6]"><span className="h-1.5 w-1.5 animate-ping rounded-full bg-white" /></span>
          Happening now
        </p>
        <button onClick={() => navigate(`${base}/community`)} className="text-[11px] font-semibold text-[#1A4D8F]">Open Community</button>
      </div>

      {feed.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white" style={glossy('#2E6FE6', '#15B8A6')}><MessageCircle className="h-6 w-6" /></span>
          <p className="mt-3 text-sm font-semibold text-foreground">It's quiet in here</p>
          <p className="mt-1 text-xs text-muted-foreground">Share an update or recognize a colleague to get things going.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => navigate(`${base}/community`)} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={glossy('#1A4D8F', '#15B8A6')}>Post update</button>
            <button onClick={() => navigate(`${base}/recognition`)} className="rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/5 px-4 py-2 text-xs font-bold text-[#7C3AED]">Give kudos</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map((item) =>
            item.kind === 'post'
              ? <PostCard key={`p-${item.post.id}`} post={item.post} onReact={(r) => react.mutate({ id: item.post.id, reaction: r })} onOpen={() => navigate(`${base}/community`)} />
              : <KudosCard key={`k-${item.kudos.id}`} kudos={item.kudos} />,
          )}
        </div>
      )}

      {/* AI reflection (Movement 9) — the memory-aware ambient moment */}
      {reflection?.insight && (
        <div className="rounded-2xl p-4 text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#1A4D8F,#15B8A6)' }}>
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
            <Sparkles className="h-3.5 w-3.5" /> Cognix Insight
          </p>
          <p className="mt-1.5 text-[13px] font-medium leading-relaxed">{reflection.insight}</p>
          {reflection.action && (
            <button onClick={() => navigate(`${base}${reflection.action!.href}`)}
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-3.5 py-1.5 text-[11px] font-bold backdrop-blur-sm active:scale-95 transition-transform">
              {reflection.action.label} →
            </button>
          )}
        </div>
      )}

      <UpcomingHolidays limit={2} />

      {/* Done for today (Movement 10) — the calm closer */}
      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[12px] text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-[#1A8050]" />
        {signals.length > 0
          ? 'A couple of things are still waiting — nothing that can’t wait for coffee.'
          : 'That’s everything — you’re all set for today.'}
      </p>
    </div>
  )
}

function PostCard({ post, onReact, onOpen }: { post: CommunityPost; onReact: (r: Reaction) => void; onOpen: () => void }) {
  const announce = post.type === 'announcement' || post.pinned
  const celebration = CELEBRATION[post.type]
  const headerName = celebration
    ? (post.author_name && post.subject_name
        ? `${post.author_name} wished ${post.subject_name}`
        : (post.subject_name ?? 'Celebration'))
    : (post.author_name ?? 'Someone')

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
      {announce && <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#2E6FE6,#15B8A6)' }} />}
      {celebration && <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg,#15B8A6,#2DD4BF)' }} />}
      <div className="p-3.5">
        <div className="flex items-center gap-2.5">
          {celebration ? (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base" style={glossy('#15B8A6', '#2DD4BF')}>{celebration.emoji}</span>
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={glossy(announce ? '#2E6FE6' : '#1A4D8F', announce ? '#15B8A6' : '#2E6FE6')}>
              {announce ? <Megaphone className="h-4 w-4" /> : initials(post.author_name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-foreground">{headerName}</p>
            <p className="text-[10px] text-muted-foreground">{celebration ? `${celebration.label} · ` : announce ? 'Announcement · ' : ''}{timeAgo(post.created_at)}</p>
          </div>
          {celebration && post.subject_employee && (
            <MobileWishButton subjectEmployeeId={post.subject_employee} name={post.subject_name ?? 'your colleague'} kind={post.type as WishKind} />
          )}
        </div>
        {post.title && <p className="mt-2 text-sm font-bold text-[#0F172A]">{post.title}</p>}
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">{post.body}</p>

        <div className="mt-3 flex items-center gap-1">
          {REACTIONS.map((r) => {
            const active = post.my_reaction === r.key
            return (
              <button key={r.key} onClick={() => onReact(r.key)}
                className={`grid h-8 w-8 place-items-center rounded-full text-sm transition-transform active:scale-90 ${active ? 'bg-[#2E6FE6]/12 ring-1 ring-[#2E6FE6]/30' : 'bg-muted/60'}`}>
                {r.emoji}
              </button>
            )
          })}
          {post.reaction_count > 0 && <span className="ml-1 text-[11px] font-semibold text-muted-foreground">{post.reaction_count}</span>}
          <button onClick={onOpen} className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />{post.comment_count > 0 ? post.comment_count : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function KudosCard({ kudos }: { kudos: Kudos }) {
  const Icon = kudosIcon(kudos.badge_code)
  return (
    <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
      <div className="flex gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white" style={glossy('#7C3AED', '#A78BFA')}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-foreground/85">
            <span className="font-bold text-foreground">{kudos.from_name ?? 'Someone'}</span> recognized{' '}
            <span className="font-bold text-foreground">{kudos.to_name ?? 'a colleague'}</span>
          </p>
          {kudos.message && <p className="mt-0.5 text-[12px] text-foreground/80">"{kudos.message}"</p>}
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            {timeAgo(kudos.created_at)}{kudos.points ? <span className="rounded-full bg-[#7C3AED]/10 px-1.5 py-0.5 font-semibold text-[#7C3AED]">+{kudos.points} pts</span> : null}
          </p>
        </div>
      </div>
    </div>
  )
}
