import type { FastifyInstance } from 'fastify'
import {
  signalSuppressor,
  signalPrioritizer,
  signalClusterer,
  signalDigestService,
  operationalClarityService,
} from '../../platform/signal-intelligence/index.js'
import type { PlatformSignal } from '../../platform/signal-intelligence/index.js'

export default async function signalIntelligenceRoutes(fastify: FastifyInstance) {
  /**
   * POST /signals/process
   * Run suppression → prioritization → clustering on a batch of signals.
   */
  fastify.post('/signals/process', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).tenantId as string
    const body   = req.body as { signals?: PlatformSignal[] }
    const rawInput = Array.isArray(body?.signals) ? body.signals : []
    // Never trust a client-supplied tenant_id — always assert the caller's own tenant
    // so a request cannot reference or poison another tenant's suppression state.
    const input = rawInput.map(signal => ({ ...signal, tenant_id: tenantId }))

    let suppressed_count = 0
    const processed: PlatformSignal[] = []

    for (const signal of input) {
      const check = signalSuppressor.shouldSuppress(signal)
      if (check.suppress) {
        suppressed_count++
        // Still record so the window is refreshed
        continue
      }
      signalSuppressor.record(signal)
      processed.push(signal)
    }

    // Prioritize and sort
    const prioritized = signalPrioritizer.prioritizeBatch(processed)

    // Cluster — get clusters and assign cluster_ids back to signals
    const clusters = signalClusterer.cluster(prioritized)
    // Build a map signal_id → cluster_id
    const clusterMap = new Map<string, string>()
    for (const cluster of clusters) {
      for (const s of cluster.signals) {
        clusterMap.set(s.signal_id, cluster.cluster_id)
      }
    }
    const tagged = prioritized.map(s => ({
      ...s,
      cluster_id: clusterMap.get(s.signal_id) ?? s.cluster_id,
    }))

    return reply.send({
      processed:       tagged,
      suppressed_count,
      clusters,
      total:           input.length,
    })
  })

  /**
   * POST /signals/digest
   * Compute a digest summary for an org's signals.
   */
  fastify.post('/signals/digest', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const orgId  = (req as any).tenantId as string
    const body   = req.body as { signals?: PlatformSignal[]; period?: string }
    const input  = Array.isArray(body?.signals) ? body.signals : []
    const period = body?.period ?? 'last_1h'

    const digest = signalDigestService.compute(orgId, input, period)
    return reply.send(digest)
  })

  /**
   * POST /signals/prioritize
   * Sort a batch of signals by computed priority descending.
   */
  fastify.post('/signals/prioritize', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body  = req.body as { signals?: PlatformSignal[] }
    const input = Array.isArray(body?.signals) ? body.signals : []

    const sorted = signalPrioritizer.prioritizeBatch(input)
    return reply.send({ signals: sorted })
  })

  /**
   * GET /signals/explain/:eventType
   * Returns a human-readable narrative for a given event type.
   */
  fastify.get('/signals/explain/:eventType', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { eventType } = req.params as { eventType: string }

    const EVENT_DESCRIPTIONS: Record<string, string> = {
      'employee.created':               'A new employee record was created in the system.',
      'employee.updated':               'An employee record was updated.',
      'compensation.revision.approved': 'A compensation revision was reviewed and approved.',
      'compensation.revision.rejected': 'A compensation revision was reviewed and rejected.',
      'payroll.run.finalized':          'A payroll run was completed and finalized.',
      'attendance.override.approved':   'An attendance correction or override was approved.',
      'leave.applied':                  'An employee submitted a leave application.',
      'leave.approved':                 'A leave application was reviewed and approved.',
      'duplicate.detected':             'A duplicate record fingerprint was detected across employee data.',
      'trust.score.updated':            'An employee trust score was recomputed based on recent events.',
    }

    const description = EVENT_DESCRIPTIONS[eventType]
      ?? `Event type '${eventType}' — no description available.`

    const dummySignal: PlatformSignal = {
      signal_id:   'explain-dummy',
      tenant_id:      'explain',
      source:      'governance',
      entity_id:   'entity',
      entity_type: 'system',
      event_type:  eventType,
      severity:    'info',
      title:       eventType,
      description,
      timestamp:   new Date().toISOString(),
    }

    const narrative = operationalClarityService.buildNarrative(dummySignal)

    return reply.send({ event_type: eventType, narrative, description })
  })
}
