/**
 * SmartEscalation — Phase UX-4
 *
 * Detects critical unresolved operational items that have exceeded their SLA
 * thresholds and surfaces them with quick-action buttons.
 *
 * Rules:
 *   - missing_punch:     > 48 h unresolved → critical
 *   - payroll_blocker:   any open          → high
 *   - fatigue_risk:      any open          → high
 *   - compliance_alert:  any open          → critical
 *
 * Supports two render modes:
 *   compact=false (default): full escalation card list
 *   compact=true:            single clickable badge (count or "All clear")
 *
 * Auto-refreshes via useActivityStream's 30-second polling.
 */

import { useState, useRef, useMemo } from 'react'
import { useNavigate }               from 'react-router-dom'
import { AlertTriangle, CheckCircle2, User, Clock } from 'lucide-react'
import { cn }                        from '@/lib/utils'
import { Button }                    from '@/components/ui/button'
import { useActivityStream }         from '@/lib/activity/useActivityStream'
import {
  SEVERITY_COLORS,
} from '@/lib/activity/types'
import type { EscalatedItem, EventSeverity } from '@/lib/activity/types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface SmartEscalationProps {
  compact?:  boolean
  onAction?: (item: EscalatedItem) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HOURS_48 = 48 * 60 * 60 * 1000

const ESCALATED_TYPES = new Set([
  'missing_punch',
  'payroll_blocker',
  'fatigue_risk',
  'compliance_alert',
])

// ── Hours badge helpers ────────────────────────────────────────────────────────

function HoursOpenBadge({ hoursOpen }: { hoursOpen: number }) {
  const colorClass =
    hoursOpen > 72 ? 'bg-destructive/15 text-destructive border-destructive/30' :
    hoursOpen > 24 ? 'bg-warning/15 text-warning border-warning/30' :
                     'bg-muted text-muted-foreground border-border'

  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium flex-shrink-0',
      colorClass,
    )}>
      <Clock className="h-2.5 w-2.5" />
      {hoursOpen}h open
    </span>
  )
}

// ── Single escalation card ─────────────────────────────────────────────────────

interface EscalationCardProps {
  item:      EscalatedItem
  onDismiss: (id: string) => void
  onAction?: (item: EscalatedItem) => void
}

function EscalationCard({ item, onDismiss, onAction }: EscalationCardProps) {
  const navigate   = useNavigate()
  const sevColors  = SEVERITY_COLORS[item.severity]

  function handleAction() {
    navigate(item.actionRoute)
    onAction?.(item)
  }

  return (
    <div className={cn(
      'relative rounded-lg border overflow-hidden',
      sevColors.border,
    )}>
      {/* Left severity bar */}
      <div
        className="absolute inset-y-0 left-0 w-0.5"
        style={{ backgroundColor: sevColors.bar }}
        aria-hidden="true"
      />

      <div className={cn('pl-3 pr-3 py-3', sevColors.bg)}>
        {/* Header row */}
        <div className="flex items-start gap-2">
          {/* Icon */}
          <AlertTriangle className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', sevColors.text)} />

          {/* Title + badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className={cn('text-xs font-semibold leading-snug', sevColors.text)}>
                {item.title}
              </p>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <HoursOpenBadge hoursOpen={item.hoursOpen} />
                {/* Dismiss button */}
                <button
                  type="button"
                  onClick={() => onDismiss(item.id)}
                  className={cn(
                    'rounded p-0.5 transition-colors',
                    sevColors.text,
                    'opacity-50 hover:opacity-100',
                  )}
                  aria-label="Dismiss escalation"
                >
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 1l10 10M11 1L1 11" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Employee name chip */}
            {item.employeeName && (
              <span className={cn(
                'inline-flex items-center gap-1 mt-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border',
                'bg-background/50',
                sevColors.border, sevColors.text,
              )}>
                <User className="h-2.5 w-2.5" />
                {item.employeeName}
              </span>
            )}
          </div>
        </div>

        {/* Action row */}
        <div className="mt-2.5 flex items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2.5"
            onClick={handleAction}
          >
            Resolve →
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SmartEscalation({ compact = false, onAction }: SmartEscalationProps) {
  const { allEvents } = useActivityStream()

  // ── Per-session dismissal ──────────────────────────────────────────────────

  const dismissedRef = useRef<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  function dismiss(id: string) {
    dismissedRef.current.add(id)
    setDismissed(prev => new Set([...prev, id]))
  }

  // ── Derive escalated items ─────────────────────────────────────────────────

  const escalatedItems = useMemo((): EscalatedItem[] => {
    const now = Date.now()

    return allEvents
      .filter(e => {
        if (e.status === 'resolved' || e.status === 'dismissed') return false
        if (!ESCALATED_TYPES.has(e.type)) return false
        if (e.type === 'missing_punch') {
          return (now - new Date(e.timestamp).getTime()) > HOURS_48
        }
        return true
      })
      .map(e => {
        const hoursOpen = Math.floor(
          (now - new Date(e.timestamp).getTime()) / (60 * 60 * 1000),
        )
        const severity: EventSeverity =
          e.type === 'missing_punch' || e.type === 'compliance_alert'
            ? 'critical'
            : 'high'

        return {
          id:           e.id,
          type:         e.type as EscalatedItem['type'],
          employeeId:   e.employeeId,
          employeeName: e.employeeName,
          since:        e.timestamp,
          hoursOpen,
          severity,
          title:        e.title,
          actionRoute:  e.actionLinks?.[0]?.route ?? '/admin/attendance/anomalies',
        }
      })
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
        return b.hoursOpen - a.hoursOpen
      })
  }, [allEvents])

  const visibleItems = escalatedItems.filter(i => !dismissed.has(i.id))

  // ── Compact mode ───────────────────────────────────────────────────────────

  if (compact) {
    return (
      <button
        type="button"
        className={cn(
          'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors',
          visibleItems.length > 0
            ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
            : 'bg-success/10 text-success border-success/20',
        )}
        aria-label={
          visibleItems.length > 0
            ? `${visibleItems.length} escalated items require attention`
            : 'No escalations'
        }
      >
        <AlertTriangle className="h-3 w-3" />
        {visibleItems.length > 0 ? `${visibleItems.length} escalated` : 'All clear'}
      </button>
    )
  }

  // ── Full mode ──────────────────────────────────────────────────────────────

  // All-clear banner
  if (visibleItems.length === 0) {
    return (
      <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-3 flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
        <span className="text-sm text-success font-medium">No escalations — all clear</span>
      </div>
    )
  }

  // Escalation list
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        <span className="text-sm font-semibold text-foreground">Escalations</span>
        <span
          className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-destructive text-[10px] text-white font-bold leading-none"
          aria-live="polite"
          aria-label={`${visibleItems.length} escalated items`}
        >
          {visibleItems.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {visibleItems.map(item => (
          <EscalationCard
            key={item.id}
            item={item}
            onDismiss={dismiss}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  )
}
