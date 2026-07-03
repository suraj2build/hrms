import { createHash } from 'crypto'
import type { PlatformSignal, SignalCluster } from '../types/signal-types.js'

function maxSeverity(severities: Array<PlatformSignal['severity']>): PlatformSignal['severity'] {
  const order: PlatformSignal['severity'][] = ['info', 'warning', 'high', 'critical']
  let max: PlatformSignal['severity'] = 'info'
  for (const s of severities) {
    if (order.indexOf(s) > order.indexOf(max)) max = s
  }
  return max
}

export class SignalClusterer {
  cluster(signals: PlatformSignal[]): SignalCluster[] {
    // Map from cluster_id → signals
    const clusters: Map<string, PlatformSignal[]> = new Map()

    const WINDOW_MS = 5 * 60 * 1000

    for (const signal of signals) {
      // Primary key: same org + entity + source
      const primaryId = createHash('sha256')
        .update(`${signal.tenant_id}:${signal.entity_id}:${signal.source}`)
        .digest('hex')
        .slice(0, 16)

      // Secondary key: same org + event_type + time window bucket (5-min)
      const windowBucket = Math.floor(new Date(signal.timestamp).getTime() / WINDOW_MS)
      const secondaryId  = createHash('sha256')
        .update(`${signal.tenant_id}:${signal.event_type}:${windowBucket}`)
        .digest('hex')
        .slice(0, 16)

      // Prefer primary cluster if it already exists, otherwise use secondary
      let clusterId: string
      if (clusters.has(primaryId)) {
        clusterId = primaryId
      } else if (clusters.has(secondaryId)) {
        clusterId = secondaryId
      } else {
        // Check if any existing cluster matches the primary key logic
        clusterId = primaryId
      }

      if (!clusters.has(clusterId)) {
        clusters.set(clusterId, [])
      }
      clusters.get(clusterId)!.push({ ...signal, cluster_id: clusterId })
    }

    const result: SignalCluster[] = []
    for (const [cluster_id, clusterSignals] of clusters.entries()) {
      const first = clusterSignals[0]
      result.push({
        cluster_id,
        tenant_id:      first.tenant_id,
        label:       `${first.source}/${first.entity_type} cluster`,
        signals:     clusterSignals,
        severity:    maxSeverity(clusterSignals.map(s => s.severity)),
        entity_ids:  [...new Set(clusterSignals.map(s => s.entity_id))],
        event_types: [...new Set(clusterSignals.map(s => s.event_type))],
        created_at:  new Date().toISOString(),
      })
    }

    return result
  }
}

export const signalClusterer = new SignalClusterer()
