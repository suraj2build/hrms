import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type MetricVariant = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

const VARIANT_STYLES: Record<MetricVariant, { icon: string; value: string; bg: string }> = {
  neutral:     { icon: 'text-muted-foreground', value: 'text-foreground',    bg: 'bg-muted/50' },
  success:     { icon: 'text-success',          value: 'text-success',        bg: 'bg-success/10' },
  warning:     { icon: 'text-warning',          value: 'text-warning',        bg: 'bg-warning/10' },
  destructive: { icon: 'text-destructive',      value: 'text-destructive',    bg: 'bg-destructive/10' },
  info:        { icon: 'text-info',             value: 'text-info',           bg: 'bg-info/10' },
}

export interface MetricCardProps {
  label: string
  value: number | string
  icon?: React.ComponentType<{ className?: string }>
  variant?: MetricVariant
  trend?: number       // positive = up, negative = down, 0 = flat
  trendLabel?: string  // e.g. "vs yesterday", "this week"
  subtitle?: string
  onClick?: () => void
  className?: string
  /** Compact single-row layout for summary strips */
  compact?: boolean
}

export function MetricCard({
  label, value, icon: Icon, variant = 'neutral',
  trend, trendLabel, subtitle, onClick, className, compact,
}: MetricCardProps) {
  const styles = VARIANT_STYLES[variant]

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg border border-border bg-card',
          onClick && 'cursor-pointer hover:bg-muted/40 transition-colors',
          className,
        )}
        onClick={onClick}
      >
        {Icon && (
          <div className={cn('flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center', styles.bg)}>
            <Icon className={cn('h-3.5 w-3.5', styles.icon)} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground truncate">{label}</p>
          <p className={cn('text-base font-semibold tabular-nums leading-none mt-0.5', styles.value)}>{value}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4',
        onClick && 'cursor-pointer hover:bg-muted/20 transition-colors',
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className={cn('text-2xl font-bold tabular-nums mt-1', styles.value)}>{value}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-1.5">
              {trend > 0 ? (
                <TrendingUp className="h-3 w-3 text-success" />
              ) : trend < 0 ? (
                <TrendingDown className="h-3 w-3 text-destructive" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span className={cn(
                'text-[11px] font-medium',
                trend > 0 ? 'text-success' : trend < 0 ? 'text-destructive' : 'text-muted-foreground',
              )}>
                {trend > 0 ? '+' : ''}{trend}
                {trendLabel && <span className="text-muted-foreground font-normal ml-1">{trendLabel}</span>}
              </span>
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn('flex-shrink-0 h-9 w-9 rounded-lg flex items-center justify-center', styles.bg)}>
            <Icon className={cn('h-4 w-4', styles.icon)} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Row of compact MetricCards — 2-col on mobile, N-col on larger */
export function MetricRow({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  const colClass = cols === 2 ? 'grid-cols-2' : cols === 3 ? 'sm:grid-cols-3' : cols === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-4'
  return (
    <div className={cn('grid grid-cols-2 gap-3', colClass)}>
      {children}
    </div>
  )
}
