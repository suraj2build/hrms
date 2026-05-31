/**
 * WorkspaceSkeleton — loading skeleton for workspace content areas.
 *
 * Variants:
 *   table    — header + row lines of varying widths
 *   cards    — grid of rounded rectangles
 *   kpi      — row of small metric boxes
 *   calendar — 7-column grid of small squares
 *   list     — rows of single-line widths
 */

import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceSkeletonProps {
  variant?:   'table' | 'cards' | 'kpi' | 'calendar' | 'list'
  /** Number of rows (table / list) */
  rows?:      number
  /** Number of columns (cards / kpi) */
  cols?:      number
  className?: string
}

// ── Width cycles for visual variety ───────────────────────────────────────────

const ROW_WIDTHS  = ['w-32', 'w-24', 'w-40', 'w-20', 'w-36', 'w-28'] as const
const HEAD_WIDTHS = ['w-20', 'w-28', 'w-16'] as const

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceSkeleton({
  variant   = 'table',
  rows      = 5,
  cols      = 4,
  className,
}: WorkspaceSkeletonProps) {
  switch (variant) {
    case 'table':   return <TableSkeleton rows={rows} className={className} />
    case 'cards':   return <CardsSkeleton cols={cols} className={className} />
    case 'kpi':     return <KpiSkeleton   cols={cols} className={className} />
    case 'calendar':return <CalendarSkeleton         className={className} />
    case 'list':    return <ListSkeleton   rows={rows} className={className} />
    default:        return null
  }
}

// ── Table skeleton ─────────────────────────────────────────────────────────────

function TableSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn('w-full space-y-0', className)} aria-hidden="true">
      {/* Header row */}
      <div className="flex items-center gap-4 border-b border-border pb-2.5 mb-2">
        {HEAD_WIDTHS.map((w, i) => (
          <div key={i} className={cn('h-3 rounded bg-muted animate-pulse', w)} />
        ))}
        <div className="ml-auto h-3 w-12 rounded bg-muted animate-pulse" />
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={ri}
          className="flex items-center gap-4 border-b border-border/40 py-3"
        >
          {/* Checkbox placeholder */}
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse flex-shrink-0" />
          {/* Varying-width cells */}
          {Array.from({ length: 4 }).map((__, ci) => (
            <div
              key={ci}
              className={cn(
                'h-3 rounded bg-muted animate-pulse',
                ROW_WIDTHS[(ri + ci) % ROW_WIDTHS.length],
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Cards skeleton ─────────────────────────────────────────────────────────────

function CardsSkeleton({ cols, className }: { cols: number; className?: string }) {
  const colClass = colsGridClass(cols)
  return (
    <div
      className={cn('grid grid-cols-2 gap-3', colClass, className)}
      aria-hidden="true"
    >
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-muted/30 animate-pulse h-28"
        />
      ))}
    </div>
  )
}

// ── KPI skeleton ───────────────────────────────────────────────────────────────

function KpiSkeleton({ cols, className }: { cols: number; className?: string }) {
  const colClass = colsGridClass(cols)
  return (
    <div
      className={cn('grid grid-cols-2 gap-3', colClass, className)}
      aria-hidden="true"
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div
          key={i}
          className="h-20 rounded-xl border border-border bg-muted/30 animate-pulse"
        />
      ))}
    </div>
  )
}

// ── Calendar skeleton ──────────────────────────────────────────────────────────

function CalendarSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('grid grid-cols-7 gap-1', className)}
      aria-hidden="true"
    >
      {Array.from({ length: 35 }).map((_, i) => (
        <div
          key={i}
          className="h-8 rounded bg-muted animate-pulse"
        />
      ))}
    </div>
  )
}

// ── List skeleton ──────────────────────────────────────────────────────────────

function ListSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 rounded bg-muted animate-pulse',
            ROW_WIDTHS[i % ROW_WIDTHS.length],
          )}
        />
      ))}
    </div>
  )
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function colsGridClass(cols: number): string {
  const map: Record<number, string> = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
    5: 'sm:grid-cols-5',
    6: 'sm:grid-cols-6',
  }
  return map[cols] ?? 'sm:grid-cols-4'
}
