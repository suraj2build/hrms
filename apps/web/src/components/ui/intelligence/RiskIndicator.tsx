import { cn } from '@/lib/utils'

interface RiskIndicatorProps {
  score: number
  label?: string
  className?: string
}

export function RiskIndicator({ score, label, className }: RiskIndicatorProps) {
  const colorClass =
    score >= 75 ? 'text-destructive' :
    score >= 50 ? 'text-amber-600 dark:text-amber-400' :
    'text-emerald-600 dark:text-emerald-400'

  return (
    <span className={cn('text-xs font-medium tabular-nums', colorClass, className)}>
      {label ? `${label}: ` : ''}{score}
    </span>
  )
}
