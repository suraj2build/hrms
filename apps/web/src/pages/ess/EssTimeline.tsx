/**
 * EssTimeline — the Timeline experience: the employee's MEMORY of their journey,
 * told as a biography (Joining → Settling in → year chapters), not an activity log.
 *
 * A pure Story lens over the canonical Event stream, composed from shared experience
 * primitives (FocusPanel · Chapter · ActivityItem · ChapterSummary · ProgressBand ·
 * ReflectionCard · DoneForToday) via the shared useTimeline hook — desktop and mobile
 * tell the identical story. Memories carry no deep-links; they are felt, not clicked
 * through. Reflection punctuates *after* the first chapter rather than pre-empting it.
 *
 * Quality bar: strip the branding and it should read as "the story of my career".
 */

import { FocusPanel } from '@/components/experience/FocusPanel'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand } from '@/components/experience/ProgressBand'
import { Chapter } from '@/components/experience/Chapter'
import { ChapterSummary } from '@/components/experience/ChapterSummary'
import { ActivityItem } from '@/components/experience/ActivityItem'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { useTimeline, type ChapterView } from '@/components/experience/useTimeline'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

function ChapterBlock({ c, index }: { c: ChapterView; index: number }) {
  return (
    <Chapter title={c.title} subtitle={c.subtitle} index={index}>
      {c.events.map(e => <ActivityItem key={e.id} event={e} />)}
      {c.progress && <ProgressBand data={c.progress} className="pt-1" />}
      {c.summary && <ChapterSummary label={c.summary} items={c.folded} />}
    </Chapter>
  )
}

export function EssTimeline() {
  const t = useTimeline()

  if (t.isLoading) return <div className="mx-auto max-w-[720px] py-2"><LoadingState rows={5} label="Gathering your story…" /></div>
  if (t.isError)   return <ErrorState title="Couldn’t load your timeline" onRetry={() => t.refetch()} />

  const empty = t.chapters.length === 0
  const [head, ...rest] = t.chapters

  return (
    <div className="mx-auto max-w-[720px] space-y-9 py-2">
      {/* Focus — the journey framing (orients, no action). */}
      {t.focus && <FocusPanel eyebrow={t.focus.eyebrow} sentence={t.focus.sentence} />}

      {empty && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Your story here is just beginning. As you work, your journey will appear — people, recognition and milestones.
        </p>
      )}

      {/* First chapter, then Reflection punctuates, then the rest of the journey. */}
      {head && <ChapterBlock c={head} index={0} />}
      {t.reflection?.insight && <ReflectionCard insight={t.reflection.insight} />}
      {rest.map((c, i) => <ChapterBlock key={c.key} c={c} index={i + 1} />)}

      {/* Deeper into the past — narrative language, never "page 2 of 47". */}
      {t.hasNextPage && (
        <div className="flex justify-center pt-1">
          <button
            onClick={() => t.fetchNextPage()}
            disabled={t.isFetchingNextPage}
            className="rounded-full border border-border/60 px-5 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
          >
            {t.isFetchingNextPage ? 'Going back…' : 'Earlier in your story ↓'}
          </button>
        </div>
      )}

      {/* Closure — the origin: forward-looking on day one, a warm anchor once there's a journey. */}
      {!t.hasNextPage && t.origin && !empty && (
        <DoneForToday>{t.origin.first_day ? t.origin.label : `${t.origin.label} Quite a journey.`}</DoneForToday>
      )}
    </div>
  )
}
