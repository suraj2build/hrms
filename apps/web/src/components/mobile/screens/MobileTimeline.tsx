/**
 * MobileTimeline — the Timeline experience on the phone: the employee's memory as a
 * biography, one thumb-scroll from now back to Joining.
 *
 * Same story, same /ess/timeline lens, same shared primitives via the shared
 * useTimeline hook as the desktop surface — zero bespoke mobile components, so phone
 * and desktop create the same emotional experience (one product). Memories carry no
 * deep-links; Reflection punctuates after the first chapter.
 */

import { useNavigate } from 'react-router-dom'
import { FocusPanel } from '@/components/experience/FocusPanel'
import { JourneyEcho } from '@/components/experience/JourneyRail'
import { ReflectionCard } from '@/components/experience/ReflectionCard'
import { ProgressBand } from '@/components/experience/ProgressBand'
import { Chapter } from '@/components/experience/Chapter'
import { ChapterSummary } from '@/components/experience/ChapterSummary'
import { ActivityItem } from '@/components/experience/ActivityItem'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { useTimeline, type ChapterView } from '@/components/experience/useTimeline'

function ChapterBlock({ c, index }: { c: ChapterView; index: number }) {
  return (
    <Chapter title={c.title} subtitle={c.subtitle} index={index}>
      {c.events.map(e => <ActivityItem key={e.id} event={e} />)}
      {c.progress && <ProgressBand data={c.progress} className="pt-1" />}
      {c.summary && <ChapterSummary label={c.summary} items={c.folded} />}
    </Chapter>
  )
}

export function MobileTimeline({ base }: { base: string }) {
  const t = useTimeline()
  const navigate = useNavigate()

  if (t.isLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <div className="h-7 w-7 rounded-full border-2 border-[#2E6FE6] border-t-transparent animate-spin" />
      </div>
    )
  }
  if (t.isError) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Couldn’t load your timeline.{' '}
        <button onClick={() => t.refetch()} className="font-medium text-primary">Try again</button>
      </p>
    )
  }

  const empty = t.chapters.length === 0
  const [head, ...rest] = t.chapters

  return (
    <div className="space-y-8 pb-4">
      {t.focus && <FocusPanel eyebrow={t.focus.eyebrow} sentence={t.focus.sentence} />}

      {/* Growth spine lives in My Growth now — Timeline keeps a compact echo. */}
      <JourneyEcho count={t.journey.length} onOpen={() => navigate(`${base}/identity`)} />

      {empty && (
        <p className="py-14 text-center text-sm text-muted-foreground">
          Your story here is just beginning. As you work, your journey will appear.
        </p>
      )}

      {head && <ChapterBlock c={head} index={0} />}
      {t.reflection?.insight && <ReflectionCard insight={t.reflection.insight} />}
      {rest.map((c, i) => <ChapterBlock key={c.key} c={c} index={i + 1} />)}

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

      {!t.hasNextPage && t.origin && !empty && (
        <DoneForToday>{t.origin.first_day ? t.origin.label : `${t.origin.label} Quite a journey.`}</DoneForToday>
      )}
    </div>
  )
}
