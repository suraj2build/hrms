import { useState, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  DollarSign,
  Shield,
  Zap,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDecisionEngine } from '@/lib/intelligence/useDecisionEngine'
import { DecisionInsightCard } from './DecisionInsightCard'
import { ImpactPreviewDialog } from './ImpactPreviewDialog'
import type {
  DecisionInsight,
  InsightCategory,
  InsightSeverity,
} from '@/lib/intelligence/types'
import {
  INSIGHT_SEVERITY_META,
  GRADE_META,
} from '@/lib/intelligence/types'

export interface RecommendationCenterProps {
  embedded?: boolean
}

const CATEGORY_TABS: Array<{ value: InsightCategory | 'all'; label: string }> = [
  { value: 'all',        label: 'All'        },
  { value: 'attendance', label: 'Attendance' },
  { value: 'roster',     label: 'Roster'     },
  { value: 'payroll',    label: 'Payroll'    },
  { value: 'compliance', label: 'Compliance' },
]

const SEVERITY_FILTERS: Array<{ value: InsightSeverity | 'all'; label: string }> = [
  { value: 'all',      label: 'All'      },
  { value: 'critical', label: 'Critical' },
  { value: 'high',     label: 'High'     },
  { value: 'medium',   label: 'Medium'   },
  { value: 'low',      label: 'Low'      },
]

function ScoreBar({ value, label }: { value: number; label: string }) {
  const color =
    value >= 80 ? 'bg-emerald-500' :
    value >= 60 ? 'bg-amber-500'   :
    value >= 40 ? 'bg-orange-500'  : 'bg-destructive'

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 animate-pulse">
      <div className="flex gap-2">
        <div className="h-4 w-14 rounded bg-muted" />
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-4 w-12 rounded bg-muted" />
      </div>
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
      <div className="h-3 w-2/3 rounded bg-muted" />
      <div className="h-7 w-24 rounded bg-muted mt-2" />
    </div>
  )
}

