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
  message:         z.string().min(1).max(2000),
  stack:           z.string().max(8000).optional(),
  url:             z.string().max(1000).optional(),
  user_note:       z.string().max(2000).optional(),
  sentry_event_id: z.string().max(100).optional(),
  severity:        z.enum(['error', 'crash', 'feedback']).optional(),
  screenshot_path: z.string().max(500).optional(),
})

export default async function supportRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/support/error-reports', auth, async (req, reply) => {
    const parsed = reportSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0]?.message ?? 'Invalid report' })
    }
    const b = parsed.data

    // SYSTEM_AUDIT_2026-10-14 follow-up finding: screenshot_path was accepted
    // as an arbitrary client-supplied string with no server-side check that
    // it actually lives inside THIS reporting tenant's own feedback folder.
    // The real upload flow (uploadFeedbackScreenshot, apps/web/src/lib/
    // supabase-storage.ts) always writes to exactly `${tenantId}/feedback/
    // <name>` in the employee-files bucket — nothing else is a legitimate
    // value here. Without this check, a malicious or merely buggy client
    // could submit ANY storage path (another tenant's upload, an unrelated
    // object in the same bucket) and have the owner panel's screenshot
    // endpoint (GET /owner/error-reports/:id/screenshot) later sign a URL
    // for it — a cross-tenant file-privacy leak riding through the feedback
    // flow. `..` is rejected outright regardless of prefix (defence in depth
    // against a traversal-crafted path even if the prefix check were ever
    // weakened).
    if (b.screenshot_path) {
      const expectedPrefix = `${req.tenantId}/feedback/`
      if (!b.screenshot_path.startsWith(expectedPrefix) || b.screenshot_path.includes('..')) {
        return reply.code(400).send({
          error:   'INVALID_SCREENSHOT_PATH',
          message: 'screenshot_path must be a path inside this tenant\'s own feedback folder',
        })
      }
    }

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
        screenshot_path: b.screenshot_path ?? null,
      })
      .select('id')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to save error report')
    return reply.code(201).send({ data: { id: data.id } })
  })
}
