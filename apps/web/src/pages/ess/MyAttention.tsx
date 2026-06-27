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
import { LoadingState } from '@/components/layout/LoadingState'
import { ErrorState } from '@/components/layout/ErrorState'

function Group({ label, signals, onAction }: { label: string; signals: Signal[]; onAction: (href: string) => void }) {
  if (!signals.length) return null
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
      <div className="space-y-2.5">
        {signals.map(s => <SignalCard key={s.id} signal={s} onAction={onAction} />)}
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

  if (isLoading) return <div className="mx-auto max-w-[680px] py-2"><LoadingState rows={4} label="Checking what needs you…" /></div>
  if (isError)   return <ErrorState title="Couldn’t load your attention" onRetry={() => refetch()} />

  const all = data?.signals ?? []
  const needsYou = all.filter(s => s.intent === 'needs_you').sort((a, b) => b.priority - a.priority)
  const canWait  = all.filter(s => s.intent === 'can_wait').sort((a, b) => b.priority - a.priority)
  const waiting  = all.filter(s => s.intent === 'waiting')
  const actionable = needsYou.length + canWait.length
  const go = (href: string) => navigate(`${base}${href}`)

  // The reward — designed as carefully as the populated state, faded in gracefully.
  if (actionable === 0) {
    return (
      <div className="mx-auto flex max-w-[680px] flex-col items-center py-20 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-700">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="h-8 w-8" />
        </span>
        <p className="mt-5 text-[1.4rem] font-semibold text-foreground">Nothing needs you.</p>
        <p className="mt-1.5 text-sm text-muted-foreground">You’re all clear — enjoy the day.</p>
        {waiting.length > 0 && (
          <p className="mt-6 text-xs text-muted-foreground">{waiting[0]!.title} · still with others</p>
        )}
      </div>
    )
  }

  const focusSentence = needsYou.length > 0
    ? `${needsYou.length} thing${needsYou.length > 1 ? 's' : ''} need${needsYou.length > 1 ? '' : 's'} you${needsYou.length <= 3 ? ' — a few minutes' : ''}.`
    : 'Nothing urgent — just a couple of things when you have a moment.'

  return (
    <div className="mx-auto max-w-[680px] space-y-8 py-2">
      {/* Focus — one synthesising sentence, never a count badge. */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/[0.06] to-[#15B8A6]/[0.06] p-6">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">What needs you</p>
        <p className="mt-2 text-[1.4rem] font-semibold leading-snug text-foreground">{focusSentence}</p>
      </div>

      {needsYou.length > 0 && canWait.length === 0 && (
        <AmbientLine>Clear these and you’re done for the day.</AmbientLine>
      )}
      {needsYou.length === 0 && canWait.length > 0 && (
        <AmbientLine>Nothing pressing — these can wait for coffee.</AmbientLine>
      )}

      <Group label="Needs you now" signals={needsYou} onAction={go} />
      <Group label="Can wait" signals={canWait} onAction={go} />
      <Group label="Waiting on others" signals={waiting} onAction={go} />

      {/* Pending-aware closer — the finish line, never a dead-end. */}
      <p className="flex items-center justify-center gap-2 pt-1 text-center text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-success" />
        Clear these and you’re all caught up.
      </p>
    </div>
  )
}
