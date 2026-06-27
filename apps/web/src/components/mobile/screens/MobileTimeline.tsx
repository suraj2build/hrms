/**
 * MobileTimeline — the Timeline experience on the phone: the employee's memory,
 * one continuous thumb-scroll from now back to the day they joined.
 *
 * Same narrative as the desktop surface, same canonical /ess/timeline endpoint,
 * the same shared experience primitives (FocusPanel · ReflectionCard · TimeGroup ·
 * ActivityItem · ProgressBand · DoneForToday) — zero bespoke mobile components, so
 * the phone and desktop tell the same story (one product).
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api/client'
import { FocusPanel } from '@/components/experience/FocusPanel'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand, type ProgressBandData } from '@/components/experience/ProgressBand'
import { TimeGroup } from '@/components/experience/TimeGroup'
import { ActivityItem, type ActivityEvent } from '@/components/experience/ActivityItem'
import { DoneForToday } from '@/components/experience/DoneForToday'

type StoryItem = ActivityEvent
interface TimelineGroup { key: string; label: string; progress?: ProgressBandData; events: StoryItem[] }
interface TimelinePage {
  focus:      { eyebrow: string; sentence: string } | null
  reflection: { insight: string | null; kind?: string } | null
  groups:     TimelineGroup[]
  nextCursor: string | null
  origin:     { joined_at: string; label: string } | null
}

export function MobileTimeline({ base }: { base: string }) {
  const navigate = useNavigate()

  const q = useInfiniteQuery<TimelinePage>({
    queryKey: ['ess-timeline'],
    queryFn: ({ pageParam }) =>
      api.get(`/ess/timeline${pageParam ? `?cursor=${encodeURIComponent(pageParam as string)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 2 * 60_000,
  })

  if (q.isLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="h-7 w-7 rounded-full border-2 border-[#2E6FE6] border-t-transparent animate-spin" />
      </div>
    )
  }
  if (q.isError) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Couldn’t load your timeline.{' '}
        <button onClick={() => q.refetch()} className="font-medium text-primary">Try again</button>
      </p>
    )
  }

  const pages = q.data?.pages ?? []
  const first = pages[0]

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
    <div className="space-y-7 pb-4">
      {first?.focus && <FocusPanel eyebrow={first.focus.eyebrow} sentence={first.focus.sentence} />}
      {first?.reflection?.insight && <ReflectionCard insight={first.reflection.insight} />}

      {empty && (
        <p className="py-14 text-center text-sm text-muted-foreground">
          Your story here is just beginning. As you work, your journey will appear.
        </p>
      )}

      {merged.map((g) => (
        <TimeGroup key={g.key} label={g.label}>
          {g.events.map((e) => (
            <ActivityItem key={e.id} event={e} onClick={e.href ? () => go(e.href!) : undefined} />
          ))}
          {g.progress && <ProgressBand data={g.progress} className="pt-2" />}
        </TimeGroup>
      ))}

      {q.hasNextPage && (
        <div className="flex justify-center pt-1">
          <button
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-full border border-border/60 px-5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load earlier'}
          </button>
        </div>
      )}

      {!q.hasNextPage && origin && !empty && (
        <DoneForToday>{`${origin.label} Quite a journey.`}</DoneForToday>
      )}
    </div>
  )
}
