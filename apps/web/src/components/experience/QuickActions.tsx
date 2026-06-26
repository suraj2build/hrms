/**
 * QuickActions — the reusable "what should I do next" block.
 *
 * Surface primitive (EXPERIENCE_CLOUD_UX_BLUEPRINT.md §2.2). Renders an ordered
 * list of *capabilities* — not a hard-coded menu. Each capability is data
 * (label, icon, href, optional badge, optional emphasis), so the surface that
 * mounts this block decides the context-aware action set; the block itself has
 * no per-action logic (Manifesto §IV.2: compose, don't accumulate).
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Capability {
  id:      string
  label:   string
  icon:    React.ComponentType<{ className?: string }>
  href:    string
  /** Optional count badge (e.g. pending items). */
  badge?:  number
  /** Visually promote this action (e.g. the most relevant next step). */
  primary?: boolean
}

export interface QuickActionsProps {
  capabilities: Capability[]
  /** Navigate handler — receives the capability's href. */
  onAction: (href: string) => void
  className?: string
}

export function QuickActions({ capabilities, onAction, className }: QuickActionsProps) {
  if (capabilities.length === 0) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {capabilities.map((c) => {
        const Icon = c.icon
        return (
          <button
            key={c.id}
            onClick={() => onAction(c.href)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-sm transition-colors',
              c.primary
                ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                : 'border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent/40',
            )}
          >
            <Icon className={cn('h-4 w-4', c.primary ? 'text-primary' : 'text-primary')} />
            {c.label}
            {c.badge != null && c.badge > 0 && (
              <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {c.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
