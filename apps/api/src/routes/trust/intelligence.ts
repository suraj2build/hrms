/**
 * Trust Intelligence routes — Sprint 3.
 * Exposes trust evaluation, graph, duplicate detection, and regulatory revision endpoints.
 * All routes are passive and read-oriented. POST /evaluate is on-demand only.
 */
import type { FastifyInstance } from 'fastify'
import { trustIntelligenceService }    from '../../platform/trust/intelligence/trust-intelligence.service.js'
import { workforceGraphService }       from '../../platform/trust/graph/workforce-graph.service.js'
import { regulatoryIngestionService }  from '../../platform/regulatory/ingestion/regulatory-ingestion.service.js'
import { verificationOrchestrator }    from '../../platform/trust/orchestrator/verification-orchestrator.service.js'
import { verificationRetryService }    from '../../platform/integrations/retry/verification-retry.service.js'

export default async function trustIntelligenceRoutes(fastify: FastifyInstance) {
  /**
   * POST /trust/evaluate
   * Run trust evaluation for an employee (on-demand).
   * Body: { employee_id, pan?, account_number?, ifsc_code?, phone? }
   */
  fastify.post('/trust/evaluate', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = req.body as any
    const tenantId = (req as any).user.tenant_id
    try {
      const result = await trustIntelligenceService.evaluateEmployee(fastify.supabase, {
        employee_id:    body.employee_id,
        tenant_id:      tenantId,
        org_id:         tenantId,
        pan:            body.pan,
        account_number: body.account_number,
        ifsc_code:      body.ifsc_code,
        phone:          body.phone,
      })
      return result
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message ?? 'Trust evaluation failed' })
    }
  })

  /**
   * GET /trust/graph/:employeeId
   * Get workforce graph edges for an employee.
   */
  fastify.get('/trust/graph/:employeeId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employeeId } = req.params as any
    const tenantId = (req as any).user.tenant_id
    const edges = await workforceGraphService.getEmployeeEdges(fastify.supabase, employeeId, tenantId)
    return { edges, total: edges.length }
  })

  /**
   * GET /trust/duplicates
   * Query duplicate detection events for the tenant.
   */
  fastify.get('/trust/duplicates', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { limit = '50' } = req.query as any
    const { data, error } = await fastify.supabase
      .from('duplicate_detection_events')
      .select('*')
      .eq('org_id', tenantId)
      .order('detected_at', { ascending: false })
      .limit(Number(limit))
    if (error) return reply.status(500).send({ error: error.message })
    return { duplicates: data ?? [], total: (data ?? []).length }
  })

  /**
   * GET /trust/verifications
   * Query verification events for the tenant.
   */
  fastify.get('/trust/verifications', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { limit = '50', employee_id } = req.query as any
    let q = fastify.supabase
      .from('verification_events')
      .select('*')
      .eq('org_id', tenantId)
      .order('verified_at', { ascending: false })
      .limit(Number(limit))
    if (employee_id) q = q.eq('entity_id', employee_id)
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return { verifications: data ?? [], total: (data ?? []).length }
  })

  /**
   * GET /trust/scores
   * Get trust scores for the tenant.
   */
  fastify.get('/trust/scores', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { limit = '50' } = req.query as any
    const { data, error } = await fastify.supabase
      .from('workforce_trust_scores')
      .select('*')
      .eq('org_id', tenantId)
      .order('score', { ascending: true })  // lowest trust first
      .limit(Number(limit))
    if (error) return reply.status(500).send({ error: error.message })
    return { scores: data ?? [], total: (data ?? []).length }
  })

  /**
   * GET /trust/regulatory/revisions
   * List compliance revision events (pending or all).
   */
  fastify.get('/trust/regulatory/revisions', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { status } = req.query as any
    let q = fastify.supabase
      .from('compliance_revision_events')
      .select('*')
      .order('ingested_at', { ascending: false })
      .limit(100)
    if (status) q = q.eq('status', status)
    // Include platform-wide (org_id IS NULL) and tenant-specific
    const { data, error } = await q
    if (error) return reply.status(500).send({ error: error.message })
    return { revisions: data ?? [], total: (data ?? []).length }
  })

  /**
   * POST /trust/regulatory/revisions
   * Ingest a new compliance revision (HR admin only).
   */
  fastify.post('/trust/regulatory/revisions', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = req.body as any
    const tenantId = (req as any).user.tenant_id
    const id = await regulatoryIngestionService.ingest(fastify.supabase, {
      org_id:           tenantId,
      revision_type:    body.revision_type,
      jurisdiction:     body.jurisdiction,
      title:            body.title,
      description:      body.description,
      old_value:        body.old_value,
      new_value:        body.new_value,
      unit:             body.unit,
      effective_from:   body.effective_from,
      source_reference: body.source_reference,
    })
    if (!id) return reply.status(500).send({ error: 'Failed to ingest revision' })
    return reply.status(201).send({ id })
  })

  /**
   * POST /trust/regulatory/revisions/:id/approve
   * Approve a revision after human review.
   */
  fastify.post('/trust/regulatory/revisions/:id/approve', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    await regulatoryIngestionService.approve(fastify.supabase, id, (req as any).user.id)
    return { success: true }
  })

  /**
   * POST /trust/regulatory/revisions/:id/reject
   * Reject a revision.
   */
  fastify.post('/trust/regulatory/revisions/:id/reject', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    await regulatoryIngestionService.reject(fastify.supabase, id, (req as any).user.id)
    return { success: true }
  })

  /**
   * GET /trust/verifications/employee/:employeeId
   * Get all verification records for an employee.
   */
  fastify.get('/trust/verifications/employee/:employeeId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const tenantId = (req as any).user.tenant_id
    const { data, error } = await fastify.supabase
      .from('verification_records')
      .select('id, verification_type, status, provider, source, score, name_match_confidence, explanation, last_error, verified_at, updated_at, retry_count')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
    if (error) return reply.status(500).send({ error: error.message })
    return { data: data ?? [] }
  })

  /**
   * POST /trust/verifications/retry/:employeeId
   * Trigger a verification retry for an employee (fire-and-forget).
   */
  fastify.post('/trust/verifications/retry/:employeeId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const tenantId = (req as any).user.tenant_id

    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, personal_info:employee_personal_info(pan_number), bank:employee_bank_statutory(account_number, ifsc_code)')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (empErr || !emp) return reply.status(404).send({ error: 'Employee not found' })

    const pi  = Array.isArray((emp as any).personal_info) ? (emp as any).personal_info[0] : (emp as any).personal_info
    const bs  = Array.isArray((emp as any).bank) ? (emp as any).bank[0] : (emp as any).bank

    // Fire-and-forget — do NOT await
    verificationOrchestrator.verify({
      supabase:        fastify.supabase,
      employee_id:     employeeId,
      tenant_id:       tenantId,
      pan:             pi?.pan_number    ?? undefined,
      account_number:  bs?.account_number ?? undefined,
      ifsc_code:       bs?.ifsc_code     ?? undefined,
    }).catch(() => { /* intentional fire-and-forget */ })

    return { status: 'retry_scheduled', employee_id: employeeId }
  })

  /**
   * GET /trust/verifications/stats
   * Get verification statistics for the tenant.
   */
  fastify.get('/trust/verifications/stats', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).user.tenant_id
    const { data, error } = await fastify.supabase
      .from('verification_records')
      .select('status, verification_type')
      .eq('tenant_id', tenantId)
    if (error) return reply.status(500).send({ error: error.message })
    const records = data ?? []
    return {
      total:        records.length,
      verified:     records.filter(r => r.status === 'verified').length,
      pending:      records.filter(r => r.status === 'pending').length,
      degraded:     records.filter(r => r.status === 'degraded').length,
      needs_review: records.filter(r => r.status === 'needs_review').length,
      failed:       records.filter(r => r.status === 'failed').length,
      retry_queue:  verificationRetryService.stats(),
    }
  })
}
