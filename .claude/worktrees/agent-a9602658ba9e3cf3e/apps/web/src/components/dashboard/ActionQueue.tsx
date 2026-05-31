import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ActionQueueItem {
  id: string
  title: string
  subtitle?: string
  meta?: string        // e.g. "3 days", "Since Mon"
  status?: string
  statusVariant?: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'
  primaryAction?: {
    label: string
    onClick: () => void
    loading?: boolean
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

interface ActionQueueProps {
  items: ActionQueueItem[]
  emptyMessage?: string
  className?: string
  /** Show skeleton loading rows */
  loading?: boolean
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/50 animate-pulse">
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-40 bg-muted rounded" />
        <div className="h-2.5 w-24 bg-muted rounded" />
      </div>
      <div className="h-6 w-14 bg-muted rounded" />
    </div>
  )
}

export function ActionQueue({ items, emptyMessage = 'No pending actions', className, loading }: ActionQueueProps) {
  if (loading) {
    return (
      <div className={className}>
        {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 gap-1', className)}>
        <p className="text-sm font-medium text-muted-foreground/60">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-0', className)}>
      {items.map((item, i) => (
        <div
          key={item.id}
          className={cn(
            'flex items-center gap-3 py-2.5',
            i < items.length - 1 && 'border-b border-border/50',
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-medium text-foreground truncate">{item.title}</p>
              {item.status && (
                <Badge variant={item.statusVariant ?? 'secondary'} className="text-[10px] py-0 px-1.5 rounded-full flex-shrink-0">
                  {item.status}
                </Badge>
              )}
            </div>
            {(item.subtitle || item.meta) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {item.subtitle}
                {item.subtitle && item.meta && <span className="mx-1">·</span>}
                {item.meta && <span>{item.meta}</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {item.secondaryAction && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] px-2"
                onClick={item.secondaryAction.onClick}
              >
                {item.secondaryAction.label}
              </Button>
            )}
            {item.primaryAction && (
              <Button
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={item.primaryAction.onClick}
                disabled={item.primaryAction.loading}
              >
                {item.primaryAction.label}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
