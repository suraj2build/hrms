/**
 * LoadingState — the single canonical loading placeholder for sections/panels.
 *
 * Part of the one-state-system mandated by EXPERIENCE_CLOUD_UX_BLUEPRINT.md §12.
 * Pairs with EmptyState and ErrorState so every surface renders the three states
 * identically. Skeleton-based (no spinner-text) so the layout doesn't jump when
 * data arrives.
 *
 * Usage:
 *   if (isLoading) return <LoadingState rows={3} />
 *   <LoadingState label="Loading your day…" />   // optional caption
 */

import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface LoadingStateProps {
  /** Number of skeleton rows to render. */
  rows?: number
  /** Optional caption shown above the skeleton (use sparingly). */
  label?: string
  /** Reduce vertical padding for inline use. */
  compact?: boolean
  className?: string
}

export function LoadingState({ rows = 3, label, compact = false, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(compact ? 'py-4' : 'py-6', className)}
    >
      {label && <p className="mb-3 text-xs text-muted-foreground">{label}</p>}
      <div className="space-y-2.5">
        {Array.from({ length: Math.max(1, rows) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 flex-shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}
