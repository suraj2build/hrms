import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'info'

interface KpiCardProps {
  label: string
  value: string
  delta?: number
  deltaLabel?: string
  hint?: string
  icon?: LucideIcon
  tone?: Tone
  /** Accepted for call-site compatibility; intentionally not rendered. */
  spark?: number[]
  onClick?: () => void
}

// Glossy gradient chip per tone
const toneChip: Record<Tone, string> = {
  primary:     'var(--grad-primary)',
  success:     'linear-gradient(145deg, #1FA968, #1A8050)',
  warning:     'linear-gradient(145deg, #E0A53B, #B07B18)',
  destructive: 'linear-gradient(145deg, #E5564B, #C93535)',
  info:        'linear-gradient(145deg, #3B82F6, #2260A8)',
}

/**
 * Compact horizontal "stat chip" — icon on the left, label/value/meta stacked
 * tight on the right. Single short row keeps the KPI ribbon dense.
 */
export function KpiCard({
  label, value, delta, deltaLabel, hint, icon: Icon, tone = 'primary', onClick,
}: KpiCardProps) {
  const positive = (delta ?? 0) > 0
  const negative = (delta ?? 0) < 0
  const meta = [deltaLabel, hint].filter(Boolean).join(' · ')

  return (
    <button
      onClick={onClick}
      className={cn(
        'surface-premium lift-hover group flex w-full items-center gap-2.5 p-2.5 text-left',
        'focus:outline-none focus:ring-2 focus:ring-primary/30',
      )}
    >
      {Icon && (
        <div className="gloss-sheen flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-black/5 shadow-sm"
             style={{ background: toneChip[tone] }}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          {typeof delta === 'number' && (
            <span className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded text-[10px] font-medium tabular-nums',
              positive && 'text-success',
              negative && 'text-destructive',
              !positive && !negative && 'text-muted-foreground',
            )}>
              {positive ? <ArrowUpRight className="h-3 w-3" /> : negative ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold leading-tight tracking-tight text-foreground tabular-nums">{value}</span>
          {meta && <span className="truncate text-[10px] text-muted-foreground">{meta}</span>}
        </div>
      </div>
    </button>
  )
}
