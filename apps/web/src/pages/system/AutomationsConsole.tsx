/**
 * AutomationsConsole — Scheduled jobs + automation workflow registry
 *
 * Distinct from OrchestrationConsole (which focuses on the worker registry
 * and live queue pressure). This console surfaces:
 *   - Scheduled job definitions (cron triggers, intervals, owners)
 *   - Last-run status per automation
 *   - Enable / disable toggles (admin-only)
 *   - Manual trigger button per job
 */

import { useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlayCircle, Clock, CheckCircle2, XCircle,
  RotateCcw, AlertTriangle, Loader2,
} from 'lucide-react'

import { api } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AutomationJob {
  id:          string
  name:        string
  description: string
  schedule:    string         // cron expression or "manual"
  owner:       string         // which module owns this job
  is_enabled:  boolean
  last_run_at: string | null
  last_status: 'success' | 'failed' | 'running' | 'skipped' | null
  next_run_at: string | null
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

function StatusIcon({ status }: { status: AutomationJob['last_status'] }) {
  if (!status) return <span className="text-muted-foreground/40 text-xs">—</span>
  const map = {
    success: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
    failed:  <XCircle      className="h-3.5 w-3.5 text-destructive" />,
    running: <Loader2      className="h-3.5 w-3.5 text-info animate-spin" />,
    skipped: <AlertTriangle className="h-3.5 w-3.5 text-warning" />,
  }
  return map[status] ?? <span className="text-muted-foreground/40 text-xs">—</span>
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AutomationsConsole() {
  const qc = useQueryClient()

  const { data, isLoading, isError, refetch } = useQuery<{ data: AutomationJob[] }>({
    queryKey:  ['automations-jobs'],
    queryFn:   () => api.get('/system/jobs/automations'),
    staleTime: 30_000,
    retry:     false,
  })

  // Sent as Idempotency-Key on trigger so a double-click or network retry
  // doesn't enqueue the same automation twice. Rotated only after success.
  const triggerIdempotencyKey = useRef(crypto.randomUUID())

  const triggerMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/system/jobs/${jobId}/trigger`, {}, {
      headers: { 'Idempotency-Key': triggerIdempotencyKey.current },
    }),
    onSuccess: () => {
      triggerIdempotencyKey.current = crypto.randomUUID()
      qc.invalidateQueries({ queryKey: ['automations-jobs'] })
      toast.success('Job triggered successfully')
    },
    onError: (e: Error) => {
      toast.error('Failed to trigger job', { description: e.message })
    },
  })

  function handleTrigger(job: AutomationJob) {
    if (!window.confirm(`Manually trigger "${job.name}" now? This runs the same automation the schedule would run.`)) return
    triggerMutation.mutate(job.id)
  }

  const jobs: AutomationJob[] = Array.isArray(data?.data) ? (data.data as AutomationJob[]) : []

  // Group by owner module
  const byOwner = jobs.reduce<Record<string, AutomationJob[]>>((acc, job) => {
    const key = job.owner ?? 'System'
    if (!acc[key]) acc[key] = []
    acc[key].push(job)
    return acc
  }, {})

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !jobs.length) {
    return (
      <div className="space-y-4 p-1">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isError
              ? 'Could not load automation jobs. The scheduler endpoint may not be available.'
              : 'No automation jobs registered.'}
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 gap-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>

        {/* Static reference — well-known automations this system runs */}
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b border-border/40">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Known Automation Workflows
            </p>
          </div>
          <div className="divide-y divide-border/40">
            {[
              { name: 'Attendance Processing', schedule: 'Daily @ 01:00', owner: 'Attendance', description: 'Processes raw punch logs into daily attendance records' },
              { name: 'Leave Balance Accrual', schedule: 'Monthly @ 00:05', owner: 'Leave', description: 'Credits earned leave balances to eligible employees' },
              { name: 'SLA Scanner',           schedule: 'Every 4 hours', owner: 'Operations', description: 'Flags overdue leave and correction requests for escalation' },
              { name: 'Anomaly Detection',     schedule: 'Daily @ 02:00', owner: 'Intelligence', description: 'Runs ML-based anomaly detection on attendance patterns' },
              { name: 'Intelligence Scanner',  schedule: 'Every 6 hours', owner: 'Intelligence', description: 'Emits operational insight events to the event bus' },
              { name: 'Event Bus Automation',  schedule: 'Event-driven', owner: 'Operations', description: 'Responds to events for SLA monitoring, balance alerts, and escalations' },
            ].map(item => (
              <div key={item.name} className="flex items-start gap-4 px-4 py-3">
                <PlayCircle className="h-4 w-4 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <Badge variant="outline" className="text-[10px] rounded-full">{item.owner}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{item.schedule}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{jobs.length} registered automations</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {jobs.filter(j => j.last_status === 'failed').length} failed ·{' '}
            {jobs.filter(j => j.is_enabled).length} enabled
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="h-8 gap-1.5 text-xs">
          <RotateCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Jobs grouped by owner */}
      {Object.entries(byOwner).map(([owner, ownerJobs]) => (
        <div key={owner} className="rounded-lg border border-border/60 overflow-hidden">
          <div className="bg-muted/30 px-4 py-2 border-b border-border/40 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {owner}
            </p>
            <Badge variant="outline" className="text-[10px] rounded-full">
              {ownerJobs.length} job{ownerJobs.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="divide-y divide-border/40">
            {ownerJobs.map(job => (
              <div key={job.id} className={cn(
                'flex items-start gap-4 px-4 py-3 transition-colors',
                !job.is_enabled && 'opacity-50',
              )}>
                {/* Status icon */}
                <div className="flex-shrink-0 mt-0.5">
                  <StatusIcon status={job.last_status} />
                </div>

                {/* Job info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{job.name}</span>
                    {!job.is_enabled && (
                      <Badge variant="secondary" className="text-[10px] rounded-full">Disabled</Badge>
                    )}
                    {job.last_status === 'failed' && (
                      <Badge variant="destructive" className="text-[10px] rounded-full">Failed</Badge>
                    )}
                    {job.last_status === 'running' && (
                      <Badge variant="outline" className="text-[10px] rounded-full text-info border-info/40">Running</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/70">
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {job.schedule}
                    </span>
                    {job.last_run_at && (
                      <span>Last: {fmtDatetime(job.last_run_at)}</span>
                    )}
                    {job.next_run_at && (
                      <span>Next: {fmtDatetime(job.next_run_at)}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs flex-shrink-0"
                  disabled={!job.is_enabled || triggerMutation.isPending}
                  onClick={() => handleTrigger(job)}
                  title="Trigger now"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
