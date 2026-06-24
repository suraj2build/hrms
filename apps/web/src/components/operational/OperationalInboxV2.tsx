/**
 * OperationalInboxV2 — Phase UX-3
 *
 * Unified inbox aggregating pending items across all modules.
 * Full-page component for /admin/notifications/inbox.
 */
/* eslint-disable react-refresh/only-export-components -- timeAgo is a tiny
   inbox-local formatting helper kept beside its sole consumer; not worth a split. */

import { useState, useMemo, useCallback } from 'react'
import { useQuery }                        from '@tanstack/react-query'
import { useNavigate }                     from 'react-router-dom'
import {
  ClipboardCheck, CalendarCheck, AlertTriangle,
  DollarSign, ShieldAlert, ClipboardEdit,
  ChevronRight, RefreshCw, CheckCheck, Inbox,
} from 'lucide-react'
import { cn }         from '@/lib/utils'
import { api }        from '@/lib/api/client'
import { Button }     from '@/components/ui/button'
import { Badge }      from '@/components/ui/badge'
import { Input }      from '@/components/ui/input'

// ── Types ─────────────────────────────────────────────────────────────────────

export type InboxCategory =
  | 'attendance_approval'
  | 'leave_approval'
  | 'anomaly_review'
  | 'payroll_blocker'
  | 'compliance_alert'
  | 'correction_request'

export interface InboxItem {
  id:            string
  category:      InboxCategory
  title:         string
  subtitle?:     string
  employeeName?: string
  employeeId?:   string
  timestamp:     string
  priority:      'high' | 'medium' | 'low'
  status:        'pending' | 'in_review' | 'escalated'
  actionRoute?:  string
  actionLabel?:  string
}

// Raw API shapes that get adapted to InboxItem
interface RawAnomaly {
  id:           string
  employee_name?: string
  employee_id?:   string
  description?:   string
  detected_at:    string
  severity?:      string
}

interface RawBlocker {
  id:           string
  title?:       string
  description?: string
  created_at:   string
  priority?:    string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function timeAgo(iso: string): string {
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

const PRIORITY_ORDER: Record<InboxItem['priority'], number> = { high: 0, medium: 1, low: 2 }

function sortItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (pd !== 0) return pd
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

// ── Category meta ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<InboxCategory, {
  label: string
  Icon:  React.ComponentType<{ className?: string }>
  color: string
}> = {
  attendance_approval: { label: 'Attendance', Icon: ClipboardCheck, color: 'text-primary' },
  leave_approval:      { label: 'Leave',      Icon: CalendarCheck,  color: 'text-primary' },
  anomaly_review:      { label: 'Anomalies',  Icon: AlertTriangle,  color: 'text-warning' },
  payroll_blocker:     { label: 'Payroll',    Icon: DollarSign,     color: 'text-destructive' },
  compliance_alert:    { label: 'Compliance', Icon: ShieldAlert,    color: 'text-destructive' },
  correction_request:  { label: 'Correction', Icon: ClipboardEdit,  color: 'text-primary' },
}

function CategoryIcon({ category }: { category: InboxCategory }) {
  const meta = CATEGORY_META[category]
  return (
    <div className={cn('mt-0.5 flex-shrink-0', meta.color)}>
      <meta.Icon className="h-4 w-4" />
    </div>
  )
}

function PriorityBadge({ priority }: { priority: InboxItem['priority'] }) {
  const variants: Record<InboxItem['priority'], React.ComponentProps<typeof Badge>['variant']> = {
    high:   'destructive',
    medium: 'warning',
    low:    'secondary',
  }
  return (
    <Badge variant={variants[priority]} className="text-[10px] h-4 px-1.5 py-0 uppercase flex-shrink-0">
      {priority}
    </Badge>
  )
}

// ── KPI strip ─────────────────────────────────────────────────────────────────

interface KpiStripProps {
  total:    number
  highPrio: number
}

function KpiStrip({ total, highPrio }: KpiStripProps) {
  return (
    <div className="flex items-center gap-6 px-5 py-3 border-b border-border bg-card">
      <div className="flex flex-col">
        <span className="text-lg font-bold text-foreground leading-none" aria-live="polite">
          {total}
        </span>
        <span className="text-[11px] text-muted-foreground mt-0.5">Total pending</span>
      </div>

      <div className="h-8 w-px bg-border" />

      <div className="flex flex-col">
        <span className="text-lg font-bold text-destructive leading-none" aria-live="polite">
          {highPrio}
        </span>
        <span className="text-[11px] text-muted-foreground mt-0.5">High priority</span>
      </div>

      <div className="h-8 w-px bg-border" />

      <div className="flex flex-col">
        <span className="text-lg font-bold text-muted-foreground leading-none">—</span>
        <span className="text-[11px] text-muted-foreground mt-0.5">Avg resolution</span>
      </div>
    </div>
  )
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type CategoryFilter = 'all' | InboxCategory
type StatusFilter   = 'all' | InboxItem['status']

const CATEGORY_TABS: { key: CategoryFilter; label: string }[] = [
  { key: 'all',                 label: 'All' },
  { key: 'attendance_approval', label: 'Attendance' },
  { key: 'leave_approval',      label: 'Leave' },
  { key: 'anomaly_review',      label: 'Anomalies' },
  { key: 'payroll_blocker',     label: 'Payroll' },
  { key: 'compliance_alert',    label: 'Compliance' },
]

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'All statuses' },
  { key: 'pending',   label: 'Pending' },
  { key: 'in_review', label: 'In Review' },
  { key: 'escalated', label: 'Escalated' },
]

