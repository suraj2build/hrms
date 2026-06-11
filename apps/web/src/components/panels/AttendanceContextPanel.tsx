import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActiveNowResponse {
  data: {
    count: number
    total_employees: number
  }
}

interface MissingPunchesResponse {
  data: {
    count: number
    employees: Array<{
      id: string
      name: string
      shift: string
    }>
  }
}

interface AnomalyEmployee {
  id: string
  employee_name: string
  anomaly_type: string
  severity: string
  date: string
}

interface AnomaliesResponse {
  data: AnomalyEmployee[]
}

interface OtSpikeEmployee {
  id: string
  name: string
  ot_hours: number
  threshold: number
}

interface OtSpikesResponse {
  data: OtSpikeEmployee[]
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

// ── Severity dot ──────────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === 'critical' || severity === 'high'
      ? 'bg-destructive'
      : severity === 'medium' || severity === 'warning'
      ? 'bg-warning'
      : 'bg-muted-foreground'
  return <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', color)} />
}

// ── Main component ─────────────────────────────────────────────────────────────

export const AttendanceContextPanel = React.memo(function AttendanceContextPanel() {
  const STALE = 30_000
  const REFETCH = 60_000

  const activeNowQuery = useQuery<ActiveNowResponse, Error>({
    queryKey: ['attendance', 'active-now'],
    queryFn: () => api.get<ActiveNowResponse>('/attendance/active-now'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const missingPunchesQuery = useQuery<MissingPunchesResponse, Error>({
    queryKey: ['attendance', 'missing-punches-today'],
    queryFn: () => api.get<MissingPunchesResponse>('/attendance/missing-punches/today'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const anomaliesQuery = useQuery<AnomaliesResponse, Error>({
    queryKey: ['attendance', 'anomalies-unresolved'],
    queryFn: () =>
      api.get<AnomaliesResponse>('/work-session-anomalies?status=unresolved&limit=5'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  const otSpikesQuery = useQuery<OtSpikesResponse, Error>({
    queryKey: ['attendance', 'ot-spikes'],
    queryFn: () => api.get<OtSpikesResponse>('/attendance/ot-spike-employees?limit=5'),
    staleTime: STALE,
    refetchInterval: REFETCH,
  })

  // ── Section 1: Live Activity ─────────────────────────────────────────────

  const activeNow = activeNowQuery.data?.data
  const isActive = (activeNow?.count ?? 0) > 0

  // ── Section 2: Missing Punches ───────────────────────────────────────────

  const missingData = missingPunchesQuery.data?.data
  const missingCount = missingData?.count ?? 0
  const missingEmployees = missingData?.employees?.slice(0, 3) ?? []

  // ── Section 3: Anomalies ─────────────────────────────────────────────────

  const anomalies = anomaliesQuery.data?.data ?? []
  const topAnomalies = anomalies.slice(0, 3)
  const hasCritical = anomalies.some(
    (a) => a.severity === 'critical' || a.severity === 'high',
  )

  // ── Section 4: OT Spikes ─────────────────────────────────────────────────

  const otSpikes = otSpikesQuery.data?.data ?? []

  return (
    <div className="text-sm">
      {/* Section 1 — Live Activity */}
      <Section
        title="Live Activity"
        badge={
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full',
              isActive ? 'bg-green-500' : 'bg-muted-foreground',
            )}
            aria-label={isActive ? 'Employees active' : 'No active employees'}
          />
        }
      >
        {activeNowQuery.isLoading ? (
          <SectionSkeleton />
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-foreground">
              <span
                className={cn(
                  'font-semibold',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {activeNow?.count ?? 0}
              </span>{' '}
              employees active now
            </p>
            <p className="text-xs text-muted-foreground">
              {activeNow?.count ?? 0} / {activeNow?.total_employees ?? 0} present today
            </p>
          </div>
        )}
      </Section>

      {/* Section 2 — Missing Punches */}
      <Section
        title="Missing Punches"
        badge={
          missingCount > 0 ? (
            <Badge
              variant="outline"
              className="text-warning border-warning text-xs px-1.5 py-0"
            >
              {missingCount}
            </Badge>
          ) : null
        }
      >
        {missingPunchesQuery.isLoading ? (
          <SectionSkeleton />
        ) : missingCount === 0 ? (
          <p className="text-xs text-muted-foreground">No missing punches today.</p>
        ) : (
          <div className="space-y-1">
            {missingEmployees.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground truncate">{emp.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">{emp.shift}</span>
              </div>
            ))}
            {missingCount > 3 && (
              <Link
                to="/admin/attendance/corrections"
                className="text-xs text-primary hover:underline"
              >
                View all ({missingCount})
              </Link>
            )}
            {missingCount <= 3 && (
              <Link
                to="/admin/attendance/corrections"
                className="text-xs text-primary hover:underline"
              >
                View all
              </Link>
            )}
          </div>
        )}
      </Section>

      {/* Section 3 — Unresolved Anomalies */}
      <Section
        title="Unresolved Anomalies"
        badge={
          anomalies.length > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                'text-xs px-1.5 py-0',
                hasCritical
                  ? 'text-destructive border-destructive'
                  : 'text-warning border-warning',
              )}
            >
              {anomalies.length}
            </Badge>
          ) : null
        }
      >
        {anomaliesQuery.isLoading ? (
          <SectionSkeleton />
        ) : anomalies.length === 0 ? (
          <p className="text-xs text-muted-foreground">No unresolved anomalies.</p>
        ) : (
          <div className="space-y-1.5">
            {topAnomalies.map((a) => (
              <div key={a.id} className="flex items-start gap-1.5">
                <SeverityDot severity={a.severity} />
                <div className="min-w-0">
                  <span className="text-xs text-foreground truncate block">
                    {a.employee_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.anomaly_type} · {a.date}
                  </span>
                </div>
              </div>
            ))}
            <Link
              to="/admin/attendance/anomalies"
              className="text-xs text-primary hover:underline block"
            >
              Review all
            </Link>
          </div>
        )}
      </Section>

      {/* Section 4 — OT Spikes */}
      <Section title="OT Spikes">
        {otSpikesQuery.isLoading ? (
          <SectionSkeleton />
        ) : otSpikes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No OT spikes detected.</p>
        ) : (
          <div className="space-y-1.5">
            {otSpikes.map((emp) => (
              <div key={emp.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-foreground truncate">{emp.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {emp.ot_hours}h / {emp.threshold}h
                </span>
              </div>
            ))}
            <Link
              to="/admin/overtime"
              className="text-xs text-primary hover:underline block"
            >
              Manage OT
            </Link>
          </div>
        )}
      </Section>
    </div>
  )
})
