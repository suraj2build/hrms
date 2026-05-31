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

// ── Time-bucket helpers ───────────────────────────────────────────────────────

type TimeBucket = 'Today' | 'Yesterday' | 'This Week' | 'Older'

function getTimeBucket(iso: string): TimeBucket {
  const now     = new Date()
  const date    = new Date(iso)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffMs  = todayStart.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round(diffMs / 86_400_000)
  if (diffDays === 0)        return 'Today'
  if (diffDays === 1)        return 'Yesterday'
  if (diffDays < 7)          return 'This Week'
  return 'Older'
}

const BUCKET_ORDER: TimeBucket[] = ['Today', 'Yesterday', 'This Week', 'Older']

function groupByBucket(notifications: NotificationData[]): Array<{ label: TimeBucket; items: NotificationData[] }> {
  const map = new Map<TimeBucket, NotificationData[]>()
  for (const n of notifications) {
    const bucket = getTimeBucket(n.created_at)
    const existing = map.get(bucket)
    if (existing) {
      existing.push(n)
    } else {
      map.set(bucket, [n])
    }
  }
  return BUCKET_ORDER.filter(b => map.has(b)).map(b => ({ label: b, items: map.get(b)! }))
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
          groupByBucket(notifications).map(({ label, items }) => (
            <div key={label}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30 border-b border-border/40">
                {label}
              </div>
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onRead={onReadOne}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
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
