/**
 * KpiStrip — horizontal strip of KPI metric cards.
 *
 * Renders a responsive CSS grid of cards. Each card supports a value,
 * optional delta indicator with directional colour, an icon, click handler,
 * and a loading skeleton state.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KpiCard {
  label:     string
  value:     string | number
  /** e.g. "+12%" — displayed below the value */
  delta?:    string
  deltaDir?: 'up' | 'down' | 'neutral'
  color?:    'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
  icon?:     React.ReactNode
  onClick?:  () => void
  loading?:  boolean
}

export interface KpiStripProps {
  cards:      KpiCard[]
  cols?:      2 | 3 | 4 | 5 | 6
  className?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const colorMap: Record<NonNullable<KpiCard['color']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger:  'text-destructive',
  info:    'text-info',
  muted:   'text-muted-foreground',
}

const deltaDirMap: Record<NonNullable<KpiCard['deltaDir']>, string> = {
  up:      'text-success',
  down:    'text-destructive',
  neutral: 'text-muted-foreground',
}

const colsMap: Record<NonNullable<KpiStripProps['cols']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function KpiStrip({ cards, cols = 4, className }: KpiStripProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-2',
        colsMap[cols],
        'gap-3',
        className,
      )}
    >
      {cards.map((card, i) => (
        <KpiCardCell key={i} card={card} />
      ))}
    </div>
  )
}

// ── Internal card cell ─────────────────────────────────────────────────────────

function KpiCardCell({ card }: { card: KpiCard }) {
  const {
    label, value, delta, deltaDir = 'neutral',
    color = 'default', icon, onClick, loading,
  } = card

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick() } : undefined}
      className={cn(
        'rounded-xl border border-border bg-card p-3 flex flex-col gap-1',
        'min-w-0',
        onClick && 'cursor-pointer hover:bg-muted/30 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      {/* Top row: label + icon */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground leading-none truncate">{label}</span>
        {icon && (
          <span className="flex-shrink-0 text-muted-foreground/50 [&_svg]:h-3.5 [&_svg]:w-3.5">
            {icon}
          </span>
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="animate-pulse h-7 w-16 bg-muted rounded inline-block" />
      ) : (
        <span className={cn('text-xl font-semibold leading-tight tabular-nums', colorMap[color])}>
          {value}
        </span>
      )}

      {/* Delta */}
      {!loading && delta !== undefined && (
        <span className={cn('text-[11px] font-medium leading-none', deltaDirMap[deltaDir])}>
          {delta}
        </span>
      )}
    </div>
  )
}
