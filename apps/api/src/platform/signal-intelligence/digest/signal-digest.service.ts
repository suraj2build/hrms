import type { PlatformSignal, SignalDigest } from '../types/signal-types.js'

export class SignalDigestService {
  compute(orgId: string, signals: PlatformSignal[], period = 'last_1h'): SignalDigest {
    const orgSignals = signals.filter(s => s.org_id === orgId)

    const by_severity: Record<string, number> = {}
    const by_source:   Record<string, number> = {}
    const entityCount: Map<string, { entity_type: string; count: number }> = new Map()

    let suppressed = 0
    let clustered  = 0

    for (const s of orgSignals) {
      // Severity counts
      by_severity[s.severity] = (by_severity[s.severity] ?? 0) + 1

      // Source counts
      by_source[s.source] = (by_source[s.source] ?? 0) + 1

      // Entity counts
      const existing = entityCount.get(s.entity_id)
      if (existing) {
        existing.count++
      } else {
        entityCount.set(s.entity_id, { entity_type: s.entity_type, count: 1 })
      }

      if (s.suppressed) suppressed++
      if (s.cluster_id) clustered++
    }

    // Top 5 entities by signal count
    const top_entities = [...entityCount.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([entity_id, { entity_type, count }]) => ({ entity_id, entity_type, signal_count: count }))

    return {
      org_id:        orgId,
      period,
      total_signals: orgSignals.length,
      by_severity,
      by_source,
      top_entities,
      suppressed,
      clustered,
      computed_at:   new Date().toISOString(),
    }
  }
}

export const signalDigestService = new SignalDigestService()
