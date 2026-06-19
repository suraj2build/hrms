/**
 * LeaveJobs — /admin/leave-jobs
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SCHEDULER HEALTH MONITOR — Autonomous Leave Engine Observability
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The Leave Automation Engine runs ALL entitlement operations automatically:
 *   • Monthly accrual        — 1st–3rd of every month
 *   • Yearly credit          — Jan 1 / Apr 1
 *   • Carry-forward          — Dec 31 / Mar 31
 *   • Balance expiry         — Daily
 *   • Event grants           — Daily (birthday, anniversary, custom)
 *   • Reconciliation         — Daily (nightly)
 *
 * This page shows engine status and health. Manual operations have been
 * moved to "Advanced Recovery" and require a documented reason.
 *
 * Access: super_admin, hr_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, Clock, AlertTriangle,
  Activity, RefreshCw, ChevronDown, ChevronRight,
  Loader2, ShieldAlert, PlayCircle, Info,
  CalendarClock, Zap, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EngineStatus {
  job_type:           string
  label:              string
  description:        string
  schedule:           string
  last_run_at:        string | null
  last_run_status:    'completed' | 'failed' | 'running' | null
  last_employees:     number | null
  last_days_credited: number | null
  last_duration_ms:   number | null
  last_error:         string | null
  next_due:           string
  is_overdue:         boolean
}

interface SchedulerStatus {
  scheduler: {
    status:            string
    last_heartbeat_at: string | null
    tick_count:        number | null
    last_error:        string | null
    is_stale:          boolean
  }
  engines: EngineStatus[]
  reconciliation: {
    open_issues:       number
    last_run_date:     string | null
    last_severity:     string | null
    issues_found:      number | null
    employees_checked: number | null
  }
}

interface JobLog {
  id:            string
  job_type:      string
  status:        string
  trigger_type:  string
  dry_run:       boolean
  replay_reason: string | null
  started_at:    string
  completed_at:  string | null
  duration_ms:   number | null
  params:        Record<string, unknown> | null
  result:        Record<string, unknown> | null
  error_msg:     string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days > 0)  return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0)  return `${mins}m ago`
  return 'Just now'
}

// ── Engine status card ────────────────────────────────────────────────────────

function EngineCard({ engine }: { engine: EngineStatus }) {
  const ok     = engine.last_run_status === 'completed'
  const failed = engine.last_run_status === 'failed'
  const never  = engine.last_run_status === null

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3',
      failed ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {failed ? (
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
          ) : never ? (
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">{engine.label}</p>
            <p className="text-[10px] text-muted-foreground">{engine.schedule}</p>
          </div>
        </div>
        <Badge
          variant={failed ? 'destructive' : ok ? 'success' : 'secondary'}
          className="rounded-full text-[10px] shrink-0"
        >
          {failed ? 'Failed' : never ? 'Pending' : 'OK'}
        </Badge>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground text-[10px] mb-0.5">Last Run</p>
          <p className="font-medium text-foreground">{timeAgo(engine.last_run_at)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] mb-0.5">Employees</p>
          <p className="font-medium text-foreground tabular-nums">
            {engine.last_employees ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] mb-0.5">Duration</p>
          <p className="font-medium text-foreground">{fmtDuration(engine.last_duration_ms)}</p>
        </div>
      </div>

      {/* Next due */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground">Next due</span>
        <span className="text-[10px] font-medium text-foreground font-mono">{engine.next_due}</span>
      </div>

      {/* Error */}
      {engine.last_error && (
        <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={engine.last_error}>
          {engine.last_error}
        </p>
      )}
    </div>
  )
}

// ── Job history row ───────────────────────────────────────────────────────────

