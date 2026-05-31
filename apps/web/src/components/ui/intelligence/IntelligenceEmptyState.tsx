import { type ReactNode } from 'react'
import { Activity }       from 'lucide-react'
import { cn }             from '@/lib/utils'

interface IntelligenceEmptyStateProps {
  icon?:        ReactNode
  title:        string
  description?: string
  action?:      ReactNode
  className?:   string
}

export function IntelligenceEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: IntelligenceEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-10 text-center', className)}>
      <div className="text-muted-foreground opacity-40 mb-1">
        {icon ?? <Activity className="h-8 w-8" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
