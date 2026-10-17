/**
 * Owner-panel error-report triage.
 *
 *   GET   /owner/error-reports         — list (filter by ?status=, ?limit=)
 *   PATCH /owner/error-reports/:id      — update status / owner_note
 *
 * Owner auth (platform_admins), separate from tenant auth.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { isValidFeedbackScreenshotPath } from '../../lib/feedback-screenshot-path.js'

const patchSchema = z.object({
  status:     z.enum(['new', 'triaged', 'resolved', 'dismissed']).optional(),
  owner_note: z.string().max(2000).optional(),
})

export default async function ownerErrorReportRoutes(fastify: FastifyInstance) {
  const ownerAuth = { preHandler: [fastify.authenticateOwner] }

  // GET /owner/error-reports?status=new&limit=100
  fastify.get('/owner/error-reports', ownerAuth, async (req, reply) => {
    const q = req.query as { status?: string; limit?: string }
    let query = fastify.supabase
      .from('error_reports')
      .select('id, tenant_id, message, url, severity, status, user_note, owner_note, created_at, resolved_at, tenants(name, slug)')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(q.limit) || 100, 500))
    if (q.status && q.status !== 'all') query = query.eq('status', q.status)

    const { data, error } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch error reports')

    // Lightweight open-count summary for the nav badge / header.
    const { count, error: countError } = await fastify.supabase
      .from('error_reports').select('id', { count: 'exact', head: true }).eq('status', 'new')
    if (countError) return serverError(req, reply, countError, ErrorCode.QUERY_FAILED, 'Failed to fetch new error-report count')

    return reply.send({ data, meta: { new_count: count ?? 0 } })
  })

  // GET /owner/error-reports/:id — full detail incl. stack
  fastify.get('/owner/error-reports/:id', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('error_reports')
      .select('*, tenants(name, slug)')
      .eq('id', id)
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch error report')
    if (!data) return notFound(reply, 'ERROR_REPORT_NOT_FOUND', 'Error report not found')
    return reply.send({ data })
  })

  // GET /owner/error-reports/:id/screenshot — short-lived signed URL for the
  // attached screenshot (service-role client bypasses the tenant-scoped
  // storage RLS that a platform-admin session wouldn't otherwise satisfy).
  fastify.get('/owner/error-reports/:id/screenshot', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { data: report, error: reportErr } = await fastify.supabase
      .from('error_reports').select('screenshot_path, tenant_id').eq('id', id).maybeSingle()
    if (reportErr) return serverError(req, reply, reportErr, ErrorCode.QUERY_FAILED, 'Failed to fetch error report')
    if (!report) return notFound(reply, 'ERROR_REPORT_NOT_FOUND', 'Error report not found')
    if (!report.screenshot_path) return notFound(reply, 'NO_SCREENSHOT', 'This report has no attached screenshot')

    // SYSTEM_AUDIT_2026-10-14 follow-up finding: independently re-validate
    // the stored path against THIS report's own tenant_id before ever
    // signing a URL for it — never trust that the row is well-formed just
    // because it made it into the table. This also covers an OLDER record
    // written before POST /support/error-reports validated the prefix
    // server-side (this round's own fix): the owner panel's view is where
    // any such stray cross-tenant path would actually get read and leaked,
    // so it is the right place to refuse it independently of whether the
    // write path happened to validate it, now or in the past.
    if (!isValidFeedbackScreenshotPath(report.screenshot_path, report.tenant_id)) {
      fastify.log.warn(
        { error_report_id: id, tenant_id: report.tenant_id, screenshot_path: report.screenshot_path },
        'owner error-report screenshot: stored path is outside the reporting tenant\'s feedback folder — refusing to sign',
      )
      return reply.code(422).send({
        error:   'INVALID_SCREENSHOT_PATH',
        message: 'This report\'s screenshot path is not a valid path for its own tenant and cannot be signed. It may be a pre-existing invalid record — see logs.',
      })
    }

    const { data: signed, error: signErr } = await fastify.supabase.storage
      .from('employee-files')
      .createSignedUrl(report.screenshot_path, 300)
    if (signErr || !signed?.signedUrl) return serverError(req, reply, signErr, ErrorCode.QUERY_FAILED, 'Failed to sign screenshot URL')
    return reply.send({ data: { url: signed.signedUrl } })
  })

  // PATCH /owner/error-reports/:id
  fastify.patch('/owner/error-reports/:id', ownerAuth, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid update' })

    const updates: Record<string, any> = { ...parsed.data }
    if (parsed.data.status === 'resolved' || parsed.data.status === 'dismissed') {
      updates.resolved_at = new Date().toISOString()
    } else if (parsed.data.status) {
      updates.resolved_at = null
    }

    const { data, error } = await fastify.supabase
      .from('error_reports').update(updates).eq('id', id).select('id, status').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update error report')
    if (!data) return notFound(reply, 'ERROR_REPORT_NOT_FOUND', 'Error report not found')
    return reply.send({ data })
  })
}
