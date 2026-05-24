/**
 * WorkspaceCommandHeader
 *
 * A reusable horizontal operational metrics strip that sits between the
 * workspace title and the tab bar. Each workspace supplies its own metrics
 * and optional alert banner.
 *
 * Layout:
 *   [alert banner? (full-width, critical severity only)]
 *   [metric chips row — scrollable on narrow screens]
 */

import { type ReactNode } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CommandAlert {
  /** Short alert message */
  message:   string
  /** Actionable label for the CTA */
  actionLabel?: string
  onAction?:    () => void
  severity:     'critical' | 'warning'
}

export interface WorkspaceCommandHeaderProps {
  /** Metric chips rendered horizontally */
  metrics:     ReactNode
  /** Optional critical/warning banner above the chips */
  alert?:      CommandAlert
  /** Extra class on the outer wrapper */
  className?:  string
  /** Whether the header is in loading state */
  loading?:    boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceCommandHeader({
  metrics,
  alert,
  className,
  loading = false,
}: WorkspaceCommandHeaderProps) {
  const [alertDismissed, setAlertDismissed] = useState(false)
  const showAlert = alert && !alertDismissed

  return (
    <div className={cn('border-b border-border/60 bg-sidebar/30', className)}>

      {/* Critical / warning alert banner */}
      {showAlert && (
        <div className={cn(
          'flex items-center gap-2 px-6 py-1.5 text-[12px] font-medium',
          alert.severity === 'critical'
            ? 'bg-destructive/10 text-destructive border-b border-destructive/15'
            : 'bg-warning/10 text-warning border-b border-warning/15',
        )}>
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">{alert.message}</span>
          {alert.actionLabel && alert.onAction && (
            <button
              type="button"
              onClick={alert.onAction}
              className="underline underline-offset-2 hover:opacity-70 transition-opacity"
            >
              {alert.actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAlertDismissed(true)}
            className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Metrics strip */}
      <div className={cn(
        'flex items-center gap-2 px-6 py-2 overflow-x-auto scrollbar-none',
        loading && 'opacity-60 pointer-events-none',
      )}>
        {metrics}
      </div>
    </div>
  )
}
