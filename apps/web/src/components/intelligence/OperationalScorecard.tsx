/**
 * OperationalScorecard.tsx — Visual scorecard for 5 operational health metrics (Phase UX-5)
 */

import { Activity, DollarSign, Minus, Shield, TrendingDown, TrendingUp, Users, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OperationalScore } from '@/lib/intelligence/types'
import { GRADE_META } from '@/lib/intelligence/types'

export interface OperationalScorecardProps {
  score:      OperationalScore
  compact?:   boolean
  showTrend?: boolean
}

interface ScoreMetric {
  key:     keyof OperationalScore
  label:   string
  icon:    LucideIcon
  invert?: boolean
}

const SCORE_METRICS: ScoreMetric[] = [
  { key: 'attendanceHealth',      label: 'Attendance',   icon: Users       },
  { key: 'payrollReadiness',      label: 'Payroll',      icon: DollarSign  },
  { key: 'complianceScore',       label: 'Compliance',   icon: Shield      },
  { key: 'fatigueRisk',           label: 'Fatigue Risk', icon: Zap,  invert: true },
  { key: 'operationalEfficiency', label: 'Efficiency',   icon: Activity    },
]

function barColor(value: number): string {
  if (value >= 80) return 'bg-success'
  if (value >= 60) return 'bg-warning'
  return 'bg-destructive'
}

export function OperationalScorecard({
  score,
  compact = false,
  showTrend = true,
}: OperationalScorecardProps) {
  const gradeMeta = GRADE_META[score.grade]

  // ── Compact mode ────────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        {/* Mini grade */}
        <div
          className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg text-base font-black border',
            gradeMeta.bg,
            gradeMeta.color,
          )}
        >
          {score.grade}
        </div>

        {/* 5 thin bars */}
        <div className="flex items-end gap-1 h-5">
          {SCORE_METRICS.map(m => {
            const raw = score[m.key] as number
            const display = m.invert ? 100 - raw : raw
            return (
              <div key={m.key} className="flex flex-col items-center gap-0.5">
                <div
                  className={cn('w-3 rounded-sm', barColor(display))}
                  style={{ height: `${Math.max(4, Math.round(display / 100 * 20))}px` }}
                  title={`${m.label}: ${display}`}
                />
              </div>
            )
          })}
        </div>

        {/* Overall score */}
        <span className="text-sm font-bold tabular-nums">{score.overallScore}</span>
      </div>
    )
  }

  // ── Full mode ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        {/* Grade badge */}
        <div
          className={cn(
            'flex items-center justify-center w-12 h-12 rounded-xl text-2xl font-black border-2 flex-shrink-0',
            gradeMeta.bg,
            gradeMeta.color,
          )}
          style={{ borderColor: 'currentColor' }}
        >
          {score.grade}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Operational Score
            </span>
            {showTrend && score.trend && (
              <>
                {score.trend === 'up'     && <TrendingUp   className="h-4 w-4 text-success" />}
                {score.trend === 'down'   && <TrendingDown className="h-4 w-4 text-destructive" />}
                {score.trend === 'stable' && <Minus        className="h-4 w-4 text-muted-foreground" />}
              </>
            )}
          </div>
          <p className="text-2xl font-black tabular-nums text-foreground leading-none mt-0.5">
            {score.overallScore}
            <span className="text-sm font-normal text-muted-foreground ml-1">/100</span>
          </p>
        </div>
      </div>

      {/* Metric bars — 2 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SCORE_METRICS.map(m => {
          const raw = score[m.key] as number
          const displayValue = m.invert ? 100 - raw : raw
          const Icon = m.icon

          return (
            <div key={m.key} className="flex items-center gap-2.5">
              <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground">{m.label}</span>
                  <span className="text-[11px] font-semibold tabular-nums">{displayValue}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', barColor(displayValue))}
                    style={{ width: `${displayValue}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Last updated */}
      <p className="text-[10px] text-muted-foreground">
        Updated{' '}
        {new Date(score.updatedAt).toLocaleString([], {
          dateStyle: 'short',
          timeStyle: 'short',
        })}
      </p>
    </div>
  )
}
