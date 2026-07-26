/**
 * Fabric Intelligence Routes — Sprint 5 Enterprise Orchestration Fabric.
 * Exposes composition, federation, simulation, decision graph,
 * orchestration, replay, and knowledge layer endpoints.
 */
import type { FastifyInstance }            from 'fastify'
import { z }                               from 'zod'
import { intelligenceCompositionService }  from '../../platform/fabric/composition/intelligence-composition.service.js'
import { federationService }               from '../../platform/fabric/federation/federation.service.js'
import { unifiedSimulationService }        from '../../platform/fabric/simulation-engine/unified-simulation.service.js'
import { decisionGraphService }            from '../../platform/fabric/decision-graph/decision-graph.service.js'
import { workflowOrchestrationService }    from '../../platform/fabric/orchestration/workflow-orchestration.service.js'
import { replayIntelligenceService }       from '../../platform/fabric/replay/replay-intelligence.service.js'
import { knowledgeLayerService }           from '../../platform/fabric/knowledge/knowledge-layer.service.js'
import { fabricControlPlaneService }       from '../../platform/fabric/control-plane/fabric-control-plane.service.js'
import { requireRole, HR_ADMIN_ROLES }     from '../../lib/rbac.js'
import { serverError, ErrorCode }          from '../../lib/api-errors.js'