// ── Inbox row ─────────────────────────────────────────────────────────────────

function InboxRow({ item }: { item: InboxItem }) {
  const navigate = useNavigate()

  function handleClick() {
    if (item.actionRoute) navigate(item.actionRoute)
  }

  return (
    <div
      role="article"
      className="flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      tabIndex={0}
      aria-label={item.title}
    >
      <CategoryIcon category={item.category} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
          <PriorityBadge priority={item.priority} />
        </div>

        {item.subtitle && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>
        )}

        {item.employeeName && (
          <span className="text-xs text-muted-foreground block">{item.employeeName}</span>
        )}

        <span className="text-xs text-muted-foreground">{timeAgo(item.timestamp)}</span>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyInbox() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Inbox className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium text-muted-foreground">Inbox is clear — all caught up!</p>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true" aria-label="Loading inbox">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-border">
          <div className="h-4 w-4 rounded bg-muted animate-pulse mt-0.5 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchInboxItems(): Promise<InboxItem[]> {
  const results = await Promise.allSettled([
    // no /attendance/approvals/pending endpoint — attendance approvals surface via corrections/regularisation
    Promise.resolve({ data: [] as InboxItem[] }),
    api.get<{ data: InboxItem[] }>('/approvals/pending'),
    api.get<{ data: RawAnomaly[] }>('/work-session-anomalies?status=unresolved'),
    api.get<{ data: RawBlocker[] }>('/payroll/blockers?status=open'),
  ])

  const items: InboxItem[] = []

  // Attendance approvals
  if (results[0].status === 'fulfilled') {
    items.push(...results[0].value.data)
  }

  // Leave approvals
  if (results[1].status === 'fulfilled') {
    items.push(...results[1].value.data)
  }

  // Anomalies — adapt to InboxItem shape
  if (results[2].status === 'fulfilled') {
    for (const raw of results[2].value.data) {
      items.push({
        id:           raw.id,
        category:     'anomaly_review',
        title:        raw.description ?? 'Attendance anomaly detected',
        employeeName: raw.employee_name,
        employeeId:   raw.employee_id,
        timestamp:    raw.detected_at,
        priority:     raw.severity === 'high' ? 'high' : raw.severity === 'low' ? 'low' : 'medium',
        status:       'pending',
        actionRoute:  '/admin/attendance/anomalies',
        actionLabel:  'Review',
      })
    }
  }

  // Payroll blockers — adapt to InboxItem shape
  if (results[3].status === 'fulfilled') {
    for (const raw of results[3].value.data) {
      items.push({
        id:          raw.id,
        category:    'payroll_blocker',
        title:       raw.title ?? 'Payroll blocker',
        subtitle:    raw.description,
        timestamp:   raw.created_at,
        priority:    raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
        status:      'pending',
        actionRoute: '/admin/payroll/blockers',
        actionLabel: 'Fix',
      })
    }
  }

  return sortItems(items)
}

// ── Main component ────────────────────────────────────────────────────────────

export function OperationalInboxV2() {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>('all')
  const [search,         setSearch]         = useState('')

  const { data: rawItems = [], isLoading, refetch, isFetching } = useQuery<InboxItem[]>({
    queryKey:  ['operational-inbox'],
    queryFn:   fetchInboxItems,
    staleTime: 60_000,
  })

  const filteredItems = useMemo(() => {
    let items = rawItems

    if (categoryFilter !== 'all') {
      items = items.filter(i => i.category === categoryFilter)
    }
    if (statusFilter !== 'all') {
      items = items.filter(i => i.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      items = items.filter(
        i =>
          i.title.toLowerCase().includes(q) ||
          (i.subtitle ?? '').toLowerCase().includes(q) ||
          (i.employeeName ?? '').toLowerCase().includes(q),
      )
    }

    return items
  }, [rawItems, categoryFilter, statusFilter, search])

  const kpiTotal    = rawItems.length
  const kpiHighPrio = useMemo(() => rawItems.filter(i => i.priority === 'high').length, [rawItems])

  const handleRefresh   = useCallback(() => { void refetch() }, [refetch])
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
  }, [])

  return (
    <div className="flex flex-col h-full bg-background">

      {/* KPI strip */}
      <KpiStrip total={kpiTotal} highPrio={kpiHighPrio} />

      {/* Toolbar */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-border bg-card">

        {/* Category tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setCategoryFilter(tab.key)}
              className={cn(
                'flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                categoryFilter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + status filter + actions */}
        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs flex-1"
            placeholder="Search by title, employee…"
            value={search}
            onChange={handleSearchChange}
          />

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className={cn(
              'h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/50',
            )}
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map(sf => (
              <option key={sf.key} value={sf.key}>{sf.label}</option>
            ))}
          </select>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh inbox"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            aria-label="Mark all read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" role="feed" aria-label="Operational inbox">
        {isLoading ? (
          <InboxSkeleton />
        ) : filteredItems.length === 0 ? (
          <EmptyInbox />
        ) : (
          filteredItems.map(item => <InboxRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  )
}
