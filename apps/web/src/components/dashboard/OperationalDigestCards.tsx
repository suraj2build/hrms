/**
 * OperationalDigestCards.tsx — Daily operational summary cards
 * Phase UX-4
 *
 * 5 cards: Attendance %, Unresolved Risks, Pending Approvals,
 *          Payroll Blockers, Compliance Warnings
 * Derived from allEvents + a /analytics/dashboard stats fetch.
 */

import { useMemo }     from 'react'
import { useQuery }    from '@tanstack/react-query'
import {
  Users, AlertTriangle, ClipboardList, ShieldAlert, AlertCircle,
} from 'lucide-react'
import { cn }          from '@/lib/utils'
import { api }         from '@/lib/api/client'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import type { OperationalDigest } from '@/lib/activity/types'

// ── Props ──────────────────────────────────────────────────────────────────────

export interface OperationalDigestCardsProps {
  layout?: 'row' | 'grid'
}

// ── Dashboard stats shape ──────────────────────────────────────────────────────

interface DashboardStats {
  active_employees: number
  total_employees:  number
}

// ── Skeleton card ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-4 w-4 rounded bg-muted" />
      </div>
      <div className="h-8 w-16 rounded bg-muted" />
      <div className="h-3 w-32 rounded bg-muted" />
    </div>
  )
}

// ── Digest card ────────────────────────────────────────────────────────────────

function DigestCard({
  label,
  value,
  subtext,
  icon: Icon,
  valueColor,
}: {
  label:      string
  value:      string | number
  subtext:    string
  icon:       React.ComponentType<{ className?: string }>
  valueColor: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <p className={cn('text-2xl font-bold tabular-nums', valueColor)}>{value}</p>
      <p className="text-xs text-muted-foreground">{subtext}</p>
    </div>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function OperationalDigestCards({ layout = 'row' }: OperationalDigestCardsProps) {
  const { allEvents, isLoading: streamLoading } = useActivityStream()

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['digest-dashboard-stats'],
    queryFn:  () => api.get<DashboardStats>('/analytics/dashboard'),
    staleTime: 5 * 60_000,
  })

  // ── Derive digest from allEvents ──────────────────────────────────────────

  const digest = useMemo((): OperationalDigest => {
    const today = new Date().toISOString().slice(0, 10)

    const unresolvedRisks = allEvents.filter(
      e => (e.severity === 'critical' || e.severity === 'high') && e.status === 'open',
    ).length

    const pendingApprovals = allEvents.filter(e => e.status === 'pending').length

    const payrollBlockers = allEvents.filter(
      e => e.type === 'payroll_blocker' && e.status === 'open',
    ).length

    const complianceWarnings = allEvents.filter(
      e => e.type === 'compliance_alert' && e.status === 'open',
    ).length

    return {
      attendancePct:      0, // overridden below with stats
      unresolvedRisks,
      pendingApprovals,
      payrollBlockers,
      complianceWarnings,
      date: today,
    }
  }, [allEvents])

  // ── Attendance % from API stats ───────────────────────────────────────────

  const attendancePct = useMemo(
    () =>
      Math.round(
        ((stats?.active_employees ?? 0) / Math.max(stats?.total_employees ?? 1, 1)) * 100,
      ),
    [stats],
  )

  // ── Value colours ─────────────────────────────────────────────────────────

  const attendanceColor =
    attendancePct >= 90
      ? 'text-success'
      : attendancePct >= 70
        ? 'text-warning'
        : 'text-destructive'

  const risksColor = digest.unresolvedRisks > 0 ? 'text-destructive' : 'text-success'

  const approvalsColor =
    digest.pendingApprovals > 5
      ? 'text-warning'
      : digest.pendingApprovals > 0
        ? 'text-info'
        : 'text-muted-foreground'

  const blockersColor = digest.payrollBlockers > 0 ? 'text-destructive' : 'text-success'

  const complianceColor = digest.complianceWarnings > 0 ? 'text-accent-coral' : 'text-success'

  // ── Loading state ──────────────────────────────────────────────────────────

  const isLoading = streamLoading || statsLoading

  if (isLoading) {
    return (
      <div
        className={cn(
          layout === 'grid'
            ? 'grid grid-cols-2 xl:grid-cols-5 gap-3'
            : 'flex items-stretch gap-3 overflow-x-auto',
        )}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  return (
    <div
      className={cn(
        layout === 'grid'
          ? 'grid grid-cols-2 xl:grid-cols-5 gap-3'
          : 'flex items-stretch gap-3 overflow-x-auto',
      )}
    >
      <DigestCard
        label="Attendance"
        value={`${attendancePct}%`}
        icon={Users}
        valueColor={attendanceColor}
        subtext="Active today"
      />
      <DigestCard
        label="Unresolved Risks"
        value={digest.unresolvedRisks}
        icon={AlertTriangle}
        valueColor={risksColor}
        subtext="Critical & high severity open"
      />
      <DigestCard
        label="Pending Approvals"
        value={digest.pendingApprovals}
        icon={ClipboardList}
        valueColor={approvalsColor}
        subtext="Awaiting action"
      />
      <DigestCard
        label="Payroll Blockers"
        value={digest.payrollBlockers}
        icon={ShieldAlert}
        valueColor={blockersColor}
        subtext="Blocking payroll run"
      />
      <DigestCard
        label="Compliance Warnings"
        value={digest.complianceWarnings}
        icon={AlertCircle}
        valueColor={complianceColor}
        subtext="Open alerts"
      />
    </div>
  )
}
