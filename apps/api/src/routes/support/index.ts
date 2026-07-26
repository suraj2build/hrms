/**
 * Support / error-reporting routes (tenant-facing).
 *
 *   POST /support/error-reports — a user reports an error they hit. Stored in
 *   error_reports for the owner panel to triage. Exempt from the subscription
 *   write-gate so users can always report problems (see plugins/auth.ts).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const reportSchema = z.object({
  message:        z.string().min(1).max(2000),
  stack:          z.string().max(8000).optional(),
  url:            z.string().max(1000).optional(),
  user_note:      z.string().max(2000).optional(),
  sentry_event_id: z.string().max(100).optional(),
  severity:       z.enum(['error', 'crash', 'feedback']).optional(),
})

export default async function supportRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/support/error-reports', auth, async (req, reply) => {
    const parsed = reportSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid report' })
    }
    const b = parsed.data

    const { data, error } = await fastify.supabase
      .from('error_reports')
      .insert({
        tenant_id:       req.tenantId,
        user_id:         req.userId,
        employee_id:     req.employeeId,
        message:         b.message,
        stack:           b.stack ?? null,
        url:             b.url ?? null,
        user_agent:      (req.headers['user-agent'] as string) ?? null,
        user_note:       b.user_note ?? null,
        sentry_event_id: b.sentry_event_id ?? null,
        severity:        b.severity ?? 'error',
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to save error report')
    return reply.code(201).send({ data: { id: data.id } })
  })
}
