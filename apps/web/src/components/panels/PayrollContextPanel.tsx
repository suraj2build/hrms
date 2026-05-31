import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'
import { useOperationalContext } from '@/contexts/OperationalContext'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PayrollBlocker {
  id: string
  employee_name: string
  blocker_type: string
  severity: 'critical' | 'warning'
}

interface BlockersResponse {
  data: PayrollBlocker[]
}

interface VarianceEmployee {
  employee_name: string
  delta_pct: number
  direction: 'up' | 'down'
}

interface VarianceSummaryResponse {
  data: {
    spike_count: number
    top_variances: VarianceEmployee[]
  }
}

interface ReadinessResponse {
  data: {
    attendance_locked: boolean
    anomalies_resolved: boolean
    revisions_approved: boolean
    readiness_pct: number
  }
}

interface PendingLocksResponse {
  data: {
    pending_count: number
    departments: string[]
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SectionSkeleton() {
  return (
    <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">
      <div className="animate-pulse bg-muted rounded h-3 w-3/4" />
      <div className="animate-pulse bg-muted rounded h-3 w-1/2" />
      <div className="animate-pulse bg-muted rounded h-3 w-2/3" />
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}

function Section({ title, badge, children }: SectionProps) {
  return (
    <div className="px-3 py-2.5 border-b border-border last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  )
}

// ── Readiness color ───────────────────────────────────────────────────────────

function readinessColor(pct: number): string {
  if (pct >= 90) return 'bg-green-500'
  if (pct >= 70) return 'bg-warning'
  return 'bg-destructive'
}

// ── Checklist item ────────────────────────────────────────────────────────────

function CheckItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2
          className="w-3.5 h-3.5 text-green-500 shrink-0"
          aria-label="Complete"
        />
      ) : (
        <XCircle
          className="w-3.5 h-3.5 text-destructive shrink-0"
          aria-label="Incomplete"
        />
      )}
      <span className={cn('text-xs', done ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export const PayrollContextPanel = React.memo(function PayrollContextPanel() {
  const { activePayrollMonth } = useOperationalContext()

  const STALE = 30_000
  const REFETCH = 60_000

  const blockersQuery = useQuery<BlockersResponse, Error>({
    queryKey: ['payroll', 'blockers', activePayrollMonth],
    queryFn: () =>
      api.get<BlockersResponse>(`/payroll/blockers?month=${activePayrollMonth}`),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const varianceQuery = useQuery<VarianceSummaryResponse, Error>({
    queryKey: ['payroll', 'variance-summary', activePayrollMonth],
    queryFn: () =>
      api.get<VarianceSummaryResponse>(
        `/payroll/variance-summary?month=${activePayrollMonth}`,
      ),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const readinessQuery = useQuery<ReadinessResponse, Error>({
    queryKey: ['payroll', 'readiness', activePayrollMonth],
    queryFn: () =>
      api.get<ReadinessResponse>(`/payroll/readiness?month=${activePayrollMonth}`),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const pendingLocksQuery = useQuery<PendingLocksResponse, Error>({
    queryKey: ['payroll', 'pending-locks', activePayrollMonth],
    queryFn: () =>
      api.get<PendingLocksResponse>(`/payroll/pending-locks?month=${activePayrollMonth}`),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  // ── Derived values ────────────────────────────────────────────────────────

  const blockers = blockersQuery.data?.data ?? []
  const hasCritical = blockers.some((b) => b.severity === 'critical')

  const varianceData = varianceQuery.data?.data
  const spikeCount = varianceData?.spike_count ?? 0
  const topVariances = (varianceData?.top_variances ?? []).slice(0, 3)

  const readiness = readinessQuery.data?.data
  const readinessPct = readiness?.readiness_pct ?? 0

  const pendingLocks = pendingLocksQuery.data?.data

  return (
    <div className="text-sm">
      {/* Section 1 — Readiness Gauge */}
      <Section title="Payroll Readiness">
        {readinessQuery.isLoading ? (
          <SectionSkeleton />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{readinessPct}% ready</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5" aria-label={`Readiness ${readinessPct}%`}>
              <div
                className={cn('h-1.5 rounded-full transition-all', readinessColor(readinessPct))}
                style={{ width: `${readinessPct}%` }}
              />
            </div>
            <div className="space-y-1 pt-1">
              <CheckItem
                label="Attendance Locked"
                done={readiness?.attendance_locked ?? false}
              />
              <CheckItem
                label="Anomalies Resolved"
                done={readiness?.anomalies_resolved ?? false}
              />
              <CheckItem
                label="Revisions Approved"
                done={readiness?.revisions_approved ?? false}
              />
            </div>
          </div>
        )}
      </Section>

      {/* Section 2 — Payroll Blockers */}
      <Section
        title="Payroll Blockers"
        badge={
          blockers.length > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                'text-xs px-1.5 py-0',
                hasCritical
                  ? 'text-destructive border-destructive'
                  : 'text-warning border-warning',
              )}
            >
              {blockers.length}
            </Badge>
          ) : null
        }
      >
        {blockersQuery.isLoading ? (
          <SectionSkeleton />
        ) : blockers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No blockers found.</p>
        ) : (
          <div className="space-y-1">
            {blockers.map((b) => (
              <div key={b.id} className="text-xs">
                <span className="text-foreground">{b.employee_name}</span>
                <span className="text-muted-foreground"> · {b.blocker_type}</span>
              </div>
            ))}
            <Link
              to="/admin/payroll/blockers"
              className="text-xs text-primary hover:underline block"
            >
              Fix Blockers
            </Link>
          </div>
        )}
      </Section>

      {/* Section 3 — Variance Spikes */}
      <Section
        title="Variance Spikes"
        badge={
          spikeCount > 0 ? (
            <Badge variant="outline" className="text-xs px-1.5 py-0 text-warning border-warning">
              {spikeCount}
            </Badge>
          ) : null
        }
      >
        {varianceQuery.isLoading ? (
          <SectionSkeleton />
        ) : spikeCount === 0 ? (
          <p className="text-xs text-muted-foreground">No variance spikes detected.</p>
        ) : (
          <div className="space-y-1">
            {topVariances.map((v, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground truncate">{v.employee_name}</span>
                <span
                  className={cn(
                    'text-xs font-medium shrink-0',
                    v.direction === 'up' ? 'text-destructive' : 'text-primary',
                  )}
                >
                  {v.direction === 'up' ? '+' : '-'}{Math.abs(v.delta_pct)}%
                </span>
              </div>
            ))}
            <Link
              to="/admin/payroll/variance"
              className="text-xs text-primary hover:underline block"
            >
              Review Variance
            </Link>
          </div>
        )}
      </Section>

      {/* Section 4 — Pending Locks */}
      <Section title="Pending Locks">
        {pendingLocksQuery.isLoading ? (
          <SectionSkeleton />
        ) : (pendingLocks?.pending_count ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">All periods locked.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-foreground">
              <span className="font-semibold">{pendingLocks?.pending_count}</span>{' '}
              {pendingLocks?.pending_count === 1 ? 'department needs' : 'departments need'}{' '}
              period lock
            </p>
            {(pendingLocks?.departments ?? []).length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                {pendingLocks?.departments.join(', ')}
              </p>
            )}
            <Link
              to="/admin/attendance/periods"
              className="text-xs text-primary hover:underline block"
            >
              Manage Locks
            </Link>
          </div>
        )}
      </Section>
    </div>
  )
})
