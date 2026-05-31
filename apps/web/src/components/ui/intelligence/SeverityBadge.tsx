import { Badge } from '@/components/ui/badge'
import { cn }    from '@/lib/utils'

type Severity = 'info' | 'warning' | 'high' | 'critical' | string

function severityVariant(s: Severity): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'critical') return 'destructive'
  if (s === 'high')     return 'destructive'
  if (s === 'warning')  return 'secondary'
  return 'outline'
}

interface SeverityBadgeProps {
  severity: Severity
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <Badge
      variant={severityVariant(severity)}
      className={cn('capitalize text-xs font-medium', className)}
    >
      {severity ?? 'info'}
    </Badge>
  )
}
