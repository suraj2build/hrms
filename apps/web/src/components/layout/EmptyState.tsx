/**
 * EmptyState — lightweight empty state for operational tables and panels.
 *
 * Keeps it operational and minimal — no illustrations, no marketing copy.
 *
 * Usage:
 *   <EmptyState
 *     icon={ClipboardCheck}
 *     title="No corrections found"
 *     description="Adjust filters or check back later."
 *     action={<Button size="sm" variant="outline">Clear filters</Button>}
 *   />
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** Lucide icon component */
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  /** Optional action button */
  action?: React.ReactNode
  className?: string
  /** Reduce vertical padding for inline use (e.g. inside table cells) */
  compact?: boolean
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-14 px-6',
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground/70">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-[26rem]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