function HistoryRow({ job }: { job: JobLog }) {
  const [expanded, setExpanded] = useState(false)

  const triggerBadgeVariant = job.trigger_type === 'scheduler' ? 'secondary'
    : job.dry_run ? 'warning'
    : 'outline'

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer text-xs"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1.5">
            {job.status === 'completed'
              ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              : <XCircle className="h-3.5 w-3.5 text-destructive" />
            }
            <span className="font-medium">{job.job_type.replace(/_/g, ' ')}</span>
          </div>
        </td>
        <td className="py-2.5 px-3">
          <Badge variant={triggerBadgeVariant} className="rounded-full text-[10px] capitalize">
            {job.dry_run ? 'dry-run' : job.trigger_type?.replace(/_/g, ' ')}
          </Badge>
        </td>
        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
          {fmtDatetime(job.started_at)}
        </td>
        <td className="py-2.5 px-3 text-muted-foreground">{fmtDuration(job.duration_ms)}</td>
        <td className="py-2.5 px-3">
          {expanded
            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-muted/10">
          <td colSpan={5} className="px-3 pb-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {job.replay_reason && (
                <div className="sm:col-span-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                  <span className="font-medium text-foreground">Reason: </span>{job.replay_reason}
                </div>
              )}
              {job.params && (
                <div>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Params</p>
                  <pre className="bg-muted rounded px-2 py-1.5 text-foreground overflow-x-auto whitespace-pre-wrap text-[10px]">
                    {JSON.stringify(job.params, null, 2)}
                  </pre>
                </div>
              )}
              {job.result && (
                <div>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Result</p>
                  <pre className="bg-muted rounded px-2 py-1.5 text-foreground overflow-x-auto whitespace-pre-wrap text-[10px]">
                    {JSON.stringify(job.result, null, 2)}
                  </pre>
                </div>
              )}
              {job.error_msg && (
                <div className="sm:col-span-2">
                  <p className="text-[10px] text-destructive font-semibold uppercase tracking-wide mb-1">Error</p>
                  <p className="text-destructive text-xs p-2 rounded bg-destructive/10 border border-destructive/20">{job.error_msg}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Advanced Recovery Panel ───────────────────────────────────────────────────

const RECOVERY_JOBS = [
  { id: 'monthly-accrual', label: 'Monthly Accrual',  endpoint: '/leave/jobs/monthly-accrual',
    fields: [
      { key: 'year',  label: 'Year',  type: 'number', default: () => String(new Date().getFullYear()) },
      { key: 'month', label: 'Month', type: 'number', default: () => String(new Date().getMonth() + 1) },
    ],
  },
  { id: 'yearly-accrual', label: 'Yearly Credit', endpoint: '/leave/jobs/yearly-accrual',
    fields: [
      { key: 'leave_year', label: 'Leave Year', type: 'number', default: () => String(new Date().getFullYear()) },
    ],
  },
  { id: 'carry-forward', label: 'Carry-Forward', endpoint: '/leave/jobs/carry-forward',
    fields: [
      { key: 'from_year', label: 'From Year', type: 'number', default: () => String(new Date().getFullYear() - 1) },
      { key: 'to_year',   label: 'To Year',   type: 'number', default: () => String(new Date().getFullYear()) },
    ],
  },
  { id: 'co-expiry', label: 'Balance Expiry', endpoint: '/leave/jobs/co-expiry',
    fields: [],
  },
  { id: 'recalculate', label: 'Policy Recalculate', endpoint: '/leave/jobs/recalculate',
    fields: [
      { key: 'leave_type_id', label: 'Leave Type ID (UUID)', type: 'text', default: () => '' },
      { key: 'year', label: 'Year', type: 'number', default: () => String(new Date().getFullYear()) },
    ],
  },
] as const

function AdvancedRecoveryPanel() {
  const [open, setOpen] = useState(false)
  const [selectedJob, setSelectedJob]   = useState<typeof RECOVERY_JOBS[number]['id']>(RECOVERY_JOBS[0].id)
  const [reason,      setReason]        = useState('')
  const [dryRun,      setDryRun]        = useState(true)
  const [confirmed,   setConfirmed]     = useState(false)
  const [fieldValues, setFieldValues]   = useState<Record<string, string>>({})
  const [resultMsg,   setResultMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  const qc = useQueryClient()

  const job = RECOVERY_JOBS.find(j => j.id === selectedJob)!

  const triggerMutation = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) =>
      api.post<{ message: string; dry_run: boolean }>(endpoint, body),
    onSuccess: (res: { message: string; dry_run: boolean }) => {
      setResultMsg({ ok: true, text: res.message ?? 'Recovery job completed.' })
      setConfirmed(false)
      qc.invalidateQueries({ queryKey: ['scheduler-history'] })
      toast.success(res.dry_run ? 'Dry run complete' : 'Recovery job completed', {
        description: res.message,
      })
    },
    onError: (err: Error) => {
      setResultMsg({ ok: false, text: err.message })
      toast.error('Recovery job failed', { description: err.message })
    },
  })

  function handleRun() {
    if (!reason.trim() || reason.trim().length < 5) {
      toast.error('Reason required', { description: 'Provide at least 5 characters explaining why this recovery is needed.' })
      return
    }
    if (!confirmed) {
      toast.error('Confirmation required', { description: 'Check the confirmation checkbox.' })
      return
    }

    const body: Record<string, unknown> = { reason: reason.trim(), dry_run: dryRun }
    for (const f of job.fields) {
      const val = fieldValues[f.key] ?? f.default()
      body[f.key] = f.type === 'number' ? Number(val) : val
    }

    triggerMutation.mutate({ endpoint: job.endpoint, body })
  }

  return (
    <SectionCard
      title="Advanced Recovery Operations"
      icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
      action={
        <Button
          size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground"
          onClick={() => setOpen(v => !v)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {open ? 'Collapse' : 'Expand'}
        </Button>
      }
    >
      {!open && (
        <div className="flex items-start gap-3 py-2">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Recovery operations are hidden by design.</p>
            <p>All entitlement operations run automatically. Manual execution should only be used for
            repair, backfill, audit recovery, or dry-run simulation. Expand to access.</p>
          </div>
        </div>
      )}

      {open && (
        <div className="space-y-4 pt-2">
          {/* Warning banner */}
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold text-foreground mb-0.5">Recovery operations only</p>
              <p className="text-muted-foreground">
                These controls bypass normal scheduling. Use ONLY for:
                backfill after migration, repair after a system failure, dry-run simulation, or
                emergency override. All executions are permanently logged with your reason.
              </p>
            </div>
          </div>

          {/* Job selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Operation</label>
            <select
              value={selectedJob}
              onChange={e => { setSelectedJob(e.target.value as typeof RECOVERY_JOBS[number]['id']); setFieldValues({}) }}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              {RECOVERY_JOBS.map(j => (
                <option key={j.id} value={j.id}>{j.label}</option>
              ))}
            </select>
          </div>

          {/* Dynamic fields */}
          {job.fields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {job.fields.map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <Input
                    type={f.type}
                    value={fieldValues[f.key] ?? f.default()}
                    onChange={e => setFieldValues(p => ({ ...p, [f.key]: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Reason — required */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Recovery Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain why this manual execution is required (e.g. 'Scheduler missed Jan accrual due to service outage 2026-01-02')…"
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">{reason.length}/500 chars (min 5)</p>
          </div>

          {/* Dry-run toggle */}
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
            <input
              type="checkbox"
              id="dry-run"
              checked={dryRun}
              onChange={e => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <div>
              <label htmlFor="dry-run" className="text-xs font-medium text-foreground cursor-pointer">
                Dry-run mode (recommended)
              </label>
              <p className="text-[10px] text-muted-foreground">
                Computes what would change but writes NO balance mutations. Safe to run any time.
              </p>
            </div>
          </div>

          {/* Confirmation */}
          <div className="flex items-center gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
            <input
              type="checkbox"
              id="confirm-recovery"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="h-4 w-4 rounded accent-destructive"
            />
            <label htmlFor="confirm-recovery" className="text-xs text-foreground cursor-pointer">
              I understand this {dryRun ? 'simulation' : 'live recovery operation'} will be permanently
              logged against my account and the above reason will be recorded.
            </label>
          </div>

          {/* Run button */}
          <Button
            size="sm"
            variant={dryRun ? 'outline' : 'default'}
            className={cn(
              'w-full h-9 text-xs gap-1.5',
              !dryRun && 'bg-warning hover:bg-warning/90 text-warning-foreground border-warning/40',
            )}
            disabled={triggerMutation.isPending || !confirmed || reason.trim().length < 5}
            onClick={handleRun}
          >
            {triggerMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
            ) : (
              <><PlayCircle className="h-3.5 w-3.5" />
              {dryRun ? `Simulate: ${job.label}` : `⚠ Execute Recovery: ${job.label}`}</>
            )}
          </Button>

          {/* Result */}
          {resultMsg && (
            <div className={cn(
              'flex items-start gap-2 text-xs p-2.5 rounded-md border',
              resultMsg.ok
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-destructive/10 border-destructive/30 text-destructive',
            )}>
              {resultMsg.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span>{resultMsg.text}</span>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeaveJobs() {
  const { profile } = useAuthStore()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'
  const [historyOpen, setHistoryOpen] = useState(false)

  // ── Status query ───────────────────────────────────────────────────────────
  const { data: statusData, isLoading, refetch, dataUpdatedAt } = useQuery<{ data: SchedulerStatus }>({
    queryKey: ['scheduler-status'],
    queryFn:  () => api.get('/leave/scheduler/status'),
    enabled:  isAdmin,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,  // auto-refresh every 5 min
  })

  // ── History query ──────────────────────────────────────────────────────────
  const { data: histData, isLoading: histLoading } = useQuery<{ data: JobLog[]; total: number }>({
    queryKey: ['scheduler-history'],
    queryFn:  () => api.get('/leave/scheduler/history?limit=40'),
    enabled:  isAdmin && historyOpen,
    staleTime: 30_000,
  })

  const status = statusData?.data
  const scheduler = status?.scheduler
  const engines   = status?.engines ?? []
  const recon     = status?.reconciliation

  const schedulerOk   = scheduler && !scheduler.is_stale && scheduler.status === 'ok'
  const schedulerStale = scheduler?.is_stale

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Leave Engine Status" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive/70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can view scheduler status.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leave Automation Engine"
        subtitle="Fully autonomous — no manual execution required for normal operations"
        actions={
          <Button
            size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* ── Scheduler heartbeat banner ─────────────────────────────────────── */}
      <div className={cn(
        'rounded-lg border px-4 py-3 flex items-center justify-between',
        isLoading       ? 'border-border bg-muted/20' :
        schedulerStale  ? 'border-destructive/40 bg-destructive/5' :
        schedulerOk     ? 'border-success/30 bg-success/5' :
                          'border-warning/40 bg-warning/5',
      )}>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : schedulerStale ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <Activity className={cn('h-4 w-4', schedulerOk ? 'text-success' : 'text-warning')} />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {isLoading ? 'Checking scheduler…'
               : schedulerStale ? 'Scheduler appears offline or stale'
               : schedulerOk ? 'Leave Automation Engine — Running'
               : 'Scheduler status unknown'}
            </p>
            {scheduler && (
              <p className="text-xs text-muted-foreground">
                Last heartbeat: {timeAgo(scheduler.last_heartbeat_at)}
                {scheduler.tick_count != null && ` · Tick #${scheduler.tick_count}`}
              </p>
            )}
          </div>
        </div>
        {scheduler && (
          <Badge
            variant={schedulerStale ? 'destructive' : schedulerOk ? 'success' : 'warning'}
            className="rounded-full text-xs shrink-0"
          >
            {schedulerStale ? 'Stale' : schedulerOk ? 'Active' : 'Degraded'}
          </Badge>
        )}
      </div>

      {/* ── Engine grid ───────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-sm">Loading engine status…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {engines.map(engine => (
            <EngineCard key={engine.job_type} engine={engine} />
          ))}
        </div>
      )}

      {/* ── Reconciliation summary ─────────────────────────────────────────── */}
      {recon && (
        <SectionCard
          title="Reconciliation Health"
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground mb-0.5">Open Issues</p>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                (recon.open_issues ?? 0) > 0 ? 'text-destructive' : 'text-success',
              )}>
                {recon.open_issues ?? 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Last Run</p>
              <p className="font-medium text-foreground">{recon.last_run_date ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Severity</p>
              <Badge
                variant={
                  recon.last_severity === 'critical' ? 'destructive' :
                  recon.last_severity === 'high'     ? 'destructive' :
                  recon.last_severity === 'medium'   ? 'warning' :
                  recon.last_severity === 'low'      ? 'secondary' : 'success'
                }
                className="rounded-full text-[10px] capitalize"
              >
                {recon.last_severity ?? 'none'}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground mb-0.5">Employees Checked</p>
              <p className="font-medium text-foreground tabular-nums">{recon.employees_checked ?? '—'}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Engine run history ────────────────────────────────────────────── */}
      <SectionCard
        title="Engine Run History"
        icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
        action={
          <Button
            size="sm" variant="ghost" className="h-7 text-xs gap-1"
            onClick={() => setHistoryOpen(v => !v)}
          >
            {historyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {historyOpen ? 'Hide' : 'Show history'}
          </Button>
        }
      >
        {!historyOpen && (
          <p className="text-xs text-muted-foreground py-2">
            Click "Show history" to view all scheduler and recovery runs with full details.
          </p>
        )}
        {historyOpen && (
          <>
            {histLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            )}
            {!histLoading && (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      {['Job', 'Trigger', 'Started', 'Duration', ''].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold text-muted-foreground py-2 px-3 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(histData?.data ?? []).map(job => (
                      <HistoryRow key={job.id} job={job} />
                    ))}
                    {(histData?.data ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                          No runs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {histData?.total != null && histData.total > 40 && (
                  <p className="text-xs text-muted-foreground px-1 mt-2">
                    Showing 40 of {histData.total} runs.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* ── Advanced Recovery ─────────────────────────────────────────────── */}
      <AdvancedRecoveryPanel />

      {/* ── Last updated ─────────────────────────────────────────────────── */}
      {dataUpdatedAt > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          Status refreshed: {new Date(dataUpdatedAt).toLocaleTimeString()}
        </p>
      )}
    </PageContainer>
  )
}
