import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface ActivityItem {
  id: string
  title: string
  subtitle?: string
  timestamp: string   // ISO string or formatted string
  status?: string
  statusVariant?: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'
  icon?: React.ComponentType<{ className?: string }>
  iconBg?: string
  action?: React.ReactNode
}

interface ActivityListProps {
  items: ActivityItem[]
  emptyMessage?: string
  className?: string
  maxItems?: number
}

function fmtRelTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1)   return 'just now'
    if (mins < 60)  return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24)   return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7)   return `${days}d ago`
    const _d = new Date(ts); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? ts : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}`
  } catch {
    return ts
  }
}

export function ActivityList({ items, emptyMessage = 'No recent activity', className, maxItems }: ActivityListProps) {
  const visible = maxItems ? items.slice(0, maxItems) : items

  if (!visible.length) {
    return (
      <div className={cn('flex items-center justify-center py-8 text-xs text-muted-foreground', className)}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={cn('space-y-0', className)}>
      {visible.map((item, i) => {
        const Icon = item.icon
        return (
          <div
            key={item.id}
            className={cn(
              'flex items-start gap-3 py-2.5',
              i < visible.length - 1 && 'border-b border-border/50',
            )}
          >
            {Icon && (
              <div className={cn(
                'flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center mt-0.5',
                item.iconBg ?? 'bg-muted',
              )}>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium text-foreground leading-snug truncate">{item.title}</p>
                <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">{fmtRelTime(item.timestamp)}</span>
              </div>
              {item.subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.subtitle}</p>
              )}
              <div className="flex items-center gap-2 mt-1">
                {item.status && (
                  <Badge variant={item.statusVariant ?? 'secondary'} className="text-[10px] py-0 px-1.5 rounded-full">
                    {item.status}
                  </Badge>
                )}
                {item.action && <div>{item.action}</div>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
