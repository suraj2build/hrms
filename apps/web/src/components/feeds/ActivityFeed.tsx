/**
 * ActivityFeed.tsx — Compact real-time activity feed
 * Phase UX-4
 *
 * Shows the most recent N events, polling via useActivityStream (30 s).
 * New items slide in from top. Clicking a row calls onEventClick or navigates
 * to the first actionLink.
 */

import { useMemo, useRef, useEffect } from 'react'
import { useNavigate }                 from 'react-router-dom'
import {
  Activity, AlertTriangle, Clock, UserCheck, UserX,
  Briefcase, DollarSign, CalendarOff, Zap, ShieldAlert, Settings,
  Link,
} from 'lucide-react'
import { cn }                from '@/lib/utils'
import { Badge }             from '@/components/ui/badge'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import {
  SEVERITY_COLORS, WORKSPACE_META,
} from '@/lib/activity/types'
import type {
  OperationalActivityEvent, EventType, WorkspaceCtx,
} from '@/lib/activity/types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ActivityFeedProps {
  maxItems?:     number
  showHeader?:   boolean
  onEventClick?: (event: OperationalActivityEvent) => void
  autoRefresh?:  boolean
  refetchMs?:    number
}

// ── Event type → icon mapping ──────────────────────────────────────────────────

function eventIcon(type: EventType): React.ComponentType<{ className?: string }> {
  switch (type) {
    case 'attendance_anomaly': return AlertTriangle
    case 'missing_punch':      return Clock
    case 'late_arrival':       return Clock
    case 'early_departure':    return Clock
    case 'approval_pending':   return Briefcase
    case 'approval_approved':  return UserCheck
    case 'approval_rejected':  return UserX
    case 'roster_change':      return Briefcase
    case 'shift_assigned':     return UserCheck
    case 'shift_unassigned':   return UserX
    case 'payroll_lock':       return DollarSign
    case 'payroll_blocker':    return DollarSign
    case 'payroll_processed':  return DollarSign
    case 'leave_approval':     return CalendarOff
    case 'leave_rejection':    return CalendarOff
    case 'leave_pending':      return CalendarOff
    case 'fatigue_risk':       return Zap
    case 'ot_spike':           return Zap
    case 'compliance_alert':   return ShieldAlert
    case 'workflow_action':    return Link
    case 'system_event':       return Settings
    default:                   return Activity
  }
}

// ── Time-ago formatter ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

// ── Feed item ──────────────────────────────────────────────────────────────────

function FeedItem({
  event,
  isNew,
  onClick,
}: {
  event:   OperationalActivityEvent
  isNew:   boolean
  onClick: (e: OperationalActivityEvent) => void
}) {
  const Icon      = eventIcon(event.type)
  const sevColors = SEVERITY_COLORS[event.severity]
  const wsMeta    = WORKSPACE_META[event.workspace as WorkspaceCtx]

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer',
        'hover:bg-muted/40 transition-colors duration-150 group select-none',
        isNew && 'animate-in slide-in-from-top-2 duration-300',
      )}
      onClick={() => onClick(event)}
      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') onClick(event) }}
    >
      {/* Severity dot */}
      <span
        className={cn('h-2 w-2 rounded-full flex-shrink-0', sevColors.dot)}
        aria-label={event.severity}
      />

      {/* Event type icon */}
      <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

      {/* Title */}
      <span className="flex-1 text-xs text-foreground truncate min-w-0">{event.title}</span>

      {/* Time ago */}
      <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
        {timeAgo(event.timestamp)}
      </span>

      {/* Workspace badge */}
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] px-1.5 py-0 h-4 flex-shrink-0 border-0',
          wsMeta.bg, wsMeta.color,
        )}
      >
        {wsMeta.label}
      </Badge>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ActivityFeed({
  maxItems    = 20,
  showHeader  = true,
  onEventClick,
  autoRefresh: _autoRefresh = true,
  refetchMs:   _refetchMs   = 15_000,
}: ActivityFeedProps) {
  const navigate = useNavigate()
  const { events, isLoading, lastUpdated } = useActivityStream()

  // Sort by timestamp descending, take first maxItems
  const displayEvents = useMemo(
    () =>
      [...events]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, maxItems),
    [events, maxItems],
  )

  // ── New item detection ─────────────────────────────────────────────────────

  const prevIdsRef = useRef<Set<string>>(new Set())

  const newIds = useMemo(() => {
    const s = new Set(
      displayEvents
        .map(e => e.id)
        .filter(id => !prevIdsRef.current.has(id)),
    )
    return s
  }, [displayEvents])

  useEffect(() => {
    prevIdsRef.current = new Set(displayEvents.map(e => e.id))
  }, [displayEvents])

  // ── Row click handler ──────────────────────────────────────────────────────

  function handleClick(event: OperationalActivityEvent): void {
    if (onEventClick) {
      onEventClick(event)
      return
    }
    const firstLink = event.actionLinks?.[0]
    if (firstLink) {
      navigate(firstLink.route)
    }
  }

  // ── Last updated label ─────────────────────────────────────────────────────

  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="rounded-xl border border-border bg-card flex flex-col">
      {/* Header */}
      {showHeader && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground flex-1">Live Activity</span>
          {/* Pulsing live indicator */}
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-success/40 text-success bg-success/10">
              LIVE
            </Badge>
          </span>
          {lastUpdatedLabel && (
            <span className="text-[10px] text-muted-foreground">{lastUpdatedLabel}</span>
          )}
        </div>
      )}

      {/* Feed list */}
      <div className="flex flex-col py-1.5 flex-1 min-h-0 overflow-y-auto">
        {isLoading && displayEvents.length === 0 ? (
          <div className="flex flex-col gap-1.5 px-3 py-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No activity events yet
          </div>
        ) : (
          displayEvents.map(event => (
            <FeedItem
              key={event.id}
              event={event}
              isNew={newIds.has(event.id)}
              onClick={handleClick}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-4 py-2.5">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          onClick={() => navigate('/operations/timeline')}
        >
          See all in Operations Timeline
        </button>
      </div>
    </div>
  )
}
