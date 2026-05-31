/**
 * chart.ts — Aurora Navy Recharts style helpers
 *
 * Import these into any chart component instead of inlining
 * var(--color-*) strings directly in JSX.
 *
 * Usage:
 *   import { CHART_PALETTE, getChartColor, getAxisStyle, getGridStyle, getTooltipStyle } from '@/components/ui/chart'
 */
import type React from 'react'

// ── Named colour palette ──────────────────────────────────────────────────────

/**
 * Domain-specific color assignments for chart segments.
 * Keys match the snake_case values that come back from the API.
 */
export const CHART_PALETTE = {
  // Employment type segments
  permanent:  'var(--color-info)',
  contract:   'var(--color-accent-violet)',
  intern:     'var(--color-accent-coral)',
  probation:  'var(--color-warning)',
  consultant: 'var(--color-accent-teal)',
  // Employee status segments
  active:     'var(--color-success)',
  inactive:   'var(--color-muted-foreground)',
  on_notice:  'var(--color-warning)',
  separated:  'var(--color-destructive)',
  // Generic chart series (use when domain is unknown)
  chart1: 'var(--color-chart-1)',
  chart2: 'var(--color-chart-2)',
  chart3: 'var(--color-chart-3)',
  chart4: 'var(--color-chart-4)',
  chart5: 'var(--color-chart-5)',
} as const

export type ChartPaletteKey = keyof typeof CHART_PALETTE

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the design-token fill for a named segment key.
 * Falls back to `--color-muted-foreground` for unknown keys.
 */
export function getChartColor(key: string): string {
  return (CHART_PALETTE as Record<string, string>)[key] ?? 'var(--color-muted-foreground)'
}

/**
 * XAxis / YAxis props — spread onto each axis element.
 *
 * @example
 * const axis = getAxisStyle()
 * <XAxis dataKey="name" tick={axis.tick} axisLine={axis.axisLine} tickLine={axis.tickLine} />
 */
export function getAxisStyle() {
  return {
    tick:     { fontSize: 11, fill: 'var(--color-muted-foreground)' },
    axisLine: { stroke: 'var(--color-border)' },
    tickLine: { stroke: 'var(--color-border)' },
  } as const
}

/**
 * CartesianGrid props — spread directly onto <CartesianGrid />.
 *
 * @example
 * <CartesianGrid {...getGridStyle()} />
 */
export function getGridStyle() {
  return {
    strokeDasharray: '3 3',
    stroke: 'var(--color-border)',
  } as const
}

/**
 * Recharts Tooltip `contentStyle` object.
 * Pass as `<Tooltip contentStyle={getTooltipStyle()} />`.
 */
export function getTooltipStyle(): React.CSSProperties {
  return {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'var(--color-foreground)',
  }
}
