/**
 * WorkforceOptimizationInsights.tsx — Grid of optimization insight cards (Phase UX-5)
 */

import { useState } from 'react'
import { Clock, Sparkles, TrendingDown, TrendingUp, UserX, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import type { AffectedEntity, OptimizationInsight, OptimizationInsightType } from '@/lib/intelligence/types'

// Grid3X3 as a fallback for LayoutGrid (not always available in older lucide versions)
import { Grid3X3 } from 'lucide-react'

export interface WorkforceOptimizationInsightsProps {
  insights:   OptimizationInsight[]
  isLoading?: boolean
  compact?:   boolean
}

const OPTIMIZATION_ICONS: Record<OptimizationInsightType, ComponentType<{ className?: string }>> = {
  chronic_absenteeism:   UserX,
  ot_hotspot:            Clock,
  shift_imbalance:       Grid3X3,
  payroll_anomaly_trend: TrendingUp,
  fatigue_cluster:       Zap,
}

function trendIcon(trend: OptimizationInsight['trend']) {
  if (trend === 'worsening') return TrendingUp
  if (trend === 'improving') return TrendingDown
  return null
}

function trendIconColor(trend: OptimizationInsight['trend']): string {
  if (trend === 'worsening') return 'text-destructive'
  if (trend === 'improving') return 'text-success'
  return 'text-muted-foreground'
}

function EntityChips({ entities }: { entities: AffectedEntity[] }) {
  const visible = entities.slice(0, 2)
  const extra   = entities.length - visible.length

  if (entities.length === 0) return null

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {visible.map(e => (
        <span
          key={e.id}
          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground truncate max-w-[90px]"
          title={e.name}
        >
          {e.name}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] text-muted-foreground">+{extra} more</span>
      )}
    </div>
  )
}

interface InsightCardProps {
  insight: OptimizationInsight
}

function InsightCard({ insight }: InsightCardProps) {
  const [showRec, setShowRec] = useState(false)

  const Icon      = OPTIMIZATION_ICONS[insight.type]
  const TrendIcon = trendIcon(insight.trend)

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1.5 relative">
      {/* Top-right icon */}
      <div className="absolute top-2.5 right-2.5">
        <Icon className={cn('h-4 w-4', trendIconColor(insight.trend))} />
      </div>

      {/* Title */}
      <p className="text-sm font-semibold text-foreground pr-6 leading-snug">{insight.title}</p>

      {/* Metric */}
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black tabular-nums text-foreground leading-none">
          {insight.metric}
        </span>
        <span className="text-xs text-muted-foreground">{insight.unit}</span>
      </div>

      {/* Trend chip */}
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
          insight.trend === 'worsening'
            ? 'bg-destructive/10 text-destructive'
            : insight.trend === 'improving'
            ? 'bg-success/10 text-success'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {TrendIcon && <TrendIcon className="h-2.5 w-2.5" />}
        {insight.trend === 'worsening' ? '↑' : insight.trend === 'improving' ? '↓' : '→'}{' '}
        {insight.trend}
        {insight.trendValue !== undefined &&
          ` (${insight.trendValue > 0 ? '+' : ''}${insight.trendValue})`}
      </span>

      {/* Affected entities */}
      <EntityChips entities={insight.affectedEntities} />

      {/* Recommendation (expandable) */}
      <div>
        <button
          onClick={() => setShowRec(v => !v)}
          className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRec ? 'Hide' : 'Show'} recommendation
        </button>
        {showRec && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            {insight.recommendation}
          </p>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 animate-pulse">
      <div className="h-3.5 w-3/4 rounded bg-muted" />
      <div className="h-7 w-1/3 rounded bg-muted" />
      <div className="h-5 w-1/4 rounded-full bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
    </div>
  )
}

export function WorkforceOptimizationInsights({
  insights,
  isLoading = false,
  compact   = false,
}: WorkforceOptimizationInsightsProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3')}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  // Empty state
  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <Sparkles className="h-6 w-6 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No optimization opportunities detected</p>
      </div>
    )
  }

  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3')}>
      {insights.map(insight => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  )
}
