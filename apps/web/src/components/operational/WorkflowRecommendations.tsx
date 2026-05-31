/**
 * WorkflowRecommendations — Phase UX-3
 *
 * Surfaces actionable next-step suggestions based on live operational state.
 * Fetches five data sources in parallel and converts them into a sorted,
 * dismissible recommendation list with severity-coded left borders.
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery }                        from '@tanstack/react-query'
import { useNavigate }                     from 'react-router-dom'
import {
  Zap, X, ChevronRight,
  AlertCircle, AlertTriangle, Info,
} from 'lucide-react'
import { cn }             from '@/lib/utils'
import { api }            from '@/lib/api/client'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Recommendation {
  id:           string
  category:     'attendance' | 'payroll' | 'roster' | 'leave' | 'compliance'
  severity:     'critical' | 'warning' | 'info'
  title:        string
  description?: string
  count?:       number
  actionLabel?: string
  actionRoute?: string
  dismissible?: boolean
}

interface RecommendationSourceData {
  missingPunches:  number
  anomalies:       number
  payrollBlockers: number
  uncoveredShifts: number
  pendingLeave:    number
}

// ── API response shapes ───────────────────────────────────────────────────────

interface CountResponse      { data: { count: number } }
interface TotalListResponse  { data: unknown[]; total: number }

// ── Builder ───────────────────────────────────────────────────────────────────

function buildRecommendations(data: RecommendationSourceData): Recommendation[] {
  const recs: Recommendation[] = []

  if (data.missingPunches > 0) recs.push({
    id: 'missing-punches', category: 'attendance',
    severity:    data.missingPunches > 10 ? 'critical' : 'warning',
    title:       `${data.missingPunches} missing punch${data.missingPunches > 1 ? 'es' : ''} require review`,
    count:       data.missingPunches,
    actionLabel: 'Review Now',
    actionRoute: '/admin/attendance/corrections',
    dismissible: false,
  })

  if (data.anomalies > 0) recs.push({
    id: 'anomalies', category: 'attendance',
    severity:    data.anomalies > 5 ? 'critical' : 'warning',
    title:       `${data.anomalies} attendance anomal${data.anomalies > 1 ? 'ies' : 'y'} unresolved`,
    count:       data.anomalies,
    actionLabel: 'Resolve Anomalies',
    actionRoute: '/admin/attendance/anomalies',
    dismissible: true,
  })

  if (data.payrollBlockers > 0) recs.push({
    id: 'payroll-blockers', category: 'payroll',
    severity:    'critical',
    title:       `Payroll blocked — ${data.payrollBlockers} issue${data.payrollBlockers > 1 ? 's' : ''} need fixing`,
    count:       data.payrollBlockers,
    actionLabel: 'Fix Blockers',
    actionRoute: '/admin/payroll/blockers',
    dismissible: false,
  })

  if (data.uncoveredShifts > 0) recs.push({
    id: 'uncovered-shifts', category: 'roster',
    severity:    'warning',
    title:       `${data.uncoveredShifts} shift${data.uncoveredShifts > 1 ? 's' : ''} without coverage`,
    count:       data.uncoveredShifts,
    actionLabel: 'View Roster',
    actionRoute: '/admin/employee-shifts',
    dismissible: true,
  })

  if (data.pendingLeave > 0) recs.push({
    id: 'pending-leave', category: 'leave',
    severity:    'info',
    title:       `${data.pendingLeave} leave request${data.pendingLeave > 1 ? 's' : ''} awaiting approval`,
    count:       data.pendingLeave,
    actionLabel: 'Approve',
    actionRoute: '/admin/approvals/inbox',
    dismissible: true,
  })

  const order: Record<Recommendation['severity'], number> = { critical: 0, warning: 1, info: 2 }
  return recs.sort((a, b) => order[a.severity] - order[b.severity])
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRecs() {
  return (
    <div className="space-y-1.5" aria-busy="true" aria-label="Loading recommendations">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  )
}

// ── RecommendationCard ────────────────────────────────────────────────────────

const SEVERITY_BORDER: Record<Recommendation['severity'], string> = {
  critical: 'border-l-destructive',
  warning:  'border-l-amber-500',
  info:     'border-l-primary',
}

const SEVERITY_BG: Record<Recommendation['severity'], string> = {
  critical: 'bg-destructive/5',
  warning:  'bg-amber-500/5',
  info:     'bg-primary/5',
}

const SEVERITY_ICON: Record<Recommendation['severity'], React.ComponentType<{ className?: string }>> = {
  critical: AlertCircle,
  warning:  AlertTriangle,
  info:     Info,
}

const SEVERITY_ICON_COLOR: Record<Recommendation['severity'], string> = {
  critical: 'text-destructive',
  warning:  'text-amber-500',
  info:     'text-primary',
}

interface RecommendationCardProps {
  rec:       Recommendation
  onDismiss: (id: string) => void
}

function RecommendationCard({ rec, onDismiss }: RecommendationCardProps) {
  const navigate = useNavigate()
  const Icon     = SEVERITY_ICON[rec.severity]

  function handleAction() {
    if (rec.actionRoute) navigate(rec.actionRoute)
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation()
    onDismiss(rec.id)
  }

  return (
    <div
      role={rec.severity === 'critical' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-md border border-border border-l-2 px-3 py-2.5',
        SEVERITY_BORDER[rec.severity],
        SEVERITY_BG[rec.severity],
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', SEVERITY_ICON_COLOR[rec.severity])} />

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground leading-snug">{rec.title}</p>
        {rec.description && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{rec.description}</p>
        )}

        {rec.actionLabel && rec.actionRoute && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 mt-1.5 -ml-2 text-primary hover:text-primary"
            onClick={handleAction}
          >
            {rec.actionLabel}
            <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {rec.count !== undefined && (
          <Badge
            variant={rec.severity === 'critical' ? 'destructive' : rec.severity === 'warning' ? 'warning' : 'info'}
            className="text-[10px] h-4 px-1.5 py-0"
            aria-live="polite"
            aria-label={`${rec.count} items`}
          >
            {rec.count}
          </Badge>
        )}

        {rec.dismissible && (
          <button
            type="button"
            onClick={handleDismiss}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            aria-label="Dismiss recommendation"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowRecommendations({ compact = false }: { compact?: boolean }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery<RecommendationSourceData>({
    queryKey:       ['workflow-recs'],
    staleTime:      60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const results = await Promise.allSettled([
        api.get<CountResponse>('/attendance/missing-punches/today'),
        api.get<TotalListResponse>('/work-session-anomalies?status=unresolved'),
        api.get<TotalListResponse>('/payroll/blockers'),
        api.get<TotalListResponse>('/roster/uncovered-shifts'),
        api.get<TotalListResponse>('/leave/pending-approvals'),
      ])

      const resolve = <T,>(
        result: PromiseSettledResult<T>,
        fallback: T,
      ): T => (result.status === 'fulfilled' ? result.value : fallback)

      const [punches, anomalies, blockers, shifts, leave] = results

      const punchRes   = resolve(punches,   { data: { count: 0 } } as CountResponse)
      const anomalyRes = resolve(anomalies, { data: [], total: 0 } as TotalListResponse)
      const blockerRes = resolve(blockers,  { data: [], total: 0 } as TotalListResponse)
      const shiftRes   = resolve(shifts,    { data: [], total: 0 } as TotalListResponse)
      const leaveRes   = resolve(leave,     { data: [], total: 0 } as TotalListResponse)

      return {
        missingPunches:  punchRes.data.count,
        anomalies:       anomalyRes.total ?? anomalyRes.data.length,
        payrollBlockers: blockerRes.total ?? blockerRes.data.length,
        uncoveredShifts: shiftRes.total   ?? shiftRes.data.length,
        pendingLeave:    leaveRes.total   ?? leaveRes.data.length,
      }
    },
  })

  const allRecs = useMemo(
    () => (data ? buildRecommendations(data) : []),
    [data],
  )

  const visibleRecs = useMemo(
    () => allRecs.filter(r => !dismissed.has(r.id)),
    [allRecs, dismissed],
  )

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]))
  }, [])

  if (isLoading) return <SkeletonRecs />
  if (visibleRecs.length === 0) return null

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-center gap-1.5 mb-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">Recommended Actions</span>
          <span
            className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
            aria-live="polite"
            aria-label={`${visibleRecs.length} recommendations`}
          >
            {visibleRecs.length}
          </span>
        </div>
      )}

      {visibleRecs.map(rec => (
        <RecommendationCard key={rec.id} rec={rec} onDismiss={handleDismiss} />
      ))}
    </div>
  )
}
