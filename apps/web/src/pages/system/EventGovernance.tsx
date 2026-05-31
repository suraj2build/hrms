/**
 * EventGovernance — /system/event-governance
 *
 * Admin-only view of the durable event infrastructure.
 * Log, replay, retention rules, and aggregate stats.
 *
 * Features:
 *   · Event Log       — filterable table, row detail dialog, replay trigger
 *   · Replay Queue    — in-progress replays, cancel pending items
 *   · Retention Rules — CRUD for per-type retention/archive config
 *   · Stats           — by_status cards, by_type table, daily_volume table
 *
 * Access: super_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { useState } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ShieldAlert,
  RefreshCw,
  DatabaseZap,
  Plus,
  X,
  RotateCcw,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { toast }         from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' | 'default' | 'info'

type EventStatus = 'delivered' | 'failed' | 'replayed' | 'dead_lettered'
type ReplayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface EventLogRow {
  id:             string
  created_at:     string
  event_type:     string
  source:         string
  status:         EventStatus
  actor:          string | null
  correlation_id: string | null
  payload:        Record<string, unknown>
}

interface EventLogResponse {
  data:   EventLogRow[]
  total:  number
}

interface ReplayQueueRow {
  id:          string
  event_type:  string
  requested_by: string | null
  status:       ReplayStatus
  attempts:     number
  created_at:   string
}

interface RetentionRule {
  id:                string
  event_type:        string | null
  retention_days:    number
  archive_after_days: number
}

interface EventStats {
  by_status:     Record<string, number>
  by_type:       { event_type: string; count: number }[]
  daily_volume:  { date: string; count: number }[]
}

interface LogFilters {
  event_type:     string
  from:           string
  to:             string
  status:         '' | EventStatus
  correlation_id: string
}

const EMPTY_LOG_FILTERS: LogFilters = {
  event_type:     '',
  from:           '',
  to:             '',
  status:         '',
  correlation_id: '',
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

const EVENT_STATUS_VARIANT: Record<EventStatus, BadgeVariant> = {
  delivered:    'success',
  failed:       'destructive',
  replayed:     'info',
  dead_lettered: 'destructive',
}

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  delivered:    'Delivered',
  failed:       'Failed',
  replayed:     'Replayed',
  dead_lettered: 'Dead Letter',
}

const REPLAY_STATUS_VARIANT: Record<ReplayStatus, BadgeVariant> = {
  pending:   'secondary',
  running:   'info',
  completed: 'success',
  failed:    'destructive',
  cancelled: 'outline',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function fmtDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function truncate(str: string | null, len = 14) {
  if (!str) return '—'
  return str.length > len ? `${str.slice(0, len)}…` : str
}

// ── Tab type ───────────────────────────────────────────────────────────────────

type Tab = 'log' | 'replay' | 'retention' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'log',       label: 'Event Log' },
  { id: 'replay',    label: 'Replay Queue' },
  { id: 'retention', label: 'Retention Rules' },
  { id: 'stats',     label: 'Stats' },
]

// ── Event Detail Dialog ────────────────────────────────────────────────────────

function EventDetailDialog({
  row,
  onClose,
}: {
  row: EventLogRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)

  const replay = useMutation({
    mutationFn: () =>
      api.post('/system/event-governance/replay', {
        event_id: row.id,
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-governance-replay-queue'] })
      setShowReason(false)
      setReason('')
      onClose()
      toast.success('Event queued for replay')
    },
    onError: (e: Error) => toast.error('Failed to queue replay', { description: e.message }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-sm font-semibold text-foreground">{row.event_type}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{row.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={EVENT_STATUS_VARIANT[row.status] ?? 'secondary'} className="text-[10px] rounded-full">
              {EVENT_STATUS_LABEL[row.status] ?? row.status}
            </Badge>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-5 py-3 border-b border-border bg-muted/30 text-xs">
          <div><span className="text-muted-foreground">Source: </span><span className="font-medium text-foreground">{row.source}</span></div>
          <div><span className="text-muted-foreground">Actor: </span><span className="font-medium text-foreground">{row.actor ?? '—'}</span></div>
          <div><span className="text-muted-foreground">Created: </span><span className="font-medium text-foreground">{fmtDatetime(row.created_at)}</span></div>
          <div><span className="text-muted-foreground">Correlation: </span><span className="font-mono text-foreground">{row.correlation_id ?? '—'}</span></div>
        </div>

        {/* Payload */}
        <div className="flex-1 overflow-auto px-5 py-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payload</p>
          <pre className="text-xs bg-muted/40 rounded-lg border border-border p-4 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border space-y-2">
          {showReason ? (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Reason for replay…"
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="h-8 text-xs flex-1"
              />
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={!reason.trim() || replay.isPending}
                onClick={() => replay.mutate()}
              >
                <RotateCcw className="h-3 w-3" />
                {replay.isPending ? 'Replaying…' : 'Confirm Replay'}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowReason(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowReason(true)}
            >
              <RotateCcw className="h-3 w-3" />
              Replay Event
            </Button>
          )}
          {replay.isError && (
            <p className="text-xs text-destructive">Replay failed. Please try again.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add Retention Rule Dialog ──────────────────────────────────────────────────

function AddRetentionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    event_type:         '',
    retention_days:     '',
    archive_after_days: '',
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/system/event-governance/retention-rules', {
        event_type:         form.event_type.trim() || null,
        retention_days:     Number(form.retention_days),
        archive_after_days: Number(form.archive_after_days),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-governance-retention'] })
      onClose()
      toast.success('Retention rule added')
    },
    onError: (e: Error) => toast.error('Failed to add retention rule', { description: e.message }),
  })

  const valid =
    form.retention_days !== '' &&
    Number(form.retention_days) > 0 &&
    form.archive_after_days !== '' &&
    Number(form.archive_after_days) > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Add Retention Rule</p>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Event Type (leave blank for all types)</label>
            <Input
              placeholder="e.g. employee.created"
              value={form.event_type}
              onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Retention Days <span className="text-destructive">*</span></label>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 90"
              value={form.retention_days}
              onChange={e => setForm(p => ({ ...p, retention_days: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Archive After Days <span className="text-destructive">*</span></label>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 30"
              value={form.archive_after_days}
              onChange={e => setForm(p => ({ ...p, archive_after_days: e.target.value }))}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Add Rule'}
          </Button>
        </div>
        {create.isError && (
          <p className="text-xs text-destructive px-5 pb-4">Failed to create rule. Please try again.</p>
        )}
      </div>
    </div>
  )
}

// ── Tab: Event Log ─────────────────────────────────────────────────────────────

function EventLogTab() {
  const [filters,  setFilters]  = useState<LogFilters>(EMPTY_LOG_FILTERS)
  const [applied,  setApplied]  = useState<LogFilters | null>(null)
  const [selected, setSelected] = useState<EventLogRow | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<EventLogResponse>({
    queryKey: ['event-governance-log', applied],
    queryFn: () => {
      if (!applied) return Promise.resolve({ data: [], total: 0 })
      const params = new URLSearchParams()
      if (applied.event_type)     params.set('event_type',     applied.event_type)
      if (applied.from)           params.set('from',           applied.from)
      if (applied.to)             params.set('to',             applied.to)
      if (applied.status)         params.set('status',         applied.status)
      if (applied.correlation_id) params.set('correlation_id', applied.correlation_id)
      return api.get<EventLogResponse>(`/system/event-governance/log?${params}`)
    },
    enabled: applied !== null,
    staleTime: 30_000,
  })

  const rows = data?.data ?? []

  function handleSearch() {
    setApplied({ ...filters })
  }

  return (
    <>
      {selected && (
        <EventDetailDialog row={selected} onClose={() => setSelected(null)} />
      )}

      <SectionCard noPadding>
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-border">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Event Type</label>
            <Input
              placeholder="e.g. employee.created"
              value={filters.event_type}
              onChange={e => setFilters(p => ({ ...p, event_type: e.target.value }))}
              className="h-7 text-xs w-44"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">From</label>
            <DateInput
              value={filters.from}
              onChange={v => setFilters(p => ({ ...p, from: v }))}
              className="h-7 text-xs w-34"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">To</label>
            <DateInput
              value={filters.to}
              onChange={v => setFilters(p => ({ ...p, to: v }))}
              className="h-7 text-xs w-34"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Status</label>
            <select
              value={filters.status}
              onChange={e => setFilters(p => ({ ...p, status: e.target.value as LogFilters['status'] }))}
              className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none focus:ring-1 ring-primary/50"
            >
              <option value="">All</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="replayed">Replayed</option>
              <option value="dead_lettered">Dead Lettered</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Correlation ID</label>
            <Input
              placeholder="correlation id…"
              value={filters.correlation_id}
              onChange={e => setFilters(p => ({ ...p, correlation_id: e.target.value }))}
              className="h-7 text-xs w-40"
            />
          </div>
          <Button size="sm" className="h-7 text-xs self-end" onClick={handleSearch}>
            Search
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 self-end"
            onClick={() => refetch()}
            disabled={isLoading}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                <div className="h-3 w-28 bg-muted rounded" />
                <div className="h-3 w-36 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-5 w-20 bg-muted rounded-full" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-3 w-32 bg-muted rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-destructive">Failed to load event log</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {/* Prompt state */}
        {!isLoading && !isError && applied === null && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <DatabaseZap className="h-8 w-8 opacity-40" />
            <p className="text-sm">Apply filters and press Search to load events.</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && applied !== null && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm">No events match the current filters.</p>
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Created At', 'Event Type', 'Source', 'Status', 'Actor', 'Correlation ID'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr
                    key={row.id}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => setSelected(row)}
                  >
                    <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtDatetime(row.created_at)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs font-mono text-foreground">
                      {row.event_type}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs text-foreground">
                      {row.source}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <Badge
                        variant={EVENT_STATUS_VARIANT[row.status] ?? 'secondary'}
                        className="text-[10px] rounded-full"
                      >
                        {EVENT_STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-xs text-muted-foreground">
                      {row.actor ?? '—'}
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                      {truncate(row.correlation_id, 18)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

// ── Tab: Replay Queue ──────────────────────────────────────────────────────────

function ReplayQueueTab() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'' | ReplayStatus>('')

  const { data, isLoading, isError, refetch } = useQuery<ReplayQueueRow[]>({
    queryKey: ['event-governance-replay-queue', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      return api.get<ReplayQueueRow[]>(`/system/event-governance/replay-queue?${params}`)
    },
    staleTime: 15_000,
  })

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.put(`/system/event-governance/replay-queue/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-governance-replay-queue'] })
      toast.success('Replay cancelled')
    },
    onError: (e: Error) => toast.error('Failed to cancel replay', { description: e.message }),
  })

  const rows = data ?? []

  return (
    <SectionCard noPadding>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as '' | ReplayStatus)}
          className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none focus:ring-1 ring-primary/50"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => refetch()}
          disabled={isLoading}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading && (
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
              <div className="h-3 w-36 bg-muted rounded" />
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="h-5 w-16 bg-muted rounded-full" />
              <div className="h-3 w-8 bg-muted rounded" />
              <div className="h-3 w-28 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-destructive">Failed to load replay queue</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <p className="text-sm">No replay queue entries found.</p>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Event Type', 'Requested By', 'Status', 'Attempts', 'Created At', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-3 whitespace-nowrap text-xs font-mono text-foreground">
                    {row.event_type}
                  </td>
                  <td className="py-3 px-3 text-xs text-muted-foreground">
                    {row.requested_by ?? '—'}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <Badge
                      variant={REPLAY_STATUS_VARIANT[row.status] ?? 'secondary'}
                      className="text-[10px] rounded-full capitalize"
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 text-xs text-muted-foreground tabular-nums">
                    {row.attempts}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    {fmtDatetime(row.created_at)}
                  </td>
                  <td className="py-3 px-3">
                    {row.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 text-destructive border-destructive/40 hover:bg-destructive/5"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(row.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ── Tab: Retention Rules ───────────────────────────────────────────────────────

function RetentionRulesTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery<RetentionRule[]>({
    queryKey: ['event-governance-retention'],
    queryFn: () => api.get<RetentionRule[]>('/system/event-governance/retention-rules'),
    staleTime: 60_000,
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/system/event-governance/retention-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['event-governance-retention'] })
      toast.success('Retention rule removed')
    },
    onError: (e: Error) => toast.error('Failed to remove retention rule', { description: e.message }),
  })

  const rules = data ?? []

  return (
    <>
      {showAdd && <AddRetentionDialog onClose={() => setShowAdd(false)} />}

      <SectionCard noPadding>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {rules.length} rule{rules.length !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => refetch()}
              disabled={isLoading}
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3 w-3" />
              Add Rule
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                <div className="h-3 w-40 bg-muted rounded" />
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-3 w-20 bg-muted rounded" />
                <div className="h-6 w-14 bg-muted rounded ml-auto" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-destructive">Failed to load retention rules</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm">No retention rules configured.</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add the first rule
            </Button>
          </div>
        )}

        {!isLoading && !isError && rules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Event Type', 'Retention Days', 'Archive After Days', 'Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 text-xs font-mono text-foreground">
                      {rule.event_type ?? (
                        <span className="italic text-muted-foreground">All Types</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-foreground tabular-nums">
                      {rule.retention_days}d
                    </td>
                    <td className="py-3 px-3 text-xs text-foreground tabular-nums">
                      {rule.archive_after_days}d
                    </td>
                    <td className="py-3 px-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/5"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(rule.id)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  )
}

// ── Tab: Stats ─────────────────────────────────────────────────────────────────

function StatsTab() {
  const { data, isLoading, isError, refetch } = useQuery<EventStats>({
    queryKey: ['event-governance-stats'],
    queryFn:  () => api.get<EventStats>('/system/event-governance/stats'),
    staleTime: 60_000,
  })

  const byStatus   = data?.by_status  ?? {}
  const byType     = data?.by_type    ?? []
  const dailyVol   = data?.daily_volume ?? []

  const sortedByType = [...byType].sort((a, b) => b.count - a.count)

  const statusOrder: string[] = ['delivered', 'failed', 'replayed', 'dead_lettered']
  const STATUS_CARD_COLORS: Record<string, string> = {
    delivered:    'text-success',
    failed:       'text-destructive',
    replayed:     'text-info',
    dead_lettered: 'text-destructive',
  }

  return (
    <div className="space-y-4">
      {/* Refresh */}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 animate-pulse">
              <div className="h-2 w-16 bg-muted rounded mb-2" />
              <div className="h-7 w-12 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-destructive">Failed to load stats</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* By status cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statusOrder.map(key => (
              <div key={key} className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">
                  {key.replace(/_/g, ' ')}
                </p>
                <p className={`text-2xl font-bold tabular-nums ${STATUS_CARD_COLORS[key] ?? 'text-foreground'}`}>
                  {(byStatus[key] ?? 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {/* By type */}
          <SectionCard title="Events by Type" noPadding>
            {sortedByType.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Event Type</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-3">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedByType.map(row => (
                      <tr key={row.event_type} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-3 text-xs font-mono text-foreground">{row.event_type}</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right font-semibold text-foreground">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Daily volume */}
          <SectionCard title="Daily Volume" noPadding>
            {dailyVol.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No data available.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Date</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-3">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyVol.map(row => (
                      <tr key={row.date} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-3 text-xs text-foreground tabular-nums">{fmtDate(row.date)}</td>
                        <td className="py-2 px-3 text-xs tabular-nums text-right text-foreground">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EventGovernance() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin'

  const [activeTab, setActiveTab] = useState<Tab>('log')

  return (
    <PageContainer>
      <PageHeader
        title="Event Governance"
        subtitle="Durable event infrastructure — log, replay, and retention"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only super admins can access Event Governance.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-border pb-0 mb-4">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'px-4 py-2 text-sm font-medium transition-colors rounded-t-md border-b-2 -mb-px',
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'log'       && <EventLogTab />}
          {activeTab === 'replay'    && <ReplayQueueTab />}
          {activeTab === 'retention' && <RetentionRulesTab />}
          {activeTab === 'stats'     && <StatsTab />}
        </>
      )}
    </PageContainer>
  )
}
