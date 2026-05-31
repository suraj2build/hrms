/**
 * OperationalTimeline
 *
 * A compact chronological event stream rendered as a left-bordered list.
 * Used in workspace intelligence panels and operational dashboards.
 */

import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export type TimelineEventSeverity = 'critical' | 'warning' | 'info' | 'success' | 'neutral'

export interface TimelineEvent {
  id:          string
  title:       string
  description?: string
  /** ISO timestamp */
  timestamp:   string
  severity:    TimelineEventSeverity
  icon?:       LucideIcon
  /** Optional CTA */
  action?:     string
  onAction?:   () => void
}

export interface OperationalTimelineProps {
  events:      TimelineEvent[]
  loading?:    boolean
  maxItems?:   number
  className?:  string
}

// ── Severity tokens ────────────────────────────────────────────────────────────

const DOT_COLOR: Record<TimelineEventSeverity, string> = {
  critical: 'bg-destructive',
  warning:  'bg-warning',
  info:     'bg-info',
  success:  'bg-success',
  neutral:  'bg-muted-foreground/40',
}

const ICON_COLOR: Record<TimelineEventSeverity, string> = {
  critical: 'text-destructive',
  warning:  'text-warning',
  info:     'text-info',
  success:  'text-success',
  neutral:  'text-muted-foreground',
}

// ── Time formatting ────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24) return `${hrs}h ago`
  const _d = new Date(iso); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OperationalTimeline({
  events,
  loading = false,
  maxItems = 20,
  className,
}: OperationalTimelineProps) {
  if (loading) {
    return (
      <div className={cn('space-y-3 pl-5', className)}>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 rounded-md bg-muted/40 animate-pulse" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className={cn('text-[11px] text-muted-foreground text-center py-4', className)}>
        No recent events
      </div>
    )
  }

  const visible = events.slice(0, maxItems)

  return (
    <div className={cn('relative pl-5', className)}>
      {/* Vertical spine */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/60" />

      <div className="space-y-3">
        {visible.map(event => {
          const Icon = event.icon
          return (
            <div key={event.id} className="relative">
              {/* Dot */}
              <div className={cn(
                'absolute -left-5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background',
                DOT_COLOR[event.severity],
              )} />

              <div className="space-y-0.5">
                <div className="flex items-start gap-1.5">
                  {Icon && <Icon className={cn('h-3 w-3 flex-shrink-0 mt-0.5', ICON_COLOR[event.severity])} />}
                  <p className="text-[11.5px] font-medium text-foreground leading-tight flex-1">{event.title}</p>
                  <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 tabular-nums">
                    {fmtRelative(event.timestamp)}
                  </span>
                </div>
                {event.description && (
                  <p className="text-[10.5px] text-muted-foreground leading-snug ml-4">{event.description}</p>
                )}
                {event.action && event.onAction && (
                  <button
                    type="button"
                    onClick={event.onAction}
                    className={cn(
                      'text-[10.5px] font-medium ml-4 underline underline-offset-2 transition-opacity hover:opacity-70',
                      ICON_COLOR[event.severity],
                    )}
                  >
                    {event.action}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
