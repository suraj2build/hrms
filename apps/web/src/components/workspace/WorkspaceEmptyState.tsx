/**
 * WorkspaceEmptyState — standardized empty state component.
 *
 * Provides a centred icon, title, description, primary CTA, and optional
 * secondary ghost action. A compact variant is available for use inside
 * table cells or small content areas.
 */

import * as React from 'react'
import { Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceEmptyStateAction {
  label:   string
  onClick: () => void
  icon?:   React.ReactNode
}

export interface WorkspaceEmptyStateSecondaryAction {
  label:   string
  onClick: () => void
}

export interface WorkspaceEmptyStateProps {
  icon?:            React.ReactNode
  title:            string
  description?:     string
  action?:          WorkspaceEmptyStateAction
  secondaryAction?: WorkspaceEmptyStateSecondaryAction
  compact?:         boolean
  className?:       string
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspaceEmptyState = React.memo(function WorkspaceEmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact   = false,
  className,
}: WorkspaceEmptyStateProps) {
  const defaultIcon = (
    <Inbox
      className={cn(
        'text-muted-foreground/50',
        compact ? 'w-5 h-5' : 'w-10 h-10',
      )}
      aria-hidden="true"
    />
  )

  const renderedIcon = icon ?? defaultIcon

  return (
    <div
      role="status"
      aria-label={title}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6 px-4' : 'py-16 px-6',
        className,
      )}
    >
      {/* Icon container */}
      <div
        aria-hidden="true"
        className={cn(
          'rounded-full bg-muted flex items-center justify-center flex-shrink-0',
          compact ? 'p-2 mb-2' : 'p-3 mb-4',
        )}
      >
        {renderedIcon}
      </div>

      {/* Title */}
      <h3
        className={cn(
          'font-medium text-foreground leading-snug',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-xs text-center leading-relaxed',
            compact ? 'text-[10px] mt-1' : 'text-xs mt-1.5',
          )}
        >
          {description}
        </p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div
          className={cn(
            'flex items-center gap-2 flex-wrap justify-center',
            compact ? 'mt-3' : 'mt-5',
          )}
        >
          {action && (
            <Button
              size="sm"
              variant="default"
              onClick={action.onClick}
              aria-label={action.label}
            >
              {action.icon && (
                <span
                  aria-hidden="true"
                  className="[&_svg]:h-3.5 [&_svg]:w-3.5 mr-1"
                >
                  {action.icon}
                </span>
              )}
              {action.label}
            </Button>
          )}

          {secondaryAction && (
            <Button
              size="sm"
              variant="ghost"
              onClick={secondaryAction.onClick}
              aria-label={secondaryAction.label}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
})

WorkspaceEmptyState.displayName = 'WorkspaceEmptyState'
