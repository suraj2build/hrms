import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell, ExternalLink, CheckCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SubTabs } from '@/components/ui/SubTabs'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

interface InboxItem {
  id: string
  recipient_id: string
  title: string
  body: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  item_type: string
  is_read: boolean
  action_required: boolean
  action_url: string | null
  expires_at: string | null
  escalated: boolean
  created_at: string
}

// Raw shape returned by /notifications/inbox before it is mapped onto InboxItem.
interface InboxRow {
  id: string
  recipient_id: string
  title: string
  summary?: string | null
  body?: string | null
  severity?: string
  entity_type?: string | null
  item_type?: string | null
  status?: string | null
  action_route?: string | null
  action_url?: string | null
  expires_at?: string | null
  escalated?: boolean
  created_at: string
}

type FilterTab = 'all' | 'urgent' | 'action_required' | 'unread'

function priorityVariant(priority: InboxItem['priority']): BadgeProps['variant'] {
  switch (priority) {
    case 'urgent': return 'destructive'
    case 'high': return 'warning'
    case 'normal': return 'secondary'
    case 'low': return 'outline'
    default: return 'secondary'
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Per-filter contextual empty copy
const FILTER_EMPTY: Record<FilterTab, { heading: string; sub: string }> = {
  all:             { heading: 'Inbox is clear',          sub: 'No notifications or action items right now.' },
  urgent:          { heading: 'No urgent items',         sub: 'All items are within normal priority range.' },
  action_required: { heading: 'Nothing needs action',   sub: 'No items currently require your response.' },
  unread:          { heading: "You're up to date",       sub: 'All notifications have been read.' },
}

export function OperationalInbox() {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: items = [], isLoading } = useQuery<InboxItem[]>({
    queryKey:        ['notifications', 'inbox'],
    // The inbox_items table uses summary/severity/status/action_route. Map those
    // onto this component's model (body/priority/is_read/action_url) so filters,
    // unread count and action buttons work — the raw fields didn't exist before,
    // so every item showed unread and the Urgent/Action tabs were always empty.
    queryFn:         () => api.get<{ data: InboxRow[] }>('/notifications/inbox').then((r) => {
      const SEV_TO_PRIORITY: Record<string, InboxItem['priority']> = {
        critical: 'urgent', error: 'high', warning: 'normal', info: 'low',
      }
      return (Array.isArray(r.data) ? r.data : []).map((row): InboxItem => ({
        id:              row.id,
        recipient_id:    row.recipient_id,
        title:           row.title,
        body:            row.summary ?? row.body ?? '',
        priority:        SEV_TO_PRIORITY[row.severity ?? ''] ?? 'normal',
        item_type:       row.entity_type ?? row.item_type ?? '',
        is_read:         (row.status ?? 'unread') !== 'unread',
        action_required: !!(row.action_route ?? row.action_url),
        action_url:      row.action_route ?? row.action_url ?? null,
        expires_at:      row.expires_at ?? null,
        escalated:       row.escalated ?? false,
        created_at:      row.created_at,
      }))
    }),
    // Poll every 60 s so approval notifications appear without manual refresh.
    // staleTime === refetchInterval: prevents a mount-refetch firing every navigation
    // while the cached value is still within the 60 s polling window.
    staleTime:       60_000,   // ← was 30_000 (misaligned — caused mount-refetch on every nav)
    refetchInterval: 60_000,
  })

  const markRead = useMutation({
    // Backend is POST /notifications/inbox/:id/read (not PUT).
    mutationFn: (id: string) => api.post(`/notifications/inbox/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
    },
    onError: (e: Error) => toast.error('Failed to mark as read', { description: e.message }),
  })

  const markAllRead = useMutation({
    // Backend bulk endpoint is POST /notifications/inbox/bulk-read (there is no read-all).
    mutationFn: () => api.post('/notifications/inbox/bulk-read', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'inbox'] })
      toast.success('All notifications marked as read')
    },
    onError: (e: Error) => toast.error('Failed to mark all as read', { description: e.message }),
  })

  const unreadCount = useMemo(() => items.filter(i => !i.is_read).length, [items])

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'urgent': return items.filter(i => i.priority === 'urgent')
      case 'action_required': return items.filter(i => i.action_required)
      case 'unread': return items.filter(i => !i.is_read)
      default: return items
    }
  }, [items, activeFilter])

  const selected = useMemo(
    () => items.find(i => i.id === selectedId) ?? null,
    [items, selectedId]
  )

  function handleSelect(item: InboxItem) {
    setSelectedId(item.id)
    if (!item.is_read) {
      markRead.mutate(item.id)
    }
  }

  const filterTabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'urgent', label: 'Urgent', count: items.filter(i => i.priority === 'urgent').length },
    { key: 'action_required', label: 'Action Required', count: items.filter(i => i.action_required).length },
    { key: 'unread', label: 'Unread', count: unreadCount },
  ]

  // Navigate action URLs internally if same-origin, externally otherwise
  function handleActionUrl(url: string) {
    try {
      const parsed = new URL(url, window.location.origin)
      if (parsed.origin === window.location.origin) {
        navigate(parsed.pathname + parsed.search)
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  // Capitalise first letter of priority label
  function fmtPriority(p: string) {
    return p.charAt(0).toUpperCase() + p.slice(1)
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Operational Inbox' }]}
        title="Operational Inbox"
        subtitle="Notifications and action items routed to you"
        actions={
          unreadCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {markAllRead.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />
              }
              Mark All Read
            </Button>
          ) : undefined
        }
      />

      {/* Filter Tabs */}
      <SubTabs<typeof activeFilter>
        tabs={filterTabs.map(t => ({ id: t.key, label: t.label, badge: t.count }))}
        value={activeFilter}
        onChange={setActiveFilter}
        className="mb-6"
      />

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[400px]">
          <div className="w-full lg:w-1/3 border border-border rounded-lg overflow-hidden divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5 animate-pulse">
                <div className="flex gap-2">
                  <div className="h-4 w-12 bg-muted rounded-full" />
                  <div className="h-4 w-8 bg-muted rounded-full ml-auto" />
                </div>
                <div className="h-3.5 w-3/4 bg-muted rounded" />
                <div className="h-3 w-full bg-muted rounded" />
              </div>
            ))}
          </div>
          <div className="hidden lg:block lg:w-2/3 border border-border rounded-lg bg-muted/10" />
        </div>
      )}

      {/* Global empty — no items at all */}
      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Bell className="h-8 w-8 opacity-30" />
          <p className="text-sm font-medium text-foreground">Inbox is clear</p>
          <p className="text-xs">No notifications or action items are pending.</p>
          <div className="flex items-center gap-3 mt-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/admin/attendance/corrections')}>
              Corrections
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/approvals/inbox')}>
              Approval Inbox
            </Button>
          </div>
        </div>
      )}

      {/* Main layout — list + detail */}
      {!isLoading && items.length > 0 && (
        <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[400px]">
          {/* Left Panel — Item List */}
          <div className="w-full lg:w-1/3 flex flex-col border border-border rounded-lg overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 p-6 text-center">
                <Bell className="h-7 w-7 text-muted-foreground opacity-30" />
                <p className="text-sm font-medium text-foreground">
                  {FILTER_EMPTY[activeFilter].heading}
                </p>
                <p className="text-xs text-muted-foreground">
                  {FILTER_EMPTY[activeFilter].sub}
                </p>
                {activeFilter !== 'all' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs mt-1"
                    onClick={() => setActiveFilter('all')}
                  >
                    Show all items
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 divide-y divide-border">
                {filtered.map(item => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(item)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleSelect(item) }}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors hover:bg-muted/40 cursor-pointer',
                      selectedId === item.id && 'bg-muted/50',
                      !item.is_read && 'border-l-2 border-primary'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={priorityVariant(item.priority)} className="text-xs px-1.5 py-0">
                          {fmtPriority(item.priority)}
                        </Badge>
                        {item.action_required && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 text-warning border-warning">
                            Action
                          </Badge>
                        )}
                        {!item.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {timeAgo(item.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground leading-snug">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {item.body.slice(0, 80)}{item.body.length > 80 ? '…' : ''}
                    </p>
                    {item.action_required && item.action_url && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); handleActionUrl(item.action_url!) }}
                          className="inline-flex items-center h-6 px-2 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          Take Action
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Panel — Detail */}
          <div className="hidden lg:flex lg:w-2/3 flex-col border border-border rounded-lg overflow-hidden">
            {!selected ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center px-8">
                <Bell className="h-8 w-8 text-muted-foreground opacity-30" />
                <p className="text-sm font-medium text-foreground">Select an item</p>
                <p className="text-xs text-muted-foreground">
                  Click any notification on the left to read it and take action.
                  Items with an <span className="text-warning font-medium">Action</span> badge require a response.
                </p>
              </div>
            ) : (
              <div className="flex flex-col flex-1 overflow-y-auto p-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h2 className="text-base font-semibold text-foreground leading-snug">{selected.title}</h2>
                  <div className="flex gap-2 shrink-0">
                    <Badge variant={priorityVariant(selected.priority)}>
                      {fmtPriority(selected.priority)}
                    </Badge>
                    <Badge variant="secondary">{selected.item_type.replace(/_/g, ' ')}</Badge>
                    {selected.action_required && (
                      <Badge variant="outline" className="text-warning border-warning">Action Required</Badge>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="text-sm text-foreground leading-relaxed bg-muted/30 rounded-md p-4 mb-6 whitespace-pre-wrap">
                  {selected.body}
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground mb-6">
                  <div>
                    <span className="font-medium">Received</span>
                    <br />
                    {new Date(selected.created_at).toLocaleString()}
                  </div>
                  {selected.expires_at && (
                    <div>
                      <span className="font-medium">Expires</span>
                      <br />
                      {new Date(selected.expires_at).toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto pt-4 border-t border-border">
                  {selected.action_url && (
                    <Button
                      size="sm"
                      onClick={() => handleActionUrl(selected.action_url!)}
                    >
                      {selected.action_url.startsWith('http') && !selected.action_url.startsWith(window.location.origin)
                        ? <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        : null
                      }
                      Go to Action
                    </Button>
                  )}
                  {!selected.is_read && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => markRead.mutate(selected.id)}
                      disabled={markRead.isPending}
                    >
                      {markRead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      Mark Read
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
