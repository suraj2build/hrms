/**
 * useDecisionEngine.ts — React hook wiring the Decision Intelligence Engine (Phase UX-5)
 *
 * Composes the pure engine functions (recommendation, scoring, predictive) with
 * the live activity stream and exposes a single DecisionEngineState to consumers.
 */

import { useMemo, useState, useCallback } from 'react'
import { useActivityStream } from '@/lib/activity/useActivityStream'
import { generateInsights } from './recommendationEngine'
import { computeScore } from './scoringEngine'
import { generatePredictiveWarnings } from './predictiveEngine'
import type {
  DecisionEngineState,
  DecisionInsight,
  OptimizationInsight,
  OptimizationInsightType,
  BulkActionItem,
} from './types'
import type { OperationalActivityEvent } from '@/lib/activity/types'

// ── Local helpers ─────────────────────────────────────────────────────────────

function makeOptId(type: OptimizationInsightType): string {
  return `opt_${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function uniqueEntitiesFromEvents(
  events: OperationalActivityEvent[],
): Array<{ id: string; name: string; type: 'employee' | 'site' | 'shift' }> {
  const map = new Map<string, { id: string; name: string; type: 'employee' }>()
  for (const e of events) {
    if (e.employeeId && !map.has(e.employeeId)) {
      map.set(e.employeeId, { id: e.employeeId, name: e.employeeName ?? 'Unknown', type: 'employee' })
    }
  }
  return [...map.values()]
}

// ── Optimization insight generator (local, not exported) ─────────────────────

function generateOptimizationInsights(events: OperationalActivityEvent[]): OptimizationInsight[] {
  const insights: OptimizationInsight[] = []

  // 1. chronic_absenteeism — if > 3 employees have > 2 missing_punch events each
  const missingPunchByEmployee = new Map<string, OperationalActivityEvent[]>()
  for (const e of events) {
    if (e.type === 'missing_punch' && e.employeeId) {
      const existing = missingPunchByEmployee.get(e.employeeId) ?? []
      existing.push(e)
      missingPunchByEmployee.set(e.employeeId, existing)
    }
  }
  const chronicAbsentees = [...missingPunchByEmployee.entries()].filter(([, evts]) => evts.length > 2)
  if (chronicAbsentees.length > 3) {
    const affectedEntities = chronicAbsentees.map(([id, evts]) => ({
      id,
      name: evts[0]?.employeeName ?? 'Unknown',
      type: 'employee' as const,
    }))
    insights.push({
      id:               makeOptId('chronic_absenteeism'),
      type:             'chronic_absenteeism',
      title:            'Chronic Absenteeism Pattern Detected',
      metric:           chronicAbsentees.length,
      unit:             'employees',
      trend:            'worsening',
      trendValue:       chronicAbsentees.length,
      recommendation:   'Conduct attendance counselling for repeat-offender employees and review scheduling flexibility.',
      affectedEntities,
    })
  }

  // 2. ot_hotspot — if ot_spike count > 3
  const otSpikeEvents = events.filter(e => e.type === 'ot_spike')
  if (otSpikeEvents.length > 3) {
    insights.push({
      id:               makeOptId('ot_hotspot'),
      type:             'ot_hotspot',
      title:            'Overtime Hotspot Identified',
      metric:           otSpikeEvents.length,
      unit:             'incidents',
      trend:            'worsening',
      trendValue:       otSpikeEvents.length,
      recommendation:   'Redistribute workload or hire additional staff in high-OT departments to reduce overtime exposure.',
      affectedEntities: uniqueEntitiesFromEvents(otSpikeEvents),
    })
  }

  // 3. shift_imbalance — if shift_unassigned count > 0
  const shiftUnassignedEvents = events.filter(e => e.type === 'shift_unassigned')
  if (shiftUnassignedEvents.length > 0) {
    insights.push({
      id:               makeOptId('shift_imbalance'),
      type:             'shift_imbalance',
      title:            'Shift Coverage Imbalance',
      metric:           shiftUnassignedEvents.length,
      unit:             'incidents',
      trend:            shiftUnassignedEvents.length > 5 ? 'worsening' : 'stable',
      trendValue:       shiftUnassignedEvents.length,
      recommendation:   'Review shift templates and ensure adequate bench strength to cover gaps.',
      affectedEntities: uniqueEntitiesFromEvents(shiftUnassignedEvents),
    })
  }

  // 4. payroll_anomaly_trend — if payroll_blocker trend is increasing (last 24h vs 24-48h)
  const now = Date.now()
  const blockers24h = events.filter(e => {
    const ms = now - new Date(e.timestamp).getTime()
    return e.type === 'payroll_blocker' && ms >= 0 && ms < 24 * 3_600_000
  })
  const blockers48h = events.filter(e => {
    const ms = now - new Date(e.timestamp).getTime()
    return e.type === 'payroll_blocker' && ms >= 24 * 3_600_000 && ms < 48 * 3_600_000
  })
  if (blockers24h.length > blockers48h.length && blockers24h.length > 0) {
    insights.push({
      id:               makeOptId('payroll_anomaly_trend'),
      type:             'payroll_anomaly_trend',
      title:            'Payroll Blocker Count Trending Up',
      metric:           blockers24h.length,
      unit:             'incidents',
      trend:            'worsening',
      trendValue:       blockers24h.length - blockers48h.length,
      recommendation:   'Investigate the root cause of increasing payroll blockers and address upstream data quality issues.',
      affectedEntities: uniqueEntitiesFromEvents(blockers24h),
    })
  }

  // 5. fatigue_cluster — if fatigue_risk count > 2
  const fatigueEvents = events.filter(e => e.type === 'fatigue_risk' && e.status === 'open')
  if (fatigueEvents.length > 2) {
    insights.push({
      id:               makeOptId('fatigue_cluster'),
      type:             'fatigue_cluster',
      title:            'Fatigue Risk Cluster Forming',
      metric:           fatigueEvents.length,
      unit:             'employees',
      trend:            'worsening',
      trendValue:       fatigueEvents.length,
      recommendation:   'Introduce mandatory rest days and cap consecutive working days for affected employees.',
      affectedEntities: uniqueEntitiesFromEvents(fatigueEvents),
    })
  }

  return insights.slice(0, 5)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDecisionEngine(): DecisionEngineState {
  const { allEvents, isLoading } = useActivityStream()

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [actionedIds,  setActionedIds]  = useState<Set<string>>(new Set())

  // ── Pure engine computations ───────────────────────────────────────────────
  const rawInsights = useMemo(() => generateInsights(allEvents), [allEvents])
  const score       = useMemo(() => computeScore(allEvents),     [allEvents])
  const predictiveWarnings   = useMemo(() => generatePredictiveWarnings(allEvents), [allEvents])
  const optimizationInsights = useMemo(() => generateOptimizationInsights(allEvents), [allEvents])

  // ── Filtered insights (removes dismissed and actioned) ─────────────────────
  const insights = useMemo(
    () => rawInsights.filter(i => !dismissedIds.has(i.id) && !actionedIds.has(i.id)),
    [rawInsights, dismissedIds, actionedIds],
  )

  // ── Derived bulk actions from visible insights ─────────────────────────────
  const bulkActions = useMemo<BulkActionItem[]>(
    () =>
      insights.map(i => ({
        id:                   i.id,
        type:                 i.actionType,
        label:                i.actionLabel,
        description:          i.explanation,
        targetEntityIds:      i.affectedEntities.map(e => e.id),
        targetEventIds:       i.sourceEventIds,
        estimatedImpact:      i.impactEstimate,
        requiresConfirmation: i.impactEstimate.affectedCount > 10,
        isReversible:         i.impactEstimate.rollbackPossible,
        endpoint:             i.actionEndpoint,
        body:                 i.actionBody,
      })),
    [insights],
  )

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const dismissInsight = useCallback((id: string) => {
    setDismissedIds(prev => new Set([...prev, id]))
  }, [])

  const actionInsight = useCallback((insight: DecisionInsight) => {
    setActionedIds(prev => new Set([...prev, insight.id]))
  }, [])

  return {
    insights,
    score,
    predictiveWarnings,
    optimizationInsights,
    bulkActions,
    isLoading,
    dismissInsight,
    actionInsight,
  }
}
