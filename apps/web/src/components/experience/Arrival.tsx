/**
 * Arrival — the first viewport of Home: the ritual of arriving at work.
 *
 * This is the product's "lock screen" (EXPERIENCE_ARRIVAL_SPEC.md). Its only job is to
 * make one feeling true within five seconds — "this feels like my workplace" — before a
 * single thought about work. Three beats, always in order: RECOGNITION (your name, in
 * the right voice) · ATMOSPHERE (a living CSS field that is this time of day) · BELONGING
 * (the faint life of the place — celebrations and community, never attendance/tracking).
 *
 * Hard constraints honoured here:
 *   - The Sacred Absence (§2.6): NO tasks, counts, approvals, warnings, urgency, nav, or
 *     buttons — except the single warm invitation, "Begin your day". This component never
 *     reads /ess/signals.
 *   - Navigation is hidden while the door is in view: we raise `atThreshold` on the shared
 *     arrivalStore on mount and lower it once the employee crosses (§4.3). The shells hide
 *     all chrome while it is raised.
 *   - Calm, AA, reduced-motion-safe, fast (paints field + greeting immediately from the
 *     clock + cached name; life fades in when data arrives).
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { useArrivalStore } from '@/stores/arrivalStore'
import { PersonAvatar } from './PersonAvatar'
import { resolveArrival } from './resolveArrival'
import type { DayContext } from './resolveGreeting'

/** Only the life-and-recognition slices of /ess/home are read here — never work. */
interface HomeLife {
  profile?: { name?: string | null }
  context?: DayContext
  recognition?: { recent?: { from_name?: string | null }[] }
  feed_teaser?: { author?: string | null }[]
  birthdays?: { name: string; days_until: number }[]
  anniversaries?: { name: string; years: number; days_until: number }[]
}

const VISIT_KEY = 'arrival-last-visit'
const todayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/** Lightweight same-day memory: is this a re-entry today? Records the visit either way. */
function readRevisit(now: Date): boolean {
  try {
    const today = todayKey(now)
    const prev = localStorage.getItem(VISIT_KEY)
    localStorage.setItem(VISIT_KEY, today)
    return prev === today
  } catch {
    return false
  }
}

/** The life of the place — belonging from celebrations & community, never surveillance. */
function resolveLife(d: HomeLife | undefined, firstDay: boolean): { line: string; faces: string[] } {
  const bdays = (d?.birthdays ?? []).filter((b) => b.days_until === 0)
  const annis = (d?.anniversaries ?? []).filter((a) => a.days_until === 0)
  const authors = (d?.feed_teaser ?? []).map((f) => f.author).filter(Boolean) as string[]
  const recog = (d?.recognition?.recent ?? []).map((r) => r.from_name).filter(Boolean) as string[]
  const faces = Array.from(new Set([...bdays.map((b) => b.name), ...annis.map((a) => a.name), ...authors, ...recog])).slice(0, 5)

  if (firstDay) return { line: 'Your new team is right here with you.', faces }
  if (bdays.length) {
    const more = bdays.length - 1
    return { line: more > 0 ? `${bdays[0]!.name} and ${more} other${more === 1 ? '' : 's'} are celebrating today.` : `It’s ${bdays[0]!.name}’s birthday today.`, faces }
  }
  if (annis.length) {
    const a = annis[0]!
    return { line: `${a.name} marks ${a.years} year${a.years === 1 ? '' : 's'} today.`, faces }
  }
  if (authors.length) return { line: `${authors[0]} and others have been sharing in Community.`, faces }
  if (recog.length) return { line: 'Kind words are going around today.', faces }
  // Solo / quiet — place-belonging, never an empty or lonely frame.
  return { line: 'The team’s here with you.', faces }
}

export function Arrival({ dayAnchorId }: { dayAnchorId: string }) {
  const { profile } = useAuthStore()
  const sectionRef = useRef<HTMLElement>(null)
  const setAtThreshold = useArrivalStore((s) => s.setAtThreshold)

  // Stable per-mount values (the clock + same-day memory read once, on arrival).
  const [now] = useState(() => new Date())
  const [revisit] = useState(() => readRevisit(now))

  // Life data — shared cache key with Home; the door paints without waiting on it.
  const { data } = useQuery<HomeLife>({
    queryKey: ['ess-home'], queryFn: () => api.get('/ess/home'), staleTime: 2 * 60_000,
  })

  const name = data?.profile?.name ?? profile?.full_name ?? null
  const view = resolveArrival({ name, ctx: data?.context, now, revisit })
  const life = resolveLife(data, view.moment === 'first_day')

  // ── Nav-hide: raise the threshold flag while the door owns the screen ──────────
  // Raise immediately on mount so chrome never flashes; lower once crossed.
  useEffect(() => {
    setAtThreshold(true)
    const el = sectionRef.current
    if (!el) return
    let crossed = false
    const io = new IntersectionObserver(
      (entries) => {
        const r = entries[0]?.intersectionRatio ?? 1
        // Hysteresis so the chrome doesn't flap at the boundary as it mounts/unmounts.
        if (!crossed && r < 0.45) { crossed = true; setAtThreshold(false) }
        else if (crossed && r > 0.7) { crossed = false; setAtThreshold(true) }
      },
      { threshold: [0, 0.45, 0.7, 1] },
    )
    io.observe(el)
    return () => { io.disconnect(); setAtThreshold(false) }
  }, [setAtThreshold])

  const beginDay = () => {
    document.getElementById(dayAnchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section
      ref={sectionRef}
      aria-label="Welcome"
      className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden"
    >
      {/* The atmospheric field — a living CSS sky. Decorative; the text carries meaning. */}
      <div
        aria-hidden
        className="arrival-breathe absolute inset-0 -z-10 origin-center"
        style={{ backgroundImage: view.field }}
      />

      {/* The greeting block — recognition + the day's weather, vertically centered. */}
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-6 sm:px-8">
        <p className="arrival-rise text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground" style={{ animationDelay: '120ms' }}>
          {view.eyebrow}
        </p>
        <h1
          className="arrival-rise mt-4 font-serif text-[2.7rem] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[3.6rem]"
          style={{ animationDelay: '240ms' }}
        >
          {view.greeting}
        </h1>
        <p className="arrival-rise mt-4 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground sm:text-lg" style={{ animationDelay: '380ms' }}>
          {view.weather}
        </p>

        {/* Belonging — the faint life of the place. Faces are decorative; the line speaks. */}
        <div className="arrival-rise mt-10 flex items-center gap-3" style={{ animationDelay: '520ms' }}>
          {life.faces.length > 0 && (
            <span className="flex -space-x-2">
              {life.faces.map((f) => (
                <PersonAvatar key={f} name={f} size="sm" className="ring-2 ring-background/80" decorative />
              ))}
            </span>
          )}
          <span className="text-sm text-muted-foreground">{life.line}</span>
        </div>
      </div>

      {/* The single warm invitation — never a software action. The quiet floor of the door. */}
      <div className="arrival-rise relative flex shrink-0 items-end justify-center pb-10 pt-4" style={{ animationDelay: '680ms' }}>
        <button
          onClick={beginDay}
          className="group flex flex-col items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <span>Begin your day</span>
          <ChevronDown className="h-4 w-4 opacity-70 transition-transform group-hover:translate-y-0.5" aria-hidden />
        </button>
      </div>
    </section>
  )
}
