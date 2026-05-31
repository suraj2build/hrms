/**
 * WorkspaceLoadingSkeleton — extended loading skeleton with 5 variants.
 *
 * Variants:
 *   page   — header block + kpi row + content area
 *   table  — header row + N alternating-width body rows
 *   cards  — N × M grid of rounded card placeholders
 *   kpi    — row of N small metric boxes
 *   form   — stacked label+input pairs
 *
 * Intentionally kept separate from WorkspaceSkeleton (UX-1) which is preserved
 * for backward compatibility.
 */

import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceLoadingSkeletonProps {
  variant?:   'page' | 'table' | 'cards' | 'kpi' | 'form'
  rows?:      number
  cols?:      number
  className?: string
}

// ── Shared primitive ───────────────────────────────────────────────────────────

function Bone({ className }: { className?: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded bg-muted', className)}
    />
  )
}

// ── Width cycles ───────────────────────────────────────────────────────────────

const ROW_WIDTHS  = ['w-32', 'w-24', 'w-40', 'w-20', 'w-36', 'w-28'] as const
const HEAD_WIDTHS = ['w-20', 'w-28', 'w-16', 'w-24'] as const

// ── Variant: page ──────────────────────────────────────────────────────────────

function PageSkeleton({ className }: { className?: string }): JSX.Element {
  return (
    <div className={cn('space-y-4', className)} aria-hidden="true" aria-label="Loading page">
      {/* Header block */}
      <div className="px-6 pt-5 pb-3 border-b border-border space-y-2">
        <Bone className="h-5 w-48" />
        <Bone className="h-3 w-72" />
      </div>

      {/* KPI row */}
      <div className="px-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* Tab bar */}
      <div className="px-6 flex gap-4 border-b border-border pb-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bone key={i} className="h-8 w-20 rounded-none rounded-t-sm" />
        ))}
      </div>

      {/* Content area */}
      <div className="px-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone
            key={i}
            className={cn('h-4', ROW_WIDTHS[i % ROW_WIDTHS.length])}
          />
        ))}
      </div>
    </div>
  )
}

// ── Variant: table ─────────────────────────────────────────────────────────────

function TableSkeleton({ rows, className }: { rows: number; className?: string }): JSX.Element {
  return (
    <div className={cn('w-full', className)} aria-hidden="true" aria-label="Loading table">
      {/* Header row */}
      <div className="flex items-center gap-4 border-b border-border pb-2.5 mb-2">
        {HEAD_WIDTHS.map((w, i) => (
          <Bone key={i} className={cn('h-3', w)} />
        ))}
        <Bone className="ml-auto h-3 w-12" />
      </div>

      {/* Data rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={ri}
          className="flex items-center gap-4 border-b border-border/40 py-3"
        >
          {/* Checkbox placeholder */}
          <Bone className="h-3.5 w-3.5 flex-shrink-0" />
          {Array.from({ length: 4 }).map((__, ci) => (
            <Bone
              key={ci}
              className={cn('h-3', ROW_WIDTHS[(ri + ci) % ROW_WIDTHS.length])}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Variant: cards ─────────────────────────────────────────────────────────────

function CardsSkeleton({ cols, className }: { cols: number; className?: string }): JSX.Element {
  const colClass = colsGridClass(cols)
  return (
    <div
      className={cn('grid grid-cols-2 gap-3', colClass, className)}
      aria-hidden="true"
      aria-label="Loading cards"
    >
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <Bone key={i} className="rounded-lg h-28" />
      ))}
    </div>
  )
}

// ── Variant: kpi ───────────────────────────────────────────────────────────────

function KpiSkeleton({ cols, className }: { cols: number; className?: string }): JSX.Element {
  const colClass = colsGridClass(cols)
  return (
    <div
      className={cn('grid grid-cols-2 gap-3', colClass, className)}
      aria-hidden="true"
      aria-label="Loading metrics"
    >
      {Array.from({ length: cols }).map((_, i) => (
        <Bone key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  )
}

// ── Variant: form ──────────────────────────────────────────────────────────────

function FormSkeleton({ rows, className }: { rows: number; className?: string }): JSX.Element {
  return (
    <div
      className={cn('space-y-5', className)}
      aria-hidden="true"
      aria-label="Loading form"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          {/* Label */}
          <Bone className="h-3 w-24" />
          {/* Input */}
          <Bone className="h-9 w-full rounded-md" />
        </div>
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

// ── WorkspaceLoadingSkeleton ───────────────────────────────────────────────────

export function WorkspaceLoadingSkeleton({
  variant   = 'page',
  rows      = 5,
  cols      = 4,
  className,
}: WorkspaceLoadingSkeletonProps): JSX.Element {
  switch (variant) {
    case 'page':  return <PageSkeleton  className={className} />
    case 'table': return <TableSkeleton rows={rows} className={className} />
    case 'cards': return <CardsSkeleton cols={cols} className={className} />
    case 'kpi':   return <KpiSkeleton   cols={cols} className={className} />
    case 'form':  return <FormSkeleton  rows={rows} className={className} />
  }
}
