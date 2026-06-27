/**
 * MyGrowth — the My Growth experience (Identity): "Who am I, and how have I grown?"
 *
 * The Growth lens — the employee's professional story first, HR data second. NOT a
 * profile form: it asks nothing and edits nothing (field edits are a module action
 * reached elsewhere). Composed from shared experience primitives over /ess/identity.
 * Sections that have no real data yet (skills / learning) are simply absent — calm
 * empty space, never a placeholder (guardrail 3).
 *
 * Spine: identity → who I work with → how I've grown (the Journey spine's canonical
 * home) → growth reflection → what I'm known for → looking ahead → a forward close.
 */

import { useIdentity } from '@/components/experience/useIdentity'
import { PeopleRail } from '@/components/experience/PeopleRail'
import { JourneyRail } from '@/components/experience/JourneyRail'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { PersonAvatar } from '@/components/experience/PersonAvatar'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { PillarHero } from '@/components/experience/PillarHero'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'
import { CalendarClock } from 'lucide-react'

function Strengths({ items }: { items: { badge: string; label: string; count: number; faces: string[] }[] }) {
  if (!items.length) return null
  return (
    <section>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Known for</p>
      <h3 className="mb-3 text-[15px] font-semibold text-foreground">What I'm known for</h3>
      <div className="flex flex-wrap gap-3">
        {items.map(s => (
          <div key={s.badge} className="flex items-center gap-3 rounded-2xl bg-card border border-border/60 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">{s.label}</span>
            {s.count > 1 && <span className="text-xs text-muted-foreground">x{s.count}</span>}
            {s.faces.length > 0 && (
              <span className="flex -space-x-1.5">
                {s.faces.map(f => <PersonAvatar key={f} name={f} size="sm" className="ring-2 ring-background" />)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function LookingAhead({ items }: { items: { label: string; detail?: string }[] }) {
  if (!items.length) return null
  return (
    <section>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">What's next</p>
      <h3 className="mb-3 text-[15px] font-semibold text-foreground">Your next chapter</h3>
      <div className="space-y-2.5">
        {items.map(it => (
          <div key={it.label} className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-teal/12 text-brand-teal">
              <CalendarClock className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{it.label}</span>
              {it.detail && <span className="block text-xs text-muted-foreground">{it.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function MyGrowth() {
  const { data, isLoading, isError, refetch } = useIdentity()

  if (isLoading) return (
    <>
      <PillarHero sky="sky-dawn" eyebrow="possibility · becoming" title="My Growth" />
      <div className="mx-auto max-w-[860px] py-8"><LoadingState rows={5} label="Bringing your story together..." /></div>
    </>
  )
  if (isError || !data?.person) return <ErrorState title="Couldn't load your growth" onRetry={() => refetch()} />

  const { person, reporting, journey, strengths, reflection, lookingAhead } = data
  const role = [person.designation, person.department].filter(Boolean).join(' · ')

  return (
    <>
      <PillarHero sky="sky-dawn" eyebrow="possibility · becoming" title="My Growth"
        tagline={role ? `${person.name} · ${role}` : person.name ?? ''} />

      <div className="mx-auto max-w-[860px] space-y-8 py-8">
        {/* Who I work with — people before fields. */}
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <PeopleRail sections={[
            { label: 'reports to', people: reporting.manager ? [reporting.manager] : [] },
            { label: 'alongside', people: reporting.peers },
            { label: 'guides',    people: reporting.reports },
          ]} />
        </div>

        {/* How I've grown — the Growth spine's canonical home. */}
        {journey.length >= 2 && (
          <section>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timeline</p>
            <h3 className="mb-3 text-[15px] font-semibold text-foreground">How I've grown</h3>
            <JourneyRail steps={journey} />
          </section>
        )}

        {/* Growth reflection — the one gradient moment. */}
        {reflection.insight && <ReflectionCard insight={reflection.insight} />}

        {/* What I'm known for — strengths, never scores. */}
        <Strengths items={strengths} />

        {/* Skills / Learning / Achievements — intentionally absent until their sources exist. */}

        {/* Looking ahead — gently forward, real data only. */}
        <LookingAhead items={lookingAhead} />

        {/* Forward closure — identity ends looking forward, never "done". */}
        <DoneForToday>
          {person.tenure_months < 12 ? 'Still early in the story — the best chapters are ahead.' : 'More chapters ahead — keep growing.'}
        </DoneForToday>
      </div>
    </>
  )
}
