import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
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
    <Card className="relative overflow-hidden">
      {/* Colored left-border wire */}
      {accent && <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', accent)} />}
      <CardContent className={cn('p-4', accent && 'pl-5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
            <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {change !== undefined && (
              <div className={cn('flex items-center gap-1 text-xs font-medium', isPositive ? 'text-success' : 'text-destructive')}>
                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                <span>{isPositive ? '+' : ''}{change}% {changeLabel}</span>
              </div>
            )}
          </div>
          <div className={cn('p-2 rounded-lg flex-shrink-0', iconBg)}>
            <Icon className={cn('h-4 w-4', iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
