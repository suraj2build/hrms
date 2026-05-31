/**
 * OperationalMetricChip
 *
 * A severity-aware clickable metric tile used inside workspace command headers.
 * Renders a value + label + optional trend in a compact pill / card form.
 *
 * Severity → token mapping (design-token only, no raw hex):
 *   critical  → text-destructive / bg-destructive/10
 *   warning   → text-warning     / bg-warning/10
 *   info      → text-info        / bg-info/10
 *   success   → text-success     / bg-success/10
 *   neutral   → text-muted-foreground / bg-muted/40
 */

import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export type MetricSeverity = 'critical' | 'warning' | 'info' | 'success' | 'neutral'

export interface OperationalMetricChipProps {
  value:       string | number
  label:       string
  severity?:   MetricSeverity
  icon?:       LucideIcon
  /** Small secondary label / trend shown below the value */
  sub?:        string
  /** Whether value is loading */
  loading?:    boolean
  /** Click handler — typically navigates to relevant workspace tab */
  onClick?:    () => void
  className?:  string
  /** Compact single-line variant (default: card) */
  compact?:    boolean
}

// ── Severity tokens ────────────────────────────────────────────────────────────

const SEVERITY_CLASSES: Record<MetricSeverity, {
  bg:    string
  text:  string
  ring:  string
  icon:  string
}> = {
  critical: { bg: 'bg-destructive/10', text: 'text-destructive',       ring: 'ring-destructive/25',    icon: 'text-destructive' },
  warning:  { bg: 'bg-warning/10',     text: 'text-warning',           ring: 'ring-warning/25',        icon: 'text-warning' },
  info:     { bg: 'bg-info/10',        text: 'text-info',              ring: 'ring-info/20',           icon: 'text-info' },
  success:  { bg: 'bg-success/10',     text: 'text-success',           ring: 'ring-success/20',        icon: 'text-success' },
  neutral:  { bg: 'bg-muted/40',       text: 'text-muted-foreground',  ring: 'ring-border',            icon: 'text-muted-foreground' },
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OperationalMetricChip({
  value,
  label,
  severity = 'neutral',
  icon: Icon,
  sub,
  loading = false,
  onClick,
  className,
  compact = false,
}: OperationalMetricChipProps) {
  const s = SEVERITY_CLASSES[severity]
  const isClickable = !!onClick

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!isClickable}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1',
          'text-[11px] font-semibold whitespace-nowrap transition-opacity',
          s.bg, s.text,
          isClickable && 'cursor-pointer hover:opacity-80',
          !isClickable && 'cursor-default',
          className,
        )}
      >
        {Icon && <Icon className={cn('h-3 w-3 flex-shrink-0', s.icon)} />}
        {loading
          ? <span className="opacity-40 animate-pulse">—</span>
          : <span className="tabular-nums">{value}</span>}
        <span className="font-medium opacity-75">{label}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg px-3 py-2.5 ring-1',
        'text-left transition-all duration-150 flex-shrink-0',
        s.bg, s.ring,
        isClickable && 'cursor-pointer hover:opacity-85 hover:scale-[1.01]',
        !isClickable && 'cursor-default',
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', s.icon)} />}
        <span className={cn('text-xl font-bold tabular-nums leading-none', s.text)}>
          {loading ? (
            <span className="opacity-30 animate-pulse">—</span>
          ) : value}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground font-medium leading-tight">{label}</span>
      {sub && (
        <span className="text-[10px] text-muted-foreground/60 leading-tight">{sub}</span>
      )}
    </button>
  )
}
