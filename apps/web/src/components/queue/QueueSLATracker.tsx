/**
 * QueueSLATracker — inline SLA status shown below queue section headers
 * when overdue items exist in that section.
 */

import { cn } from '@/lib/utils'
import type { QueueSection, OperationalQueueItem } from '@/lib/queue/types'

export interface QueueSLATrackerProps {
  section: QueueSection
  items:   OperationalQueueItem[]
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function QueueSLATracker({ section, items }: QueueSLATrackerProps) {
  const sectionItems = items.filter(i => i.section === section)
  const overdueItems = sectionItems.filter(i => i.overdue && i.status === 'open')

  if (overdueItems.length === 0) return null

  // avg resolution time across overdue items
  const avgMins =
    overdueItems.length > 0
      ? Math.round(
          overdueItems.reduce((sum, i) => sum + i.estimated_resolution_time, 0) /
            overdueItems.length,
        )
      : 0

  // oldest item by created_at
  const oldest = overdueItems.reduce<OperationalQueueItem | null>((prev, cur) => {
    if (!prev) return cur
    return new Date(cur.created_at) < new Date(prev.created_at) ? cur : prev
  }, null)

  return (
    <p className={cn('text-[11px] text-muted-foreground leading-none')}>
      {overdueItems.length} overdue
      {' · '}
      avg {avgMins} min resolution
      {oldest ? ` · oldest: ${timeAgo(oldest.created_at)}` : ''}
    </p>
  )
}
