/**
 * ObservabilityConsole — /admin/system/observability
 *
 * Phase 8 — Platform Observability Console.
 * Real-time view of the event bus, job queue, module health, and
 * platform startup checks — all in one authenticated operator workspace.
 *
 * Sections:
 *  1. Platform overview stat cards (in-memory)
 *  2. Scheduler stale warning banner (DB-backed)
 *  3. Scheduler Health (DB-backed heartbeats)
 *  4. Durable Queue Health (live DB counts)
 *  5. Durable Dead-Letter Queue (per-job requeue)
 *  6. Retry Storm Detection (open incidents + acknowledge)
 *  7. Quarantined Jobs (poison jobs + clear quarantine)
 *  8. Module Registry (in-memory)
 *  9. Startup Health Checks (in-memory)
 * 10. Event Bus — Emission by Type (in-memory)
 * 11. Job Queue — Metrics by Type (in-memory)
 * 12. Dead-Letter Queue — legacy in-memory
 *
 * Refresh: every 30s (auto) + manual refresh button.
 * Access: super_admin / hr_admin only.
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity, Zap, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, ShieldAlert, Server, Clock, Database,
  Radio, Box, Trash2, Heart, RotateCcw, Ban, CloudLightning, Cpu, Upload, ScrollText,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { AsyncStatusBadge } from '@/components/async'
import { toast }            from 'sonner'

// ── Types — in-memory observability ───────────────────────────────────────────

interface HealthCheck {
  name:      string
  status:    'ok' | 'degraded' | 'failed' | 'skipped'
  latencyMs: number
  message?:  string
}

interface EventBusType {
  type:        string
  emitted:     number
  failed:      number
  failurePct:  number
}

interface JobMetricRow {
  type:      string
  enqueued:  number
  started:   number
  completed: number
  failed:    number
  retried:   number
  dead:      number
}

interface DeadJob {
  id:       string
  type:     string
  error:    string | null
  failedAt: string | null
  attempts: number
}

interface ObservabilityData {
  timestamp: string
  platform: {
    status:        'ok' | 'degraded' | 'unavailable'
    startedAt:     string
    uptimeSeconds: number
    modules:       Record<string, boolean>
    checks:        HealthCheck[]
  }
  event_bus: {
    handler_count:    number
    total_emitted:    number
    total_failed:     number
    failure_rate_pct: number
    by_type:          EventBusType[]
  }
  job_queue: {
    pending:     number
    running:     number
    completed:   number
    dead_letter: number
    by_type:     JobMetricRow[]
    recent_dead: DeadJob[]
  }
}

// ── Types — durable queue (DB-backed) ─────────────────────────────────────────

interface DurableQueueMetrics {
  pending:   number
  running:   number
  completed: number
  dead:      number
  by_type:   Record<string, { pending: number; running: number; dead: number }>
}

interface DurableDeadJob {
  id:               string
  job_type:         string
  status:           string
  attempt:          number
  max_retries:      number
  failed_at:        string | null
  error:            string | null
  failure_category: string | null
  tenant_id:        string | null
}

interface StormIncident {
  id:           string
  job_type:     string
  tenant_id:    string | null
  dead_count:   number
  first_dead_at: string
  last_dead_at:  string
  detected_at:  string | null
  status:       string
}

interface QuarantinedJob {
  job_id:        string
  job_type:      string
  requeue_count: number
  is_quarantined: boolean
}

interface SchedulerHeartbeat {
  scheduler_name:    string
  tenant_id:         string | null
  last_heartbeat_at: string | null
  status:            string
  tick_count:        number
  last_error:        string | null
  age_seconds:       number | null
  is_stale:          boolean
}

interface UploadSession {
  id:               string
  upload_type:      string
  status:           string
  storage_path:     string | null
  file_name:        string | null
  file_size:        number | null
  mime_type:        string | null
  reference_id:     string | null
  reference_type:   string | null
  result_summary:   Record<string, unknown> | null
  error_message:    string | null
  upload_completed_at: string | null
  expires_at:       string
  created_at:       string
}

interface EventGovernanceEntry {
  id:             string
  event_type:     string
  status:         string
  correlation_id: string | null
  actor_name:     string | null
  payload:        Record<string, unknown> | null
  error:          string | null
  metadata:       Record<string, unknown> | null
  created_at:     string
}

interface AttendanceUploadHealth {
  status:   'healthy' | 'degraded' | 'critical'
  summary: {
    total_last_30d:   number
    completed:        number
    failed:           number
    orphaned:         number
    partial_failures: number
    replay_uploads:   number
  }
  recent_failures: Array<{
    id:            string
    file_name:     string | null
    created_at:    string
    error_message: string | null
    result_summary: Record<string, unknown> | null
  }>
  last_successful_upload: string | null
}

interface ImportJobSummary {
  id:           string
  master_type:  string
  mode:         string
  file_name:    string | null
  status:       string
  total_rows:   number | null
  valid_rows:   number | null
  failed_rows:  number | null
  created_rows: number | null
  updated_rows: number | null
  created_at:   string
  duration_ms:  number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function fmtRelativeTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date   = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60)            return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60)            return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)             return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays === 1)          return 'Yesterday'
  if (diffDays < 7)            return `${diffDays}d ago`
  return date.toLocaleString()
}

function eventLogSeverityBorder(entry: EventGovernanceEntry): string {
  if (entry.error || entry.status === 'failed')   return 'border-l-2 border-l-red-500'
  if (entry.status === 'degraded')                return 'border-l-2 border-l-orange-500'
  if (entry.status === 'warning')                 return 'border-l-2 border-l-amber-400'
  return 'border-l-2 border-l-blue-400'
}

function fmtAge(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60)    return `${seconds}s ago`
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={cn(
      'inline-block w-2 h-2 rounded-full flex-shrink-0',
      ok ? 'bg-success' : 'bg-destructive',
    )} />
  )
}

function PlatformStatusBadge({ status }: { status: string }) {
  const variant: 'success' | 'warning' | 'destructive' =
    status === 'ok'       ? 'success' :
    status === 'degraded' ? 'warning' :
    'destructive'
  return (
    <Badge variant={variant} className="rounded-full capitalize text-[10px]">
      {status}
    </Badge>
  )
}

function CheckStatusBadge({ status }: { status: HealthCheck['status'] }) {
  const variant: 'success' | 'warning' | 'destructive' | 'secondary' =
    status === 'ok'      ? 'success' :
    status === 'degraded'? 'warning' :
    status === 'failed'  ? 'destructive' :
    'secondary'
  return (
    <Badge variant={variant} className="rounded-full text-[10px] capitalize">
      {status}
    </Badge>
  )
}

function SchedulerStatusBadge({ status, isStale }: { status: string; isStale: boolean }) {
  if (isStale) return <Badge variant="destructive" className="rounded-full text-[10px]">stale</Badge>
  const variant: 'success' | 'warning' | 'destructive' | 'secondary' =
    status === 'running' ? 'success' :
    status === 'stopped' ? 'secondary' :
    status === 'error'   ? 'destructive' :
    'warning'
  return (
    <Badge variant={variant} className="rounded-full text-[10px] capitalize">
      {status}
    </Badge>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ObservabilityConsole() {
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [purgingDead, setPurgingDead] = useState(false)

  // ── Existing in-memory observability query ───────────────────────────────────
  const {
    data: resp,
    isLoading,
    isFetching: isObsFetching,
    isError,
    dataUpdatedAt,
  } = useQuery<{ data: ObservabilityData }>({
    queryKey:        ['system-observability'],
    queryFn:         () => api.get('/system/observability'),
    enabled:         isAdmin,
    staleTime:       30_000,
    refetchInterval: 30_000,
  })

  // ── Durable queue — live DB counts ──────────────────────────────────────────
  // staleTime aligned to refetchInterval so a remount within 15 s doesn't double-fetch.
  const { data: durableResp } =
    useQuery<{ data: DurableQueueMetrics }>({
      queryKey:        ['durable-queue'],
      queryFn:         () => api.get('/system/jobs/durable'),
      enabled:         isAdmin,
      staleTime:       15_000,
      refetchInterval: 15_000,
    })

  // ── Durable dead-letter jobs ─────────────────────────────────────────────────
  const { data: durableDeadResp } =
    useQuery<{ data: DurableDeadJob[]; total: number }>({
      queryKey:        ['durable-dead-jobs'],
      queryFn:         () => api.get('/system/jobs/durable/dead'),
      enabled:         isAdmin,
      staleTime:       15_000,
      refetchInterval: 15_000,
    })

  // ── Retry storm open incidents ───────────────────────────────────────────────
  const { data: stormResp } =
    useQuery<{ data: StormIncident[]; total: number }>({
      queryKey:        ['retry-storm-incidents'],
      queryFn:         () => api.get('/system/jobs/durable/retry-storm/open'),
      enabled:         isAdmin,
      staleTime:       15_000,
      refetchInterval: 15_000,
    })

  // ── Quarantined jobs ─────────────────────────────────────────────────────────
  const { data: quarantineResp } =
    useQuery<{ data: QuarantinedJob[]; total: number }>({
      queryKey:        ['quarantined-jobs'],
      queryFn:         () => api.get('/system/jobs/durable/quarantine'),
      enabled:         isAdmin,
      staleTime:       30_000,
      refetchInterval: 30_000,
    })

  // ── Scheduler heartbeats ─────────────────────────────────────────────────────
  const { data: schedulerResp } =
    useQuery<{ data: SchedulerHeartbeat[]; stale_count: number; healthy: boolean }>({
      queryKey:        ['scheduler-health'],
      queryFn:         () => api.get('/system/scheduler-health'),
      enabled:         isAdmin,
      staleTime:       30_000,
      refetchInterval: 30_000,
    })

  // ── Upload sessions (recent 50, incl. orphans/failures) ─────────────────────
  const { data: uploadSessionsResp } =
    useQuery<{ data: UploadSession[] }>({
      queryKey:        ['upload-sessions-obs'],
      queryFn:         () => api.get('/uploads/sessions?limit=50'),
      enabled:         isAdmin,
      staleTime:       30_000,
      refetchInterval: 30_000,
    })

  // ── Event governance log (recent 30 tenant-scoped events) ────────────────────
  // Slow-changing audit log — 60 s stale / 60 s interval.
  const { data: eventLogResp } =
    useQuery<{ data: EventGovernanceEntry[] }>({
      queryKey:        ['event-governance-log'],
      queryFn:         () => api.get('/system/event-governance/log?limit=30'),
      enabled:         isAdmin,
      staleTime:       60_000,
      refetchInterval: 60_000,
    })

  // ── Attendance upload health — shared key with AttendanceUploadWorkspace ─────
  // Use the slower 120 s interval here; the workspace drives its own 30 s interval
  // when mounted. React Query will pick the fastest active subscriber's interval.
  const { data: uploadHealthResp } =
    useQuery<AttendanceUploadHealth>({
      queryKey:        ['attendance-upload-health'],
      queryFn:         () => api.get('/attendance/upload-health'),
      enabled:         isAdmin,
      staleTime:       120_000,
      refetchInterval: 120_000,
    })

  // ── Master import jobs — low-churn history ────────────────────────────────────
  const { data: recentImportsResp } =
    useQuery<{ data: ImportJobSummary[]; total: number }>({
      queryKey:        ['import-jobs-recent'],
      queryFn:         () => api.get('/import/jobs?limit=20'),
      enabled:         isAdmin,
      staleTime:       60_000,
      refetchInterval: 60_000,
    })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const requeueMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.post(`/system/jobs/durable/dead/${jobId}/requeue`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['durable-dead-jobs'], exact: true })
      qc.invalidateQueries({ queryKey: ['durable-queue'],     exact: true })
    },
    onError: (e: Error) => toast.error('Failed to requeue job', { description: e.message }),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (incidentId: string) =>
      api.post(`/system/jobs/durable/retry-storm/${incidentId}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retry-storm-incidents'], exact: true })
    },
    onError: (e: Error) => toast.error('Failed to acknowledge storm incident', { description: e.message }),
  })

  const clearQuarantineMutation = useMutation({
    mutationFn: (jobId: string) =>
      api.delete(`/system/jobs/durable/quarantine/${jobId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quarantined-jobs'],  exact: true })
      qc.invalidateQueries({ queryKey: ['durable-dead-jobs'], exact: true })
    },
    onError: (e: Error) => toast.error('Failed to clear job quarantine', { description: e.message }),
  })

  // ── Derived state ────────────────────────────────────────────────────────────

  const obs              = resp?.data
  const durableMetrics   = durableResp?.data
  const durableDeadJobs  = durableDeadResp?.data ?? []
  const stormIncidents   = stormResp?.data ?? []
  const quarantinedJobs  = quarantineResp?.data ?? []
  const schedulerRows    = schedulerResp?.data ?? []
  const uploadSessions   = uploadSessionsResp?.data ?? []
  const eventLogEntries  = eventLogResp?.data ?? []
  const uploadHealth     = uploadHealthResp ?? null
  const recentImports    = recentImportsResp?.data ?? []
  const hasStaleScheduler = (schedulerResp?.stale_count ?? 0) > 0 ||
    schedulerRows.some(r => r.status === 'error')

  // ── Refresh All ──────────────────────────────────────────────────────────────
  // Uses invalidateQueries (not individual refetch()) so React Query schedules
  // background refetches through its normal deduplication pipeline.
  // Targeted exact keys prevent cascade-invalidating unrelated queries.
  function handleRefreshAll() {
    const fastKeys   = [['durable-queue'], ['durable-dead-jobs'], ['retry-storm-incidents']]
    const normalKeys = [['system-observability'], ['quarantined-jobs'], ['scheduler-health'], ['upload-sessions-obs']]
    const slowKeys   = [['event-governance-log'], ['attendance-upload-health'], ['import-jobs-recent']]
    ;[...fastKeys, ...normalKeys, ...slowKeys].forEach(key =>
      qc.invalidateQueries({ queryKey: key, exact: true })
    )
  }

  async function handlePurgeDead() {
    if (!confirm('Purge all dead-letter jobs? This cannot be undone.')) return
    setPurgingDead(true)
    try {
      await api.delete('/system/jobs/dead')
      // Invalidate both the in-memory obs snapshot AND the durable dead-jobs table
      qc.invalidateQueries({ queryKey: ['system-observability'], exact: true })
      qc.invalidateQueries({ queryKey: ['durable-dead-jobs'],    exact: true })
      qc.invalidateQueries({ queryKey: ['durable-queue'],        exact: true })
      toast.success('Dead-letter jobs purged')
    } catch (e) {
      toast.error('Failed to purge dead-letter jobs', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setPurgingDead(false)
    }
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Observability Console" subtitle="Platform engineering metrics" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
            <p className="text-sm">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Observability Console"
        subtitle="Live platform event bus, job queue, module health, and scheduler"
        actions={
          <div className="flex items-center gap-2">
            {dataUpdatedAt > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={handleRefreshAll}
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isObsFetching && 'animate-spin')} />
              Refresh All
            </Button>
          </div>
        }
      />

      {/* ── Scheduler stale warning banner ─────────────────────────────── */}
      {hasStaleScheduler && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Scheduler degraded or stale</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              One or more scheduler processes have missed their heartbeat window (&gt;2 hours) or
              reported an error. Scheduled jobs (leave accrual, payroll triggers, etc.) may not
              be running. Check the Scheduler Health section below and investigate server logs.
            </p>
          </div>
        </div>
      )}

      {/* Initial load skeleton — only shown when there is NO cached data at all.
          Background re-fetches do NOT trigger this; stale data remains visible. */}
      {isLoading && (
        <SectionCard>
          <p className="text-xs text-muted-foreground animate-pulse py-8 text-center">
            Loading observability data…
          </p>
        </SectionCard>
      )}

      {isError && !obs && (
        <SectionCard>
          <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 opacity-40" />
            <p className="text-sm">Failed to load observability data.</p>
            <Button size="sm" variant="outline" onClick={handleRefreshAll}>Retry</Button>
          </div>
        </SectionCard>
      )}

      {obs && (
        <>
          {/* ── Platform overview stat cards ─────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              {
                label: 'Platform Status',
                value: <PlatformStatusBadge status={obs.platform.status} />,
                icon:  Server,
                sub:   `Uptime: ${fmtUptime(obs.platform.uptimeSeconds)}`,
              },
              {
                label: 'Event Handlers',
                value: obs.event_bus.handler_count,
                icon:  Radio,
                sub:   `${(obs.event_bus.total_emitted ?? 0).toLocaleString()} events emitted`,
                cls:   'text-foreground',
              },
              {
                label: 'Event Failures',
                value: obs.event_bus.total_failed,
                icon:  Zap,
                sub:   `${obs.event_bus.failure_rate_pct}% failure rate`,
                cls:   obs.event_bus.total_failed > 0 ? 'text-destructive' : 'text-success',
              },
              {
                label: 'Dead-Letter Jobs',
                value: obs.job_queue.dead_letter,
                icon:  AlertTriangle,
                sub:   `${obs.job_queue.pending} pending, ${obs.job_queue.running} running`,
                cls:   obs.job_queue.dead_letter > 0 ? 'text-warning' : 'text-success',
              },
              {
                label: 'Orphaned Uploads',
                value: uploadSessions.filter(s => s.status === 'orphaned').length,
                icon:  Upload,
                sub:   [
                  `${uploadSessions.filter(s => s.status === 'failed').length} failed`,
                  `${uploadSessions.filter(s => ['pending','uploading','processing'].includes(s.status)).length} in-flight`,
                ].join(' · '),
                cls:   uploadSessions.some(s => s.status === 'orphaned') ? 'text-warning' : 'text-success',
              },
            ].map(({ label, value, icon: Icon, sub, cls }) => (
              <SectionCard key={label}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
                <div className={cn('font-display text-xl font-bold', cls)}>{value}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
              </SectionCard>
            ))}
          </div>

          {/* ── Scheduler Health (DB-backed) ─────────────────────────────── */}
          <SectionCard
            title="Scheduler Health"
            icon={<Heart className="h-4 w-4 text-muted-foreground" />}
          >
            {schedulerRows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No scheduler heartbeats recorded yet. Schedulers write their first heartbeat on startup.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Scheduler', 'Tenant', 'Status', 'Last Heartbeat', 'Age', 'Ticks', 'Last Error'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedulerRows.map(row => (
                      <tr
                        key={`${row.scheduler_name}-${row.tenant_id ?? 'global'}`}
                        className={cn(
                          'border-b border-border/50',
                          (row.is_stale || row.status === 'error') && 'bg-destructive/5',
                        )}
                      >
                        <td className="px-3 py-2 font-mono text-foreground">{row.scheduler_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.tenant_id ?? 'global'}</td>
                        <td className="px-3 py-2">
                          <SchedulerStatusBadge status={row.status} isStale={row.is_stale} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtTs(row.last_heartbeat_at)}
                        </td>
                        <td className={cn(
                          'px-3 py-2 tabular-nums',
                          row.is_stale ? 'text-destructive font-semibold' : 'text-muted-foreground',
                        )}>
                          {fmtAge(row.age_seconds)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">
                          {(row.tick_count ?? 0).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-destructive max-w-xs truncate" title={row.last_error ?? ''}>
                          {row.last_error ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ── Durable Queue Health (live DB counts) ────────────────────── */}
          {durableMetrics && (
            <SectionCard
              title="Durable Queue Health"
              icon={<Database className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Pending',   value: durableMetrics.pending,   cls: durableMetrics.pending > 0 ? 'text-warning' : 'text-muted-foreground' },
                  { label: 'Running',   value: durableMetrics.running,   cls: durableMetrics.running > 0 ? 'text-foreground' : 'text-muted-foreground' },
                  { label: 'Completed', value: durableMetrics.completed, cls: 'text-success' },
                  { label: 'Dead (24h)',value: durableMetrics.dead,      cls: durableMetrics.dead > 0 ? 'text-destructive' : 'text-muted-foreground' },
                ].map(({ label, value, cls }) => (
                  <div key={label} className="rounded-md border border-border px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className={cn('font-display text-lg font-bold tabular-nums', cls)}>{(value ?? 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              {Object.keys(durableMetrics.by_type).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {['Job Type', 'Pending', 'Running', 'Dead'].map(h => (
                          <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(durableMetrics.by_type).map(([type, counts]) => (
                        <tr key={type} className="border-b border-border/50">
                          <td className="px-3 py-2 font-mono text-foreground">{type}</td>
                          <td className={cn('px-3 py-2 tabular-nums', counts.pending > 0 ? 'text-warning' : 'text-muted-foreground')}>
                            {counts.pending}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{counts.running}</td>
                          <td className={cn('px-3 py-2 tabular-nums', counts.dead > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground')}>
                            {counts.dead}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          )}

          {/* ── Durable Dead-Letter Queue ─────────────────────────────────── */}
          {durableDeadJobs.length > 0 && (
            <SectionCard
              title={`Durable Dead-Letter Queue (${durableDeadResp?.total ?? durableDeadJobs.length} jobs)`}
              icon={<XCircle className="h-4 w-4 text-destructive" />}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job Type', 'Failed At', 'Attempts', 'Category', 'Error', 'Action'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {durableDeadJobs.map(job => (
                      <tr key={job.id} className="border-b border-border/50 bg-destructive/5">
                        <td className="px-3 py-2 font-mono text-foreground">{job.job_type}</td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtTs(job.failed_at)}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-destructive font-semibold">
                          {job.attempt}/{job.max_retries}
                        </td>
                        <td className="px-3 py-2">
                          {job.failure_category ? (
                            <Badge
                              variant={job.failure_category === 'permanent' ? 'destructive' : 'warning'}
                              className="rounded-full text-[10px] capitalize"
                            >
                              {job.failure_category}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-destructive max-w-[200px] truncate" title={job.error ?? ''}>
                          {job.error ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1"
                            disabled={requeueMutation.isPending}
                            onClick={() => {
                              if (confirm(`Requeue job ${job.id}?\n\nType: ${job.job_type}\nAttempts: ${job.attempt}/${job.max_retries}`)) {
                                requeueMutation.mutate(job.id)
                              }
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Requeue
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── Retry Storm Detection ────────────────────────────────────── */}
          {stormIncidents.length > 0 && (
            <SectionCard
              title={`Retry Storm Incidents (${stormIncidents.length} open)`}
              icon={<CloudLightning className="h-4 w-4 text-warning" />}
            >
              <p className="text-[11px] text-muted-foreground mb-3">
                A retry storm occurs when &gt;10 dead results accumulate for the same job type within 10 minutes.
                Acknowledge to confirm investigation is in progress.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job Type', 'Dead Count', 'First Dead', 'Last Dead', 'Status', 'Action'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stormIncidents.map(incident => (
                      <tr key={incident.id} className="border-b border-border/50 bg-warning/5">
                        <td className="px-3 py-2 font-mono text-foreground">{incident.job_type}</td>
                        <td className="px-3 py-2 tabular-nums text-destructive font-bold">
                          {incident.dead_count}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtTs(incident.first_dead_at)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtTs(incident.last_dead_at)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="warning" className="rounded-full text-[10px] capitalize">
                            {incident.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] gap-1"
                            disabled={acknowledgeMutation.isPending}
                            onClick={() => acknowledgeMutation.mutate(incident.id)}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Acknowledge
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── Quarantined Jobs ────────────────────────────────────────── */}
          {quarantinedJobs.length > 0 && (
            <SectionCard
              title={`Quarantined Jobs (${quarantinedJobs.length})`}
              icon={<Ban className="h-4 w-4 text-destructive" />}
            >
              <p className="text-[11px] text-muted-foreground mb-3">
                Jobs quarantined after {3} failed requeue attempts. Fix the job handler, then clear quarantine to allow requeuing again.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job ID', 'Job Type', 'Requeue Attempts', 'Action'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {quarantinedJobs.map(job => (
                      <tr key={job.job_id} className="border-b border-border/50 bg-destructive/5">
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{job.job_id}</td>
                        <td className="px-3 py-2 font-mono text-foreground">{job.job_type}</td>
                        <td className="px-3 py-2 tabular-nums text-destructive font-bold">
                          {job.requeue_count}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 text-[10px] gap-1"
                            disabled={clearQuarantineMutation.isPending}
                            onClick={() => {
                              if (confirm(`Clear quarantine for job ${job.job_id}?\n\nType: ${job.job_type}\n\nWARNING: Only do this after fixing the job handler. The job will become eligible for requeuing again.`)) {
                                clearQuarantineMutation.mutate(job.job_id)
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear Quarantine
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── Platform module status ─────────────────────────────────────── */}
          <SectionCard
            title="Module Registry"
            icon={<Box className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(obs.platform.modules).map(([mod, enabled]) => (
                <div
                  key={mod}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-xs border',
                    enabled
                      ? 'border-success/30 bg-success/5 text-foreground'
                      : 'border-destructive/30 bg-destructive/5 text-muted-foreground',
                  )}
                >
                  <StatusDot ok={enabled} />
                  <span className="font-mono truncate">{mod}</span>
                  <span className={cn('ml-auto text-[10px]', enabled ? 'text-success' : 'text-destructive')}>
                    {enabled ? 'active' : 'disabled'}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Startup health checks ─────────────────────────────────────── */}
          <SectionCard
            title="Startup Health Checks"
            icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Check', 'Status', 'Latency', 'Message'].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {obs.platform.checks.map(check => (
                    <tr key={check.name} className="border-b border-border/50">
                      <td className="px-3 py-2 font-mono text-foreground">{check.name}</td>
                      <td className="px-3 py-2"><CheckStatusBadge status={check.status} /></td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{check.latencyMs}ms</td>
                      <td className="px-3 py-2 text-muted-foreground">{check.message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* ── Event bus by event type ───────────────────────────────────── */}
          <SectionCard
            title="Event Bus — Emission by Type"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          >
            {obs.event_bus.by_type.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No events emitted yet this process lifetime.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Event Type', 'Emitted', 'Failed', 'Failure %'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {obs.event_bus.by_type.map(row => (
                      <tr key={row.type} className="border-b border-border/50">
                        <td className="px-3 py-2 font-mono text-foreground">{row.type}</td>
                        <td className="px-3 py-2 tabular-nums">{(row.emitted ?? 0).toLocaleString()}</td>
                        <td className={cn(
                          'px-3 py-2 tabular-nums',
                          row.failed > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground',
                        )}>
                          {row.failed}
                        </td>
                        <td className="px-3 py-2">
                          {row.failurePct > 0 ? (
                            <Badge
                              variant={row.failurePct > 20 ? 'destructive' : 'warning'}
                              className="rounded-full text-[10px]"
                            >
                              {row.failurePct}%
                            </Badge>
                          ) : (
                            <span className="text-success text-[10px]">0%</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ── Job queue by type (legacy in-memory) ─────────────────────── */}
          {obs.job_queue.by_type.length > 0 && (
            <SectionCard
              title="Job Queue — Metrics by Type (In-Memory)"
              icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job Type', 'Enqueued', 'Started', 'Completed', 'Failed', 'Retried', 'Dead'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {obs.job_queue.by_type.map(row => (
                      <tr key={row.type} className="border-b border-border/50">
                        <td className="px-3 py-2 font-mono text-foreground">{row.type}</td>
                        <td className="px-3 py-2 tabular-nums">{row.enqueued}</td>
                        <td className="px-3 py-2 tabular-nums">{row.started}</td>
                        <td className="px-3 py-2 tabular-nums text-success">{row.completed}</td>
                        <td className={cn(
                          'px-3 py-2 tabular-nums',
                          row.failed > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground',
                        )}>
                          {row.failed}
                        </td>
                        <td className={cn(
                          'px-3 py-2 tabular-nums',
                          row.retried > 0 ? 'text-warning' : 'text-muted-foreground',
                        )}>
                          {row.retried}
                        </td>
                        <td className={cn(
                          'px-3 py-2 tabular-nums',
                          row.dead > 0 ? 'text-destructive font-bold' : 'text-muted-foreground',
                        )}>
                          {row.dead}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── Dead-letter jobs (legacy in-memory) ──────────────────────── */}
          {obs.job_queue.recent_dead.length > 0 && (
            <SectionCard
              title={`Dead-Letter Queue — In-Memory (${obs.job_queue.dead_letter} total)`}
              icon={<XCircle className="h-4 w-4 text-destructive" />}
              action={
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-[10px] gap-1"
                  onClick={handlePurgeDead}
                  disabled={purgingDead}
                >
                  <Trash2 className="h-3 w-3" />
                  {purgingDead ? 'Purging…' : 'Purge All'}
                </Button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job Type', 'Error', 'Failed At', 'Attempts'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {obs.job_queue.recent_dead.map(job => (
                      <tr key={job.id} className="border-b border-border/50 bg-destructive/5">
                        <td className="px-3 py-2 font-mono text-foreground">{job.type}</td>
                        <td className="px-3 py-2 text-destructive max-w-xs truncate" title={job.error ?? ''}>
                          {job.error ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtTs(job.failedAt)}
                        </td>
                        <td className="px-3 py-2 tabular-nums font-semibold text-destructive">
                          {job.attempts}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* ── Upload Sessions ───────────────────────────────────────────── */}
          <SectionCard
            title={`Upload Sessions — Recent (${uploadSessions.length})`}
            icon={<Upload className="h-4 w-4 text-muted-foreground" />}
          >
            {uploadSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No upload sessions recorded yet.
              </p>
            ) : (
              <>
                {/* Summary chips */}
                {(() => {
                  const byStatus = uploadSessions.reduce<Record<string, number>>((acc, s) => {
                    acc[s.status] = (acc[s.status] ?? 0) + 1
                    return acc
                  }, {})
                  const chips: Array<{ label: string; count: number; cls: string }> = [
                    { label: 'completed', count: byStatus['completed'] ?? 0, cls: 'text-success' },
                    { label: 'pending',   count: byStatus['pending']   ?? 0, cls: 'text-warning' },
                    { label: 'failed',    count: byStatus['failed']    ?? 0, cls: 'text-destructive' },
                    { label: 'orphaned',  count: byStatus['orphaned']  ?? 0, cls: 'text-destructive' },
                    { label: 'expired',   count: byStatus['expired']   ?? 0, cls: 'text-muted-foreground' },
                  ].filter(c => c.count > 0)
                  return chips.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {chips.map(c => (
                        <div key={c.label} className="rounded-md border border-border px-2 py-1 text-[10px]">
                          <span className={cn('font-bold tabular-nums', c.cls)}>{c.count}</span>
                          <span className="text-muted-foreground ml-1">{c.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null
                })()}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {['Type', 'File', 'Status', 'Size', 'Completed', 'Result'].map(h => (
                          <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadSessions.map(s => {
                        const sizeKb = s.file_size != null
                          ? s.file_size < 1024
                            ? `${s.file_size} B`
                            : s.file_size < 1024 * 1024
                              ? `${(s.file_size / 1024).toFixed(1)} KB`
                              : `${(s.file_size / 1024 / 1024).toFixed(2)} MB`
                          : '—'
                        const summary = s.result_summary
                        const summaryText = summary
                          ? Object.entries(summary)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')
                          : s.error_message ?? '—'
                        return (
                          <tr
                            key={s.id}
                            className={cn(
                              'border-b border-border/50',
                              (s.status === 'failed' || s.status === 'orphaned') && 'bg-destructive/5',
                            )}
                          >
                            <td className="px-3 py-2 font-mono text-foreground">{s.upload_type}</td>
                            <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate" title={s.file_name ?? ''}>
                              {s.file_name ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              <AsyncStatusBadge status={s.status} />
                            </td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{sizeKb}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {fmtTs(s.upload_completed_at)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground max-w-[220px] truncate" title={summaryText}>
                              {summaryText}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </SectionCard>

          {/* ── Operational Event Governance Log ─────────────────────────── */}
          <SectionCard
            title={`Operational Event Log — Recent ${eventLogEntries.length > 0 ? `(${eventLogEntries.length})` : ''}`}
            icon={<ScrollText className="h-4 w-4 text-muted-foreground" />}
          >
            {eventLogEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No governance events recorded yet. Events from uploads, imports, payroll runs, approvals, and queue failures appear here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Event Type', 'Status', 'Actor', 'Correlation ID', 'Error', 'Timestamp'].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {eventLogEntries.map(entry => (
                      <tr
                        key={entry.id}
                        className={cn(
                          'border-b border-border/50',
                          eventLogSeverityBorder(entry),
                          entry.error ? 'bg-destructive/5' : undefined,
                        )}
                      >
                        <td className="px-3 py-2 font-mono text-foreground">
                          {entry.event_type.replace(/_/g, ' ')}
                        </td>
                        <td className="px-3 py-2">
                          <AsyncStatusBadge status={entry.status} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.actor_name ?? <span className="italic opacity-50">system</span>}
                        </td>
                        <td
                          className="px-3 py-2 font-mono text-[10px] text-muted-foreground max-w-[120px] truncate"
                          title={entry.correlation_id ?? ''}
                        >
                          {entry.correlation_id ?? '—'}
                        </td>
                        <td
                          className="px-3 py-2 text-destructive max-w-[200px] truncate"
                          title={entry.error ?? ''}
                        >
                          {entry.error ?? '—'}
                        </td>
                        <td
                          className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap"
                          title={fmtTs(entry.created_at)}
                        >
                          {fmtRelativeTs(entry.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* ── Attendance Upload Health ─────────────────────────────────── */}
          <SectionCard
            title="Attendance Upload Health"
            icon={<Upload className="h-4 w-4 text-muted-foreground" />}
          >
            {!uploadHealth ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading upload health…</p>
            ) : (
              <div className="space-y-3">
                {/* Status banner */}
                <div className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
                  uploadHealth.status === 'healthy'  && 'bg-success/10 text-success',
                  uploadHealth.status === 'degraded' && 'bg-warning/10 text-warning',
                  uploadHealth.status === 'critical' && 'bg-destructive/10 text-destructive',
                )}>
                  {uploadHealth.status === 'healthy'  && <CheckCircle2 className="h-4 w-4" />}
                  {uploadHealth.status === 'degraded' && <AlertTriangle className="h-4 w-4" />}
                  {uploadHealth.status === 'critical' && <XCircle className="h-4 w-4" />}
                  <span className="capitalize">{uploadHealth.status}</span>
                  {uploadHealth.summary.replay_uploads > 0 && (
                    <span className="ml-auto text-xs text-warning font-normal">
                      {uploadHealth.summary.replay_uploads} replay upload{uploadHealth.summary.replay_uploads > 1 ? 's' : ''} detected
                    </span>
                  )}
                </div>
                {/* Summary grid */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  {[
                    { label: 'Total (30d)', value: uploadHealth.summary.total_last_30d, cls: '' },
                    { label: 'Completed',   value: uploadHealth.summary.completed,      cls: 'text-success' },
                    { label: 'Failed',      value: uploadHealth.summary.failed,         cls: uploadHealth.summary.failed > 0 ? 'text-destructive' : '' },
                    { label: 'Orphaned',    value: uploadHealth.summary.orphaned,       cls: uploadHealth.summary.orphaned > 0 ? 'text-warning' : '' },
                    { label: 'Partial',     value: uploadHealth.summary.partial_failures, cls: uploadHealth.summary.partial_failures > 0 ? 'text-warning' : '' },
                    { label: 'Replays',     value: uploadHealth.summary.replay_uploads,  cls: uploadHealth.summary.replay_uploads > 0 ? 'text-warning' : '' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="rounded border bg-muted/30 px-2 py-1">
                      <div className={cn('text-base font-bold', cls)}>{value}</div>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                {/* Last successful upload */}
                <div className="text-xs text-muted-foreground">
                  Last successful upload: {uploadHealth.last_successful_upload ? fmtTs(uploadHealth.last_successful_upload) : <span className="text-warning">Never</span>}
                </div>
                {/* Recent failures */}
                {uploadHealth.recent_failures.length > 0 && (
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-1.5 text-left font-medium">File</th>
                          <th className="px-3 py-1.5 text-left font-medium">Time</th>
                          <th className="px-3 py-1.5 text-left font-medium">Error</th>
                          <th className="px-3 py-1.5 text-left font-medium">Rows</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {uploadHealth.recent_failures.map((f) => (
                          <tr key={f.id} className="bg-destructive/5">
                            <td className="px-3 py-1.5 font-mono">{f.file_name ?? '—'}</td>
                            <td className="px-3 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">{fmtTs(f.created_at)}</td>
                            <td className="px-3 py-1.5 text-destructive max-w-xs truncate">{f.error_message ?? '—'}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {f.result_summary ? `${(f.result_summary.failed_rows as number | undefined) ?? 0} failed` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── Master Import Health ─────────────────────────────────────────── */}
          <SectionCard
            title="Master Import Health"
            icon={<Database className="h-4 w-4 text-muted-foreground" />}
          >
            {recentImports.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No import jobs found.</p>
            ) : (
              <div className="space-y-2">
                {/* Summary row */}
                {(() => {
                  const total     = recentImports.length
                  const completed = recentImports.filter(j => j.status === 'completed').length
                  const failed    = recentImports.filter(j => j.status === 'failed').length
                  const partial   = recentImports.filter(j => j.status === 'completed' && (j.failed_rows ?? 0) > 0).length
                  return (
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                      {[
                        { label: 'Recent Jobs', value: total,     cls: '' },
                        { label: 'Completed',   value: completed, cls: 'text-success' },
                        { label: 'Failed',      value: failed,    cls: failed > 0 ? 'text-destructive' : '' },
                        { label: 'Partial',     value: partial,   cls: partial > 0 ? 'text-warning' : '' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="rounded border bg-muted/30 px-2 py-1">
                          <div className={cn('text-base font-bold', cls)}>{value}</div>
                          <div className="text-[10px] text-muted-foreground">{label}</div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                {/* Recent jobs table */}
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Type</th>
                        <th className="px-3 py-1.5 text-left font-medium">File</th>
                        <th className="px-3 py-1.5 text-left font-medium">Status</th>
                        <th className="px-3 py-1.5 text-right font-medium">Rows</th>
                        <th className="px-3 py-1.5 text-right font-medium">Failed</th>
                        <th className="px-3 py-1.5 text-left font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {recentImports.slice(0, 15).map((job) => (
                        <tr
                          key={job.id}
                          className={cn(
                            job.status === 'failed' && 'bg-destructive/5',
                            job.status === 'completed' && (job.failed_rows ?? 0) > 0 && 'bg-warning/5',
                          )}
                        >
                          <td className="px-3 py-1.5 font-mono">{job.master_type.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-1.5 max-w-[140px] truncate text-muted-foreground">{job.file_name ?? '—'}</td>
                          <td className="px-3 py-1.5">
                            <AsyncStatusBadge status={job.status} />
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{job.total_rows ?? '—'}</td>
                          <td className={cn(
                            'px-3 py-1.5 text-right tabular-nums',
                            (job.failed_rows ?? 0) > 0 ? 'text-destructive font-medium' : 'text-muted-foreground',
                          )}>
                            {job.failed_rows ?? 0}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground whitespace-nowrap">{fmtTs(job.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Timestamp footer ─────────────────────────────────────────── */}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1">
            <Clock className="h-3 w-3" />
            <span>Data snapshot: {fmtTs(obs.timestamp)}</span>
            <span>·</span>
            <span>Platform started: {fmtTs(obs.platform.startedAt)}</span>
          </div>
        </>
      )}
    </PageContainer>
  )
}
