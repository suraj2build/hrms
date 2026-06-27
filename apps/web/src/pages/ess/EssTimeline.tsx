/**
 * EssTimeline — the Timeline experience: the employee's MEMORY of their journey.
 *
 * Not a log, not an audit report, not an activity table (EXPERIENCE_TIMELINE_DESIGN.md).
 * It is one continuous story read top (now) → bottom (the day they joined): people,
 * recognition, approvals, milestones, growth — woven into a narrative the employee
 * scrolls and *recognises themselves in*.
 *
 * A pure Story lens over the canonical Event stream — it composes /ess/timeline
 * (which is itself a thin lens over /ess/events) with the shared experience
 * primitives (FocusPanel · ReflectionCard · TimeGroup · ActivityItem · ProgressBand ·
 * DoneForToday). No Timeline-specific event shape, no bespoke components.
 *
 * Quality bar: strip the branding and it should read as "the story of my career",
 * never "an audit log".
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { FocusPanel } from '@/components/experience/FocusPanel'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand, type ProgressBandData } from '@/components/experience/ProgressBand'
import { TimeGroup } from '@/components/experience/TimeGroup'
import { ActivityItem, type ActivityEvent } from '@/components/experience/ActivityItem'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

// The Story-view item (Patterns §3.3 Event projection) the endpoint already shaped.
type StoryItem = ActivityEvent
interface TimelineGroup { key: string; label: string; progress?: ProgressBandData; events: StoryItem[] }
interface TimelinePage {
  focus:      { eyebrow: string; sentence: string } | null
  reflection: { insight: string | null; kind?: string } | null
  groups:     TimelineGroup[]
  nextCursor: string | null
  origin:     { joined_at: string; label: string } | null
}

export function EssTimeline() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  const q = useInfiniteQuery<TimelinePage>({
    queryKey: ['ess-timeline'],
    queryFn: ({ pageParam }) =>
      api.get(`/ess/timeline${pageParam ? `?cursor=${encodeURIComponent(pageParam as string)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 2 * 60_000,
  })

  if (q.isLoading) return <div className="mx-auto max-w-[720px] py-2"><LoadingState rows={5} label="Gathering your story…" /></div>
  if (q.isError)   return <ErrorState title="Couldn’t load your timeline" onRetry={() => q.refetch()} />

  const pages = q.data?.pages ?? []
  const first = pages[0]

  // Merge groups by key across pages (a month/year chapter can span pages), order preserved.
  const merged: TimelineGroup[] = []
  const idx = new Map<string, TimelineGroup>()
  for (const p of pages) for (const g of p.groups) {
    let m = idx.get(g.key)
    if (!m) { m = { key: g.key, label: g.label, progress: g.progress, events: [] }; idx.set(g.key, m); merged.push(m) }
    m.events.push(...g.events)
    if (!m.progress && g.progress) m.progress = g.progress
  }
  const origin = pages.map(p => p.origin).find(Boolean) ?? null
  const go = (href: string) => navigate(`${base}${href}`)
  const empty = merged.length === 0

  return (
    <div className="mx-auto max-w-[720px] space-y-8 py-2">
      {/* Focus — the journey framing (orients, no action). */}
      {first?.focus && <FocusPanel eyebrow={first.focus.eyebrow} sentence={first.focus.sentence} />}

      {/* Reflection — one memory-aware insight, the signature gradient moment. */}
      {first?.reflection?.insight && <ReflectionCard insight={first.reflection.insight} />}

      {empty && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Your story here is just beginning. As you work, your journey will appear — people, recognition, milestones and all.
        </p>
      )}

      {/* Story — time-grouped chapters, faces woven in, milestones emphasised. */}
      {merged.map((g) => (
        <TimeGroup key={g.key} label={g.label}>
          {g.events.map((e) => (
            <ActivityItem key={e.id} event={e} onClick={e.href ? () => go(e.href!) : undefined} />
          ))}
          {g.progress && <ProgressBand data={g.progress} className="pt-2" />}
        </TimeGroup>
      ))}

      {/* Deeper into the past — keyset pagination, never a "page 2 of 47". */}
      {q.hasNextPage && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-full border border-border/60 px-5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
          </button>
        </div>
      )}

      {/* Closure — the origin marker: the emotional floor of the journey. */}
      {!q.hasNextPage && origin && !empty && (
        <DoneForToday>{`${origin.label} Quite a journey.`}</DoneForToday>
      )}
    </div>
  )
}
