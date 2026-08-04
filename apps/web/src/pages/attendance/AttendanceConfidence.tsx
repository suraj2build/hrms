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
import { cn, fmtDate }   from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────
// Mirrors apps/api/src/routes/attendance/confidence.ts's actual response
// shapes — both /summary and /low are month-bucketed (not date-range) and
// /low is grouped per employee (not one row per day).

interface LowConfidenceRow {
  employee_id:     string
  employee_code:   string
  name:            string
  days_with_issue: number
  avg_score:       number | null
  dates:           string[]
}

interface SummaryApiResponse {
  month:                string
  avg_confidence_score: number | null
  by_level:             Record<'high' | 'medium' | 'low' | 'critical', number>
  total_records:        number
}

interface LowConfidenceApiResponse {
  data: LowConfidenceRow[]
}

type ConfidenceLevelFilter = 'all' | 'low' | 'critical'

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

// Same fixed score bands attendance-processor.ts uses to assign
// confidence_level at write time — used here to color an aggregated row's
// avg_score, since /low groups multiple days (each with its own level) per
// employee rather than returning one confidence_level per row.
function bandForScore(score: number | null): ConfidenceLevel {
  const s = score ?? 0
  if (s >= 80) return 'high'
  if (s >= 60) return 'medium'
  if (s >= 40) return 'low'
  return 'critical'
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

  // Filter state — both /summary and /low are month-bucketed server-side
  // (apps/api/src/routes/attendance/confidence.ts), not date-range based.
  const currentMonth = new Date().toISOString().slice(0, 7)

  const [month,       setMonth]       = useState(currentMonth)
  const [levelFilter, setLevelFilter] = useState<ConfidenceLevelFilter>('all')
  const [applied, setApplied] = useState<{ month: string; level: ConfidenceLevelFilter }>(
    { month: currentMonth, level: 'all' },
  )

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: summary, isLoading: summaryLoading } =
    useQuery<SummaryApiResponse>({
      queryKey: ['confidence-summary', applied.month],
      queryFn:  () => api.get<SummaryApiResponse>(`/attendance/confidence/summary?month=${applied.month}`),
      staleTime: 60_000,
      enabled: isAdmin,
    })

  const { data: lowData, isLoading: lowLoading, isError, refetch } =
    useQuery<LowConfidenceApiResponse>({
      queryKey: ['confidence-low', applied.month, applied.level],
      queryFn:  () => api.get<LowConfidenceApiResponse>(
        `/attendance/confidence/low?month=${applied.month}&level=${applied.level}`,
      ),
      staleTime: 60_000,
      enabled: isAdmin,
    })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const lowRows = lowData?.data ?? []
  // Employees at risk reflects whatever level filter is currently applied
  // (defaults to 'all' = low + critical) — /low is already grouped per
  // employee, so its row count is the distinct at-risk employee count.
  const employeesAtRisk = lowRows.length

  const orderedDist = summary
    ? LEVEL_ORDER.map(lvl => ({ level: lvl, count: summary.by_level[lvl] ?? 0 }))
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
                      (summary.avg_confidence_score ?? 0) >= 80 ? 'high'
                      : (summary.avg_confidence_score ?? 0) >= 60 ? 'medium'
                      : (summary.avg_confidence_score ?? 0) >= 40 ? 'low'
                      : 'critical',
                    ),
                  )}
                >
                  {(summary.avg_confidence_score ?? 0).toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">out of 100</p>
              </div>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    (summary.avg_confidence_score ?? 0) >= 80
                      ? 'bg-success'
                      : (summary.avg_confidence_score ?? 0) >= 60
                      ? 'bg-warning'
                      : 'bg-destructive',
                  )}
                  style={{ width: `${Math.min(100, summary.avg_confidence_score ?? 0)}%` }}
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
                    employeesAtRisk > 0 ? 'text-destructive' : 'text-success',
                  )}
                >
                  {employeesAtRisk}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {applied.level === 'all' ? 'low or critical' : applied.level} this month, 3+ affected days
                </p>
              </div>
              {employeesAtRisk > 0 ? (
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
          {/* Month */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Month</label>
            <Input
              type="month"
              className="h-8 text-xs"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </div>

          {/* Level */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Level</label>
            <select
              value={levelFilter}
              onChange={e => setLevelFilter(e.target.value as ConfidenceLevelFilter)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            >
              <option value="all">Low or Critical</option>
              <option value="low">Low only</option>
              <option value="critical">Critical only</option>
            </select>
          </div>

          {/* Apply */}
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setApplied({ month, level: levelFilter })}
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
                No employees had 3+ {applied.level === 'all' ? 'low/critical' : applied.level}-confidence days in {applied.month}.
              </p>
            </div>
          )}

          {!lowLoading && !isError && lowRows.length > 0 && (
            <div className="overflow-x-auto -mx-1 mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Days with Issue', 'Avg Score', 'Level', 'Date Range'].map(h => (
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
                  {lowRows.map(row => {
                    const band = bandForScore(row.avg_score)
                    return (
                      <tr
                        key={row.employee_id}
                        className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                      >
                        {/* Employee */}
                        <td className="py-2.5 px-3">
                          <p className="text-xs font-medium text-foreground leading-tight">
                            {row.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {row.employee_code}
                          </p>
                        </td>

                        {/* Days with issue */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-xs text-foreground tabular-nums">
                          {row.days_with_issue}
                        </td>

                        {/* Avg score */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={cn('text-sm font-bold tabular-nums', scoreTextClass(band))}>
                            {(row.avg_score ?? 0).toFixed(1)}
                          </span>
                        </td>

                        {/* Level badge */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <Badge
                            variant={levelBadgeVariant(band)}
                            className="rounded-full text-[10px] px-2 capitalize"
                          >
                            {band}
                          </Badge>
                        </td>

                        {/* Date range */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-xs text-foreground tabular-nums">
                          {fmtDate(row.dates[0])}{row.dates.length > 1 ? ` – ${fmtDate(row.dates[row.dates.length - 1])}` : ''}
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
