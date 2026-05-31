import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export type DeepLinkTarget =
  | { type: 'employee-roster';   employeeId: string; month?: string }
  | { type: 'session-replay';    employeeId: string; date: string }
  | { type: 'payroll-impact';    employeeId: string; month?: string }
  | { type: 'attendance-day';    employeeId: string; date: string }
  | { type: 'anomaly-detail';    anomalyId: string }
  | { type: 'payroll-run';       runId: string }
  | { type: 'roster-conflict';   employeeId: string; date: string }
  | { type: 'leave-request';     requestId: string }

// ── Route mapper ───────────────────────────────────────────────────────────────

export function getDeepLink(target: DeepLinkTarget): string {
  switch (target.type) {
    case 'employee-roster':
      return `/admin/employee-shifts?employee=${target.employeeId}${
        target.month ? `&month=${target.month}` : ''
      }`
    case 'session-replay':
      return `/admin/attendance/intelligence-center?employee=${target.employeeId}&date=${target.date}&tab=replay`
    case 'payroll-impact':
      return `/admin/payroll/investigate?employee=${target.employeeId}${
        target.month ? `&month=${target.month}` : ''
      }`
    case 'attendance-day':
      return `/admin/attendance/forensics?employee=${target.employeeId}&date=${target.date}`
    case 'anomaly-detail':
      return `/admin/attendance/anomalies?id=${target.anomalyId}`
    case 'payroll-run':
      return `/admin/payroll/runs/${target.runId}/explain`
    case 'roster-conflict':
      return `/admin/employee-shifts?employee=${target.employeeId}&date=${target.date}`
    case 'leave-request':
      return `/admin/approvals/inbox?request=${target.requestId}`
    default: {
      // Exhaustiveness check — TypeScript will error here if a case is missed
      const _exhaustive: never = target
      void _exhaustive
      return '/admin/dashboard'
    }
  }
}

// ── Navigation hook ────────────────────────────────────────────────────────────

export function useDeepLink(): (target: DeepLinkTarget) => void {
  const navigate = useNavigate()
  return useCallback(
    (target: DeepLinkTarget) => {
      navigate(getDeepLink(target))
    },
    [navigate],
  )
}

// ── CrossLinkBadge ─────────────────────────────────────────────────────────────

export interface CrossLinkBadgeProps {
  label: string
  target: DeepLinkTarget
  icon?: React.ReactNode
  variant?: 'default' | 'outline'
}

export function CrossLinkBadge({
  label,
  target,
  icon,
  variant = 'outline',
}: CrossLinkBadgeProps): JSX.Element {
  const navigate = useNavigate()

  function handleClick(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault()
    navigate(getDeepLink(target))
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Navigate to ${label}`}
      className={cn(
        'inline-flex items-center gap-1 cursor-pointer select-none',
        'rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'outline'
          ? 'border-border bg-background text-foreground hover:bg-muted'
          : 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  )
}
