/**
 * OperationalHealth — /attendance/operational-health
 *
 * Observability workspace for HR admins. Aggregates system-level
 * operational signals from all attendance sub-systems:
 *
 *   • Processing runs — success/failure rates, duration trends, stale locks
 *   • Anomaly funnel — open vs resolved over time
 *   • Correction SLA — pending corrections aging
 *   • Policy evaluation errors — failed resolutions
 *   • Forensics quick-jump — recent per-employee timeline access
 *
 * Designed for daily ops review by a senior HR administrator.
 */
import { useState }          from 'react'
import { Link }              from 'react-router-dom'
import { useQuery }          from '@tanstack/react-query'
import {
  Zap, AlertTriangle, ClipboardCheck, ShieldCheck, Target,
  CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, Minus,
  RefreshCw, ExternalLink, ChevronRight, Brain, Flame,
} from 'lucide-react'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { useBasePath }    from '@/lib/routing'
import { cn }             from '@/lib/utils'
import { ensureArray }    from '@/lib/array-utils'
import { ErrorBoundary }  from '@/components/error-boundary/ErrorBoundary'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessingRun {
  id:              string
  status:          'success' | 'failed' | 'running'
  started_at:      string
  completed_at:    string | null
  duration_ms:     number | null
  processed_count: number
  skipped_count:   number
  error_message:   string | null
}

interface ProcessStatus {
  is_running:       boolean
  started_at:       string | null
  lock_ttl_seconds: number | null
}

interface IntelSummary {
  at_risk_count:     number
  open_anomalies:    number
  avg_risk_score:    number
  computed_at:       string
}

interface AtRiskEmployee {
  employee_id:   string
  name:          string
  employee_code: string
  risk_score:    number
  reasons:       string[]
  anomaly_count: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - Date.parse(iso)
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, trend, variant = 'neutral', href, icon: Icon,
}: {
  label:    string
  value:    string | number
  sub?:     string
  trend?:   'up' | 'down' | 'flat'
  variant?: 'success' | 'warning' | 'destructive' | 'neutral'
  href?:    string
  icon:     React.ComponentType<{ className?: string }>
}) {
  const colorMap = {
    success:     'text-success',
    warning:     'text-warning',
    destructive: 'text-destructive',
    neutral:     'text-foreground',
  }
  const iconColorMap = {
    success:     'text-success',
    warning:     'text-warning/70',
    destructive: 'text-destructive/70',
    neutral:     'text-muted-foreground/50',
  }

  const inner = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className={cn('text-2xl font-bold', colorMap[variant])}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Icon className={cn('h-5 w-5', iconColorMap[variant])} />
        {trend === 'up'   && <TrendingUp   className="h-3.5 w-3.5 text-success" />}
        {trend === 'down' && <TrendingDown  className="h-3.5 w-3.5 text-destructive" />}
        {trend === 'flat' && <Minus         className="h-3.5 w-3.5 text-muted-foreground/40" />}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link to={href} className="block rounded-lg border border-border bg-card p-4 hover:bg-muted/40 transition-colors">
        {inner}
      </Link>
    )
  }
  return <div className="rounded-lg border border-border bg-card p-4">{inner}</div>
}

// ── Run list ──────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: ProcessingRun }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0 text-xs">
      {run.status === 'success'
        ? <CheckCircle2 className="h-3.5 w-3.5 text-success flex-shrink-0" />
        : run.status === 'failed'
        ? <XCircle      className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
        : <Zap          className="h-3.5 w-3.5 text-info flex-shrink-0 animate-pulse" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{fmtTime(run.started_at)}</span>
          <Badge
            variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'destructive' : 'outline'}
            className="rounded-full text-[9px]"
          >
            {run.status}
          </Badge>
        </div>
        {run.error_message && (
          <p className="text-destructive mt-0.5 truncate">{run.error_message}</p>
        )}
        {run.status === 'success' && (
          <p className="text-muted-foreground mt-0.5">
            {run.processed_count} processed · {run.skipped_count} skipped
          </p>
        )}
      </div>
      <span className="text-muted-foreground flex-shrink-0 flex items-center gap-1">
        <Clock className="h-3 w-3" />
        {fmtDuration(run.duration_ms)}
      </span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

