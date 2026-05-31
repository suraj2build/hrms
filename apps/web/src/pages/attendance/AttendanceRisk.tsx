/**
 * AttendanceRisk — /attendance/risk
 *
 * HR admin workspace for viewing and computing attendance risk profiles.
 * Shows risk scores, chronic late counts, absence streaks, correction abuse,
 * and volatility scores per employee per period.
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }        from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast }            from 'sonner'
import {
  ShieldAlert, AlertTriangle, RefreshCw,
  Loader2, TrendingUp, Users, Activity,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RiskProfile {
  id: string
  employee_id: string
  period: string
  risk_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  chronic_late_count: number
  absence_streak_days: number
  correction_abuse_count: number
  volatility_score: number
  computed_at: string
  employees?: {
    first_name: string
    last_name: string
    employee_code: string
  }
}

interface RiskSummary {
  avg_risk_score: number
  high_risk_count: number
  employees_by_level: Array<{ level: string; count: number }>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string): string {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function currentPeriod(): string {
  const now = new Date()
  const q = Math.ceil((now.getMonth() + 1) / 3)
  return `${now.getFullYear()}-Q${q}`
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

const LEVEL_VARIANT: Record<RiskLevel, 'success' | 'warning' | 'destructive'> = {
  low:      'success',
  medium:   'warning',
  high:     'destructive',
  critical: 'destructive',
}

const LEVEL_BAR_CLS: Record<RiskLevel, string> = {
  low:      'bg-success',
  medium:   'bg-warning',
  high:     'bg-destructive',
  critical: 'bg-destructive',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RiskScoreBar({ score, level }: { score: number; level: RiskLevel }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden max-w-[80px]">
        <div
          className={cn('h-full rounded-full', LEVEL_BAR_CLS[level])}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums font-medium text-foreground">{score}</span>
    </div>
  )
}

function SummaryTile({ label, value, sub, icon: Icon, cls }: {
  label: string
  value: string | number
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  cls?: string
}) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <p className={cn('text-2xl font-bold', cls ?? 'text-foreground')}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </SectionCard>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AttendanceRisk() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [period, setPeriod]         = useState(currentPeriod)
  const [loadedPeriod, setLoadedPeriod] = useState(currentPeriod)
  const [computeError, setComputeError] = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: listData, isLoading: listLoading, refetch: refetchList } = useQuery<{ data: RiskProfile[] }>({
    queryKey: ['risk-list', loadedPeriod],
    queryFn:  () => api.get(`/attendance/risk?period_end=${loadedPeriod}&limit=50`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  const { data: summaryData, refetch: refetchSummary } = useQuery<{ data: RiskSummary }>({
    queryKey: ['risk-summary', loadedPeriod],
    queryFn:  () => api.get(`/attendance/risk/summary?period_end=${loadedPeriod}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const computeMut = useMutation<{ computed: number }, Error, { employee_ids: string[]; period: string }>({
    mutationFn: (body) => api.post('/attendance/risk/compute', body),
    onSuccess: (data) => {
      setComputeError('')
      refetchList()
      refetchSummary()
      toast.success('Risk profiles computed', { description: `${data.computed} profile(s) updated` })
    },
    onError: (e: Error) => {
      setComputeError(e.message ?? 'Compute failed')
      toast.error('Failed to compute risk profiles', { description: e.message })
    },
  })

  function handleLoad() {
    setLoadedPeriod(period)
  }

  function handleCompute() {
    setComputeError('')
    computeMut.mutate({ employee_ids: [], period: loadedPeriod })
  }

  // ── Access guard ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Attendance Risk Profiles" subtitle="Workforce attendance risk scoring and pattern detection" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
            <p className="text-sm">HR admin access required to view risk profiles.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const profiles = listData?.data ?? []
  const summary  = summaryData?.data

  const levelOrder: RiskLevel[] = ['critical', 'high', 'medium', 'low']

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Risk Profiles"
        subtitle="Workforce attendance risk scoring and pattern detection"
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
              : <><RefreshCw className="h-3.5 w-3.5" />Recompute</>}
          </Button>
        }
      />

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryTile
            label="Avg Risk Score"
            value={summary.avg_risk_score.toFixed(1)}
            sub="across all employees"
            icon={Activity}
            cls={
              summary.avg_risk_score >= 70 ? 'text-destructive'
              : summary.avg_risk_score >= 40 ? 'text-warning'
              : 'text-success'
            }
          />
          <SummaryTile
            label="High-Risk Employees"
            value={summary.high_risk_count}
            sub="high + critical level"
            icon={AlertTriangle}
            cls={summary.high_risk_count > 0 ? 'text-destructive' : 'text-success'}
          />
          {levelOrder.slice(0, 2).map(lvl => {
            const entry = summary.employees_by_level.find(e => e.level === lvl)
            return (
              <SummaryTile
                key={lvl}
                label={`${lvl.charAt(0).toUpperCase() + lvl.slice(1)} Risk`}
                value={entry?.count ?? 0}
                sub="employees"
                icon={Users}
                cls={
                  lvl === 'critical' || lvl === 'high' ? 'text-destructive'
                  : lvl === 'medium' ? 'text-warning'
                  : 'text-success'
                }
              />
            )
          })}
        </div>
      )}

      {/* Distribution mini-bar */}
      {summary?.employees_by_level && summary.employees_by_level.length > 0 && (
        <SectionCard
          title="Risk Level Distribution"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="flex flex-wrap gap-4">
            {levelOrder.map(lvl => {
              const entry = summary.employees_by_level.find(e => e.level === lvl)
              const count = entry?.count ?? 0
              return (
                <div key={lvl} className="flex items-center gap-2">
                  <Badge
                    variant={LEVEL_VARIANT[lvl]}
                    className="rounded-full text-[10px] capitalize min-w-[56px] text-center"
                  >
                    {lvl}
                  </Badge>
                  <span className="text-sm font-bold tabular-nums text-foreground">{count}</span>
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* Period controls */}
      <SectionCard>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <Input
              placeholder="e.g. 2025-Q2"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="h-8 text-xs w-36"
            />
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={handleLoad}>
            Load
          </Button>
          {computeError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {computeError}
            </p>
          )}
          {computeMut.isSuccess && !computeError && (
            <p className="text-xs text-success">
              Computed {(computeMut.data as { computed: number }).computed} profiles.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Risk profiles table */}
      <SectionCard
        title={`Risk Profiles — ${loadedPeriod}${profiles.length ? ` (${profiles.length})` : ''}`}
        icon={<ShieldAlert className="h-4 w-4 text-muted-foreground" />}
      >
        {listLoading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading risk profiles…
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 opacity-30" />
            <p className="text-sm">No risk profiles found for {loadedPeriod}.</p>
            <p className="text-xs opacity-70">Try running Recompute or loading a different period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {[
                    'Employee', 'Risk Score', 'Level',
                    'Chronic Late', 'Absence Streak', 'Correction Abuse', 'Computed At',
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => (
                  <tr key={p.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      {p.employees ? (
                        <>
                          <p className="font-medium text-foreground">
                            {p.employees.first_name} {p.employees.last_name}
                          </p>
                          <p className="text-[10px] text-muted-foreground">#{p.employees.employee_code}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground font-mono text-[10px]">{p.employee_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 min-w-[130px]">
                      <RiskScoreBar score={p.risk_score} level={p.risk_level} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        variant={LEVEL_VARIANT[p.risk_level]}
                        className="rounded-full text-[10px] capitalize"
                      >
                        {p.risk_level}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-center">
                      <span className={cn(
                        'font-medium',
                        p.chronic_late_count > 5 ? 'text-destructive' : p.chronic_late_count > 2 ? 'text-warning' : 'text-muted-foreground',
                      )}>
                        {p.chronic_late_count}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-center">
                      <span className={cn(
                        'font-medium',
                        p.absence_streak_days > 3 ? 'text-destructive' : p.absence_streak_days > 1 ? 'text-warning' : 'text-muted-foreground',
                      )}>
                        {p.absence_streak_days}d
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-center">
                      <span className={cn(
                        'font-medium',
                        p.correction_abuse_count > 3 ? 'text-destructive' : p.correction_abuse_count > 0 ? 'text-warning' : 'text-muted-foreground',
                      )}>
                        {p.correction_abuse_count}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {fmtDatetime(p.computed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
