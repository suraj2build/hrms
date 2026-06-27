import { Suspense, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, User2, Users } from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { resolveGreeting, type DayContext } from '@/components/experience/resolveGreeting'
import { cn } from '@/lib/utils'
import { HEADER_GRADIENT } from './glossy'
import { MobileBottomNav, employeeTabs } from './MobileBottomNav'
import { MobileHome } from './screens/MobileHome'
import { MobileTimeline } from './screens/MobileTimeline'
import { MyGrowth } from '@/pages/ess/MyGrowth'
import { MyAttention } from '@/pages/ess/MyAttention'
import { MyTeam } from '@/pages/ess/MyTeam'
import type { Signal } from '@/components/experience/SignalCard'
import { MobileAttendance } from './screens/MobileAttendance'
import { MobileLeave } from './screens/MobileLeave'
import { MobilePayslip } from './screens/MobilePayslip'
import { MobileApprovals } from './screens/MobileApprovals'
import { MobileMore } from './screens/MobileMore'
import { MobileRecognition } from './screens/MobileRecognition'
import { MobileCommunity } from './screens/MobileCommunity'
import { MobileFlowDesk } from './screens/MobileFlowDesk'

type Persona = 'me' | 'team'

function Loader() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-[#2E6FE6] border-t-transparent animate-spin" />
    </div>
  )
}

/**
 * MobileEssShell — the dedicated phone experience for ESS. Rendered ONLY below
 * the lg breakpoint (see EssShell). Desktop never touches this. Provides a
 * glossy header, an optional Employee/Team persona toggle (managers only), a
 * route-driven content area and a bottom tab bar.
 */
export function MobileEssShell({ previewHome = false }: { previewHome?: boolean } = {}) {
  const { profile } = useAuthStore()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const isManager = profile?.role === 'manager' || profile?.role === 'super_admin' || profile?.role === 'hr_admin'
  // Manager console (/manager/*) and manager-self (/manager/self/*) both use the
  // self base for the employee screens; plain /ess/* uses /ess.
  const base = pathname.startsWith('/manager') ? '/manager/self' : '/ess'
  // Default to the Team view when landing on a manager-console (non-self) route.
  const inManagerConsole = pathname.startsWith('/manager') && !pathname.startsWith('/manager/self')
  const [persona, setPersona] = useState<Persona>(inManagerConsole && isManager ? 'team' : 'me')

  // Dynamic, contextual greeting (EXPERIENCE_HOME_DESIGN.md §3.A) — shared cache
  // key with MobileHome so this adds no extra round-trip.
  const { data: home } = useQuery<{ profile?: { name?: string | null }; context?: DayContext }>({
    queryKey: ['ess-home'], queryFn: () => api.get('/ess/home'), staleTime: 2 * 60_000,
  })
  const greet = resolveGreeting(home?.profile?.name ?? profile?.full_name ?? 'there', home?.context, new Date())

  // The bell badge fires ONLY when something genuinely needs you now (never for
  // "waiting" or info) — My Attention is meant to reach zero, not accumulate.
  const { data: sig } = useQuery<{ signals: Signal[] }>({
    queryKey: ['ess-signals'], queryFn: () => api.get('/ess/signals'), staleTime: 60_000,
  })
  const needsYou = (sig?.signals ?? []).some(s => s.intent === 'needs_you')

  const onFab = () => navigate(`${base}/attendance`)

  return (
    <div className="flex min-h-screen flex-col bg-[#EEF3FF]">
      {/* ── Glossy header ── */}
      <header className="relative px-5 pb-5 pt-9 text-white" style={{ background: HEADER_GRADIENT }}>
        <div className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: 'radial-gradient(120% 80% at 80% -10%, rgba(255,255,255,0.45), transparent 60%)' }} />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white shadow-sm">
              <LogoMark size={22} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-base font-extrabold">{greet.headline}</span>
              <span className="block line-clamp-1 text-[11px] text-white/80">{greet.subline}</span>
            </span>
          </span>
          <button aria-label="What needs you" onClick={() => navigate(`${base}/attention`)} className="relative">
            <Bell className="h-5 w-5 text-white/90" />
            {needsYou && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#F5A623] ring-2 ring-[#1A4D8F]" />}
          </button>
        </div>

        {/* Persona toggle — managers only */}
        {isManager && (
          <div role="tablist" aria-label="Employee or Team view"
            className="relative mt-4 inline-flex rounded-xl bg-white/15 p-0.5 backdrop-blur">
            {([['me', 'Me', User2], ['team', 'Team', Users]] as const).map(([id, label, Icon]) => {
              const active = persona === id
              return (
                <button key={id} role="tab" aria-selected={active} onClick={() => setPersona(id)}
                  className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors',
                    active ? 'bg-white text-[#1A4D8F] shadow-sm' : 'text-white/80')}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              )
            })}
          </div>
        )}
      </header>

      {/* ── Content ── */}
      <main className="flex-1 px-4 pb-28 pt-4">
        {persona === 'team' && isManager
          ? <MyTeam />
          : (
            <Suspense fallback={<Loader />}>
              {previewHome ? <MobileHome base={base} /> : <MobileRouter base={base} />}
            </Suspense>
          )}
      </main>

      {/* ── Bottom nav (employee persona) ── */}
      {persona === 'me' && <MobileBottomNav tabs={employeeTabs(base)} onFab={onFab} />}
    </div>
  )
}

/** Route → mobile screen. Unhandled ESS routes fall back to the existing page. */
function MobileRouter({ base }: { base: string }) {
  const { pathname } = useLocation()
  const sub = pathname.replace(base, '') || '/home'

  if (sub === '' || sub === '/' || sub.startsWith('/home') || sub.startsWith('/dashboard')) return <MobileHome base={base} />
  if (sub.startsWith('/timeline')) return <MobileTimeline base={base} />
  if (sub.startsWith('/identity')) return <MyGrowth />
  if (sub.startsWith('/attention')) return <MyAttention />
  if (sub.startsWith('/team')) return <MyTeam />
  if (sub.startsWith('/attendance')) return <MobileAttendance base={base} />
  if (sub.startsWith('/leave')) return <MobileLeave base={base} />
  if (sub.startsWith('/compensation')) return <MobilePayslip base={base} />
  if (sub.startsWith('/approvals')) return <MobileApprovals base={base} />
  if (sub.startsWith('/flowdesk')) return <MobileFlowDesk base={base} />
  if (sub.startsWith('/recognition')) return <MobileRecognition base={base} />
  if (sub.startsWith('/community')) return <MobileCommunity base={base} />
  if (sub.startsWith('/more')) return <MobileMore base={base} />

  // Any other ESS route → render the existing (desktop) page in the mobile container.
  return <Outlet />
}
