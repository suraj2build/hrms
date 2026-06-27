/**
 * useTimeline — the shared data hook behind both the desktop and mobile Timeline.
 *
 * One hook so the phone and desktop tell the exact same story (one product). It
 * fetches /ess/timeline (the Story lens over canonical Events), pages with a keyset
 * cursor, merges chapters across pages, and derives each chapter's date-range
 * subtitle and its compressed "routine" summary on the client. No business logic —
 * pure shaping of what the lens already decided.
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { ActivityEvent } from './ActivityItem'
import type { JourneyStep } from './JourneyRail'

export type StoryItem = ActivityEvent

export interface ChapterView {
  key:      string
  title:    string
  subtitle: string
  events:   StoryItem[]
  folded:   StoryItem[]
  summary:  string | null
  progress?: { heading: string; ambient: string; hints: { label: string; value: string }[] }
}

interface TimelinePage {
  focus:      { eyebrow: string; sentence: string } | null
  reflection: { insight: string | null; kind?: string } | null
  journey?:   JourneyStep[]
  chapters:   { key: string; title: string; order: number; events: StoryItem[]; folded: StoryItem[]; progress?: ChapterView['progress'] }[]
  nextCursor: string | null
  origin:     { joined_at: string; label: string; first_day: boolean } | null
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const my = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }

function rangeLabel(items: StoryItem[]): string {
  const ts = items.map(i => new Date(i.at).getTime()).filter(n => !isNaN(n)).sort((a, b) => a - b)
  if (!ts.length) return ''
  const lo = my(new Date(ts[0]!).toISOString()), hi = my(new Date(ts[ts.length - 1]!).toISOString())
  return lo === hi ? lo : `${lo} – ${hi}`
}

function summaryOf(folded: StoryItem[]): string | null {
  if (!folded.length) return null
  const payslips = folded.filter(f => f.type === 'payroll').length
  const days     = folded.filter(f => f.type === 'leave').length
  const parts: string[] = []
  if (payslips) parts.push(`${payslips} payslip${payslips > 1 ? 's' : ''}`)
  if (days)     parts.push(`${days} day${days > 1 ? 's' : ''} off`)
  const rest = folded.length - payslips - days
  if (rest > 0) parts.push(`${rest} more`)
  return parts.join(' · ') || null
}

export function useTimeline() {
  const q = useInfiniteQuery<TimelinePage>({
    queryKey: ['ess-timeline'],
    queryFn: ({ pageParam }) =>
      api.get(`/ess/timeline${pageParam ? `?cursor=${encodeURIComponent(pageParam as string)}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 2 * 60_000,
  })

  const pages = q.data?.pages ?? []
  const first = pages[0]

  // Merge chapters by key across pages, then derive subtitle + summary.
  const map = new Map<string, { key: string; title: string; order: number; events: StoryItem[]; folded: StoryItem[]; progress?: ChapterView['progress'] }>()
  for (const p of pages) for (const c of p.chapters) {
    let m = map.get(c.key)
    if (!m) { m = { key: c.key, title: c.title, order: c.order, events: [], folded: [], progress: c.progress }; map.set(c.key, m) }
    m.events.push(...c.events)
    m.folded.push(...c.folded)
    m.order = Math.max(m.order, c.order)
    if (!m.progress && c.progress) m.progress = c.progress
  }
  const chapters: ChapterView[] = [...map.values()]
    .sort((a, b) => b.order - a.order)
    .map(c => ({ ...c, subtitle: rangeLabel([...c.events, ...c.folded]), summary: summaryOf(c.folded) }))

  return {
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    focus: first?.focus ?? null,
    reflection: first?.reflection ?? null,
    journey: first?.journey ?? [],
    origin: pages.map(p => p.origin).find(Boolean) ?? null,
    chapters,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  }
}
