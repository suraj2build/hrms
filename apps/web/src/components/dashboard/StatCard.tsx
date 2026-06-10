import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  iconColor: string
  iconBg: string
  accent?: string        // Tailwind bg-* class — renders as colored left-border wire
  change?: number
  changeLabel?: string
  subtitle?: string
}

export function StatCard({ title, value, icon: Icon, iconColor, iconBg, accent, change, changeLabel, subtitle }: StatCardProps) {
  const isPositive = (change ?? 0) >= 0

  return (
    <div className="surface-premium lift-hover overflow-hidden p-4">
      {/* Colored left-border wire */}
      {accent && <div className={cn('absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl', accent)} />}
      <div className={cn('flex items-start justify-between gap-3', accent && 'pl-2')}>
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
          <p className="text-2xl font-bold text-foreground leading-none tabular-nums">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {change !== undefined && (
            <div className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
              isPositive ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
            )}>
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span className="tabular-nums">{isPositive ? '+' : ''}{change}% {changeLabel}</span>
            </div>
          )}
        </div>
        {/* Glossy icon chip — keeps the card's themed color, adds sheen + depth */}
        <div className={cn('gloss-sheen flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} />
        </div>
      </div>
    </div>
  )
}
