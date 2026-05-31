/**
 * StatusBadge — unified status badge component.
 *
 * Uses design-token status colours to render a pill badge with an optional
 * coloured dot prefix. Supports two sizes (sm / md).
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { TOKENS } from '@/lib/design-tokens'
import type { StatusVariant } from '@/lib/design-tokens'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StatusBadgeProps {
  variant:    StatusVariant
  label:      string
  dot?:       boolean
  size?:      'sm' | 'md'
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export const StatusBadge = React.memo(function StatusBadge({
  variant,
  label,
  dot      = false,
  size     = 'sm',
  className,
}: StatusBadgeProps) {
  const tokens = TOKENS.status[variant]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        tokens.bg,
        tokens.text,
        tokens.border,
        size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1',
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full mr-1.5 flex-shrink-0',
            tokens.dot,
          )}
        />
      )}
      {label}
    </span>
  )
})

StatusBadge.displayName = 'StatusBadge'