export function RecommendationCenter({ embedded = false }: RecommendationCenterProps) {
  const {
    insights,
    score,
    predictiveWarnings,
    optimizationInsights,
    bulkActions,
    isLoading,
    dismissInsight,
    actionInsight,
  } = useDecisionEngine()

  const [selectedInsight, setSelectedInsight] = useState<DecisionInsight | null>(null)
  const [previewInsight,  setPreviewInsight]   = useState<DecisionInsight | null>(null)
  const [categoryFilter,  setCategoryFilter]   = useState<InsightCategory | 'all'>('all')
  const [severityFilter,  setSeverityFilter]   = useState<InsightSeverity | 'all'>('all')
  const [expandedOptId,   setExpandedOptId]    = useState<string | null>(null)

  const filteredInsights = useMemo(
    () =>
      insights.filter(
        (i) =>
          (categoryFilter === 'all' || i.category === categoryFilter) &&
          (severityFilter === 'all' || i.severity === severityFilter),
      ),
    [insights, categoryFilter, severityFilter],
  )

  const criticalCount = insights.filter((i) => i.severity === 'critical').length
  const pendingCount  = insights.filter((i) => i.status === 'pending').length

  const gradeMeta  = GRADE_META[score.grade]
  const TrendIcon  =
    score.trend === 'up'   ? TrendingUp   :
    score.trend === 'down' ? TrendingDown : Minus

  const scoreMetrics = [
    { label: 'Attendance Health', value: score.attendanceHealth,       icon: Users       },
    { label: 'Payroll Readiness', value: score.payrollReadiness,       icon: DollarSign  },
    { label: 'Compliance',        value: score.complianceScore,        icon: Shield      },
    { label: 'Fatigue Risk',      value: 100 - score.fatigueRisk,      icon: Zap         },
    { label: 'Efficiency',        value: score.operationalEfficiency,  icon: Activity    },
  ]

  const pendingBulkCount = bulkActions.filter(
    (a) => a.requiresConfirmation,
  ).length

  function handleDismiss(id: string) {
    dismissInsight(id)
    if (selectedInsight?.id === id) setSelectedInsight(null)
  }

  function handleAction(insight: DecisionInsight) {
    setPreviewInsight(insight)
  }

  function handlePreview(insight: DecisionInsight) {
    setPreviewInsight(insight)
  }

  function handlePreviewSuccess(insight: DecisionInsight) {
    actionInsight(insight)
    setPreviewInsight(null)
  }

  const content = (
    <div className="space-y-4">

      {/* Predictive warnings strip */}
      {predictiveWarnings.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {predictiveWarnings.map((w) => (
            <button
              key={w.id}
              title={w.description}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border whitespace-nowrap flex-shrink-0',
                w.severity === 'critical'
                  ? 'bg-destructive/10 text-destructive border-destructive/30'
                  : w.severity === 'high'
                  ? 'bg-orange-500/10 text-orange-600 border-orange-500/30'
                  : 'bg-amber-500/10 text-amber-600 border-amber-500/30',
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {w.title}
              <span className="opacity-60">
                · {w.probability}% · {w.timeHorizon}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main body */}
      <div className="grid lg:grid-cols-[1fr_360px] gap-4 items-start">

        {/* Left: recommendations list */}
        <div className="space-y-3">

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Category tabs */}
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/40">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setCategoryFilter(tab.value)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                    categoryFilter === tab.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Severity filter */}
            <div className="flex items-center gap-1">
              {SEVERITY_FILTERS.map((sf) => {
                const meta = sf.value !== 'all' ? INSIGHT_SEVERITY_META[sf.value] : null
                return (
                  <button
                    key={sf.value}
                    onClick={() => setSeverityFilter(sf.value)}
                    className={cn(
                      'px-2 py-0.5 text-[11px] font-medium rounded-full border transition-colors',
                      severityFilter === sf.value
                        ? meta
                          ? cn(meta.color, meta.bg, meta.border)
                          : 'bg-foreground text-background border-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground',
                    )}
                  >
                    {sf.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Summary */}
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">{filteredInsights.length}</span>{' '}
            recommendations
            {criticalCount > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-destructive">{criticalCount} critical</span>
              </>
            )}
            {' · '}
            <span className="font-semibold">{pendingCount}</span> pending action
          </p>

          {/* Insights list */}
          <div className="space-y-2">
            {isLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : filteredInsights.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <CheckCircle2 className="h-10 w-10 text-success/60" />
                <p className="text-sm font-medium text-muted-foreground">
                  All clear — no recommendations
                </p>
              </div>
            ) : (
              filteredInsights.map((insight) => (
                <div
                  key={insight.id}
                  onClick={() =>
                    setSelectedInsight((prev) =>
                      prev?.id === insight.id ? null : insight,
                    )
                  }
                >
                  <DecisionInsightCard
                    insight={insight}
                    onDismiss={handleDismiss}
                    onAction={handleAction}
                    onPreview={handlePreview}
                    selected={selectedInsight?.id === insight.id}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-4 lg:sticky lg:top-0">

          {/* Score breakdown */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Operational Score
            </p>
            <div className="flex items-center gap-2 mb-2">
              <span
                className={cn(
                  'text-3xl font-black tabular-nums',
                  gradeMeta.color,
                )}
              >
                {score.grade}
              </span>
              <div className="flex-1 space-y-0.5">
                <p className="text-sm font-bold tabular-nums">{score.overallScore}</p>
                <div className={cn('flex items-center gap-1 text-[10px]', gradeMeta.color)}>
                  <TrendIcon className="h-3 w-3" />
                  <span className="capitalize">{score.trend ?? 'stable'}</span>
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              {scoreMetrics.map((m) => (
                <ScoreBar key={m.label} label={m.label} value={m.value} />
              ))}
            </div>
          </div>

          {/* Optimization insights accordion */}
          {optimizationInsights.length > 0 && (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/60">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Optimisation Insights
                </p>
              </div>
              <div className="divide-y divide-border/40">
                {optimizationInsights.slice(0, 5).map((opt) => {
                  const isExpanded = expandedOptId === opt.id
                  const trendColor =
                    opt.trend === 'worsening' ? 'text-destructive' :
                    opt.trend === 'improving' ? 'text-emerald-600' : 'text-muted-foreground'
                  const TrendChipIcon =
                    opt.trend === 'worsening' ? TrendingDown :
                    opt.trend === 'improving' ? TrendingUp   : Minus

                  return (
                    <div key={opt.id}>
                      <button
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                        onClick={() =>
                          setExpandedOptId((prev) => (prev === opt.id ? null : opt.id))
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{opt.title}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] font-semibold tabular-nums">
                              {opt.metric} {opt.unit}
                            </span>
                            <span className={cn('flex items-center gap-0.5 text-[10px] font-medium', trendColor)}>
                              <TrendChipIcon className="h-3 w-3" />
                              {opt.trendValue != null && `${opt.trendValue > 0 ? '+' : ''}${opt.trendValue}`}
                              <span className="capitalize">{opt.trend}</span>
                            </span>
                          </div>
                        </div>
                        {isExpanded
                          ? <ChevronUp className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-3">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            {opt.recommendation}
                          </p>
                          {opt.affectedEntities.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Affects: {opt.affectedEntities.map((e) => e.name).join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bulk action queue summary */}
          {pendingBulkCount > 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">{pendingBulkCount} bulk actions pending</p>
                <p className="text-[11px] text-muted-foreground">Awaiting confirmation</p>
              </div>
              <Badge
                variant="outline"
                className="text-warning bg-warning/10 border-warning/30 text-[11px] font-semibold"
              >
                {pendingBulkCount}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <>
        {content}
        <ImpactPreviewDialog
          insight={previewInsight}
          onClose={() => setPreviewInsight(null)}
          onConfirm={(ins) => actionInsight(ins)}
          onSuccess={handlePreviewSuccess}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4 max-w-screen-xl mx-auto">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Recommendation Center</h1>
            <p className="text-xs text-muted-foreground">AI-Powered Operational Intelligence</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Risk score chip */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-full px-3 py-1.5 border text-sm font-semibold',
                GRADE_META[score.grade].color,
                GRADE_META[score.grade].bg,
                'border-transparent',
              )}
            >
              <span className="text-base font-black">{score.grade}</span>
              <span className="tabular-nums">{score.overallScore}</span>
              <TrendIcon className="h-4 w-4" />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6">
        {content}
      </div>

      <ImpactPreviewDialog
        insight={previewInsight}
        onClose={() => setPreviewInsight(null)}
        onConfirm={(ins) => actionInsight(ins)}
        onSuccess={handlePreviewSuccess}
      />
    </div>
  )
}
