import { cn } from '@/lib/utils'

export interface NotificationData {
  id:         string
  title:      string
  body:       string
  link?:      string | null
  is_read:    boolean
  created_at: string
  event_id:   string
}

export interface NotificationItemProps {
  notification: NotificationData
  onRead:       (id: string) => void
  onNavigate?:  (link: string) => void
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function NotificationItem({ notification, onRead, onNavigate }: NotificationItemProps) {
  function handleClick() {
    onRead(notification.id)
    if (notification.link && onNavigate) {
      onNavigate(notification.link)
    }
  }

  return (
    <button
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
      onClick={handleClick}
    >
      <span
        className={cn(
          'mt-1.5 h-2 w-2 rounded-full flex-shrink-0',
          notification.is_read ? 'bg-transparent' : 'bg-primary',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground leading-tight">{notification.title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{fmtRelative(notification.created_at)}</p>
      </div>
    </button>
  )
}
