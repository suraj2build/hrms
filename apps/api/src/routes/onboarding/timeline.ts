/**
 * timeline.ts — Phase O2: Canonical Timeline API.
 *
 * GET /onboarding/sessions/:id/timeline        — by session
 * GET /employees/:id/onboarding-timeline       — by employee
 *
 * Registered with no prefix so full paths are explicit here.
 */

import type { FastifyInstance } from 'fastify'
import { fetchTimeline } from '../../lib/timeline-aggregator.js'

export default async function timelineRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // Onboarding lifecycle timeline is an HR-ops surface — neither route had
  // a role check, letting any authenticated employee read another
  // employee's onboarding event history.
  function requireHrAdmin(req: any, reply: any): boolean {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /onboarding/sessions/:id/timeline ─────────────────────────────────
  fastify.get('/onboarding/sessions/:id/timeline', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id: sessionId } = req.params as { id: string }
    const tenantId: string  = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const { data: session } = await fastify.supabase
      .from('onboarding_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!session) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Session not found' })

    try {
      const result = await fetchTimeline(fastify.supabase, {
        tenantId,
        sessionId,
        limit:  Number((req.query as any).limit)  || 100,
        offset: Number((req.query as any).offset) || 0,
      })
      return reply.send({ data: result })
    } catch (err: any) {
      req.log.error({ err }, 'timeline_fetch_failed')
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: err.message })
    }
  })

  // ── GET /employees/:id/onboarding-timeline ────────────────────────────────
  fastify.get('/employees/:id/onboarding-timeline', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return
    const { id: employeeId } = req.params as { id: string }
    const tenantId: string   = req.tenantId

    if (!tenantId) return reply.code(401).send({ error: 'UNAUTHORIZED' })

    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    try {
      const result = await fetchTimeline(fastify.supabase, {
        tenantId,
        employeeId,
        limit:  Number((req.query as any).limit)  || 100,
        offset: Number((req.query as any).offset) || 0,
      })
      return reply.send({ data: result })
    } catch (err: any) {
      req.log.error({ err }, 'timeline_fetch_failed')
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: err.message })
    }
  })
}