export default async function fabricRoutes(fastify: FastifyInstance) {
  // Every route here surfaces governance/decision/orchestration data — trust
  // composition, decision lineage, escalation, replay sessions — for an
  // arbitrary entity_id with no ownership check. The frontend only exposes
  // this under the admin-only /admin/fabric shell (AdminShellV2), so the API
  // must enforce the same restriction rather than relying on the UI gate.
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /fabric/health — fabric control plane health snapshot
  fastify.get('/fabric/health', adminAuth, async (req, reply) => {
    const orgId = (req as any).tenantId
    try {
      const snapshot = await fabricControlPlaneService.computeFabricHealth(fastify.supabase, orgId)
      return snapshot
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute fabric health')
    }
  })

  // POST /fabric/compose — compute intelligence composition for an entity
  fastify.post('/fabric/compose', adminAuth, async (req, _reply) => {
    const body = req.body as any
    const orgId = (req as any).tenantId
    const composition = intelligenceCompositionService.compose({
      entity_id:        body.entity_id,
      entity_type:      body.entity_type ?? 'employee',
      tenant_id:           orgId,
      governance_score: body.governance_score,
      trust_score:      body.trust_score,
    })
    return composition
  })

  // POST /fabric/compose/batch — batch composition
  fastify.post('/fabric/compose/batch', adminAuth, async (req, _reply) => {
    const body = req.body as any
    const orgId = (req as any).tenantId
    const compositions = intelligenceCompositionService.composeBatch(orgId, body.entities ?? [])
    return { compositions, total: compositions.length }
  })

  // GET /fabric/federation/dependencies — module dependency map
  fastify.get('/fabric/federation/dependencies', adminAuth, async (_req, _reply) => {
    const deps = federationService.getModuleDependencies()
    return { dependencies: deps, total: deps.length }
  })

  // GET /fabric/federation/chain/:entityId — federation chain for entity
  fastify.get('/fabric/federation/chain/:entityId', adminAuth, async (req, _reply) => {
    const { entityId } = req.params as any
    const orgId = (req as any).tenantId
    const chain = federationService.buildFederationChain(fastify.supabase, entityId, 'employee', orgId)
    return chain
  })

  // POST /fabric/simulate/policy — policy change simulation
  fastify.post('/fabric/simulate/policy', adminAuth, async (req, _reply) => {
    const body = req.body as any
    const orgId = (req as any).tenantId
    const run = unifiedSimulationService.simulatePolicyChange({
      tenant_id:           orgId,
      policy_name:      body.policy_name ?? 'unnamed',
      change_type:      body.change_type ?? 'new',
      affected_modules: body.affected_modules ?? [],
      affected_count:   Number(body.affected_count) || 0,
      estimated_admin_hours: Number(body.estimated_admin_hours) || 0,
      created_by:       (req as any).userId,
    })
    fastify.supabase.from('simulation_runs').insert({
      tenant_id: run.tenant_id, simulation_type: run.simulation_type, label: run.label,
      input_params: run.input_params, result_summary: run.result_summary,
      created_at: run.created_at, created_by: run.created_by ?? null,
    }).then(undefined, () => {})
    return run
  })

  // POST /fabric/simulate/governance-drift — governance drift projection
  fastify.post('/fabric/simulate/governance-drift', adminAuth, async (req, _reply) => {
    const body = req.body as any
    const orgId = (req as any).tenantId
    const run = unifiedSimulationService.simulateGovernanceDrift({
      tenant_id:             orgId,
      current_drift_rate: Number(body.current_drift_rate) || 20,
      trend_direction:    body.trend_direction ?? 'stable',
      weeks_ahead:        Number(body.weeks_ahead) || 12,
      created_by:         (req as any).userId,
    })
    fastify.supabase.from('simulation_runs').insert({
      tenant_id: run.tenant_id, simulation_type: run.simulation_type, label: run.label,
      input_params: run.input_params, result_summary: run.result_summary,
      created_at: run.created_at, created_by: run.created_by ?? null,
    }).then(undefined, () => {})
    return run
  })

  // GET /fabric/decisions — recent decision graph nodes
  fastify.get('/fabric/decisions', adminAuth, async (req, _reply) => {
    const orgId = (req as any).tenantId
    const { limit = '50' } = req.query as any
    const nodes = await decisionGraphService.getRecentNodes(fastify.supabase, orgId, Number(limit))
    return { nodes, total: nodes.length }
  })

  // GET /fabric/decisions/lineage/:entityId — entity decision lineage
  fastify.get('/fabric/decisions/lineage/:entityId', adminAuth, async (req, _reply) => {
    const { entityId } = req.params as any
    const orgId = (req as any).tenantId
    const nodes = await decisionGraphService.getEntityLineage(fastify.supabase, entityId, orgId)
    return { nodes, entity_id: entityId, total: nodes.length }
  })

  // GET /fabric/orchestration — recent orchestration activities
  fastify.get('/fabric/orchestration', adminAuth, async (req, _reply) => {
    const orgId = (req as any).tenantId
    const { limit = '20' } = req.query as any
    const activities = await workflowOrchestrationService.getRecentActivities(fastify.supabase, orgId, Number(limit))
    return { activities, total: activities.length }
  })

  const EscalateSchema = z.object({
    entity_id:   z.string().uuid(),
    entity_type: z.string().optional(),
    reason:      z.string().optional(),
    escalate_to: z.string().uuid().optional(),
  })

  const ReplaySchema = z.object({
    entity_id:   z.string().uuid(),
    entity_type: z.string().optional(),
    from:        z.string(),
    to:          z.string(),
  })

  // POST /fabric/orchestration/escalate — coordinate an escalation (advisory)
  fastify.post('/fabric/orchestration/escalate', adminAuth, async (req, reply) => {
    const parsed = EscalateSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const orgId = (req as any).tenantId
    const activityId = await workflowOrchestrationService.coordinateEscalation(fastify.supabase, {
      tenant_id:      orgId,
      entity_id:   parsed.data.entity_id,
      entity_type: parsed.data.entity_type ?? 'employee',
      reason:      parsed.data.reason ?? '',
      escalate_to: parsed.data.escalate_to,
    })
    return reply.status(201).send({ activity_id: activityId })
  })

  // POST /fabric/replay — start a replay session
  fastify.post('/fabric/replay', adminAuth, async (req, reply) => {
    const parsed = ReplaySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const orgId = (req as any).tenantId
    const session = await replayIntelligenceService.replay(fastify.supabase, {
      tenant_id:      orgId,
      entity_id:   parsed.data.entity_id,
      entity_type: parsed.data.entity_type ?? 'employee',
      from:        parsed.data.from,
      to:          parsed.data.to,
      created_by:  (req as any).userId,
    })
    return session
  })

  // GET /fabric/replay/sessions — list replay sessions
  fastify.get('/fabric/replay/sessions', adminAuth, async (req, _reply) => {
    const orgId = (req as any).tenantId
    const { limit = '20' } = req.query as any
    const sessions = await replayIntelligenceService.listSessions(fastify.supabase, orgId, Number(limit))
    return { sessions, total: sessions.length }
  })

  // GET /fabric/knowledge — search knowledge layer
  fastify.get('/fabric/knowledge', adminAuth, async (req, _reply) => {
    const { domain, text } = req.query as any
    const results = knowledgeLayerService.search({ domain, text })
    return { entries: results, total: results.length }
  })

  // GET /fabric/knowledge/:key — get specific knowledge entry
  fastify.get('/fabric/knowledge/:key', adminAuth, async (req, reply) => {
    const { key } = req.params as any
    const entry = knowledgeLayerService.get(key)
    if (!entry) return reply.status(404).send({ error: 'Knowledge entry not found' })
    return entry
  })
}
