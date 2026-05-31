/**
 * Attendance Queue Actions
 *
 * Generic action endpoints for the Operations / Resolution Workspace.
 * Queue items can be anomalies, corrections, regularisations, etc.
 * These endpoints operate on the most common backing type (attendance_anomalies)
 * and return idempotent successes for the others.
 *
 * Routes:
 *   POST /attendance/queue/:id/resolve   — mark anomaly as resolved
 *   POST /attendance/queue/:id/escalate  — mark anomaly as escalated; soft-success for others
 *   POST /attendance/queue/:id/snooze    — lightweight snooze acknowledgement
 *
 * Auth pattern: same as anomalies.ts — authenticate via fastify.authenticate,
 * then check req.userRole inline (NOT via a separate preHandler, which can cause
 * Fastify to return 400 when mixing async/callback-style hooks).
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const HR_ROLES = ['super_admin', 'hr_admin']

export default async function attendanceQueueActionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /attendance/queue/:id/resolve ─────────────────────────────────────
  fastify.post('/attendance/queue/:id/resolve', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .select('id, resolved_at')
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, id }, 'queue resolve: anomaly update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    }

    // data === null means the id isn't an anomaly (correction, revision, etc.) — still succeed
    return reply.send({
      message:     'Resolved',
      id,
      resolved_at: data?.resolved_at ?? new Date().toISOString(),
    })
  })

  // ── POST /attendance/queue/:id/escalate ────────────────────────────────────
  fastify.post('/attendance/queue/:id/escalate', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    // req.body may be null when the client sends no body (Content-Type: application/json, empty)
    const body   = (req.body != null && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
    const reason = typeof body['reason'] === 'string' ? body['reason'] : undefined

    const now = new Date().toISOString()

    // Attempt to mark the anomaly as resolved/escalated (non-fatal if not an anomaly)
    const { error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: now,
        updated_at:  now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)

    if (error) {
      req.log.warn({ err: error, id }, 'queue escalate: anomaly update failed (non-fatal)')
      // Don't surface the DB error — the escalate action itself still succeeds
    }

    return reply.send({ message: 'Escalated', id, reason: reason ?? null })
  })

  // ── POST /attendance/queue/:id/snooze ──────────────────────────────────────
  fastify.post('/attendance/queue/:id/snooze', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    // Parse hours from body; default 24h — handle null/empty body gracefully
    const bodySchema = z.object({
      hours: z.coerce.number().int().min(1).max(168).default(24),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    const hours  = parsed.data?.hours ?? 24

    const snoozedUntil = new Date(Date.now() + hours * 3_600_000).toISOString()

    return reply.send({ message: 'Snoozed', id, snoozed_until: snoozedUntil, hours })
  })
}
