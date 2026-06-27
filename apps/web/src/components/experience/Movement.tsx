/**
 * Movement — one beat of a surface's vertical spine in Visual Language v2.
 *
 * Replaces the bordered card with air + light: a quiet uppercase eyebrow over
 * borderless content, entering with the signature rise (staggered down the spine,
 * premium easing). Motion is honoured only when allowed (the `.atmo-rise` rule lives
 * inside a prefers-reduced-motion: no-preference media query). Content floats on the
 * tinted canvas; depth comes from light, never borders.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface MovementProps {
  eyebrow?: string
  action?: { label: string; onClick: () => void }
  index?: number
  children: React.ReactNode
  className?: string
}

export function Movement({ eyebrow, action, index = 0, children, className }: MovementProps) {
  return (
    <section
      className={cn('atmo-rise', className)}
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
    >
      {(eyebrow || action) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>}
          {action && (
            <button
              onClick={action.onClick}
              className="rounded-md text-[12px] font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  )
}
