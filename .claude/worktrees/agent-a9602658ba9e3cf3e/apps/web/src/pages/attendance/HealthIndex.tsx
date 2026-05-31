/**
 * HealthIndex — /attendance/health-index
 *
 * Multi-dimensional attendance health scoring by scope
 * (employee / department / site / org).
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }              from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast }                 from 'sonner'
import {
  ShieldAlert, Activity, TrendingUp, TrendingDown,
  Loader2, RefreshCw, AlertTriangle, Building2,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface HealthScore {
  id: string
  scope: 'employee' | 'department' | 'site' | 'org'
  scope_id: string | null
  scope_name: string | null
  period_month: string
  health_score: number
  present_rate: number
  late_rate: number
  absent_rate: number
  anomaly_rate: number
  missing_punch_rate: number
  computed_at: string
}

interface HealthSummary {
  org_health_score: number
  trend: string
  at_risk_departments: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function healthScoreColor(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 60) return 'text-warning'
  return 'text-destructive'
}

function healthScoreBarCls(score: number): string {
  if (score >= 80) return 'bg-success'
  if (score >= 60) return 'bg-warning'
  return 'bg-destructive'
}

function healthScoreBg(score: number): string {
  if (score >= 80) return 'bg-success/10'
  if (score >= 60) return 'bg-warning/10'
  return 'bg-destructive/10'
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

type ScopeFilter = 'all' | 'employee' | 'department' | 'site' | 'org'

// ── Health Score Card ──────────────────────────────────────────────────────────

function HealthCard({ entry }: { entry: HealthScore }) {
  const score = entry.health_score
  return (
    <div className={cn(
      'rounded-xl border border-border p-4 space-y-3',
      healthScoreBg(score),
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">
            {entry.scope_name ?? `(${entry.scope})`}
          </p>
          <p className="text-[10px] text-muted-foreground capitalize">{entry.scope}</p>
        </div>
        <div className={cn('text-2xl font-bold tabular-nums flex-shrink-0', healthScoreColor(score))}>
          {score.toFixed(0)}
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', healthScoreBarCls(score))}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>

      {/* Rate grid */}
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="text-center">
          <p className="text-muted-foreground">Present</p>
          <p className="font-semibold text-success">{fmtPct(entry.present_rate)}</p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">Late</p>
          <p className={cn('font-semibold', entry.late_rate > 0.1 ? 'text-warning' : 'text-foreground')}>
            {fmtPct(entry.late_rate)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">Absent</p>
          <p className={cn('font-semibold', entry.absent_rate > 0.1 ? 'text-destructive' : 'text-foreground')}>
            {fmtPct(entry.absent_rate)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-muted-foreground">Anomaly</p>
          <p className={cn('font-semibold', entry.anomaly_rate > 0.05 ? 'text-warning' : 'text-muted-foreground')}>
            {fmtPct(entry.anomaly_rate)}
          </p>
        </div>
        <div className="text-center col-span-2">
          <p className="text-muted-foreground">Missing Punch</p>
          <p className={cn('font-semibold', entry.missing_punch_rate > 0.05 ? 'text-warning' : 'text-muted-foreground')}>
            {fmtPct(entry.missing_punch_rate)}
          </p>
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground/60">
        Computed {fmtDatetime(entry.computed_at)}
      </p>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function HealthIndex() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [periodMonth, setPeriodMonth] = useState(currentMonth)
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [computeError, setComputeError] = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: listData, isLoading: listLoading, refetch: refetchList } = useQuery<{ data: HealthScore[] }>({
    queryKey: ['health-index-list', periodMonth, scopeFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        period_month: periodMonth,
        limit: '50',
      })
      if (scopeFilter !== 'all') params.set('scope', scopeFilter)
      return api.get(`/attendance/health-index/list?${params}`)
    },
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const { data: summaryData, refetch: refetchSummary } = useQuery<{ data: HealthSummary }>({
    queryKey: ['health-index-summary', periodMonth],
    queryFn:  () => api.get(`/attendance/health-index/summary?period_month=${periodMonth}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const computeMut = useMutation<{ computed: number }, Error, { period_month: string }>({
    mutationFn: (body) => api.post('/attendance/health-index/compute', body),
    onSuccess: (data) => {
      setComputeError('')
      refetchList()
      refetchSummary()
      toast.success('Health scores computed', { description: `${data.computed} score(s) updated` })
    },
    onError: (e: Error) => {
      setComputeError(e.message ?? 'Compute failed')
      toast.error('Failed to compute health scores', { description: e.message })
    },
  })

  function handleCompute() {
    setComputeError('')
    computeMut.mutate({ period_month: periodMonth })
  }

  // ── Access guard ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Attendance Health Index"
          subtitle="Multi-dimensional attendance health scoring by scope"
        />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const entries  = listData?.data ?? []
  const summary  = summaryData?.data
  const trend    = summary?.trend ?? ''
  const trendUp  = trend.toLowerCase().includes('improv') || trend === 'up'
  const trendDown = trend.toLowerCase().includes('declin') || trend === 'down'

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Health Index"
        subtitle="Multi-dimensional attendance health scoring by scope"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={handleCompute}
            disabled={computeMut.isPending}
          >
            {computeMut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Computing…</>
              : <><RefreshCw className="h-3.5 w-3.5" />Compute</>}
          </Button>
        }
      />

      {/* Summary row */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Org health score */}
          <SectionCard>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Org Health Score
            </p>
            <div className="flex items-end gap-2">
              <p className={cn('text-4xl font-bold tabular-nums', healthScoreColor(summary.org_health_score))}>
                {summary.org_health_score.toFixed(0)}
              </p>
              <span className="text-muted-foreground text-sm mb-1">/ 100</span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden mt-2">
              <div
                className={cn('h-full rounded-full', healthScoreBarCls(summary.org_health_score))}
                style={{ width: `${Math.min(100, summary.org_health_score)}%` }}
              />
            </div>
          </SectionCard>

          {/* Trend */}
          <SectionCard>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Trend
            </p>
            <div className="flex items-center gap-2 mt-1">
              {trendUp && <TrendingUp className="h-6 w-6 text-success" />}
              {trendDown && <TrendingDown className="h-6 w-6 text-destructive" />}
              {!trendUp && !trendDown && <Activity className="h-6 w-6 text-muted-foreground" />}
              <p className={cn(
                'text-lg font-semibold capitalize',
                trendUp ? 'text-success' : trendDown ? 'text-destructive' : 'text-muted-foreground',
              )}>
                {trend || '—'}
              </p>
            </div>
          </SectionCard>

          {/* At-risk departments */}
          <SectionCard>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
              At-Risk Departments
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Building2 className={cn('h-5 w-5', summary.at_risk_departments > 0 ? 'text-destructive' : 'text-success')} />
              <p className={cn('text-3xl font-bold tabular-nums', summary.at_risk_departments > 0 ? 'text-destructive' : 'text-success')}>
                {summary.at_risk_departments}
              </p>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {summary.at_risk_departments > 0 ? 'Departments need attention' : 'All departments healthy'}
            </p>
          </SectionCard>
        </div>
      )}

      {/* Controls */}
      <SectionCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Period Month</label>
            <Input
              type="month"
              value={periodMonth}
              onChange={e => setPeriodMonth(e.target.value)}
              className="h-8 text-xs w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Scope</label>
            <select
              value={scopeFilter}
              onChange={e => setScopeFilter(e.target.value as ScopeFilter)}
              className="h-8 text-xs rounded-md border border-input bg-background px-2 outline-none w-36"
            >
              <option value="all">All Scopes</option>
              <option value="employee">Employee</option>
              <option value="department">Department</option>
              <option value="site">Site</option>
              <option value="org">Org</option>
            </select>
          </div>
          {computeError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {computeError}
            </p>
          )}
          {computeMut.isSuccess && !computeError && (
            <p className="text-xs text-success">
              Computed {(computeMut.data as { computed: number }).computed} health scores.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Health score grid */}
      {listLoading ? (
        <SectionCard>
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading health scores…
          </div>
        </SectionCard>
      ) : entries.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
            <Activity className="h-8 w-8 opacity-30" />
            <p className="text-sm">No health scores found for {periodMonth}.</p>
            <p className="text-xs opacity-70">Try running Compute to generate scores.</p>
          </div>
        </SectionCard>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-foreground">
              {entries.length} scope{entries.length !== 1 ? 's' : ''} · {periodMonth}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {entries.map(entry => (
              <HealthCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
