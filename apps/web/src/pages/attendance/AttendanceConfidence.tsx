/**
 * AttendanceConfidence — /attendance/confidence
 *
 * Admin-only workspace for reviewing attendance confidence scores
 * and data quality indicators across the workforce.
 *
 * Access: hr_admin, super_admin only.
 */

import { useState }     from 'react'
import { useQuery }     from '@tanstack/react-query'
import {
  ShieldAlert, TrendingDown, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react'

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

interface ConfidenceSummary {
  avg_score:           number
  employees_at_risk:   number
  level_distribution:  Array<{ level: string; count: number }>
}

interface LowConfidenceRow {
  employee_id:       string
  date:              string
  confidence_score:  number
  confidence_level:  string
  confidence_factors: Record<string, number>
  employees: {
    first_name:    string
    last_name:     string
    employee_code: string
  }
}

interface SummaryApiResponse {
  data: ConfidenceSummary
}

interface LowConfidenceApiResponse {
  data: LowConfidenceRow[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type ConfidenceLevel = 'high' | 'medium' | 'low' | 'critical'

function normaliseLevel(level: string): ConfidenceLevel {
  const l = level.toLowerCase()
  if (l === 'high' || l === 'medium' || l === 'low' || l === 'critical') return l
  return 'low'
}

function scoreTextClass(level: string): string {
  switch (normaliseLevel(level)) {
    case 'high':     return 'text-success'
    case 'medium':   return 'text-warning'
    case 'low':      return 'text-destructive'
    case 'critical': return 'text-destructive'
  }
}

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive'

function levelBadgeVariant(level: string): BadgeVariant {
  switch (normaliseLevel(level)) {
    case 'high':     return 'success'
    case 'medium':   return 'warning'
    case 'low':      return 'destructive'
    case 'critical': return 'destructive'
  }
}

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** Return the top N factor keys by value, formatted as "factor_name (0.xx)" */
function topFactors(factors: Record<string, number>, n = 2): string[] {
  return Object.entries(factors)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} (${v.toFixed(2)})`)
}

// ── Level distribution card ────────────────────────────────────────────────────

const LEVEL_ORDER: ConfidenceLevel[] = ['high', 'medium', 'low', 'critical']

const LEVEL_BG: Record<ConfidenceLevel, string> = {
  high:     'bg-success/10',
  medium:   'bg-warning/10',
  low:      'bg-destructive/10',
  critical: 'bg-destructive/10',
}

function LevelDistCard({
  level, count,
}: { level: string; count: number }) {
  const norm = normaliseLevel(level)
  return (
    <div className={cn('rounded-lg border border-border px-3 py-2.5', LEVEL_BG[norm])}>
      <p className={cn('text-[10px] font-semibold uppercase tracking-wide capitalize mb-1', scoreTextClass(level))}>
        {level}
      </p>
      <p className="text-xl font-bold text-foreground">{count}</p>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function AttendanceConfidence() {
  const { profile } = useAuthStore()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  // Filter state
  const today     = new Date().toISOString().slice(0, 10)
  const monthAgo  = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [dateFrom,   setDateFrom]   = useState(monthAgo)
  const [dateTo,     setDateTo]     = useState(today)
  const [threshold,  setThreshold]  = useState(60)
  const [applied, setApplied] = useState<{
    dateFrom: string; dateTo: string; threshold: number
  }>({ dateFrom: monthAgo, dateTo: today, threshold: 60 })

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: summaryData, isLoading: summaryLoading } =
    useQuery<SummaryApiResponse>({
      queryKey: ['confidence-summary', applied.dateFrom, applied.dateTo],
      queryFn:  () => {
        const params = new URLSearchParams()
        if (applied.dateFrom) params.set('date_from', applied.dateFrom)
        if (applied.dateTo)   params.set('date_to',   applied.dateTo)
        return api.get<SummaryApiResponse>(`/attendance/confidence/summary?${params}`)
      },
      staleTime: 60_000,
      enabled: isAdmin,
    })

  const { data: lowData, isLoading: lowLoading, isError, refetch } =
    useQuery<LowConfidenceApiResponse>({
      queryKey: ['confidence-low', applied.threshold],
      queryFn:  () => {
        const params = new URLSearchParams({
          threshold: String(applied.threshold),
          limit:     '50',
        })
        return api.get<LowConfidenceApiResponse>(`/attendance/confidence/low?${params}`)
      },
      staleTime: 60_000,
      enabled: isAdmin,
    })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const summary  = summaryData?.data
  const lowRows  = lowData?.data ?? []

  const orderedDist = summary
    ? LEVEL_ORDER.map(lvl => {
        const found = summary.level_distribution.find(d => normaliseLevel(d.level) === lvl)
        return { level: lvl, count: found?.count ?? 0 }
      })
    : []

  // ── Access guard ──────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Attendance Confidence"
          subtitle="Confidence scores and data quality indicators"
        />
        <SectionCard>
          <div className="flex flex-col items-center py-16 gap-2 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">Access restricted</p>
            <p className="text-xs text-muted-foreground/60">
              This workspace is available to HR administrators only.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Confidence"
        subtitle="Confidence scores and data quality indicators"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => refetch()}
          >
            <TrendingDown className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* ── Summary section ── */}
      {summaryLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading summary…
        </div>
      ) : summary ? (
        <div className="space-y-4">
          {/* Average score + at-risk */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Avg score */}
            <div className="rounded-lg border border-border bg-card p-5 flex items-center gap-5">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Average Confidence Score
                </p>
                <p
                  className={cn(
                    'text-4xl font-bold tabular-nums',
                    scoreTextClass(
                      summary.avg_score >= 80 ? 'high'
                      : summary.avg_score >= 60 ? 'medium'
                      : summary.avg_score >= 40 ? 'low'
                      : 'critical',
                    ),
                  )}
                >
                  {summary.avg_score.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">out of 100</p>
              </div>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    summary.avg_score >= 80
                      ? 'bg-success'
                      : summary.avg_score >= 60
                      ? 'bg-warning'
                      : 'bg-destructive',
                  )}
                  style={{ width: `${Math.min(100, summary.avg_score)}%` }}
                />
              </div>
            </div>

            {/* Employees at risk */}
            <div className="rounded-lg border border-border bg-card p-5 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Employees at Risk
                </p>
                <p
                  className={cn(
                    'text-4xl font-bold',
                    summary.employees_at_risk > 0 ? 'text-destructive' : 'text-success',
                  )}
                >
                  {summary.employees_at_risk}
                </p>
                <p className="text-xs text-muted-foreground mt-1">below threshold</p>
              </div>
              {summary.employees_at_risk > 0 ? (
                <AlertTriangle className="h-6 w-6 text-destructive/70 mt-1" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-success/70 mt-1" />
              )}
            </div>
          </div>

          {/* Level distribution */}
          {orderedDist.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {orderedDist.map(({ level, count }) => (
                <LevelDistCard key={level} level={level} count={count} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ── Low confidence records table ── */}
      <SectionCard
        title={`Low Confidence Records${lowRows.length ? ` (${lowRows.length})` : ''}`}
        icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
        noPadding
      >
        {/* Filter bar */}
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border">
          {/* Date from */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Date From</label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date to */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Date To</label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={dateTo}
              min={dateFrom}
              onChange={e => setDateTo(e.target.value)}
            />
          </div>

          {/* Threshold */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">
              Threshold (0–100)
            </label>
            <Input
              type="number"
              className="h-8 text-xs w-24"
              min={0}
              max={100}
              value={threshold}
              onChange={e => setThreshold(Math.max(0, Math.min(100, Number(e.target.value))))}
            />
          </div>

          {/* Apply */}
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setApplied({ dateFrom, dateTo, threshold })}
          >
            Apply
          </Button>
        </div>

        {/* Table content */}
        <div className="px-4 pb-4">
          {lowLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading records…</span>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-2 py-12">
              <p className="text-sm text-destructive">Failed to load confidence records.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
            </div>
          )}

          {!lowLoading && !isError && lowRows.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 text-center">
              <CheckCircle2 className="h-8 w-8 text-success opacity-60" />
              <p className="text-sm font-medium text-foreground">No low-confidence records</p>
              <p className="text-xs text-muted-foreground">
                All records are at or above the {applied.threshold} threshold.
              </p>
            </div>
          )}

          {!lowLoading && !isError && lowRows.length > 0 && (
            <div className="overflow-x-auto -mx-1 mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Date', 'Score', 'Level', 'Key Factors'].map(h => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold text-muted-foreground py-2 px-3 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lowRows.map((row, idx) => {
                    const factors = topFactors(row.confidence_factors)
                    return (
                      <tr
                        key={`${row.employee_id}-${row.date}-${idx}`}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      >
                        {/* Employee */}
                        <td className="py-2.5 px-3">
                          <p className="text-xs font-medium text-foreground leading-tight">
                            {row.employees.first_name} {row.employees.last_name}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {row.employees.employee_code}
                          </p>
                        </td>

                        {/* Date */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-xs text-foreground tabular-nums">
                          {fmtDate(row.date)}
                        </td>

                        {/* Score */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={cn(
                              'text-sm font-bold tabular-nums',
                              scoreTextClass(row.confidence_level),
                            )}
                          >
                            {row.confidence_score.toFixed(1)}
                          </span>
                        </td>

                        {/* Level badge */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <Badge
                            variant={levelBadgeVariant(row.confidence_level)}
                            className="rounded-full text-[10px] px-2 capitalize"
                          >
                            {row.confidence_level}
                          </Badge>
                        </td>

                        {/* Key factors */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {factors.length > 0 ? factors.map(f => (
                              <span
                                key={f}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                              >
                                {f}
                              </span>
                            )) : (
                              <span className="text-[10px] text-muted-foreground/50">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>
    </PageContainer>
  )
}
