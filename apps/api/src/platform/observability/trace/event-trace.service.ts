/**
 * EventTraceService — structured event lineage and operational summaries.
 *
 * Transforms raw platform_events arrays into human-readable traces.
 * Pure computation — receives pre-fetched events, never queries DB directly.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'

export interface EventTraceNode {
  event_id:    string
  event_type:  string
  module:      string
  entity_id:   string
  timestamp:   string
  severity:    string
  description: string        // human-readable: "Compensation revision approved for employee EMP-123"
  children:    EventTraceNode[]
}

export interface EventTrace {
  correlation_id: string
  root?:          EventTraceNode
  flat:           EventTraceNode[]   // all nodes in chronological order
  depth:          number
  severity_peak:  string
  duration_ms?:   number             // root.timestamp → last event timestamp
  summary:        string             // one-line: "5-event chain: employee.created → compensation.revision.approved (critical peak)"
}

export interface EventSummary {
  org_id:               string
  period:               string
  total:                number
  by_module:            Record<string, number>
  by_severity:          Record<string, number>
  by_event_type:        Record<string, number>
  most_active_entities: Array<{ entity_id: string; entity_type: string; count: number }>
  severity_peak:        string
  computed_at:          string
}

export interface EventHeatmapCell {
  hour:       number        // 0–23 (UTC hour)
  event_type: string
  count:      number
  severity:   string        // most common severity in this cell
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high:     3,
  warning:  2,
  info:     1,
}

function peakSeverity(events: ResolvedPlatformEvent[]): string {
  let peak = 'info'
  for (const e of events) {
    const sev = e.severity ?? 'info'
    if ((SEVERITY_ORDER[sev] ?? 0) > (SEVERITY_ORDER[peak] ?? 0)) {
      peak = sev
    }
  }
  return peak
}

function describeEvent(e: ResolvedPlatformEvent): string {
  const entity = `${e.entity_type} ${e.entity_id}`
  const descriptions: Record<string, string> = {
    'employee.created':               `New employee record created: ${entity}`,
    'employee.updated':               `Employee record updated: ${entity}`,
    'compensation.revision.approved': `Compensation revision approved for ${entity}`,
    'payroll.run.finalized':          `Payroll run finalized: ${entity}`,
    'attendance.override.approved':   `Attendance override approved for ${entity}`,
    'duplicate.detected':             `Duplicate detected on ${entity}`,
    'trust.score.updated':            `Trust score updated for ${entity}`,
  }
  return descriptions[e.event_type] ?? `${e.event_type} on ${entity}`
}

function toNode(e: ResolvedPlatformEvent): EventTraceNode {
  return {
    event_id:    e.event_id,
    event_type:  e.event_type,
    module:      e.module,
    entity_id:   e.entity_id,
    timestamp:   e.timestamp,
    severity:    e.severity ?? 'info',
    description: describeEvent(e),
    children:    [],
  }
}

function treeDepth(node: EventTraceNode): number {
  if (node.children.length === 0) return 1
  return 1 + Math.max(...node.children.map(treeDepth))
}

class EventTraceService {
  /**
   * Build a tree-structured trace from a correlation chain of events.
   * Parent-child linkage is derived from parent_event_id.
   */
  buildTrace(correlationId: string, events: ResolvedPlatformEvent[]): EventTrace {
    if (events.length === 0) {
      return {
        correlation_id: correlationId,
        flat:           [],
        depth:          0,
        severity_peak:  'info',
        summary:        '0-event chain',
      }
    }

    // Build node map
    const nodeMap = new Map<string, EventTraceNode>()
    for (const e of events) {
      nodeMap.set(e.event_id, toNode(e))
    }

    // Wire parent→child relationships
    let rootNode: EventTraceNode | undefined
    for (const e of events) {
      const node = nodeMap.get(e.event_id)!
      if (e.parent_event_id) {
        const parent = nodeMap.get(e.parent_event_id)
        if (parent) {
          parent.children.push(node)
        }
      } else {
        rootNode = node
      }
    }

    // If no explicit root found (orphaned chain), pick oldest event
    if (!rootNode) {
      const oldest = [...events].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )[0]
      rootNode = nodeMap.get(oldest.event_id)
    }

    // Flat list in chronological order
    const flat = [...events]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(e => nodeMap.get(e.event_id)!)

    const depth        = rootNode ? treeDepth(rootNode) : 0
    const severity_peak = peakSeverity(events)

    // duration_ms: root → last event
    let duration_ms: number | undefined
    if (events.length >= 2) {
      const times = events.map(e => new Date(e.timestamp).getTime())
      duration_ms = Math.max(...times) - Math.min(...times)
    }

    const firstType = flat[0]?.event_type ?? ''
    const lastType  = flat[flat.length - 1]?.event_type ?? ''
    const summary   = `${events.length}-event chain: ${firstType} → ${lastType} (${severity_peak} peak)`

    return {
      correlation_id: correlationId,
      root:           rootNode,
      flat,
      depth,
      severity_peak,
      duration_ms,
      summary,
    }
  }

  /**
   * Aggregate platform events into an operational summary.
   */
  summarize(orgId: string, events: ResolvedPlatformEvent[], period = 'last_24h'): EventSummary {
    const by_module:    Record<string, number> = {}
    const by_severity:  Record<string, number> = {}
    const by_event_type: Record<string, number> = {}
    const entityCounts: Map<string, { entity_type: string; count: number }> = new Map()

    for (const e of events) {
      by_module[e.module]         = (by_module[e.module] ?? 0) + 1
      const sev = e.severity ?? 'info'
      by_severity[sev]            = (by_severity[sev] ?? 0) + 1
      by_event_type[e.event_type] = (by_event_type[e.event_type] ?? 0) + 1

      const key     = e.entity_id
      const existing = entityCounts.get(key)
      if (existing) {
        existing.count++
      } else {
        entityCounts.set(key, { entity_type: e.entity_type, count: 1 })
      }
    }

    const most_active_entities = [...entityCounts.entries()]
      .map(([entity_id, v]) => ({ entity_id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    return {
      org_id:               orgId,
      period,
      total:                events.length,
      by_module,
      by_severity,
      by_event_type,
      most_active_entities,
      severity_peak:        peakSeverity(events),
      computed_at:          new Date().toISOString(),
    }
  }

  /**
   * Build a heatmap of events grouped by UTC hour + event_type.
   */
  buildHeatmap(events: ResolvedPlatformEvent[]): EventHeatmapCell[] {
    // Map key: "hour:event_type"
    const cellMap = new Map<string, { count: number; severityCounts: Record<string, number> }>()

    for (const e of events) {
      const hour      = new Date(e.timestamp).getUTCHours()
      const key       = `${hour}:${e.event_type}`
      const sev       = e.severity ?? 'info'
      const existing  = cellMap.get(key)
      if (existing) {
        existing.count++
        existing.severityCounts[sev] = (existing.severityCounts[sev] ?? 0) + 1
      } else {
        cellMap.set(key, { count: 1, severityCounts: { [sev]: 1 } })
      }
    }

    const cells: EventHeatmapCell[] = []
    for (const [key, data] of cellMap.entries()) {
      const [hourStr, ...typeParts] = key.split(':')
      const event_type = typeParts.join(':')
      // Most common severity in this cell
      const severity = Object.entries(data.severityCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'info'

      cells.push({
        hour:       parseInt(hourStr, 10),
        event_type,
        count:      data.count,
        severity,
      })
    }

    return cells.sort((a, b) => a.hour - b.hour || a.event_type.localeCompare(b.event_type))
  }
}

export const eventTraceService = new EventTraceService()
