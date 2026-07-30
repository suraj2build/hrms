import type { PlatformSignal, SignalDigest } from '../types/signal-types.js'

const PERIOD_RE = /^last_(\d+)([hdm])$/

/** Parse a "last_Nh"/"last_Nd"/"last_Nm" period label into milliseconds, or null if unrecognized. */
function periodToMs(period: string): number | null {
  const m = PERIOD_RE.exec(period)
  if (!m) return null
  const n = Number(m[1])
  const unitMs = m[2] === 'h' ? 3_600_000 : m[2] === 'd' ? 86_400_000 : 60_000
  return n * unitMs
}

export class SignalDigestService {
  compute(orgId: string, signals: PlatformSignal[], period = 'last_1h'): SignalDigest {
    const windowMs = periodToMs(period)
    // The response labels itself with `period` — the aggregation must actually
    // be bounded to that window, or a caller sending signals spanning days
    // while claiming "last_1h" gets a digest that silently over-reports
    // relative to its own stated window. Unrecognized period labels fall back
    // to no time filtering (tenant-scoping still applies) since there's no
    // window to enforce.
    const cutoff = windowMs != null ? Date.now() - windowMs : null
    const orgSignals = signals.filter(s =>
      s.tenant_id === orgId && (cutoff == null || new Date(s.timestamp).getTime() >= cutoff),
    )

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
      tenant_id:        orgId,
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
