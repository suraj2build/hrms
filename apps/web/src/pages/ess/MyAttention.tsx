/**
 * MyAttention — the My Attention experience (the Need lens): "What needs me now?"
 *
 * Built to be FINISHED, not managed. Employees should reach "Nothing needs you" and
 * feel it as a reward — the empty state is designed with as much care as the full one
 * (guardrail 1). Only items that need a decision / action / review appear (guardrail
 * 2; pure FYI is excluded upstream as intent:'info_only'). Three intent groups reduce
 * cognitive load (guardrail 3). When the last item clears, the all-clear fades in
 * gracefully rather than snapping (guardrail 4). My Attention must always shrink.
 *
 * Read-only and self-resolving over the existing /ess/signals Need lens — acting in a
 * module clears the condition, so the item leaves the queue on the next read.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { SignalCard, type Signal } from '@/components/experience/SignalCard'
import { AmbientLine } from '@/components/experience/AmbientLine'
import { PillarHero } from '@/components/experience/PillarHero'
import { DoneForToday } from '@/components/experience/DoneForToday'
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

function Group({ label, signals, onAction }: { label: string; signals: Signal[]; onAction: (href: string) => void }) {
  if (!signals.length) return null
  return (
    <section>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
        <div className="divide-y divide-border/40">
          {signals.map(s => <SignalCard key={s.id} signal={s} onAction={onAction} />)}
        </div>
      </div>
    </section>
  )
}

export function MyAttention() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/manager/self') ? '/manager/self' : '/ess'

  const { data, isLoading, isError, refetch } = useQuery<{ signals: Signal[] }>({
    queryKey: ['ess-signals'], queryFn: () => api.get('/ess/signals'), staleTime: 60_000,
  })

  if (isLoading) return (
    <>
      <PillarHero sky="sky-night" eyebrow="calm control" title="My Attention" />
      <div className="mx-auto max-w-[680px] py-8"><LoadingState rows={4} label="Checking what needs you..." /></div>
    </>
  )
  if (isError) return <ErrorState title="Couldn't load your attention" onRetry={() => refetch()} />

  const all = data?.signals ?? []
  const needsYou = all.filter(s => s.intent === 'needs_you').sort((a, b) => b.priority - a.priority)
  const canWait  = all.filter(s => s.intent === 'can_wait').sort((a, b) => b.priority - a.priority)
  const waiting  = all.filter(s => s.intent === 'waiting')
  const actionable = needsYou.length + canWait.length
  const go = (href: string) => navigate(`${base}${href}`)

  // The reward — designed as carefully as the populated state, faded in gracefully.
  if (actionable === 0) {
    return (
      <>
        <PillarHero sky="sky-night" eyebrow="calm control" title="My Attention"
          tagline="Nothing needs you right now. Emptiness here is the reward." />
        <div className="mx-auto flex max-w-[680px] flex-col items-center py-20 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-700">
          <div className="rounded-2xl bg-success/8 border border-success/20 p-10 text-center mx-auto max-w-sm w-full">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success mx-auto">
              <CheckCircle2 className="h-8 w-8" />
            </span>
            <p className="serif-hero mt-5 text-[1.8rem] text-foreground">Nothing needs you.</p>
            <p className="mt-2 text-sm text-muted-foreground">You're all clear — enjoy the day.</p>
            {waiting.length > 0 && (
              <p className="mt-6 text-xs text-muted-foreground">{waiting[0]!.title} · still with others</p>
            )}
          </div>
        </div>
      </>
    )
  }

  const focusSentence = needsYou.length > 0
    ? `${needsYou.length} thing${needsYou.length > 1 ? 's' : ''} need${needsYou.length > 1 ? '' : 's'} you${needsYou.length <= 3 ? ' — a few minutes' : ''}.`
    : 'Nothing urgent — just a couple of things when you have a moment.'

  return (
    <>
      <PillarHero sky="sky-night" eyebrow="calm control" title="My Attention" tagline={focusSentence} />

      <div className="mx-auto max-w-[680px] space-y-8 py-8">
        <AmbientLine>{focusSentence}</AmbientLine>

        <Group label="Needs you now" signals={needsYou} onAction={go} />
        <Group label="Can wait" signals={canWait} onAction={go} />
        <Group label="Waiting on others" signals={waiting} onAction={go} />

        <DoneForToday>
          {needsYou.length + canWait.length} items — clear these and you're all caught up.
        </DoneForToday>
      </div>
    </>
  )
}
