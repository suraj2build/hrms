/**
 * FocusPanel — the Focus pattern (§3.1): open a surface with one confident,
 * human statement of what matters most, on a faint navy→teal wash. One eyebrow,
 * one big sentence, at most one action. Never a wall of options. On Timeline the
 * Focus orients (the journey framing) and carries no action.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface FocusPanelProps {
  eyebrow: string
  sentence: string
  action?: { label: string; href: string }
  onAction?: (href: string) => void
  className?: string
}

export function FocusPanel({ eyebrow, sentence, action, onAction, className }: FocusPanelProps) {
  return (
    <div className={cn('rounded-2xl bg-gradient-to-br from-primary/[0.06] to-brand-teal/[0.06] p-6', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      <h1 className="mt-2 text-[1.6rem] font-semibold leading-snug text-foreground">{sentence}</h1>
      {action && (
        <button
          onClick={() => onAction?.(action.href)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {action.label} →
        </button>
      )}
    </div>
  )
}
