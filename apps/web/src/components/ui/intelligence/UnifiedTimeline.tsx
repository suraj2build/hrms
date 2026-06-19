import { cn } from '@/lib/utils'

interface TimelineEvent {
  id:           string
  timestamp:    string
  title:        string
  description?: string
  severity?:    string
  module?:      string
  actor_id?:    string
  metadata?:    Record<string, unknown>
}

interface UnifiedTimelineProps {
  events:         TimelineEvent[]
  onEventClick?:  (event: TimelineEvent) => void
  emptyMessage?:  string
  loading?:       boolean
}

function dotColor(severity?: string): string {
  if (severity === 'critical') return 'bg-destructive'
  if (severity === 'high')     return 'bg-destructive'
  if (severity === 'warning')  return 'bg-warning'
  return 'bg-muted-foreground'
}

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 py-2.5 animate-pulse">
      <div className="mt-1.5 size-2 rounded-full bg-muted shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/3 rounded bg-muted" />
        <div className="h-2.5 w-2/3 rounded bg-muted" />
      </div>
    </div>
  )
}

export function UnifiedTimeline({
  events,
  onEventClick,
  emptyMessage = 'No events recorded yet.',
  loading = false,
}: UnifiedTimelineProps) {
  if (loading) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
    )
  }

  return (
    <div className="relative divide-y divide-border">
      {events.map(ev => {
        const clickable = !!onEventClick
        const content = (
          <div className="flex items-start gap-3 py-2.5">
            <div className={cn('mt-1.5 size-2 rounded-full shrink-0', dotColor(ev.severity))} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-foreground truncate">{ev.title}</span>
                {ev.module && (
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{ev.module}</span>
                )}
              </div>
              {ev.description && (
                <p className="text-xs text-muted-foreground truncate">{ev.description}</p>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {new Date(ev.timestamp).toLocaleTimeString()}
            </span>
          </div>
        )

        if (clickable) {
          return (
            <button
              key={ev.id}
              type="button"
              className="w-full text-left hover:bg-muted/40 transition-colors"
              onClick={() => onEventClick(ev)}
            >
              {content}
            </button>
          )
        }

        return <div key={ev.id}>{content}</div>
      })}
    </div>
  )
}
