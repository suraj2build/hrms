import { cn } from '@/lib/utils'

interface HealthIndicatorProps {
  score: number
  signal: 'healthy' | 'degraded' | 'critical' | string
  label?: string
  className?: string
}

function dotColor(signal: string): string {
  if (signal === 'healthy')  return 'bg-emerald-500'
  if (signal === 'degraded') return 'bg-amber-500'
  if (signal === 'critical') return 'bg-destructive'
  return 'bg-muted-foreground'
}

export function HealthIndicator({ score, signal, label, className }: HealthIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn('size-2 rounded-full shrink-0', dotColor(signal))} />
      <span className="text-xs text-muted-foreground">{label ?? signal}</span>
      <span className="text-xs font-medium tabular-nums">{score}</span>
    </div>
  )
}
