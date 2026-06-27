/**
 * EssTimeline — My Story: the employee's MEMORY of their journey, composed as a
 * "river of time." (Visual Language v2 · the Memory/dusk atmosphere.)
 *
 * PSYCHOLOGICAL OUTCOME (frozen target): "My time here matters." Not a momentary hit
 * of nostalgia — a durable sense that the work has counted. The composition serves
 * that outcome: a single luminous line descends from NOW (top, bright) into the past
 * (fading), with the employee's own moments as stations on it — faces where people
 * are involved, milestones that bloom, routine folded into quiet pebbles. Content
 * (people, milestones, chapters) always leads; the line is a soft reinforcement, not
 * decoration. Calm, readable (dark text on the light dusk field), accessible (real
 * heading order; the line is aria-hidden; reduced-motion honoured), performant
 * (CSS only). Architecture/data/Core unchanged — a pure Story lens over useTimeline.
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { Atmosphere } from '@/components/experience/Atmosphere'
import { JourneyEcho } from '@/components/experience/JourneyRail'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand } from '@/components/experience/ProgressBand'
import { ChapterSummary } from '@/components/experience/ChapterSummary'
import { ActivityItem } from '@/components/experience/ActivityItem'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { useTimeline, type ChapterView } from '@/components/experience/useTimeline'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

/** One chapter as a stretch of the river: a serif chapter title (a journal heading)
 *  with a node on the line, then its moments as stations (ActivityItem icons sit on
 *  the line), the folded routine as a pebble, and a year's Progress as encouragement. */
function ChapterStation({ c, index }: { c: ChapterView; index: number }) {
  return (
    <section className="atmo-rise" style={{ animationDelay: `${Math.min(index, 8) * 70}ms`, animationFillMode: 'backwards' }}>
      <div className="relative mb-4 pl-11">
        <span aria-hidden className="absolute left-[12px] top-[6px] h-2 w-2 rounded-full bg-brand-teal ring-4 ring-background" />
        <h2 className="font-serif text-[1.15rem] leading-tight text-foreground">{c.title}</h2>
        {c.subtitle && <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{c.subtitle}</p>}
      </div>
      <div className="space-y-5">
        {c.events.map(e => <ActivityItem key={e.id} event={e} />)}
        {c.summary && <ChapterSummary label={c.summary} items={c.folded} />}
        {c.progress && <ProgressBand data={c.progress} className="pl-11 pt-1" />}
      </div>
    </section>
  )
}

export function EssTimeline() {
  const t = useTimeline()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  if (t.isLoading) return <div className="mx-auto max-w-[720px] py-4"><LoadingState rows={6} label="Gathering your story…" /></div>
  if (t.isError)   return <ErrorState title="Couldn’t load your story" onRetry={() => t.refetch()} />

  const empty = t.chapters.length === 0
  const [head, ...rest] = t.chapters

  return (
    <div className="mx-auto max-w-[720px] py-4">
      {/* Dusk atmosphere — the serif emotional beat + quiet stats (numbers beside meaning). */}
      <Atmosphere
        theme="memory"
        eyebrow={t.focus?.eyebrow ?? 'YOUR STORY'}
        title="Your story so far."
        subtitle={t.focus?.sentence}
      >
        {t.journey.length > 0 && (
          <p className="text-[13px] text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{t.journey.length}</span> milestone{t.journey.length === 1 ? '' : 's'}
            {t.chapters.length > 0 && <> · <span className="font-semibold tabular-nums text-foreground">{t.chapters.length}</span> chapter{t.chapters.length === 1 ? '' : 's'} so far</>}
          </p>
        )}
      </Atmosphere>

      {empty && (
        <p className="py-20 text-center text-base text-muted-foreground">
          Your story here is just beginning. As you work, your journey will appear — people, recognition and milestones.
        </p>
      )}

      {!empty && (
        <div className="relative mt-12">
          {/* The river — one luminous line, brightest at NOW (top), fading into the past. */}
          <div aria-hidden className="pointer-events-none absolute left-4 top-1 bottom-6 w-px bg-gradient-to-b from-brand-teal/60 via-border to-transparent" />
          <div className="space-y-9">
            {head && <ChapterStation c={head} index={0} />}
            {/* A reflective pause — the one insight, a wide station on the river. */}
            {t.reflection?.insight && (
              <div className="pl-11"><ReflectionCard insight={t.reflection.insight} /></div>
            )}
            {rest.map((c, i) => <ChapterStation key={c.key} c={c} index={i + 1} />)}
          </div>
        </div>
      )}

      {/* Deeper into the past — narrative language, never "page 2 of 47". */}
      {t.hasNextPage && (
        <div className="flex justify-center pt-6">
          <button
            onClick={() => t.fetchNextPage()}
            disabled={t.isFetchingNextPage}
            className="rounded-full px-5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t.isFetchingNextPage ? 'Going back…' : 'Earlier in your story ↓'}
          </button>
        </div>
      )}

      {/* The origin — where the line is born and fades; the emotional floor. */}
      {!t.hasNextPage && t.origin && !empty && (
        <div className="pt-8">
          <DoneForToday>{t.origin.first_day ? t.origin.label : `${t.origin.label} Quite a journey.`}</DoneForToday>
        </div>
      )}

      {/* A quiet door to the forward-looking self. */}
      {t.journey.length >= 2 && (
        <div className="pt-6">
          <JourneyEcho count={t.journey.length} onOpen={() => navigate(`${base}/identity`)} />
        </div>
      )}
    </div>
  )
}
