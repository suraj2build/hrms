/**
 * Updates — onboarding activity & notifications feed.
 *
 * Consumes the existing Notifications service (shared ['notifications'] query) and
 * presents the new hire's recent updates, surfacing onboarding-related ones first.
 * Tapping an item marks it read and follows its link. No new notification logic.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellOff, Loader2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useOnboardingNotifications, useMarkNotificationRead, isOnboardingRelated,
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

export function Updates({ limit = 12 }: { limit?: number }) {
  const { data, isLoading, isError } = useOnboardingNotifications()
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()

  const items = useMemo(() => {
    const all = data?.data ?? []
    // Onboarding-related first, then newest — without dropping general updates.
    return all
      .slice()
      .sort((a, b) => {
        const r = Number(isOnboardingRelated(b)) - Number(isOnboardingRelated(a))
        if (r !== 0) return r
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
        <p className="text-sm text-muted-foreground">No updates yet. We’ll let you know when there’s news.</p>
      </div>
    )
  }

  const handleClick = (n: OnboardingNotification) => {
    if (!n.is_read) markRead.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
      {items.map(n => (
        <button
          key={n.id}
          onClick={() => handleClick(n)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-[#2E6FE6]')} />
          <Bell className={cn('mt-0.5 h-4 w-4 shrink-0', n.is_read ? 'text-muted-foreground/50' : 'text-[#2E6FE6]')} />
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm leading-tight', n.is_read ? 'font-medium text-foreground' : 'font-semibold text-foreground')}>
              {n.title}
            </p>
            {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
            <p className="mt-1 text-[10px] text-muted-foreground">{fmtRelative(n.created_at)}</p>
          </div>
          {n.link && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" />}
        </button>
      ))}
    </div>
  )
}

export default Updates
