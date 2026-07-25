/**
 * Updates — onboarding activity feed.
 *
 * Consumes structured onboarding inbox items filtered server-side by entity_type
 * ('onboarding_session' | 'onboarding_document' | 'onboarding_checklist').
 * No keyword matching. No URL parsing. No heuristics.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, Loader2, ChevronRight, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useOnboardingNotifications, useMarkNotificationRead, isUnread, isActionRequired,
  type OnboardingNotification,
} from './onboarding-data'

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function ItemIcon({ severity, actionRequired }: { severity: string; actionRequired: boolean }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0'
  if (actionRequired)         return <AlertTriangle className={cn(cls, 'text-warning')} />
  if (severity === 'success') return <CheckCircle2 className={cn(cls, 'text-success')} />
  if (severity === 'warning') return <AlertTriangle className={cn(cls, 'text-warning')} />
  return <Info className={cn(cls, 'text-[#2E6FE6]')} />
}

export function Updates({ limit = 12 }: { limit?: number }) {
  const { data, isLoading, isError } = useOnboardingNotifications()
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()

  const items = useMemo(() => {
    const all = data?.data ?? []
    // Action-required first, then newest.
    return all
      .slice()
      .sort((a, b) => {
        const r = Number(isActionRequired(a)) - Number(isActionRequired(b))
        if (r !== 0) return -r
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      .slice(0, limit)
  }, [data, limit])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your updates…
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Could not load your updates.
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <BellOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No updates yet. We'll let you know when there's news.</p>
      </div>
    )
  }

  const handleClick = (n: OnboardingNotification) => {
    if (isUnread(n)) markRead.mutate(n.id)
    if (n.action_route) navigate(n.action_route)
  }

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
      {items.map(n => (
        <button
          key={n.id}
          onClick={() => handleClick(n)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <span className={cn(
            'mt-2 h-2 w-2 shrink-0 rounded-full',
            isUnread(n) ? 'bg-[#2E6FE6]' : 'bg-transparent',
          )} />
          <ItemIcon severity={n.severity} actionRequired={isActionRequired(n)} />
          <div className="min-w-0 flex-1">
            <p className={cn(
              'text-sm leading-tight',
              isUnread(n) ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}>
              {n.title}
            </p>
            {n.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.summary}</p>}
            <p className="mt-1 text-[10px] text-muted-foreground">{fmtRelative(n.created_at)}</p>
          </div>
          {n.action_route && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" />}
        </button>
      ))}
    </div>
  )
}

export default Updates
