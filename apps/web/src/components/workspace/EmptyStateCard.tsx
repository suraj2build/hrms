/**
 * EmptyStateCard — enhanced empty state with module description, next-step hint,
 * a primary CTA, and an optional secondary action.
 *
 * Supports a compact variant for smaller content areas.
 */

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EmptyStateCardProps {
  icon?:            React.ComponentType<{ className?: string }>
  title:            string
  /** 1–2 sentence description of what this module does */
  what?:            string
  /** Recommended next action text (rendered as "Next step: …") */
  nextAction?:      string
  ctaLabel?:        string
  onCta?:           () => void
  ctaIcon?:         React.ReactNode
  /** Secondary softer link action */
  secondaryLabel?:  string
  onSecondary?:     () => void
  /** Compact variant for smaller content areas */
  compact?:         boolean
  className?:       string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EmptyStateCard({
  icon:   Icon,
  title,
  what,
  nextAction,
  ctaLabel,
  onCta,
  ctaIcon,
  secondaryLabel,
  onSecondary,
  compact  = false,
  className,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className,
      )}
    >
      {/* Icon circle */}
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full bg-muted/40 flex-shrink-0 mb-4',
            compact ? 'h-10 w-10' : 'h-14 w-14',
          )}
        >
          <Icon
            className={cn(
              'text-muted-foreground',
              compact ? 'h-5 w-5' : 'h-7 w-7',
            )}
          />
        </div>
      )}

      {/* Title */}
      <h3
        className={cn(
          'font-semibold text-foreground leading-snug',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
        {title}
      </h3>

      {/* What this module does */}
      {what && (
        <p
          className={cn(
            'mt-1.5 italic text-muted-foreground max-w-sm leading-relaxed',
            compact ? 'text-[10px]' : 'text-xs',
          )}
        >
          {what}
        </p>
      )}

      {/* Next step hint */}
      {nextAction && (
        <p className="mt-2 flex items-baseline gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-medium">
            Next step:
          </span>
          <span className="text-[11px] text-muted-foreground">
            {nextAction}
          </span>
        </p>
      )}

      {/* Actions */}
      {(ctaLabel || secondaryLabel) && (
        <div className={cn('flex items-center gap-2 flex-wrap justify-center', compact ? 'mt-3' : 'mt-5')}>
          {ctaLabel && onCta && (
            <Button size="sm" onClick={onCta}>
              {ctaIcon && (
                <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">
                  {ctaIcon}
                </span>
              )}
              {ctaLabel}
            </Button>
          )}

          {secondaryLabel && onSecondary && (
            <Button size="sm" variant="ghost" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
