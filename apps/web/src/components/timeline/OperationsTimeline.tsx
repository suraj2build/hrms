/**
 * OperationsTimeline.tsx — Phase UX-4
 *
 * Full-featured operational event timeline: grouped by time bucket, severity-coded,
 * searchable, filterable, with expandable detail, "What Changed?" diffs, action CTAs,
 * and 30-second live polling via useActivityStream.
 */
import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Clock,
  ClipboardList,
  CheckCircle2,
  XCircle,
  CalendarDays,
  CalendarCheck,
  CalendarX,
  Lock,
  ShieldAlert,
  Calendar,
  Zap,
  TrendingUp,
  Activity,
  Settings,
  Bell,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  User2,
  Search,
} from 'lucide-react'
import { cn }    from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge }  from '@/components/ui/badge'
import { UnifiedEventFilter } from '@/components/filters/UnifiedEventFilter'
import { useActivityStream }  from '@/lib/activity/useActivityStream'
import {
  SEVERITY_COLORS,
  STATUS_META,
  WORKSPACE_META,
  type EventFilters,
  type EventType,
  type OperationalActivityEvent,
} from '@/lib/activity/types'

// ── Icon map ──────────────────────────────────────────────────────────────────

const EVENT_TYPE_ICONS: Partial<Record<EventType, React.ComponentType<{ className?: string }>>> = {
  attendance_anomaly: AlertTriangle,
  missing_punch:      Clock,
  late_arrival:       Clock,
  early_departure:    Clock,
  approval_pending:   ClipboardList,
  approval_approved:  CheckCircle2,
  approval_rejected:  XCircle,
  roster_change:      CalendarDays,
  shift_assigned:     CalendarCheck,
  shift_unassigned:   CalendarX,
  payroll_lock:       Lock,
  payroll_blocker:    ShieldAlert,
  payroll_processed:  CheckCircle2,
  leave_approval:     CalendarCheck,
  leave_rejection:    XCircle,
  leave_pending:      Calendar,
  fatigue_risk:       Zap,
  ot_spike:           TrendingUp,
  compliance_alert:   ShieldAlert,
  workflow_action:    Activity,
  system_event:       Settings,
}

// ── Time grouping ─────────────────────────────────────────────────────────────

type TimeGroup = 'Today' | 'Yesterday' | 'This Week' | 'Earlier'

function getTimeGroup(iso: string): TimeGroup {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay())
  const d = new Date(iso)
  if (d >= today)     return 'Today'
  if (d >= yesterday) return 'Yesterday'
  if (d >= weekStart) return 'This Week'
  return 'Earlier'
}

const GROUP_ORDER: TimeGroup[] = ['Today', 'Yesterday', 'This Week', 'Earlier']

// ── timeAgo helper ────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)  return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

// ── TimelineEventItem ─────────────────────────────────────────────────────────

interface TimelineEventItemProps {
  event:           OperationalActivityEvent
  onEmployeeClick?: (id: string, name: string) => void
}

