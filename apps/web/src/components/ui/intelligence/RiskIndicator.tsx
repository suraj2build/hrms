import { cn } from '@/lib/utils'

interface RiskIndicatorProps {
  score: number
  label?: string
  className?: string
}

export function RiskIndicator({ score, label, className }: RiskIndicatorProps) {
  const colorClass =
    score >= 75 ? 'text-destructive' :
    score >= 50 ? 'text-warning dark:text-warning' :
    'text-success dark:text-success'

  return (
    <span className={cn('text-xs font-medium tabular-nums', colorClass, className)}>
      {label ? `${label}: ` : ''}{score}
    </span>
  )
}
