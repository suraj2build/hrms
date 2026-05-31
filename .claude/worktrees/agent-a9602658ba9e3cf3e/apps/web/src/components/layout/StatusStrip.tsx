/**
 * StatusStrip — compact operational summary row above major tables.
 *
 * Renders a horizontal strip of labelled counts with semantic colour coding.
 * Keeps information density high without card-level overhead.
 *
 * Usage:
 *   <StatusStrip
 *     items={[
 *       { label: 'Pending',    value: 12, variant: 'warning' },
 *       { label: 'Processing', value: 3,  variant: 'info'    },
 *       { label: 'Failed',     value: 1,  variant: 'destructive' },
 *       { label: 'Applied Today', value: 48, variant: 'success' },
 *     ]}
 *   />
 */

import { cn } from '@/lib/utils'

type StripVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'

const VARIANT_STYLES: Record<StripVariant, { dot: string; value: string; label: string }> = {
  default:     { dot: 'bg-foreground/30',       value: 'text-foreground',         label: 'text-muted-foreground' },
  success:     { dot: 'bg-success',             value: 'text-success',            label: 'text-muted-foreground' },
  warning:     { dot: 'bg-warning',             value: 'text-warning',            label: 'text-muted-foreground' },
  destructive: { dot: 'bg-destructive',         value: 'text-destructive',        label: 'text-muted-foreground' },
  info:        { dot: 'bg-info',                value: 'text-info',               label: 'text-muted-foreground' },
  muted:       { dot: 'bg-muted-foreground/30', value: 'text-muted-foreground',   label: 'text-muted-foreground/60' },
}

export interface StripItem {
  label: string
  value: number | string
  variant?: StripVariant
  /** If true, only render when value > 0 */
  hideWhenZero?: boolean
}

export interface StatusStripProps {
  items: StripItem[]
  className?: string
}

export function StatusStrip({ items, className }: StatusStripProps) {
  const visible = items.filter(
    item => !(item.hideWhenZero && (item.value === 0 || item.value === '0')),
  )

  if (!visible.length) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 bg-muted/[0.4] border-b border-border/50',
        className,
      )}
    >
      {visible.map((item, i) => {
        const styles = VARIANT_STYLES[item.variant ?? 'default']
        return (
          <div key={i} className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', styles.dot)} />
            <span className={cn('text-[11px] font-semibold tabular-nums', styles.value)}>
              {item.value}
            </span>
            <span className={cn('text-[11px]', styles.label)}>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
