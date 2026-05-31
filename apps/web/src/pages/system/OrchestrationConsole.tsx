/**
 * OrchestrationConsole — /system/orchestration
 *
 * Admin-only view of the worker orchestration layer.
 * Registry, queue pressure, long-running job governance, and health.
 *
 * Features:
 *   · Workers          — live worker registry, heartbeat, drain control
 *   · Queue Partitions — queue depth, pressure, partition assignment
 *   · Jobs             — filterable job table, progress, cancel
 *   · Health           — overall health card, key metrics, auto-refresh
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
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { toast }         from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' | 'default' | 'info'

type WorkerStatus  = 'active' | 'idle' | 'draining' | 'stopped' | 'crashed'
type QueuePressure = 'low' | 'normal' | 'elevated' | 'critical'
type JobStatus     = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
type OverallHealth = 'healthy' | 'degraded' | 'critical'

interface Worker {
  worker_id:       string
  type:            string
  host:            string
  status:          WorkerStatus
  last_heartbeat:  string
  current_job:     string | null
  jobs_processed:  number
  failed:          number
}

interface WorkersResponse {
  active_count:  number
  idle_count:    number
  crashed_count: number
  workers:       Worker[]
}

interface QueuePartition {
  queue:             string
  partition_key:     string | null
  depth:             number
  pressure:          QueuePressure
  assigned_worker:   string | null
  last_processed:    string | null
}

interface QueueResponse {
  total_depth:    number
  critical_count: number
  elevated_count: number
  partitions:     QueuePartition[]
}

interface Job {
  id:           string
  job_type:     string
  key:          string | null
  status:       JobStatus
  started_at:   string | null
  progress_pct: number | null
  duration_ms:  number | null
  worker_id:    string | null
}

interface JobsResponse {
  data: Job[]
}

interface HealthResponse {
  overall_health:   OverallHealth
  workers_active:   number
  max_queue_depth:  number
  stuck_jobs:       number
  failed_last_hour: number
}

interface JobFilters {
  status:   '' | JobStatus
  job_type: string
}

const EMPTY_JOB_FILTERS: JobFilters = { status: '', job_type: '' }

// ── Badge helpers ──────────────────────────────────────────────────────────────

const WORKER_STATUS_VARIANT: Record<WorkerStatus, BadgeVariant> = {
  active:   'success',
  idle:     'secondary',
  draining: 'warning',
  stopped:  'outline',
  crashed:  'destructive',
}

const PRESSURE_VARIANT: Record<QueuePressure, BadgeVariant> = {
  low:      'success',
  normal:   'secondary',
  elevated: 'warning',
  critical: 'destructive',
}

const JOB_STATUS_VARIANT: Record<JobStatus, BadgeVariant> = {
  pending:   'secondary',
  running:   'info',
  completed: 'success',
  failed:    'destructive',
  cancelled: 'outline',
  timed_out: 'destructive',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function fmtDuration(ms: number | null) {
  if (ms === null) return '—'
  if (ms < 1000)   return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function truncate(str: string | null, len = 16) {
  if (!str) return '—'
  return str.length > len ? `${str.slice(0, len)}…` : str
}

// ── Tab type ───────────────────────────────────────────────────────────────────

type Tab = 'workers' | 'queues' | 'jobs' | 'health'

const TABS: { id: Tab; label: string }[] = [
  { id: 'workers', label: 'Workers' },
  { id: 'queues',  label: 'Queue Partitions' },
  { id: 'jobs',    label: 'Jobs' },
  { id: 'health',  label: 'Health' },
]

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueClass = 'text-foreground',
}: {
  label:       string
  value:       number | string
  valueClass?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[10px] text-muted-foreground mb-0.5 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}

// ── Tab: Workers ───────────────────────────────────────────────────────────────

function WorkersTab() {
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery<WorkersResponse>({
    queryKey: ['orchestration-workers'],
    queryFn:  () => api.get<WorkersResponse>('/system/orchestration/workers'),
    staleTime: 15_000,
  })

  const drain = useMutation({
    mutationFn: (worker_id: string) =>
      api.put(`/system/orchestration/workers/${worker_id}/status`, { status: 'draining' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orchestration-workers'] })
      toast.success('Worker set to draining')
    },
    onError: (e: Error) => {
      toast.error('Failed to drain worker', { description: e.message })
    },
  })

  const workers = data?.workers ?? []

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active"  value={isLoading ? '—' : (data?.active_count  ?? 0)} valueClass="text-success" />
        <StatCard label="Idle"    value={isLoading ? '—' : (data?.idle_count    ?? 0)} valueClass="text-muted-foreground" />
        <StatCard label="Crashed" value={isLoading ? '—' : (data?.crashed_count ?? 0)} valueClass="text-destructive" />
      </div>

      <SectionCard noPadding>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {workers.length} worker{workers.length !== 1 ? 's' : ''}
          </p>
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
                <div className="h-3 w-32 bg-muted rounded" />
                <div className="h-3 w-20 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-5 w-16 bg-muted rounded-full" />
                <div className="h-3 w-28 bg-muted rounded" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-destructive">Failed to load workers</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && workers.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm">No workers registered.</p>
          </div>
        )}

        {!isLoading && !isError && workers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Worker ID', 'Type', 'Host', 'Status', 'Last Heartbeat', 'Current Job', 'Processed', 'Failed', 'Actions'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map(w => (
                  <tr key={w.worker_id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 text-xs font-mono text-foreground">
                      {truncate(w.worker_id, 20)}
                    </td>
                    <td className="py-3 px-3 text-xs text-foreground">{w.type}</td>
                    <td className="py-3 px-3 text-xs text-muted-foreground">{w.host}</td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <Badge
                        variant={WORKER_STATUS_VARIANT[w.status] ?? 'secondary'}
                        className="text-[10px] rounded-full capitalize"
                      >
                        {w.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtDatetime(w.last_heartbeat)}
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                      {truncate(w.current_job, 20)}
                    </td>
                    <td className="py-3 px-3 text-xs tabular-nums text-foreground text-right">
                      {w.jobs_processed.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-xs tabular-nums text-destructive text-right">
                      {w.failed.toLocaleString()}
                    </td>
                    <td className="py-3 px-3">
                      {w.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 text-warning border-warning/40 hover:bg-warning/5"
                          disabled={drain.isPending}
                          onClick={() => drain.mutate(w.worker_id)}
                        >
                          Drain
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
    </div>
  )
}

// ── Tab: Queue Partitions ──────────────────────────────────────────────────────

function QueuePartitionsTab() {
  const { data, isLoading, isError, refetch } = useQuery<QueueResponse>({
    queryKey: ['orchestration-queues'],
    queryFn:  () => api.get<QueueResponse>('/system/orchestration/queues'),
    staleTime: 15_000,
  })

  const partitions = data?.partitions ?? []

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Depth"    value={isLoading ? '—' : (data?.total_depth    ?? 0)} />
        <StatCard label="Critical Queues" value={isLoading ? '—' : (data?.critical_count ?? 0)} valueClass="text-destructive" />
        <StatCard label="Elevated Queues" value={isLoading ? '—' : (data?.elevated_count ?? 0)} valueClass="text-warning" />
      </div>

      <SectionCard noPadding>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {partitions.length} partition{partitions.length !== 1 ? 's' : ''}
          </p>
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
                <div className="h-3 w-28 bg-muted rounded" />
                <div className="h-3 w-20 bg-muted rounded" />
                <div className="h-3 w-10 bg-muted rounded" />
                <div className="h-5 w-16 bg-muted rounded-full" />
                <div className="h-3 w-24 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-2 py-12">
            <p className="text-sm text-destructive">Failed to load queues</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        )}

        {!isLoading && !isError && partitions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm">No queue partitions found.</p>
          </div>
        )}

        {!isLoading && !isError && partitions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Queue', 'Partition Key', 'Depth', 'Pressure', 'Assigned Worker', 'Last Processed'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {partitions.map((p, idx) => (
                  <tr key={`${p.queue}-${p.partition_key ?? idx}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3 text-xs font-mono text-foreground">{p.queue}</td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                      {p.partition_key ?? <span className="italic">default</span>}
                    </td>
                    <td className="py-3 px-3 text-xs tabular-nums">
                      {p.depth > 0
                        ? <span className="font-bold text-foreground">{p.depth.toLocaleString()}</span>
                        : <span className="text-muted-foreground">0</span>
                      }
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <Badge
                        variant={PRESSURE_VARIANT[p.pressure] ?? 'secondary'}
                        className="text-[10px] rounded-full capitalize"
                      >
                        {p.pressure}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                      {truncate(p.assigned_worker, 20)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {fmtDatetime(p.last_processed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">{clamped}%</span>
    </div>
  )
}

// ── Tab: Jobs ──────────────────────────────────────────────────────────────────

function JobsTab() {
  const qc = useQueryClient()
  const [filters,  setFilters]  = useState<JobFilters>(EMPTY_JOB_FILTERS)
  const [applied,  setApplied]  = useState<JobFilters | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<JobsResponse>({
    queryKey: ['orchestration-jobs', applied],
    queryFn: () => {
      if (!applied) return Promise.resolve({ data: [] })
      const params = new URLSearchParams()
      if (applied.status)   params.set('status',   applied.status)
      if (applied.job_type) params.set('job_type', applied.job_type)
      return api.get<JobsResponse>(`/system/orchestration/jobs?${params}`)
    },
    enabled: applied !== null,
    staleTime: 15_000,
  })

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.post(`/system/orchestration/jobs/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orchestration-jobs'] })
      toast.success('Job cancelled')
    },
    onError: (e: Error) => {
      toast.error('Failed to cancel job', { description: e.message })
    },
  })

  const jobs = data?.data ?? []

  function handleSearch() {
    setApplied({ ...filters })
  }

  return (
    <SectionCard noPadding>
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-border">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Status</label>
          <select
            value={filters.status}
            onChange={e => setFilters(p => ({ ...p, status: e.target.value as JobFilters['status'] }))}
            className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none focus:ring-1 ring-primary/50"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="timed_out">Timed Out</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Job Type</label>
          <Input
            placeholder="e.g. payroll.calculate"
            value={filters.job_type}
            onChange={e => setFilters(p => ({ ...p, job_type: e.target.value }))}
            className="h-7 text-xs w-44"
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

      {isLoading && (
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
              <div className="h-3 w-32 bg-muted rounded" />
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-5 w-16 bg-muted rounded-full" />
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="h-2 w-20 bg-muted rounded-full" />
              <div className="h-3 w-12 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-destructive">Failed to load jobs</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && applied === null && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <Activity className="h-8 w-8 opacity-40" />
          <p className="text-sm">Apply filters and press Search to load jobs.</p>
        </div>
      )}

      {!isLoading && !isError && applied !== null && jobs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <p className="text-sm">No jobs match the current filters.</p>
        </div>
      )}

      {!isLoading && !isError && jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Job Type', 'Key', 'Status', 'Started At', 'Progress', 'Duration', 'Worker ID', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-3 text-xs font-mono text-foreground">{job.job_type}</td>
                  <td className="py-3 px-3 text-xs font-mono text-muted-foreground">{truncate(job.key)}</td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <Badge
                      variant={JOB_STATUS_VARIANT[job.status] ?? 'secondary'}
                      className="text-[10px] rounded-full capitalize"
                    >
                      {job.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    {fmtDatetime(job.started_at)}
                  </td>
                  <td className="py-3 px-3">
                    {job.progress_pct !== null
                      ? <ProgressBar pct={job.progress_pct} />
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    {fmtDuration(job.duration_ms)}
                  </td>
                  <td className="py-3 px-3 text-xs font-mono text-muted-foreground">
                    {truncate(job.worker_id, 16)}
                  </td>
                  <td className="py-3 px-3">
                    {(job.status === 'pending' || job.status === 'running') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2 text-destructive border-destructive/40 hover:bg-destructive/5"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(job.id)}
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

// ── Tab: Health ────────────────────────────────────────────────────────────────

const HEALTH_CONFIG: Record<
  OverallHealth,
  { variant: BadgeVariant; icon: React.ReactNode; label: string; ringClass: string }
> = {
  healthy:  {
    variant:   'success',
    icon:      <CheckCircle2 className="h-10 w-10 text-success" />,
    label:     'Healthy',
    ringClass: 'ring-success/30',
  },
  degraded: {
    variant:   'warning',
    icon:      <AlertTriangle className="h-10 w-10 text-warning" />,
    label:     'Degraded',
    ringClass: 'ring-warning/30',
  },
  critical: {
    variant:   'destructive',
    icon:      <XCircle className="h-10 w-10 text-destructive" />,
    label:     'Critical',
    ringClass: 'ring-destructive/30',
  },
}

function HealthTab() {
  const { data, isLoading, isError, refetch } = useQuery<HealthResponse>({
    queryKey:      ['orchestration-health'],
    queryFn:       () => api.get<HealthResponse>('/system/orchestration/health'),
    staleTime:     30_000,
    refetchInterval: 30_000,
  })

  const cfg = data ? (HEALTH_CONFIG[data.overall_health] ?? HEALTH_CONFIG.healthy) : null

  return (
    <div className="space-y-4">
      {/* Auto-refresh note */}
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">Auto-refreshes every 30 seconds</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh now
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-16 gap-4 animate-pulse">
            <div className="h-16 w-16 rounded-full bg-muted" />
            <div className="h-6 w-24 bg-muted rounded" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 animate-pulse">
                <div className="h-2 w-20 bg-muted rounded mb-2" />
                <div className="h-7 w-12 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="text-sm text-destructive">Failed to load health data</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && data && cfg && (
        <>
          {/* Large health indicator */}
          <div className="flex flex-col items-center justify-center gap-4 py-12 rounded-xl border border-border bg-card">
            <div className={`p-4 rounded-full ring-4 ${cfg.ringClass} bg-card`}>
              {cfg.icon}
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{cfg.label}</p>
              <p className="text-xs text-muted-foreground mt-1">Overall system health</p>
            </div>
            <Badge variant={cfg.variant} className="text-xs px-3 py-1 rounded-full">
              {data.overall_health.toUpperCase()}
            </Badge>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Workers Active"
              value={data.workers_active}
              valueClass="text-success"
            />
            <StatCard
              label="Max Queue Depth"
              value={data.max_queue_depth}
              valueClass={data.max_queue_depth > 100 ? 'text-destructive' : data.max_queue_depth > 50 ? 'text-warning' : 'text-foreground'}
            />
            <StatCard
              label="Stuck Jobs"
              value={data.stuck_jobs}
              valueClass={data.stuck_jobs > 0 ? 'text-destructive' : 'text-foreground'}
            />
            <StatCard
              label="Failed (Last Hour)"
              value={data.failed_last_hour}
              valueClass={data.failed_last_hour > 0 ? 'text-destructive' : 'text-foreground'}
            />
          </div>
        </>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OrchestrationConsole() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin'

  const [activeTab, setActiveTab] = useState<Tab>('workers')

  return (
    <PageContainer>
      <PageHeader
        title="Orchestration Console"
        subtitle="Worker registry, queue pressure, and long-running job governance"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only super admins can access the Orchestration Console.</p>
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
          {activeTab === 'workers' && <WorkersTab />}
          {activeTab === 'queues'  && <QueuePartitionsTab />}
          {activeTab === 'jobs'    && <JobsTab />}
          {activeTab === 'health'  && <HealthTab />}
        </>
      )}
    </PageContainer>
  )
}
