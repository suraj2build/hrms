import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NotificationItem } from './NotificationItem'
import type { NotificationData } from './NotificationItem'

export interface NotificationCenterProps {
  notifications: NotificationData[]
  unreadCount:   number
  loading:       boolean
  onReadOne:     (id: string) => void
  onReadAll:     () => void
  onNavigate:    (link: string) => void
}

export function NotificationCenter({
  notifications,
  unreadCount,
  loading,
  onReadOne,
  onReadAll,
  onNavigate,
}: NotificationCenterProps) {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-destructive text-[10px] text-white font-bold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={onReadAll}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="px-4 py-8 text-xs text-muted-foreground text-center">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No notifications</p>
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onRead={onReadOne}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border text-center">
        <span className="text-[11px] text-muted-foreground">Showing last 50 notifications</span>
      </div>
    </div>
  )
}
