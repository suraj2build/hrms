/**
 * PayrollResolutionCenter — /admin/payroll/blockers/:runId
 *
 * Resolution Center for a failed or partial_failed payroll run.
 * Groups per-employee failures by validation rule code and surfaces
 * structured remediation guidance so HR admins can fix root causes,
 * mark individual blockers resolved/ignored, and re-trigger the run.
 *
 * Sections:
 *   1. Run Header — month, status, employee counts
 *   2. Run Health Bar — retry/finalize eligibility + severity counters
 *   3. Blocker Groups — one card per rule_code, with per-employee list
 *   4. Recovery Actions — Retry Failed, Freeze Month
 */

import { useState, useMemo }                     from 'react'
import { useParams, useNavigate, Link }          from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ShieldCheck, AlertCircle, AlertTriangle,
  CheckCircle2, Info, ChevronDown, ChevronUp,
  Loader2, RefreshCw, Lock, ExternalLink,
  XCircle, ClipboardCheck,
} from 'lucide-react'
import { toast }           from 'sonner'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { ConfirmDialog }  from '@/components/ui/ConfirmDialog'
import { api }            from '@/lib/api/client'
import { cn, fmtDate }    from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlockerEmployee {
  blocker_id:      string
  employee_id:     string
  employee_code:   string | null
  employee_name:   string | null
  reason:          string
  message:         string
  status:          'open' | 'resolved' | 'ignored'
  resolved_at:     string | null
  resolution_note: string | null
}

interface BlockerGroup {
  rule_code:         string
  rule_name:         string
  rule_description:  string
  stage:             string
  stage_label:       string
  severity:          'critical' | 'warning' | 'info'
  blocking:          boolean
  remediation_route: string | null
  open_count:        number
  resolved_count:    number
  ignored_count:     number
  total_count:       number
  employees:         BlockerEmployee[]
}

interface RunHealth {
  retry_eligible:    boolean
  finalize_eligible: boolean
  critical_open:     number
  warning_open:      number
  info_open:         number
  critical_resolved: number
  warning_resolved:  number
  total_open:        number
  total_resolved:    number
  total_ignored:     number
  health_label:      string
}

interface RunInfo {
  id:             string
  month:          string
  status:         string
  employee_count: number
  error_message:  string | null
  failure_summary: { total_failed: number; total_employees: number } | null
}

interface BlockersResponse {
  run:    RunInfo
  groups: BlockerGroup[]
  health: RunHealth
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  const d = new Date(Number(y), Number(mo) - 1, 1)
  return d.toLocaleString('default', { month: 'long', year: 'numeric' })
}

const SEVERITY_ICON: Record<string, React.ElementType> = {
  critical: AlertCircle,
  warning:  AlertTriangle,
  info:     Info,
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-destructive',
  warning:  'text-warning',
  info:     'text-info',
}

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-destructive/10 border-destructive/30',
  warning:  'bg-warning/10 border-warning/30',
  info:     'bg-info/10 border-info/30',
}

const STATUS_COLOR: Record<string, string> = {
  open:     'text-destructive',
  resolved: 'text-success',
  ignored:  'text-muted-foreground',
}

// ── ResolveDialog ─────────────────────────────────────────────────────────────

function ResolveDialog({
  blocker,
  onClose,
  onSubmit,
  pending,
}: {
  blocker:  BlockerEmployee
  onClose:  () => void
  onSubmit: (action: 'resolved' | 'ignored', note: string) => void
  pending:  boolean
}) {
  const [action, setAction] = useState<'resolved' | 'ignored'>('resolved')
  const [note,   setNote]   = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-lg border border-border shadow-lg w-full max-w-md mx-4 p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">Mark Blocker</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {blocker.employee_name ?? '(unnamed)'} · #{blocker.employee_code ?? '—'}
          </p>
        </div>

        <div className="p-2.5 rounded-md bg-muted/30 text-xs text-muted-foreground">
          {blocker.message}
        </div>

        {/* Action selector */}
        <div className="grid grid-cols-2 gap-2">
          {(['resolved', 'ignored'] as const).map(a => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={cn(
                'rounded-md border px-3 py-2 text-xs font-medium transition-colors text-left',
                action === a
                  ? a === 'resolved'
                    ? 'bg-success/15 border-success/40 text-success'
                    : 'bg-muted border-muted-foreground/30 text-muted-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/30',
              )}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {a === 'resolved'
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <XCircle className="h-3.5 w-3.5" />
                }
                <span className="capitalize">{a}</span>
              </div>
              <p className="text-[10px] font-normal opacity-70">
                {a === 'resolved'
                  ? 'Root cause is fixed — recalculate employee on retry'
                  : 'Accept the risk — employee stays excluded from run'
                }
              </p>
            </button>
          ))}
        </div>

        {/* Resolution note */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Note <span className="font-normal opacity-60">(optional)</span>
          </label>
          <textarea
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            rows={2}
            placeholder="e.g. Compensation record updated — ready to retry"
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={pending}
          />
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            className={cn('gap-1.5', action === 'ignored' && 'variant-outline')}
            variant={action === 'ignored' ? 'outline' : 'default'}
            onClick={() => onSubmit(action, note)}
            disabled={pending}
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : action === 'resolved'
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <XCircle className="h-3.5 w-3.5" />
            }
            Mark as {action}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── BlockerGroupCard ──────────────────────────────────────────────────────────