function OperationalHealthInner() {
  const { profile }   = useAuthStore()
  const basePath      = useBasePath()
  const isAdmin       = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [refetchKey, setRefetchKey] = useState(0)

  const { data: status, isLoading: statusLoading } = useQuery<ProcessStatus>({
    queryKey:  ['op-health-process-status', refetchKey],
    queryFn:   () => api.get('/attendance/process/status'),
    staleTime: 15_000,
  })

  const { data: lastRun, isLoading: lastRunLoading } = useQuery<ProcessingRun>({
    queryKey:  ['op-health-last-run', refetchKey],
    queryFn:   () => api.get('/attendance/process/last'),
    staleTime: 15_000,
  })

  // Recent runs (last 10) — reuse the last-run endpoint result + derive
  const { data: recentRunsData } = useQuery<{ data: ProcessingRun[] }>({
    queryKey:  ['op-health-recent-runs', refetchKey],
    queryFn:   () => api.get('/attendance/process/runs?limit=10'),
    staleTime: 30_000,
  })

  const { data: anomalySummary } = useQuery<{ open_count: number; resolved_today: number }>({
    queryKey:  ['op-health-anomaly', refetchKey],
    queryFn:   () => api.get('/attendance/anomalies/summary'),
    staleTime: 30_000,
  })

  const { data: correctionSummary } = useQuery<{ pending_count: number; approved_today: number; oldest_pending_days: number | null }>({
    queryKey:  ['op-health-correction', refetchKey],
    queryFn:   () => api.get('/attendance/regularisation/summary'),
    staleTime: 30_000,
  })

  // Phase 10: AI intelligence summary (at-risk counts, avg score)
  const { data: intelData } = useQuery<{ summary: IntelSummary; at_risk: AtRiskEmployee[] }>({
    queryKey:  ['op-health-intelligence', refetchKey],
    queryFn:   () => api.get('/attendance/intelligence'),
    staleTime: 60_000,
    // graceful degradation — if the endpoint is absent, silently omit the panel
    retry: false,
  })
  const intelSummary = intelData?.summary ?? null
  const topAtRisk    = (intelData?.at_risk ?? []).slice(0, 4)

  // Derived stale-lock detection
  const isStale = (() => {
    if (!status?.is_running || !status.started_at) return false
    const ageMs = Date.now() - Date.parse(status.started_at)
    const ttlMs = (status.lock_ttl_seconds ?? 900) * 1_000
    return ageMs > ttlMs
  })()

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Operational Health"
          subtitle="System observability for HR administrators"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-12 gap-2 text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">This workspace is available to HR administrators only.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const recentRuns = recentRunsData?.data ?? (lastRun ? [lastRun] : [])
  const failedRuns24h = recentRuns.filter(r => {
    if (r.status !== 'failed') return false
    const diffH = (Date.now() - Date.parse(r.started_at)) / 3_600_000
    return diffH <= 24
  }).length

  return (
    <PageContainer>
      <PageHeader
        title="Operational Health"
        subtitle="Real-time observability across the attendance & leave system"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setRefetchKey(k => k + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* ── Stale lock alert ── */}
      {isStale && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-destructive">Processing lock is stale</p>
            <p className="text-xs text-destructive/80 mt-0.5">
              The attendance processing job has been running for longer than the configured TTL
              ({(status?.lock_ttl_seconds ?? 900) / 60} min). It may have crashed. The next run will auto-takeover.
            </p>
          </div>
          <Link to={`${basePath}/attendance`} className="text-xs text-destructive underline flex-shrink-0 flex items-center gap-1">
            Open Attendance <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatTile
          label="Processing"
          value={status?.is_running ? 'Running' : 'Idle'}
          sub={status?.started_at ? `Since ${fmtRelative(status.started_at)}` : lastRun ? `Last: ${fmtRelative(lastRun.started_at)}` : undefined}
          icon={Zap}
          variant={status?.is_running ? 'warning' : 'neutral'}
          href={`${basePath}/attendance`}
        />
        <StatTile
          label="Open Anomalies"
          value={anomalySummary?.open_count ?? '—'}
          sub={anomalySummary?.resolved_today != null ? `${anomalySummary.resolved_today} resolved today` : undefined}
          icon={AlertTriangle}
          variant={(anomalySummary?.open_count ?? 0) >= 10 ? 'warning' : (anomalySummary?.open_count ?? 0) > 0 ? 'neutral' : 'success'}
          href={`${basePath}/attendance/anomalies`}
        />
        <StatTile
          label="Pending Corrections"
          value={correctionSummary?.pending_count ?? '—'}
          sub={correctionSummary?.oldest_pending_days != null
            ? `Oldest: ${correctionSummary.oldest_pending_days}d`
            : undefined}
          icon={ClipboardCheck}
          variant={(correctionSummary?.pending_count ?? 0) > 0 ? 'warning' : 'success'}
          href={`${basePath}/attendance/corrections`}
        />
        <StatTile
          label="Failed Runs (24h)"
          value={failedRuns24h}
          sub={lastRun ? `Avg: ${fmtDuration(lastRun.duration_ms)}` : undefined}
          icon={XCircle}
          variant={failedRuns24h > 0 ? 'destructive' : 'success'}
        />
        {/* Phase 10: AI intelligence tile — only shown when endpoint responds */}
        <StatTile
          label="At-Risk Employees"
          value={intelSummary?.at_risk_count ?? '—'}
          sub={intelSummary?.avg_risk_score != null
            ? `Avg risk score: ${intelSummary.avg_risk_score.toFixed(0)}`
            : undefined}
          icon={Brain}
          variant={
            intelSummary == null              ? 'neutral'
            : intelSummary.at_risk_count >= 5 ? 'warning'
            : intelSummary.at_risk_count  > 0 ? 'neutral'
            : 'success'
          }
          href={`${basePath}/intelligence`}
        />
      </div>

      {/* ── Phase 10: AI Insights — At-Risk snapshot (only when data available) ── */}
      {topAtRisk.length > 0 && (
        <SectionCard
          title="AI Insights — At-Risk Employees"
          icon={<Brain className="h-4 w-4 text-muted-foreground" />}
          description="Employees flagged by the workforce intelligence engine based on attendance patterns"
          action={
            <Link
              to={`${basePath}/intelligence`}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              Full analysis <ChevronRight className="h-3 w-3" />
            </Link>
          }
        >
          <div className="space-y-1">
            {topAtRisk.map(emp => (
              <div
                key={emp.employee_id}
                className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0 text-xs"
              >
                <Flame className={cn(
                  'h-3.5 w-3.5 flex-shrink-0',
                  emp.risk_score >= 70 ? 'text-destructive' : emp.risk_score >= 40 ? 'text-warning' : 'text-muted-foreground',
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{emp.name}</span>
                    <span className="font-mono text-muted-foreground text-[10px]">#{emp.employee_code}</span>
                  </div>
                  {ensureArray<string>(emp.reasons).length > 0 && (
                    <p className="text-muted-foreground mt-0.5 truncate">
                      {ensureArray<string>(emp.reasons).slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn(
                    'text-xs font-bold tabular-nums',
                    emp.risk_score >= 70 ? 'text-destructive' : emp.risk_score >= 40 ? 'text-warning' : 'text-muted-foreground',
                  )}>
                    {emp.risk_score}
                  </span>
                  <Link
                    to={`${basePath}/attendance/forensics?employeeId=${emp.employee_id}`}
                    className="px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors whitespace-nowrap text-[10px]"
                  >
                    Forensics
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent processing runs */}
        <SectionCard
          title="Recent Processing Runs"
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          action={
            <Link
              to={`${basePath}/attendance`}
              className="text-xs text-primary flex items-center gap-1 hover:underline"
            >
              Run processor <ChevronRight className="h-3 w-3" />
            </Link>
          }
        >
          {(statusLoading || lastRunLoading) ? (
            <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
          ) : recentRuns.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">No processing runs recorded yet.</div>
          ) : (
            <div>
              {recentRuns.slice(0, 8).map(run => <RunRow key={run.id} run={run} />)}
            </div>
          )}
        </SectionCard>

        {/* System status + quick links */}
        <div className="space-y-4">
          {/* Last successful run details */}
          {lastRun && lastRun.status === 'success' && (
            <SectionCard
              title="Last Successful Run"
              icon={<CheckCircle2 className="h-4 w-4 text-success" />}
            >
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { label: 'Started',    value: fmtTime(lastRun.started_at) },
                  { label: 'Duration',   value: fmtDuration(lastRun.duration_ms) },
                  { label: 'Processed',  value: lastRun.processed_count },
                  { label: 'Skipped',    value: lastRun.skipped_count },
                ].map(({ label, value }) => (
                  <div key={label} className="p-2 rounded-md bg-muted/40">
                    <p className="text-muted-foreground text-[10px] mb-0.5">{label}</p>
                    <p className="font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Quick navigation */}
          <SectionCard
            title="Quick Access"
            icon={<Target className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-1">
              {[
                { label: 'Attendance Anomalies',  href: `${basePath}/attendance/anomalies`,   icon: AlertTriangle,  count: anomalySummary?.open_count },
                { label: 'Pending Corrections',   href: `${basePath}/attendance/corrections`, icon: ClipboardCheck, count: correctionSummary?.pending_count },
                { label: 'AI Workforce Insights', href: `${basePath}/intelligence`,            icon: Brain,          count: intelSummary?.at_risk_count },
                { label: 'Attendance Audit Log',  href: `${basePath}/attendance/audit`,       icon: ShieldCheck },
                { label: 'Attendance Forensics',  href: `${basePath}/attendance/forensics`,   icon: Target },
                { label: 'Muster Roll',           href: `${basePath}/attendance/muster`,      icon: TrendingUp },
              ].map(({ label, href, icon: Icon, count }) => (
                <Link
                  key={href}
                  to={href}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-muted/60 transition-colors text-xs group"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground flex-shrink-0" />
                  <span className="flex-1 text-muted-foreground group-hover:text-foreground">{label}</span>
                  {count != null && count > 0 && (
                    <Badge variant="secondary" className="rounded-full text-[9px] h-4 px-1.5">{count}</Badge>
                  )}
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground" />
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  )
}

export function OperationalHealth() {
  return (
    <ErrorBoundary title="Operational Health">
      <OperationalHealthInner />
    </ErrorBoundary>
  )
}
