/**
 * MyTeam — the My Team experience (People-near lens): "How are my people?"
 *
 * The most human surface of the Employee OS. Every section answers one people-
 * question: who's here, who's away, who to celebrate, who recently changed, who
 * might need support. It is NEVER an approval inbox, a dashboard, an analytics page,
 * or a reporting workspace (frozen boundary) — action lives in My Attention. Faces
 * over charts, moments over metrics.
 *
 * Read-only over /ess/team, from shared experience primitives. Desktop + mobile.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Cake, PartyPopper, Plane } from 'lucide-react'
import { api } from '@/lib/api/client'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { AmbientLine } from '@/components/experience/AmbientLine'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

interface Party { id: string; name: string; subtitle?: string }
interface TeamPayload {
  focus:  { sentence: string }
  roster: { manager: Party | null; peers: Party[]; reports: Party[] }
  today:  {
    celebrations: { name: string; kind: 'birthday' | 'anniversary'; years?: number }[]
    out: { name: string; back?: string }[]
  }
  recent:  { id: string; title: string; person?: string }[]
  manager: { insight?: string } | null
}

function FaceRow({ people }: { people: Party[] }) {
  if (!people.length) return null
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3">
      {people.map(p => (
        <span key={p.id} className="flex items-center gap-2">
          <PersonAvatar name={p.name} size="md" decorative />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-foreground">{p.name}</span>
            {p.subtitle && <span className="block text-[11px] text-muted-foreground">{p.subtitle}</span>}
          </span>
        </span>
      ))}
    </div>
  )
}

export function MyTeam() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager') ? (pathname.startsWith('/manager/self') ? '/manager/self' : '/manager/self') : '/ess'

  const { data, isLoading, isError, refetch } = useQuery<TeamPayload>({
    queryKey: ['ess-team'], queryFn: () => api.get('/ess/team'), staleTime: 2 * 60_000,
  })

  if (isLoading) return <div className="mx-auto max-w-[760px] py-2"><LoadingState rows={4} label="Bringing your team together…" /></div>
  if (isError)   return <ErrorState title="Couldn’t load your team" onRetry={() => refetch()} />

  const t = data!
  const peopleAll = [...(t.roster.manager ? [t.roster.manager] : []), ...t.roster.peers, ...t.roster.reports]
  const empty = peopleAll.length === 0

  return (
    <div className="mx-auto max-w-[760px] space-y-8 py-2">
      {/* Focus — one human line about the team right now. */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/[0.06] to-brand-teal/[0.06] p-6">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your team</p>
        <h1 className="mt-2 text-[1.6rem] font-semibold leading-snug text-foreground">{t.focus.sentence}</h1>
      </div>

      {empty && (
        <p className="py-14 text-center text-sm text-muted-foreground">
          Your team will appear here as it grows — the people you work with, day to day.
        </p>
      )}

      {/* Today — who to celebrate, who's away. */}
      {(t.today.celebrations.length > 0 || t.today.out.length > 0) && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today</h3>
          <div className="space-y-3">
            {t.today.celebrations.map((c, i) => (
              <div key={`c${i}`} className="flex items-center gap-3">
                <PersonAvatar name={c.name} size="md" />
                <span className="flex items-center gap-1.5 text-sm text-foreground">
                  {c.kind === 'birthday'
                    ? <><Cake className="h-4 w-4 text-brand-teal" /> It’s <span className="font-semibold">{c.name}</span>’s birthday</>
                    : <><PartyPopper className="h-4 w-4 text-brand-teal" /> <span className="font-semibold">{c.name}</span> — {c.years ?? ''}-year work anniversary</>}
                </span>
              </div>
            ))}
            {t.today.out.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Plane className="h-4 w-4" /></span>
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{t.today.out.map(o => o.name).join(', ')}</span>
                  {t.today.out.length === 1 ? ' is' : ' are'} out today
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Your people — the roster, as faces. */}
      {!empty && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your people</h3>
          <FaceRow people={peopleAll} />
        </section>
      )}

      {/* Recently — team recognition (who did great work). */}
      {t.recent.length > 0 && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently</h3>
          <div className="space-y-3">
            {t.recent.map(r => (
              <div key={r.id} className="flex items-center gap-3">
                {r.person ? <PersonAvatar name={r.person} size="sm" /> : null}
                <span className="text-sm text-foreground">{r.title}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Manager care — who might need support (one gentle line, never a metric). */}
      {t.manager?.insight && (
        <div className="rounded-2xl bg-gradient-to-br from-[#1A4D8F] to-[#15B8A6] p-6 text-white shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/90">A quiet nudge</p>
          <p className="mt-2 text-base font-medium leading-relaxed">{t.manager.insight}</p>
        </div>
      )}
    </div>
  )
}
