/**
 * NotificationCenter — Phase UX-3
 *
 * Persistent slide-in notification drawer from the right edge.
 * Fetches 30 most recent notifications, supports mark-as-read,
 * mark-all-read, delete, and type-based filtering.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate }                           from 'react-router-dom'
import {
  Bell, X, AlertTriangle, Clock, ShieldAlert,
  CalendarClock, Info, Trash2,
} from 'lucide-react'
import { cn }         from '@/lib/utils'
import { api }        from '@/lib/api/client'
import { Button }     from '@/components/ui/button'
import { toast }      from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotificationCenterProps {
  open:    boolean
  onClose: () => void
}

type NotificationType = 'alert' | 'reminder' | 'breach' | 'deadline' | 'info'

interface Notification {
  id:           string
  type:         NotificationType
  title:        string
  body?:        string
  timestamp:    string
  read:         boolean
  actionRoute?: string
  actionLabel?: string
}

/** Raw backend notification row — fields are loosely typed and adapted to Notification. */
interface RawNotification {
  id:           string
  type?:        string
  title:        string
  body?:        string | null
  created_at?:  string | null
  timestamp?:   string | null
  is_read?:     boolean | null
  read?:        boolean | null
  link?:        string | null
  actionRoute?: string | null
  actionLabel?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins   = Math.floor(diffMs / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

// ── Type meta ─────────────────────────────────────────────────────────────────

const TYPE_META: Record<NotificationType, {
  Icon:       React.ComponentType<{ className?: string }>
  iconColor:  string
  barColor:   string
}> = {
  alert:    { Icon: AlertTriangle,  iconColor: 'text-destructive',  barColor: 'bg-destructive' },
  reminder: { Icon: Clock,          iconColor: 'text-amber-500',    barColor: 'bg-amber-500'   },
  breach:   { Icon: ShieldAlert,    iconColor: 'text-destructive',  barColor: 'bg-destructive' },
  deadline: { Icon: CalendarClock,  iconColor: 'text-amber-500',    barColor: 'bg-amber-500'   },
  info:     { Icon: Info,           iconColor: 'text-primary',      barColor: 'bg-primary'     },
}

type FilterTab = 'All' | 'Alerts' | 'Reminders' | 'Deadlines'

const FILTER_TABS: FilterTab[] = ['All', 'Alerts', 'Reminders', 'Deadlines']

const TAB_TYPE_MAP: Record<FilterTab, NotificationType[] | null> = {
  All:       null,
  Alerts:    ['alert', 'breach'],
  Reminders: ['reminder'],
  Deadlines: ['deadline'],
}

// ── NotificationItem ──────────────────────────────────────────────────────────

interface NotificationItemProps {
  notification: Notification
  onMarkRead:   (id: string) => void
  onDelete:     (id: string) => void
}

function NotificationItem({ notification: n, onMarkRead, onDelete }: NotificationItemProps) {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(false)
  const meta = TYPE_META[n.type]

  function handleClick() {
    if (!n.read) onMarkRead(n.id)
    if (n.actionRoute) navigate(n.actionRoute)
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    onDelete(n.id)
  }

  return (
    <div
      role={n.type === 'alert' || n.type === 'breach' ? 'alert' : 'article'}
      className={cn(
        'flex items-start gap-0 border-b border-border cursor-pointer',
        'hover:bg-muted/40 transition-colors relative',
        !n.read && 'bg-primary/5',
      )}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      tabIndex={0}
      aria-label={n.title}
    >
      {/* Left color bar */}
      <div className={cn('w-0.5 self-stretch flex-shrink-0', meta.barColor)} />

      <div className="flex items-start gap-2.5 px-3 py-3 flex-1 min-w-0">
        {/* Type icon */}
        <meta.Icon className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', meta.iconColor)} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1.5">
            <p className="text-xs font-medium text-foreground leading-snug">{n.title}</p>

            {/* Unread dot */}
            {!n.read && (
              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" aria-label="Unread" />
            )}
          </div>

          {n.body && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
              {n.body}
            </p>
          )}

          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">{timeAgo(n.timestamp)}</span>
            {n.actionLabel && n.actionRoute && (
              <span className="text-[10px] text-primary font-medium">{n.actionLabel} →</span>
            )}
          </div>
        </div>
      </div>

      {/* Delete button — visible on hover */}
      {hovered && (
        <button
          type="button"
          onClick={handleDelete}
          className="absolute right-2 top-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors p-0.5 rounded"
          aria-label="Delete notification"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function NotificationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading notifications">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-start gap-2.5 px-3 py-3 border-b border-border">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-2.5 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── FilterTab button ──────────────────────────────────────────────────────────

interface FilterTabButtonProps {
  label:    FilterTab
  active:   boolean
  onClick:  () => void
}

function FilterTabButton({ label, active, onClick }: FilterTabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const [activeTab, setActiveTab] = useState<FilterTab>('All')

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: rawNotifications, isLoading } = useQuery<Notification[]>({
    queryKey:  ['notifications'],
    queryFn:   () =>
      // Backend rows are { id, title, body, link, is_read, created_at, event_id }.
      // Map them onto the component's model so the unread badge, timestamps and
      // action links work (previously read `n.read`/`n.type`/`n.timestamp`, which
      // the API never sends — the badge counted every item as unread).
      api.get<{ data: RawNotification[] }>('/notifications?limit=30').then(r =>
        (Array.isArray(r.data) ? r.data : []).map((n): Notification => ({
          id:          n.id,
          type:        (n.type as NotificationType) ?? 'info',
          title:       n.title,
          body:        n.body ?? undefined,
          timestamp:   n.created_at ?? n.timestamp ?? new Date().toISOString(),
          read:        n.is_read ?? n.read ?? false,
          actionRoute: n.link ?? n.actionRoute ?? undefined,
          actionLabel: n.actionLabel ?? undefined,
        })),
      ),
    staleTime: 30_000,
    enabled:   open,
  })
  const notifications: Notification[] = useMemo(
    () => (Array.isArray(rawNotifications) ? rawNotifications : []),
    [rawNotifications],
  )

  // ── Mutations ─────────────────────────────────────────────────────────────

  const markOneMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<void>(`/notifications/${id}/read`),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Notification[]>(['notifications'], prev =>
        (prev ?? []).map(n => n.id === id ? { ...n, read: true } : n),
      )
    },
    onError: (e: Error) => toast.error('Failed to mark notification as read', { description: e.message }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => api.post<void>('/notifications/read-all'),
    onSuccess: () => {
      queryClient.setQueryData<Notification[]>(['notifications'], prev =>
        (prev ?? []).map(n => ({ ...n, read: true })),
      )
    },
    onError: (e: Error) => toast.error('Failed to mark all notifications as read', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/notifications/${id}`),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Notification[]>(['notifications'], prev =>
        (prev ?? []).filter(n => n.id !== id),
      )
    },
    onError: (e: Error) => toast.error('Failed to delete notification', { description: e.message }),
  })

  // ── Derived state ──────────────────────────────────────────────────────────

  const filteredNotifications = useMemo(() => {
    const types = TAB_TYPE_MAP[activeTab]
    if (!types) return notifications
    return notifications.filter(n => types.includes(n.type))
  }, [notifications, activeTab])

  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications],
  )

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMarkRead = useCallback((id: string) => {
    markOneMutation.mutate(id)
  }, [markOneMutation])

  const handleMarkAll = useCallback(() => {
    markAllMutation.mutate()
  }, [markAllMutation])

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id)
  }, [deleteMutation])

  const handleViewAll = useCallback(() => {
    navigate('/admin/notifications/inbox')
    onClose()
  }, [navigate, onClose])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop (mobile) */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-label="Notification center"
        aria-modal="true"
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-[360px] bg-background border-l border-border shadow-xl',
          'flex flex-col transform transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-foreground" />
            <span className="font-semibold text-sm text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <span
                className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-destructive text-[10px] text-white font-bold leading-none"
                aria-live="polite"
                aria-label={`${unreadCount} unread notifications`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-7 px-2 text-muted-foreground hover:text-foreground"
                onClick={handleMarkAll}
                disabled={markAllMutation.isPending}
              >
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              aria-label="Close notifications"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 flex-shrink-0">
          {FILTER_TABS.map(tab => (
            <FilterTabButton
              key={tab}
              label={tab}
              active={activeTab === tab}
              onClick={() => setActiveTab(tab)}
            />
          ))}
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto" role="feed" aria-label="Notifications">
          {isLoading ? (
            <NotificationSkeleton />
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Bell className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No notifications</p>
            </div>
          ) : (
            filteredNotifications.map(n => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={handleMarkRead}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-center flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={handleViewAll}
          >
            View all in Inbox
          </Button>
        </div>
      </div>
    </>
  )
}
