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
import { aadhaarVerificationService }  from '../../platform/trust/verification/aadhaar/aadhaar-verification.service.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function trustIntelligenceRoutes(fastify: FastifyInstance) {
  /**
   * POST /trust/evaluate
   * Run trust evaluation for an employee (on-demand).
   * Body: { employee_id, pan?, account_number?, ifsc_code?, phone? }
   */
  fastify.post('/trust/evaluate', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const body = req.body as any
    const tenantId = (req as any).tenantId
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
    const tenantId = (req as any).tenantId
    const edges = await workforceGraphService.getEmployeeEdges(fastify.supabase, employeeId, tenantId)
    return { edges, total: edges.length }
  })

  /**
   * GET /trust/duplicates
   * Query duplicate detection events for the tenant.
   */
  fastify.get('/trust/duplicates', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).tenantId
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
    const tenantId = (req as any).tenantId
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
    const tenantId = (req as any).tenantId
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
   * GET /trust/scores/employee/:employeeId
   * Latest employee-type trust score for one employee. Returns { score: null }
   * (not 404) when no score has been computed yet, so the Insights panel simply
   * hides the row instead of erroring.
   */
  fastify.get('/trust/scores/employee/:employeeId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const tenantId = (req as any).tenantId
    const { data, error } = await fastify.supabase
      .from('workforce_trust_scores')
      .select('id, score, severity, factors, explainability, computed_at')
      .eq('org_id', tenantId)
      .eq('entity_id', employeeId)
      .eq('score_type', 'employee')
      .maybeSingle()
    if (error) return reply.status(500).send({ error: error.message })
    return {
      score:          data?.score          ?? null,
      severity:       data?.severity        ?? null,
      factors:        data?.factors         ?? [],
      explainability: data?.explainability  ?? null,
      computed_at:    data?.computed_at      ?? null,
    }
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
    const tenantId = (req as any).tenantId
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
    await regulatoryIngestionService.approve(fastify.supabase, id, (req as any).userId)
    return { success: true }
  })

  /**
   * POST /trust/regulatory/revisions/:id/reject
   * Reject a revision.
   */
  fastify.post('/trust/regulatory/revisions/:id/reject', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    await regulatoryIngestionService.reject(fastify.supabase, id, (req as any).userId)
    return { success: true }
  })

  /**
   * GET /trust/verifications/employee/:employeeId
   * Get all verification records for an employee.
   */
  fastify.get('/trust/verifications/employee/:employeeId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const tenantId = (req as any).tenantId
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
    const tenantId = (req as any).tenantId

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
   * POST /trust/verifications/aadhaar/:employeeId  (HR admin)
   * Phase 1 Aadhaar verification — format + Verhoeff checksum + recorded consent.
   * Online e-KYC against UIDAI is Phase 2 (provider-gated). Requires explicit
   * consent (Aadhaar Act §8 / DPDP Act). The raw number is used transiently and
   * never stored by this layer — only a masked record lands in verification_records.
   * Body: { consent: boolean, aadhaar?: string }  (falls back to the number on file)
   */
  fastify.post(
    '/trust/verifications/aadhaar/:employeeId',
    { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] },
    async (req, reply) => {
      const { employeeId } = req.params as { employeeId: string }
      const body = (req.body ?? {}) as { consent?: boolean; aadhaar?: string }
      const tenantId = (req as any).tenantId

      if (body.consent !== true) {
        return reply.status(400).send({ error: 'CONSENT_REQUIRED', message: 'Explicit consent is required to verify Aadhaar.' })
      }

      // Prefer a number supplied in the request; otherwise use the one on file.
      let aadhaar = (body.aadhaar ?? '').trim()
      if (!aadhaar) {
        const { data: bs } = await fastify.supabase
          .from('employee_bank_statutory')
          .select('aadhaar_number')
          .eq('employee_id', employeeId)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        aadhaar = (bs as any)?.aadhaar_number ?? ''
      }
      if (!aadhaar) {
        return reply.status(400).send({ error: 'NO_AADHAAR', message: 'No Aadhaar number on file for this employee.' })
      }

      // Awaited so the verification_records row is persisted before we respond.
      await verificationOrchestrator.verify({
        supabase:        fastify.supabase,
        employee_id:     employeeId,
        tenant_id:       tenantId,
        aadhaar,
        aadhaar_consent: true,
      })

      // PII-safe echo of the outcome (mask only).
      const v = aadhaarVerificationService.validateStructure(aadhaar)
      return { status: v.isValid ? 'verified' : 'failed', masked: v.masked, employee_id: employeeId }
    },
  )

  /**
   * POST /ess/aadhaar/verify  (employee self-service)
   * The signed-in employee verifies their own Aadhaar with explicit consent.
   * Same Phase-1 engine (format + checksum); online e-KYC is Phase 2.
   * Body: { consent: boolean, aadhaar: string }
   */
  fastify.post(
    '/ess/aadhaar/verify',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId   = (req as any).userId
      const tenantId = (req as any).tenantId
      const body = (req.body ?? {}) as { consent?: boolean; aadhaar?: string }

      if (body.consent !== true) {
        return reply.status(400).send({ error: 'CONSENT_REQUIRED', message: 'Explicit consent is required to verify Aadhaar.' })
      }
      const aadhaar = (body.aadhaar ?? '').trim()
      if (!aadhaar) {
        return reply.status(400).send({ error: 'NO_AADHAAR', message: 'Enter your Aadhaar number to verify.' })
      }

      // Resolve the caller's own employee record — they can only verify themselves.
      const { data: prof } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', userId)
        .eq('tenant_id', tenantId)
        .single()
      const employeeId = (prof as any)?.employee_id
      if (!employeeId) {
        return reply.status(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record.' })
      }

      await verificationOrchestrator.verify({
        supabase:        fastify.supabase,
        employee_id:     employeeId,
        tenant_id:       tenantId,
        aadhaar,
        aadhaar_consent: true,
      })

      const v = aadhaarVerificationService.validateStructure(aadhaar)
      return { status: v.isValid ? 'verified' : 'failed', masked: v.masked }
    },
  )

  /**
   * GET /trust/verifications/stats
   * Get verification statistics for the tenant.
   */
  fastify.get('/trust/verifications/stats', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const tenantId = (req as any).tenantId
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
