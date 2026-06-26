/**
 * SignalCard — a single "what needs you" card on an Experience Cloud surface.
 *
 * The first reusable surface primitive of the Employee Operating System
 * (EXPERIENCE_CLOUD_UX_BLUEPRINT.md §2). A Signal is data; this renders it as a
 * calm, actionable card — icon by type, accent by severity, a contextual action.
 * Home composes a ranked array of these; future surfaces reuse the same card.
 *
 * It carries no business logic and no per-type branching beyond presentation —
 * new signal types render with zero changes here (Manifesto §IV.2: compose,
 * don't accumulate).
 */

import * as React from 'react'
import {
  Clock, Inbox, ClipboardList, FileText, CalendarCheck, Bell, ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SignalSeverity = 'info' | 'warning' | 'critical'
export type SignalType = 'attendance' | 'approvals' | 'requests' | 'documents' | 'leave'

export interface Signal {
  id:       string
  type:     SignalType
  severity: SignalSeverity
  priority: number
  title:    string
  body?:    string
  action?:  { label: string; href: string }
}

const ICON: Record<SignalType, React.ComponentType<{ className?: string }>> = {
  attendance: Clock,
  approvals:  Inbox,
  requests:   ClipboardList,
  documents:  FileText,
  leave:      CalendarCheck,
}

// Token-based accents — no hardcoded hex (Manifesto §IV.7 / one visual system).
const ACCENT: Record<SignalSeverity, { card: string; icon: string }> = {
  critical: { card: 'border-destructive/30 bg-destructive/5', icon: 'bg-destructive/10 text-destructive' },
  warning:  { card: 'border-warning/30 bg-warning/5',         icon: 'bg-warning/10 text-warning' },
  info:     { card: 'border-border bg-card',                  icon: 'bg-primary/10 text-primary' },
}

export interface SignalCardProps {
  signal: Signal
  /** Navigate handler — receives the signal's action.href (a path). */
  onAction?: (href: string) => void
  className?: string
}

export function SignalCard({ signal, onAction, className }: SignalCardProps) {
  const Icon = ICON[signal.type] ?? Bell
  const accent = ACCENT[signal.severity] ?? ACCENT.info

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-3.5 shadow-sm', accent.card, className)}>
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', accent.icon)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{signal.title}</p>
        {signal.body && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{signal.body}</p>}
      </div>
      {signal.action && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => onAction?.(signal.action!.href)}
        >
          {signal.action.label}
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
