/**
 * Operations intelligence routes — Sprint 4.
 * Provides health signals, heatmaps, SLA, simulation, automation, and security signal endpoints.
 * All endpoints are read-only except simulation POST routes which are analytical only.
 */
import type { FastifyInstance }          from 'fastify'
import { operationalIntelligenceService } from '../../platform/operations/intelligence/operational-intelligence.service.js'
import { healthSignalService }            from '../../platform/operations/health/health-signal.service.js'
import { heatmapService }                 from '../../platform/operations/heatmaps/heatmap.service.js'
import { slaService }                     from '../../platform/operations/sla/sla.service.js'
import { simulationService }              from '../../platform/operations/simulation/simulation.service.js'
import { securityIntelligenceService }    from '../../platform/operations/security-intelligence/security-intelligence.service.js'
import { triggerRegistry }                from '../../platform/operations/automation/trigger-registry.js'
import { requireRole, HR_ADMIN_ROLES }    from '../../lib/rbac.js'
import { serverError, ErrorCode }         from '../../lib/api-errors.js'

export default async function operationsRoutes(fastify: FastifyInstance) {

  // These endpoints surface company-wide payroll/trust/governance health,
  // heatmaps keyed by employee/branch id, and automation/SLA audit trails —
  // the same class of admin-only data as /operations/simulate/* and
  // /operations/security/signals below, which were already locked to
  // HR_ADMIN_ROLES for exactly this reason (any employee could otherwise
  // read which coworkers were risk-flagged). The only frontend caller is
  // EnterpriseControlCenter.tsx under the admin-only /admin/* shell, so the
  // API must enforce the same restriction rather than relying on the UI gate.
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /operations/summary — overall operational health
  fastify.get('/operations/summary', adminAuth, async (req, _reply) => {
    const tenantId = (req as any).tenantId
    return operationalIntelligenceService.getOperationalSummary(tenantId)
  })

  // GET /operations/health — domain health signals
  fastify.get('/operations/health', adminAuth, async (req, _reply) => {
    const tenantId = (req as any).tenantId
    const signals = healthSignalService.getAllDomainHealth(tenantId)
    return { signals, total: signals.length }
  })

  // GET /operations/heatmaps — all domain heatmaps
  fastify.get('/operations/heatmaps', adminAuth, async (req, _reply) => {
    const tenantId = (req as any).tenantId
    const snapshots = heatmapService.getAllSnapshots(tenantId)
    return { snapshots, total: snapshots.length }
  })

  // GET /operations/heatmaps/:domain — specific domain heatmap
  fastify.get('/operations/heatmaps/:domain', adminAuth, async (req, _reply) => {
    const { domain } = req.params as any
    const tenantId = (req as any).tenantId
    const snapshot = heatmapService.buildDomainHeatmap(domain, tenantId)
    return snapshot
  })

  // GET /operations/sla — SLA tracking status
  fastify.get('/operations/sla', adminAuth, async (req, _reply) => {
    const tenantId = (req as any).tenantId
    const tracked  = slaService.getTracked(tenantId)
    const breaches = slaService.getBreaches(tenantId)
    const defs     = slaService.getDefinitions()
    return { tracked, breaches, definitions: defs }
  })

  // GET /operations/automation/activity — recent automation actions
  fastify.get('/operations/automation/activity', adminAuth, async (req, reply) => {
    const tenantId = (req as any).tenantId
    const { limit = '50' } = req.query as any
    const { data, error } = await fastify.supabase
      .from('automation_activity_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('fired_at', { ascending: false })
      .limit(Number(limit))
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch automation activity')
    return { activities: data ?? [], total: (data ?? []).length }
  })

  // GET /operations/automation/triggers — list registered triggers
  fastify.get('/operations/automation/triggers', { preHandler: [fastify.authenticate] }, async (_req, _reply) => {
    const triggers = triggerRegistry.listTriggers().map(t => ({
      trigger_id:  t.trigger_id,
      name:        t.name,
      description: t.description,
      event_types: t.event_types,
      enabled:     t.enabled,
      safeguards:  t.safeguards,
    }))
    return { triggers, total: triggers.length }
  })

  // POST /operations/simulate/payroll — payroll impact simulation
  // Fresh audit finding: gated only on fastify.authenticate, so any employee
  // could trigger and read company-wide payroll-impact simulations (CTC
  // increase deltas, aggregate cost projections). The equivalent endpoint
  // (payroll/simulate.ts) already requires HR_ADMIN_ROLES — apply the same
  // gate here and to its three siblings below.
  fastify.post('/operations/simulate/payroll', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req, _reply) => {
    const body = req.body as any
    const tenantId = (req as any).tenantId
    const run = simulationService.simulatePayrollImpact({
      tenant_id:            tenantId,
      affected_count:    Number(body.affected_count) || 0,
      avg_ctc_increase:  Number(body.avg_ctc_increase) || 0,
      months_in_period:  Number(body.months_in_period) || 1,
      created_by:        (req as any).userId,
    })
    // Persist simulation run (fire-and-forget — result is still returned on failure)
    fastify.supabase.from('simulation_runs').insert({
      tenant_id:           run.tenant_id,
      simulation_type:  run.simulation_type,
      label:            run.label,
      input_params:     run.input_params,
      result_summary:   run.result_summary,
      created_at:       run.created_at,
      created_by:       run.created_by ?? null,
    }).then(undefined, (err: any) => fastify.log.warn({ err }, 'simulation_runs insert failed (payroll)'))
    return run
  })

  // POST /operations/simulate/compliance — compliance threshold simulation
  fastify.post('/operations/simulate/compliance', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req, _reply) => {
    const body = req.body as any
    const tenantId = (req as any).tenantId
    const run = simulationService.simulateComplianceThreshold({
      tenant_id:          tenantId,
      threshold_type:  body.threshold_type ?? 'threshold',
      old_threshold:   Number(body.old_threshold) || 0,
      new_threshold:   Number(body.new_threshold) || 0,
      affected_count:  Number(body.affected_count) || 0,
      created_by:      (req as any).userId,
    })
    fastify.supabase.from('simulation_runs').insert({
      tenant_id: run.tenant_id, simulation_type: run.simulation_type, label: run.label,
      input_params: run.input_params, result_summary: run.result_summary,
      created_at: run.created_at, created_by: run.created_by ?? null,
    }).then(undefined, (err: any) => fastify.log.warn({ err }, 'simulation_runs insert failed (compliance)'))
    return run
  })

  // POST /operations/simulate/overtime — overtime growth simulation
  fastify.post('/operations/simulate/overtime', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req, _reply) => {
    const body = req.body as any
    const tenantId = (req as any).tenantId
    const run = simulationService.simulateOvertimeGrowth({
      tenant_id:                tenantId,
      affected_count:        Number(body.affected_count) || 0,
      avg_ot_hours_per_week: Number(body.avg_ot_hours_per_week) || 0,
      ot_rate_per_hour:      Number(body.ot_rate_per_hour) || 0,
      weeks:                 Number(body.weeks) || 4,
      created_by:            (req as any).userId,
    })
    fastify.supabase.from('simulation_runs').insert({
      tenant_id: run.tenant_id, simulation_type: run.simulation_type, label: run.label,
      input_params: run.input_params, result_summary: run.result_summary,
      created_at: run.created_at, created_by: run.created_by ?? null,
    }).then(undefined, (err: any) => fastify.log.warn({ err }, 'simulation_runs insert failed (overtime)'))
    return run
  })

  // GET /operations/simulate/history — past simulation runs
  fastify.get('/operations/simulate/history', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req, reply) => {
    const tenantId = (req as any).tenantId
    const { limit = '20' } = req.query as any
    const { data, error } = await fastify.supabase
      .from('simulation_runs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Number(limit))
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch simulation history')
    return { runs: data ?? [], total: (data ?? []).length }
  })

  // GET /operations/security/signals — security intelligence events
  // Same class of data as the dedicated /security/* workspace (unusual
  // approval velocity, excessive overrides, escalation bypass — which
  // manager/admin triggered them), which requires HR-admin. This route was
  // only gated on fastify.authenticate, letting any employee see which
  // admins in their tenant were flagged for unusual behavior.
  fastify.get('/operations/security/signals', { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }, async (req, _reply) => {
    const tenantId = (req as any).tenantId
    const { limit = '50' } = req.query as any
    const events = securityIntelligenceService.getEvents(tenantId, Number(limit))
    return { signals: events, total: events.length }
  })

  // GET /operations/sla/breaches — SLA breach events (also from DB)
  fastify.get('/operations/sla/breaches', adminAuth, async (req, reply) => {
    const tenantId = (req as any).tenantId
    const { limit = '50' } = req.query as any
    const { data, error } = await fastify.supabase
      .from('sla_breach_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('breached_at', { ascending: false })
      .limit(Number(limit))
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch SLA breaches')
    return { breaches: data ?? [], total: (data ?? []).length }
  })
}
