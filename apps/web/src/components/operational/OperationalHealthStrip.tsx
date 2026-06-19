/**
 * OperationalHealthStrip — global horizontal strip rendered below the TopNav.
 * Shows at-a-glance health metrics across all HRMS modules.
 *
 * Polls GET /operational/health every 60 s.
 * Displays loading skeletons while data is first fetched.
 */

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'

// ── Types ──────────────────────────────────────────────────────────────────────

type MetricStatus = 'healthy' | 'warning' | 'critical' | 'loading'

interface HealthMetric {
  id:       string
  label:    string
  value:    string | number
  status:   MetricStatus
  icon:     React.ReactNode
  route?:   string
  tooltip?: string
}

interface HealthApiResponse {
  data: {
    attendance_health:  number
    payroll_readiness:  number
    compliance_score:   number
    unresolved_risks:   number
    missing_punches:    number
    pending_approvals:  number
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const HEALTH_QUERY_KEY = ['op-health'] as const

function attendanceStatus(pct: number): MetricStatus {
  if (pct >= 80) return 'healthy'
  if (pct >= 60) return 'warning'
  return 'critical'
}

function payrollStatus(pct: number): MetricStatus {
  if (pct >= 90) return 'healthy'
  if (pct >= 70) return 'warning'
  return 'critical'
}

function complianceStatus(pct: number): MetricStatus {
  if (pct >= 85) return 'healthy'
  if (pct >= 65) return 'warning'
  return 'critical'
}

function riskStatus(count: number): MetricStatus {
  if (count === 0) return 'healthy'
  if (count <= 5)  return 'warning'
  return 'critical'
}

function statusTextColor(status: MetricStatus): string {
  switch (status) {
    case 'healthy':  return 'text-success dark:text-success'
    case 'warning':  return 'text-warning dark:text-warning'
    case 'critical': return 'text-destructive dark:text-destructive'
    case 'loading':  return 'text-muted-foreground'
  }
}

function statusDotColor(status: MetricStatus): string {
  switch (status) {
    case 'healthy':  return 'bg-success'
    case 'warning':  return 'bg-warning'
    case 'critical': return 'bg-destructive'
    case 'loading':  return 'bg-muted-foreground'
  }
}

function buildMetrics(d: HealthApiResponse['data']): HealthMetric[] {
  return [
    {
      id:      'attendance',
      label:   'Attendance Health',
      value:   `${d.attendance_health}%`,
      status:  attendanceStatus(d.attendance_health),
      icon:    null,
      route:   '/attendance',
      tooltip: 'Percentage of scheduled shifts with valid punches',
    },
    {
      id:      'payroll',
      label:   'Payroll Readiness',
      value:   `${d.payroll_readiness}%`,
      status:  payrollStatus(d.payroll_readiness),
      icon:    null,
      route:   '/payroll',
      tooltip: 'Employees ready for payroll processing',
    },
    {
      id:      'compliance',
      label:   'Compliance Score',
      value:   `${d.compliance_score}%`,
      status:  complianceStatus(d.compliance_score),
      icon:    null,
      route:   '/compliance',
      tooltip: 'Overall compliance score across all policies',
    },
    {
      id:      'risks',
      label:   'Unresolved Risks',
      value:   d.unresolved_risks,
      status:  riskStatus(d.unresolved_risks),
      icon:    null,
      route:   '/compliance',
      tooltip: 'Open risk items requiring attention',
    },
  ]
}

function timeAgoLabel(date: Date): string {
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSeconds < 10)  return 'just now'
  if (diffSeconds < 60)  return `${diffSeconds}s ago`
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60)  return `${diffMinutes}m ago`
  return `${Math.floor(diffMinutes / 60)}h ago`
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface StatusDotProps {
  status: MetricStatus
}

const StatusDot = React.memo(function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={cn('w-1.5 h-1.5 rounded-full inline-block flex-shrink-0', statusDotColor(status))}
      aria-hidden="true"
    />
  )
})
StatusDot.displayName = 'StatusDot'

// ── Main component ─────────────────────────────────────────────────────────────

export const OperationalHealthStrip = React.memo(function OperationalHealthStrip() {
  const navigate = useNavigate()

  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)

  const { data, isLoading, dataUpdatedAt, refetch } = useQuery<HealthApiResponse, Error>({
    queryKey:        HEALTH_QUERY_KEY,
    queryFn:         () => api.get<HealthApiResponse>('/operational/health'),
    refetchInterval: 60_000,
    staleTime:       30_000,
    retry:           false,
  })

  // Update lastUpdated timestamp when data arrives
  React.useEffect(() => {
    if (dataUpdatedAt) {
      setLastUpdated(new Date(dataUpdatedAt))
    }
  }, [dataUpdatedAt])

  // Tick every 15 s to keep "Updated X ago" fresh
  React.useEffect(() => {
    const id = setInterval(() => { forceRender() }, 15_000)
    return () => clearInterval(id)
  }, [])

  const metrics: HealthMetric[] = React.useMemo(
    () => (data ? buildMetrics(data.data) : []),
    [data],
  )

  const handleRefetch = React.useCallback(() => {
    void refetch()
  }, [refetch])

  const handleMetricClick = React.useCallback(
    (route: string | undefined) => {
      if (route) navigate(route)
    },
    [navigate],
  )

  return (
    <div
      role="status"
      aria-label="Operational health overview"
      className="h-8 bg-muted/30 border-b border-border flex items-center px-4 gap-6 overflow-x-auto"
    >
      {isLoading ? (
        // Loading skeletons
        <>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 animate-pulse"
              aria-hidden="true"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
              <span className="h-3 w-24 rounded bg-muted-foreground/20" />
            </div>
          ))}
        </>
      ) : (
        metrics.map(metric => {
          const isClickable = Boolean(metric.route)
          const Wrapper = isClickable ? 'button' : 'span'

          return (
            <Wrapper
              key={metric.id}
              className={cn(
                'flex items-center gap-1.5 text-xs whitespace-nowrap',
                isClickable &&
                  'cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm',
              )}
              title={metric.tooltip}
              {...(isClickable
                ? {
                    onClick: () => handleMetricClick(metric.route),
                    'aria-label': `${metric.label}: ${metric.value}`,
                    type: 'button' as const,
                  }
                : {})}
            >
              <StatusDot status={metric.status} />
              <span className="text-muted-foreground">{metric.label}</span>
              <span className={cn('font-medium', statusTextColor(metric.status))}>
                {metric.value}
              </span>
            </Wrapper>
          )
        })
      )}

      {/* Right-aligned: last updated + manual refresh */}
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
        {lastUpdated && (
          <span>Updated {timeAgoLabel(lastUpdated)}</span>
        )}
        <button
          type="button"
          onClick={handleRefetch}
          aria-label="Refresh operational health data"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
})

OperationalHealthStrip.displayName = 'OperationalHealthStrip'
