/**
 * WorkspaceKpiStrip — enhanced KPI strip for workspace pages.
 *
 * Renders a responsive grid of metric cards with value, label, delta indicator,
 * optional icon, click support, and a loading skeleton state. The outer component
 * and each internal card are wrapped in React.memo for render efficiency.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { StatusVariant } from '@/lib/design-tokens'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KpiCardData {
  id:        string
  label:     string
  value:     string | number
  /** e.g. "+12%" or "-3" */
  delta?:    string
  deltaDir?: 'up' | 'down' | 'flat'
  variant?:  StatusVariant
  icon?:     React.ReactNode
  loading?:  boolean
  onClick?:  () => void
}

export interface WorkspaceKpiStripProps {
  items:      KpiCardData[]
  loading?:   boolean
  cols?:      2 | 3 | 4 | 5 | 6
  className?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const colsMap: Record<NonNullable<WorkspaceKpiStripProps['cols']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
}

const deltaDirClass: Record<NonNullable<KpiCardData['deltaDir']>, string> = {
  up:   'text-success dark:text-green-400',
  down: 'text-destructive dark:text-red-400',
  flat: 'text-muted-foreground',
}

// ── Internal card ──────────────────────────────────────────────────────────────

interface KpiCardCellProps {
  item:    KpiCardData
  loading: boolean
}

const KpiCardCell = React.memo(function KpiCardCell({ item, loading }: KpiCardCellProps) {
  const isLoading    = loading || item.loading
  const isClickable  = Boolean(item.onClick)
  const deltaClass   = item.deltaDir ? deltaDirClass[item.deltaDir] : 'text-muted-foreground'

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if ((e.key === 'Enter' || e.key === ' ') && item.onClick) {
      e.preventDefault()
      item.onClick()
    }
  }

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `${item.label}: ${item.value}` : undefined}
      onClick={isClickable ? item.onClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      className={cn(
        'rounded-lg border border-border bg-card p-4 flex flex-col gap-1 cursor-default min-w-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        isClickable && 'cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all duration-150',
      )}
    >
      {/* Top row: label + icon */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
          {item.label}
        </span>
        {item.icon && (
          <span
            aria-hidden="true"
            className="flex-shrink-0 text-muted-foreground [&_svg]:w-4 [&_svg]:h-4"
          >
            {item.icon}
          </span>
        )}
      </div>

      {/* Value */}
      {isLoading ? (
        <div
          aria-hidden="true"
          className="animate-pulse bg-muted rounded h-8 w-16"
        />
      ) : (
        <span className="text-2xl font-bold tabular-nums text-foreground leading-tight">
          {item.value}
        </span>
      )}

      {/* Delta */}
      {!isLoading && item.delta !== undefined && (
        <span className={cn('text-xs font-medium leading-none', deltaClass)}>
          {item.delta}
        </span>
      )}
    </div>
  )
})

KpiCardCell.displayName = 'KpiCardCell'

// ── WorkspaceKpiStrip ──────────────────────────────────────────────────────────

export const WorkspaceKpiStrip = React.memo(function WorkspaceKpiStrip({
  items,
  loading   = false,
  cols      = 4,
  className,
}: WorkspaceKpiStripProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2',
        colsMap[cols],
        'gap-3',
        className,
      )}
      aria-label="Key metrics"
    >
      {items.map((item) => (
        <KpiCardCell key={item.id} item={item} loading={loading} />
      ))}
    </div>
  )
})

WorkspaceKpiStrip.displayName = 'WorkspaceKpiStrip'