function BlockerGroupCard({
  group,
  onResolve,
}: {
  group:     BlockerGroup
  onResolve: (blocker: BlockerEmployee) => void
}) {
  const [expanded, setExpanded] = useState(group.open_count > 0)

  const SeverityIcon = SEVERITY_ICON[group.severity] ?? Info

  return (
    <div className={cn('rounded-lg border overflow-hidden', SEVERITY_BG[group.severity])}>
      {/* Group header */}
      <button
        type="button"
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-black/5 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <SeverityIcon className={cn('h-4 w-4 flex-shrink-0 mt-0.5', SEVERITY_COLOR[group.severity])} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{group.rule_name}</span>
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              group.severity === 'critical' ? 'bg-destructive/15 text-destructive'
                : group.severity === 'warning' ? 'bg-warning/15 text-warning'
                : 'bg-info/15 text-info',
            )}>
              {group.severity}
            </span>
            {group.blocking && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                blocking
              </span>
            )}
            <span className="text-[10px] text-muted-foreground rounded-full bg-muted/60 px-1.5 py-0.5">
              {group.stage_label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{group.rule_description}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
            {group.open_count > 0 && (
              <span className="text-destructive font-medium">{group.open_count} open</span>
            )}
            {group.resolved_count > 0 && (
              <span className="text-success">{group.resolved_count} resolved</span>
            )}
            {group.ignored_count > 0 && (
              <span>{group.ignored_count} ignored</span>
            )}
            <span className="opacity-50">· {group.total_count} total</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {group.remediation_route && (
            <Link
              to={group.remediation_route}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-info hover:underline"
            >
              Fix <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          )}
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Employee list */}
      {expanded && (
        <div className="border-t border-current/10 divide-y divide-current/5">
          {group.employees.map(emp => (
            <div
              key={emp.blocker_id}
              className="flex items-start gap-3 px-4 py-2.5 bg-card/50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {emp.employee_name ?? '(archived employee)'}
                  </span>
                  {emp.employee_code && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      #{emp.employee_code}
                    </span>
                  )}
                  <span className={cn('text-[10px] font-medium capitalize', STATUS_COLOR[emp.status])}>
                    {emp.status}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {emp.message}
                </p>
                {emp.resolution_note && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                    Note: {emp.resolution_note}
                  </p>
                )}
              </div>
              {emp.status === 'open' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 flex-shrink-0"
                  onClick={() => onResolve(emp)}
                >
                  <ClipboardCheck className="h-3 w-3 mr-1" />
                  Mark
                </Button>
              )}
              {emp.status !== 'open' && emp.resolved_at && (
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {fmtDate(emp.resolved_at)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── RunHealthBar ──────────────────────────────────────────────────────────────

function RunHealthBar({ health }: { health: RunHealth }) {
  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 space-y-2',
      health.retry_eligible ? 'bg-success/5 border-success/30' : 'bg-destructive/5 border-destructive/30',
    )}>
      {/* Primary status */}
      <div className="flex items-center gap-2">
        {health.retry_eligible
          ? <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
          : <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        }
        <span className={cn(
          'text-sm font-semibold',
          health.retry_eligible ? 'text-success' : 'text-destructive',
        )}>
          {health.health_label}
        </span>
      </div>

      {/* Severity counts */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        {health.critical_open > 0 && (
          <span className="text-destructive font-medium">
            {health.critical_open} critical open
          </span>
        )}
        {health.warning_open > 0 && (
          <span className="text-warning">
            {health.warning_open} warning{health.warning_open !== 1 ? 's' : ''} open
          </span>
        )}
        {health.total_resolved > 0 && (
          <span className="text-success">{health.total_resolved} resolved</span>
        )}
        {health.total_ignored > 0 && (
          <span>{health.total_ignored} ignored</span>
        )}
        {health.total_open === 0 && (
          <span className="text-success font-medium">All blockers cleared</span>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollResolutionCenter() {
  const { runId } = useParams<{ runId: string }>()
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  // Blocker to resolve (opens ResolveDialog)
  const [resolvingBlocker, setResolvingBlocker] = useState<BlockerEmployee | null>(null)

  // Filter state
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved' | 'ignored'>('all')

  // Freeze-month confirmation
  const [showFreezeConfirm, setShowFreezeConfirm] = useState(false)

  // ── Fetch blockers ──────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery<BlockersResponse>({
    queryKey: ['payroll-blockers-center', runId],
    queryFn:  () => api.get(`/payroll/runs/${runId}/blockers`),
    enabled:  !!runId,
    staleTime: 15_000,
  })

  // ── Resolve / ignore blocker ────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: ({ blockerId, action, note }: { blockerId: string; action: 'resolved' | 'ignored'; note: string }) =>
      api.post(`/payroll/blockers/${blockerId}/resolve`, {
        action,
        resolution_note: note || undefined,
      }),
    onSuccess: (_, vars) => {
      toast.success(`Blocker marked as ${vars.action}`)
      setResolvingBlocker(null)
      qc.invalidateQueries({ queryKey: ['payroll-blockers-center', runId] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to update blocker'),
  })

  // ── Retry failed employees ──────────────────────────────────────────────────
  const retryMutation = useMutation({
    mutationFn: () => api.post<{ succeeded_count?: number; failed_count?: number; new_run_status?: string }>(`/payroll/runs/${runId}/retry-failed`, {}),
    onSuccess: (res) => {
      const succeeded = res?.succeeded_count ?? 0
      const failed    = res?.failed_count    ?? 0
      toast.success(
        `Retry complete — ${succeeded} succeeded, ${failed} still failing`,
        { description: res?.new_run_status === 'draft' ? 'All blockers cleared!' : 'Some blockers remain open.' },
      )
      qc.invalidateQueries({ queryKey: ['payroll-blockers-center', runId] })
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
      if (res?.new_run_status === 'draft') {
        navigate('/admin/payroll')
      }
    },
    onError: (e: unknown) => {
      const health = (e as { data?: { health?: RunHealth } })?.data?.health
      toast.error(
        e instanceof Error ? e.message : 'Retry failed',
        { description: health ? health.health_label : undefined },
      )
    },
  })

  // ── Freeze month ────────────────────────────────────────────────────────────
  const freezeMutation = useMutation({
    mutationFn: () => api.post<{ frozen_month?: string }>(`/payroll/runs/${runId}/freeze`, {
      reason: 'Frozen from Resolution Center — investigation in progress',
    }),
    onSuccess: (res) => {
      setShowFreezeConfirm(false)
      toast.success(`Payroll for ${res?.frozen_month} frozen`, {
        description: 'No further payroll writes are allowed for this month.',
      })
      qc.invalidateQueries({ queryKey: ['payroll-runs'] })
    },
    onError: (e: unknown) => {
      setShowFreezeConfirm(false)
      toast.error(e instanceof Error ? e.message : 'Failed to freeze payroll month')
    },
  })

  // ── Derived ─────────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    if (!data?.groups) return []
    if (filterStatus === 'all') return data.groups

    return data.groups
      .map(g => ({
        ...g,
        employees: g.employees.filter(e => e.status === filterStatus),
      }))
      .filter(g => g.employees.length > 0)
  }, [data?.groups, filterStatus])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20 gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Resolution Center…
        </div>
      </PageContainer>
    )
  }

  if (isError || !data) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center gap-4 py-20">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load blockers for this run.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Retry
          </Button>
        </div>
      </PageContainer>
    )
  }

  const { run, health } = data
  const totalBlockers   = data.groups.reduce((s, g) => s + g.total_count, 0)
  const openBlockers    = data.groups.reduce((s, g) => s + g.open_count,  0)

  return (
    <PageContainer>
      <PageHeader
        title="Resolution Center"
        subtitle={`${fmtMonth(run.month)} · ${run.status}`}
        actions={
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/admin/payroll')}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Runs
          </Button>
        }
      />

      <div className="space-y-4">

        {/* ── Run summary ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: 'Employees',
              value: run.failure_summary
                ? `${run.failure_summary.total_employees - run.failure_summary.total_failed} / ${run.failure_summary.total_employees}`
                : run.employee_count,
              sub:   run.failure_summary ? 'succeeded / total' : 'in run',
              cls:   'text-foreground',
            },
            {
              label: 'Open Blockers',
              value: openBlockers,
              sub:   `of ${totalBlockers} total`,
              cls:   openBlockers > 0 ? 'text-destructive' : 'text-success',
            },
            {
              label: 'Critical Open',
              value: health.critical_open,
              sub:   health.critical_open > 0 ? 'blocking retry' : 'none — retry allowed',
              cls:   health.critical_open > 0 ? 'text-destructive' : 'text-success',
            },
            {
              label: 'Warnings Open',
              value: health.warning_open,
              sub:   health.warning_open > 0 ? 'non-blocking' : 'all clear',
              cls:   health.warning_open > 0 ? 'text-warning' : 'text-muted-foreground',
            },
          ].map(({ label, value, sub, cls }) => (
            <div key={label} className="p-3 rounded-lg border border-border bg-card space-y-0.5">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className={cn('text-lg font-bold', cls)}>{value}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>

        {/* ── Health bar ────────────────────────────────────────────────────── */}
        <RunHealthBar health={health} />

        {/* ── Blocker groups ────────────────────────────────────────────────── */}
        <SectionCard
          title="Blockers by Rule"
          description={`${openBlockers} open · resolve all critical blockers to enable retry`}
          action={
            <div className="flex items-center gap-1">
              {(['all', 'open', 'resolved', 'ignored'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(s)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors capitalize',
                    filterStatus === s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80',
                  )}
                >
                  {s}
                </button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 ml-1"
                onClick={() => refetch()}
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        >
          {groups.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {filterStatus === 'all'
                  ? 'No blockers found for this run.'
                  : `No ${filterStatus} blockers.`
                }
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(group => (
                <BlockerGroupCard
                  key={group.rule_code}
                  group={group}
                  onResolve={setResolvingBlocker}
                />
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── Recovery actions ──────────────────────────────────────────────── */}
        <SectionCard
          title="Recovery Actions"
          description="Re-run failed employees or freeze the month to prevent further changes"
        >
          <div className="flex gap-3 flex-wrap">

            {/* Retry Failed */}
            <div className="flex-1 min-w-[220px] p-4 rounded-lg border border-border bg-muted/20 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  Retry Failed Employees
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Re-runs payroll for all employees with open blockers.
                  Only allowed when zero critical+blocking blockers are open.
                </p>
              </div>

              {!health.retry_eligible && (
                <div className="flex items-start gap-1.5 text-xs text-destructive p-2 rounded-md bg-destructive/10">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  {health.health_label}
                </div>
              )}

              {health.retry_eligible && health.warning_open > 0 && (
                <div className="flex items-start gap-1.5 text-xs text-warning p-2 rounded-md bg-warning/10">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  {health.warning_open} warning{health.warning_open !== 1 ? 's' : ''} still open — retry is allowed but verify them first.
                </div>
              )}

              <Button
                size="sm"
                className="gap-1.5 w-full"
                disabled={!health.retry_eligible || retryMutation.isPending}
                onClick={() => retryMutation.mutate()}
              >
                {retryMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />
                }
                {retryMutation.isPending ? 'Retrying…' : 'Retry Failed'}
              </Button>
            </div>

            {/* Freeze Month */}
            <div className="flex-1 min-w-[220px] p-4 rounded-lg border border-border bg-muted/20 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-warning" />
                  Freeze Month
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Prevents any further payroll writes for {run.month}.
                  Use when investigation is needed and changes must be blocked.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 w-full text-warning border-warning/40 hover:bg-warning/10"
                disabled={freezeMutation.isPending}
                onClick={() => setShowFreezeConfirm(true)}
              >
                {freezeMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Lock className="h-3.5 w-3.5" />
                }
                {freezeMutation.isPending ? 'Freezing…' : `Freeze ${run.month}`}
              </Button>
            </div>

            {/* Navigate to Validation Center */}
            <div className="flex-1 min-w-[220px] p-4 rounded-lg border border-border bg-muted/20 space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-info" />
                  Validation Rules
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  View and configure which validation rules fire during payroll computation,
                  their severity, and whether they block retry.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 w-full"
                asChild
              >
                <Link to="/admin/payroll/validation">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Open Validation Center
                </Link>
              </Button>
            </div>

          </div>
        </SectionCard>

      </div>

      {/* ── Resolve dialog ────────────────────────────────────────────────────── */}
      {resolvingBlocker && (
        <ResolveDialog
          blocker={resolvingBlocker}
          onClose={() => setResolvingBlocker(null)}
          pending={resolveMutation.isPending}
          onSubmit={(action, note) =>
            resolveMutation.mutate({
              blockerId: resolvingBlocker.blocker_id,
              action,
              note,
            })
          }
        />
      )}

      <ConfirmDialog
        open={showFreezeConfirm}
        title="Freeze payroll month?"
        message={`This blocks all further payroll writes for ${run.month} until it is reopened. Use only when investigation requires changes to be blocked.`}
        confirmLabel="Freeze Month"
        destructive
        onConfirm={() => freezeMutation.mutate()}
        onCancel={() => setShowFreezeConfirm(false)}
      />
    </PageContainer>
  )
}
