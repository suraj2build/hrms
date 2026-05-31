import { cn } from '@/lib/utils'

type SeverityLevel = 'info' | 'warning' | 'high' | 'critical' | string

interface SummaryItem {
  label:    string
  value:    string | number
  trend?:   'up' | 'down' | 'flat'
  severity?: SeverityLevel
}

interface OperationalSummaryProps {
  items:    SummaryItem[]
  loading?: boolean
}

function severityValueClass(severity?: SeverityLevel): string {
  if (severity === 'critical') return 'text-destructive'
  if (severity === 'high')     return 'text-destructive'
  if (severity === 'warning')  return 'text-amber-600 dark:text-amber-400'
  return 'text-foreground'
}

function SkeletonChip() {
  return <div className="h-10 w-24 rounded-lg bg-muted animate-pulse shrink-0" />
}

export function OperationalSummary({ items, loading = false }: OperationalSummaryProps) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonChip key={i} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="flex flex-col items-start rounded-lg border bg-card px-3 py-2 shrink-0"
        >
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</span>
          <span className={cn('text-sm font-semibold tabular-nums', severityValueClass(item.severity))}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
