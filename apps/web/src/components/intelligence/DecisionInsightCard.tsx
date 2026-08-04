import { useState } from 'react'
import { X, ChevronDown, ChevronUp, Eye, Users, AlertTriangle, RotateCcw } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { DecisionInsight } from '@/lib/intelligence/types'
import { INSIGHT_SEVERITY_META, CONFIDENCE_META } from '@/lib/intelligence/types'

export interface DecisionInsightCardProps {
  insight:   DecisionInsight
  onDismiss: (id: string) => void
  onAction:  (insight: DecisionInsight) => void
  onPreview: (insight: DecisionInsight) => void
  selected?: boolean
  compact?:  boolean
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const SEVERITY_HEX: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#3b82f6',
}

export function DecisionInsightCard({
  insight,
  onDismiss,
  onAction,
  onPreview,
  selected = false,
  compact  = false,
}: DecisionInsightCardProps) {
  const [showWhy, setShowWhy] = useState(false)

  const severityMeta    = INSIGHT_SEVERITY_META[insight.severity]
  const confidenceMeta  = CONFIDENCE_META[insight.confidenceLevel]
  const barColor        = SEVERITY_HEX[insight.severity] ?? '#3b82f6'

  const visibleEntities = compact
    ? insight.affectedEntities.slice(0, 2)
    : insight.affectedEntities.slice(0, 3)
  const extraCount = insight.affectedEntities.length - visibleEntities.length

  const visibleFactors = compact
    ? insight.factors.slice(0, 2)
    : insight.factors

  const { impactEstimate } = insight

  return (
    <div
      className={cn(
        'relative flex rounded-lg border bg-card shadow-sm overflow-hidden transition-all',
        selected ? 'border-primary' : 'border-border',
      )}
    >
      {/* Severity colour bar */}
      <div className="w-[3px] flex-shrink-0" style={{ backgroundColor: barColor }} />

      {/* Card body */}
      <div className="flex-1 p-3 space-y-2 min-w-0">

        {/* Row 1: badges + dismiss */}
        <div className="flex items-center gap-1.5 flex-wrap pr-6">
          <Badge
            className={cn(
              'text-[10px] font-semibold px-1.5 py-0 border',
              severityMeta.color,
              severityMeta.bg,
              severityMeta.border,
            )}
            variant="outline"
          >
            {severityMeta.label}
          </Badge>
          <Badge
            className="text-[10px] font-medium px-1.5 py-0 bg-muted/60 text-muted-foreground border-border/50 capitalize"
            variant="outline"
          >
            {insight.category}
          </Badge>
          {/* Confidence chip */}
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
              confidenceMeta.color,
              confidenceMeta.bg,
              'border-transparent',
            )}
          >
            {insight.confidence}% conf.
          </span>
        </div>

        {/* Dismiss button */}
        <button
          aria-label="Dismiss insight"
          onClick={() => onDismiss(insight.id)}
          className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Title */}
        <p className="text-sm font-semibold leading-snug">{insight.title}</p>

        {/* Explanation */}
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {insight.explanation}
        </p>

        {/* Recommended action */}
        <p className="text-xs italic text-muted-foreground/80 leading-snug">
          {insight.recommendedAction}
        </p>

        {/* Confidence meter */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                confidenceMeta.bg.replace('/10', '/60'),
              )}
              style={{ width: `${insight.confidence}%` }}
            />
          </div>
          <span className={cn('text-[10px] font-semibold tabular-nums', confidenceMeta.color)}>
            {insight.confidence}%
          </span>
        </div>

        {/* Impact strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {impactEstimate.affectedCount} affected
          </span>
          {impactEstimate.payrollImpact !== undefined && (
            <span className="flex items-center gap-1">
              <span className="opacity-60">₹</span>
              {formatCurrency(impactEstimate.payrollImpact)} payroll
            </span>
          )}
          {impactEstimate.complianceRisk && (
            <span className={cn(
              'flex items-center gap-1',
              impactEstimate.complianceRisk === 'high'   ? 'text-destructive' :
              impactEstimate.complianceRisk === 'medium' ? 'text-warning'   : 'text-info',
            )}>
              <AlertTriangle className="h-3 w-3" />
              {impactEstimate.complianceRisk} compliance risk
            </span>
          )}
          {impactEstimate.rollbackPossible && (
            <span className="flex items-center gap-1 text-success">
              <RotateCcw className="h-3 w-3" />
              {impactEstimate.rollbackWindowHours != null
                ? `Undo ${impactEstimate.rollbackWindowHours}h`
                : 'Reversible'}
            </span>
          )}
        </div>

        {/* Affected entities chips */}
        {insight.affectedEntities.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {visibleEntities.map((entity) => (
              <span
                key={entity.id}
                title={entity.name}
                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-[9px] font-bold text-primary flex-shrink-0"
              >
                {initials(entity.name)}
              </span>
            ))}
            {extraCount > 0 && (
              <span className="text-[10px] text-muted-foreground font-medium">
                +{extraCount} more
              </span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={() => onPreview(insight)}
          >
            <Eye className="h-3 w-3" />
            Preview Impact
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-3 ml-auto"
            onClick={() => onAction(insight)}
          >
            {insight.actionLabel}
          </Button>
        </div>

        {/* "See why" expandable — hidden in compact mode */}
        {!compact && (
          <div>
            <button
              onClick={() => setShowWhy((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showWhy ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              See why
            </button>

            {showWhy && (
              <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Confidence factors
                </p>
                {visibleFactors.map((f) => (
                  <div key={f.label} className="flex items-center gap-2">
                    <div className="h-1.5 rounded-full bg-primary/20 flex-1">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${f.contribution}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-24 truncate">
                      {f.label}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {insight.explainability.confidenceLogic}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {insight.explainability.impactCalculation}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
