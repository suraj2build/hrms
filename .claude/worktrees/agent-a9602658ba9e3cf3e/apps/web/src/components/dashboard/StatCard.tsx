import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  iconColor: string
  iconBg: string
  change?: number
  changeLabel?: string
  subtitle?: string
}

export function StatCard({ title, value, icon: Icon, iconColor, iconBg, change, changeLabel, subtitle }: StatCardProps) {
  const isPositive = (change ?? 0) >= 0

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {change !== undefined && (
              <div className={cn('flex items-center gap-1 text-xs font-medium', isPositive ? 'text-success' : 'text-destructive')}>
                {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                <span>{isPositive ? '+' : ''}{change}% {changeLabel}</span>
              </div>
            )}
          </div>
          <div className={cn('p-2.5 rounded-lg flex-shrink-0', iconBg)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