function TimelineEventItem({ event, onEmployeeClick }: TimelineEventItemProps) {
  const [expandedInfo, setExpandedInfo] = useState(false)
  const navigate = useNavigate()

  const IconComponent = EVENT_TYPE_ICONS[event.type] ?? Activity
  const severityColors = SEVERITY_COLORS[event.severity]
  const workspaceMeta  = WORKSPACE_META[event.workspace]
  const statusMeta     = STATUS_META[event.status]

  const handleItemClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't toggle expand when clicking action buttons or employee chip
      const target = e.target as HTMLElement
      if (target.closest('[data-action]')) return
      setExpandedInfo((p) => !p)
    },
    [],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setExpandedInfo((p) => !p)
      }
    },
    [],
  )

  return (
    <article
      role="article"
      aria-label={event.title}
      tabIndex={0}
      onClick={handleItemClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex gap-3 pl-3 pr-4 py-3 cursor-pointer',
        'border-b border-border/50 last:border-0',
        'hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/30',
        'transition-colors',
      )}
    >
      {/* Severity bar */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r"
        style={{ backgroundColor: severityColors.bar }}
      />

      {/* Icon */}
      <div
        className={cn(
          'shrink-0 mt-0.5 flex items-center justify-center w-7 h-7 rounded-full',
          severityColors.bg,
        )}
      >
        <IconComponent className={cn('h-3.5 w-3.5', severityColors.text)} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0 space-y-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-medium text-foreground leading-snug truncate">
              {event.title}
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
                workspaceMeta.bg, workspaceMeta.color,
              )}
            >
              {workspaceMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn('text-[11px] font-medium', statusMeta.color)}>
              {statusMeta.label}
            </span>
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {timeAgo(event.timestamp)}
            </span>
            <span aria-hidden className="text-muted-foreground/40">
              {expandedInfo ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
          </div>
        </div>

        {/* Description — only when expanded */}
        {expandedInfo && event.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {event.description}
          </p>
        )}

        {/* What Changed? — only when expanded and change exists */}
        {expandedInfo && event.change && (
          <div className="mt-2 p-2.5 rounded-md bg-muted/50 border border-border/60 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              What Changed?
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-medium text-foreground capitalize">
                {event.change.field.replace(/_/g, ' ')}:
              </span>
              <span className="text-destructive line-through opacity-70">
                {String(event.change.oldValue ?? '—')}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-foreground font-medium">
                {String(event.change.newValue ?? '—')}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              by{' '}
              <span className="font-medium text-foreground">
                {event.change.changedBy}
              </span>{' '}
              at {new Date(event.change.changedAt).toLocaleString('en-IN', {
                day:    '2-digit',
                month:  'short',
                year:   'numeric',
                hour:   '2-digit',
                minute: '2-digit',
              })}
            </p>
            {event.change.reason && (
              <p className="text-[11px] text-muted-foreground italic">
                Reason: {event.change.reason}
              </p>
            )}
          </div>
        )}

        {/* Metadata — only when expanded */}
        {expandedInfo && event.metadata && Object.keys(event.metadata).length > 0 && (
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
            {Object.entries(event.metadata).map(([k, v]) =>
              v != null ? (
                <div key={k} className="flex items-center gap-1 text-[11px]">
                  <span className="text-muted-foreground capitalize">
                    {k.replace(/_/g, ' ')}:
                  </span>
                  <span className="text-foreground truncate">{String(v)}</span>
                </div>
              ) : null,
            )}
          </div>
        )}

        {/* Bottom row: action links + employee chip */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {/* Action links — always visible */}
          {event.actionLinks && event.actionLinks.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap" data-action="true">
              {event.actionLinks.map((link) => (
                <Button
                  key={link.route + link.label}
                  type="button"
                  variant={link.variant === 'destructive' ? 'destructive' : 'ghost'}
                  size="sm"
                  data-action="true"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(link.route)
                  }}
                  className="h-6 px-2 text-[11px]"
                >
                  {link.label}
                </Button>
              ))}
            </div>
          )}

          {/* Employee chip */}
          {event.employeeName && (
            <button
              type="button"
              data-action="true"
              aria-label={`View employee ${event.employeeName}`}
              onClick={(e) => {
                e.stopPropagation()
                if (onEmployeeClick && event.employeeId) {
                  onEmployeeClick(event.employeeId, event.employeeName!)
                }
              }}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
                'text-[11px] font-medium border border-border bg-muted/50',
                'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
                onEmployeeClick && event.employeeId ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <User2 className="h-3 w-3 shrink-0" />
              {event.employeeName}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface OperationsTimelineProps {
  initialFilters?:  EventFilters
  compact?:         boolean
  maxHeight?:       string
  onEmployeeClick?: (employeeId: string, employeeName: string) => void
}

// ── Main component ────────────────────────────────────────────────────────────

export function OperationsTimeline({
  initialFilters,
  compact       = false,
  maxHeight     = '100%',
  onEmployeeClick,
}: OperationsTimelineProps) {
  const [filters, setFilters] = useState<EventFilters>(initialFilters ?? {})

  const { events, allEvents, isLoading, lastUpdated, refresh } = useActivityStream(filters)

  const containerRef = useRef<HTMLDivElement>(null)

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const items = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>('[role="article"]'),
    )
    const focused = document.activeElement as HTMLElement | null
    const idx     = focused ? items.indexOf(focused) : -1

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[idx + 1]
      if (next) next.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = items[idx - 1]
      if (prev) prev.focus()
    }
  }, [])

  // ── Group events ──────────────────────────────────────────────────────────

  const grouped = new Map<TimeGroup, OperationalActivityEvent[]>()
  for (const group of GROUP_ORDER) grouped.set(group, [])
  for (const ev of events) {
    const g = getTimeGroup(ev.timestamp)
    grouped.get(g)!.push(ev)
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const criticalCount = allEvents.filter((e) => e.severity === 'critical').length
  const openCount     = allEvents.filter((e) => e.status   === 'open').length

  // ── Last updated label ────────────────────────────────────────────────────

  const lastUpdatedLabel = lastUpdated ? timeAgo(lastUpdated.toISOString()) : 'never'

  // ── Compact render ────────────────────────────────────────────────────────

  if (compact) {
    return (
      <div
        ref={containerRef}
        role="feed"
        aria-label="Operations Timeline"
        aria-busy={isLoading}
        onKeyDown={handleContainerKeyDown}
        className="overflow-y-auto"
        style={{ maxHeight }}
      >
        {isLoading && events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Search className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">No events found</p>
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const groupEvents = grouped.get(group)!
            if (!groupEvents.length) return null
            return (
              <div key={group}>
                <div
                  role="heading"
                  aria-level={3}
                  className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border/50"
                >
                  <span className="text-xs font-semibold text-muted-foreground">{group}</span>
                  <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                    {groupEvents.length}
                  </span>
                </div>
                {groupEvents.map((ev) => (
                  <TimelineEventItem
                    key={ev.id}
                    event={ev}
                    onEmployeeClick={onEmployeeClick}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>
    )
  }

  // ── Full render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <Bell className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground flex-1">
          Operations Timeline
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-bold uppercase tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          LIVE
        </span>
        {lastUpdated && (
          <span className="text-[11px] text-muted-foreground">
            Updated {lastUpdatedLabel}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={refresh}
          aria-label="Refresh timeline"
          className="h-7 w-7 shrink-0"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <UnifiedEventFilter
          filters={filters}
          onChange={setFilters}
          compact
        />
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 shrink-0 bg-muted/20">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{allEvents.length}</span>
          total events
        </div>
        {criticalCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            <span className="font-medium text-destructive">{criticalCount}</span>
            <span className="text-muted-foreground">critical</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-orange-600">{openCount}</span>
          open
        </div>
        {events.length !== allEvents.length && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
            Showing{' '}
            <span className="font-medium text-foreground">{events.length}</span>
            {' '}of{' '}
            <span className="font-medium text-foreground">{allEvents.length}</span>
          </div>
        )}
      </div>

      {/* Scroll container */}
      <div
        ref={containerRef}
        role="feed"
        aria-label="Operations Timeline"
        aria-busy={isLoading}
        onKeyDown={handleContainerKeyDown}
        className="flex-1 overflow-y-auto min-h-0"
        style={{ maxHeight }}
      >
        {isLoading && events.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-10 w-10 mb-3 opacity-25" />
            <p className="text-sm font-medium">No events match your filters</p>
            <p className="text-xs mt-1 opacity-60">Try adjusting or clearing your filters</p>
          </div>
        ) : (
          GROUP_ORDER.map((group) => {
            const groupEvents = grouped.get(group)!
            if (!groupEvents.length) return null
            return (
              <div key={group}>
                {/* Group header — sticky */}
                <div
                  role="heading"
                  aria-level={3}
                  className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border/50"
                >
                  <span className="text-xs font-semibold text-muted-foreground">
                    {group}
                  </span>
                  <Badge
                    variant="secondary"
                    className="h-4 min-w-[18px] px-1.5 text-[10px] font-bold"
                  >
                    {groupEvents.length}
                  </Badge>
                </div>

                {/* Events */}
                {groupEvents.map((ev) => (
                  <TimelineEventItem
                    key={ev.id}
                    event={ev}
                    onEmployeeClick={onEmployeeClick}
                  />
                ))}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border/50 shrink-0 bg-muted/10">
        <p className="text-[11px] text-muted-foreground">
          Showing{' '}
          <span className="font-medium text-foreground">{events.length}</span> of{' '}
          <span className="font-medium text-foreground">{allEvents.length}</span>{' '}
          events &middot; Updated {lastUpdatedLabel}
        </p>
      </div>
    </div>
  )
}
