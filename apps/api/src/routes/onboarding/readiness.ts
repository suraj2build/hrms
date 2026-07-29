/**
 * readiness.ts — Phase O3: Readiness API.
 *
 * GET /onboarding/sessions/:id/readiness   — readiness by session
 * GET /employees/:id/readiness             — readiness by employee
 *
 * Both endpoints return the same ReadinessResult shape.
 * Registered with no prefix — full paths are explicit here.
 */

import type { FastifyInstance } from 'fastify'
import { computeReadiness } from '../../lib/readiness-engine.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function readinessRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // Onboarding readiness is an HR-ops surface — neither route had a role
  // check, letting any authenticated employee read another employee's
  // onboarding blocking items/dimensions.
  function requireHrAdmin(req: any, reply: any): boolean {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /onboarding/sessions/:id/readiness ────────────────────────────────
  fastify.get('/onboarding/sessions/:id/readiness', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id: sessionId } = req.params as { id: string }
    const tenantId: string  = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const { data: session, error: sessionErr } = await fastify.supabase
      .from('onboarding_sessions').select('id')
      .eq('id', sessionId).eq('tenant_id', tenantId).maybeSingle()
    if (sessionErr) return serverError(req, reply, sessionErr, ErrorCode.QUERY_FAILED, 'Failed to look up onboarding session')
    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })

    try {
      const result = await computeReadiness(fastify.supabase, { tenantId, sessionId })
      return reply.send({ data: result })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute onboarding readiness')
    }
  })

  // ── GET /employees/:id/readiness ──────────────────────────────────────────
  fastify.get('/employees/:id/readiness', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id: employeeId } = req.params as { id: string }
    const tenantId: string   = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees').select('id')
      .eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to look up employee')
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    try {
      const result = await computeReadiness(fastify.supabase, { tenantId, employeeId })
      return reply.send({ data: result })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to compute onboarding readiness')
    }
  })
}
