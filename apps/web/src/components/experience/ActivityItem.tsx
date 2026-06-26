/**
 * ActivityItem — one event row on the "What happened" Experience Cloud block.
 *
 * Surface primitive (EXPERIENCE_CLOUD_UX_BLUEPRINT.md §3). Renders an
 * activity event (from GET /ess/activity) as a calm timeline row — icon by
 * type, title, body, relative time. No per-type business logic; new event
 * types render with zero changes here. Reused later by the full Timeline.
 */

import * as React from 'react'
import { Clock, CalendarCheck, CreditCard, Award, Cake, Megaphone, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PersonAvatar } from './PersonAvatar'

export type ActivityType = 'attendance' | 'leave' | 'payroll' | 'recognition' | 'birthday' | 'announcement'

export interface ActivityEvent {
  id:    string
  type:  ActivityType
  title: string
  body?: string
  at:    string
  /** When set, the row shows this person's face instead of a type icon. */
  person?: string
}

const ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  attendance:   Clock,
  leave:        CalendarCheck,
  payroll:      CreditCard,
  recognition:  Award,
  birthday:     Cake,
  announcement: Megaphone,
}

// Subtle per-type icon tint — token-based (one visual system).
const TINT: Record<ActivityType, string> = {
  attendance:   'bg-primary/10 text-primary',
  leave:        'bg-info/10 text-info',
  payroll:      'bg-success/10 text-success',
  recognition:  'bg-warning/10 text-warning',
  birthday:     'bg-primary/10 text-primary',
  announcement: 'bg-muted text-muted-foreground',
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  const d = Math.floor(diff / 86_400_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

export function ActivityItem({ event, className }: { event: ActivityEvent; className?: string }) {
  const Icon = ICON[event.type] ?? Activity
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {event.person ? (
        <PersonAvatar name={event.person} size="sm" className="mt-0.5" />
      ) : (
        <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', TINT[event.type] ?? 'bg-muted text-muted-foreground')}>
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{event.title}</p>
        {event.body && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{event.body}</p>}
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">{timeAgo(event.at)}</span>
    </div>
  )
}
