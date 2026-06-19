/**
 * TodaysMission — full-width summary strip at top of My Work Queue.
 */

import { cn } from '@/lib/utils'
import type { TodaysMissionData, QueueMode } from '@/lib/queue/types'
import { QUEUE_MODE_META } from '@/lib/queue/types'

export interface TodaysMissionProps {
  mission:      TodaysMissionData
  onModeChange: (mode: QueueMode) => void
}

const QUEUE_MODES: QueueMode[] = ['daily_ops', 'payroll_week', 'audit_mode', 'low_staffing']

export function TodaysMission({ mission, onModeChange }: TodaysMissionProps) {
  const { blockers_remaining, estimated_payroll_readiness, actions_required_today, urgent_sites, sla_risks, queue_mode } = mission

  const cardCn = cn(
    'rounded-xl border p-4',
    blockers_remaining === 0
      ? 'bg-success/10 border-success/30'
      : blockers_remaining <= 2
        ? 'bg-warning/10 border-warning/30'
        : 'bg-destructive/10 border-destructive/30',
  )

  const readinessCn = cn(
    'h-2 rounded-full transition-all',
    estimated_payroll_readiness >= 90
      ? 'bg-success'
      : estimated_payroll_readiness >= 60
        ? 'bg-warning'
        : 'bg-destructive',
  )

  return (
    <div className={cardCn}>
      {/* Main row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Label */}
        <span className="text-sm font-semibold text-foreground whitespace-nowrap">
          Today&apos;s Mission
        </span>

        {/* Blockers */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Blockers:</span>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold leading-none',
              blockers_remaining === 0
                ? 'bg-success/15 text-success'
                : blockers_remaining <= 2
                  ? 'bg-warning/15 text-warning'
                  : 'bg-destructive/15 text-destructive',
            )}
          >
            {blockers_remaining}
          </span>
        </div>

        {/* Readiness */}
        <div className="flex items-center gap-2 min-w-[140px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Readiness:</span>
          <div className="flex-1 h-2 rounded-full bg-muted min-w-[80px]">
            <div
              className={readinessCn}
              style={{ width: `${estimated_payroll_readiness}%` }}
            />
          </div>
          <span className="text-xs font-medium text-foreground">{estimated_payroll_readiness}%</span>
        </div>

        {/* Actions required */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Actions:</span>
          <span className="text-xs font-semibold text-foreground">{actions_required_today}</span>
        </div>

        {/* Urgent sites */}
        {urgent_sites.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Urgent Sites:</span>
            {urgent_sites.map(site => (
              <span
                key={site}
                className="inline-flex items-center rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-medium"
              >
                {site}
              </span>
            ))}
          </div>
        )}

        {/* Mode selector */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted-foreground">Mode:</span>
          <select
            value={queue_mode}
            onChange={e => onModeChange(e.target.value as QueueMode)}
            className="text-xs rounded border border-border bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {QUEUE_MODES.map(m => (
              <option key={m} value={m}>
                {QUEUE_MODE_META[m].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* SLA risks row */}
      {sla_risks.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 pl-1">
          {sla_risks.map((risk, idx) => (
            <li key={idx} className="text-[11px] text-muted-foreground before:content-['·_'] before:mr-1">
              {risk}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
