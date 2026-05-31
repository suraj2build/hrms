/**
 * GET /attendance/upload-health
 *
 * Returns a health summary of recent attendance CSV uploads for this tenant.
 * Used by the Observability Console and Payroll Readiness Dashboard to surface
 * stale, failed, or unprocessed attendance uploads.
 *
 * Response:
 *  {
 *    status: 'healthy' | 'degraded' | 'critical',
 *    summary: {
 *      total_last_30d:   number,   // upload sessions in last 30 days
 *      completed:        number,
 *      failed:           number,
 *      orphaned:         number,
 *      partial_failures: number,   // completed but with failed_rows > 0
 *      replay_uploads:   number,   // completed uploads flagged as replays
 *    },
 *    recent_failures: Array<{
 *      id:          string,
 *      file_name:   string | null,
 *      created_at:  string,
 *      error_message: string | null,
 *      result_summary: unknown,
 *    }>,
 *    stale_uploads: Array<{      // completed > 48h ago with no follow-up processing run
 *      id:         string,
 *      file_name:  string | null,
 *      created_at: string,
 *    }>,
 *    last_successful_upload: string | null,   // ISO timestamp
 *  }
 *
 * Auth: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function attendanceUploadHealthRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/attendance/upload-health', adminAuth, async (req: any, reply) => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // ── Fetch all attendance_csv sessions in last 30 days ──────────────────
    const { data: sessions, error } = await fastify.supabase
      .from('upload_sessions')
      .select('id, status, file_name, created_at, error_message, result_summary, content_checksum')
      .eq('tenant_id', req.tenantId)
      .eq('upload_type', 'attendance_csv')
      .gte('created_at', since30d)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const rows = (sessions ?? []) as Array<{
      id:             string
      status:         string
      file_name:      string | null
      created_at:     string
      error_message:  string | null
      result_summary: Record<string, unknown> | null
      content_checksum: string | null
    }>

    // ── Compute summary ────────────────────────────────────────────────────
    let completed = 0, failed = 0, orphaned = 0, partialFailures = 0, replayUploads = 0

    for (const r of rows) {
      if (r.status === 'completed') {
        completed++
        const summary = r.result_summary ?? {}
        if ((summary.failed_rows as number ?? 0) > 0) partialFailures++
        if (summary.is_replay === true) replayUploads++
      } else if (r.status === 'failed') {
        failed++
      } else if (r.status === 'orphaned') {
        orphaned++
      }
    }

    // ── Recent failures (last 10) ──────────────────────────────────────────
    const recentFailures = rows
      .filter((r) => r.status === 'failed' || r.status === 'orphaned')
      .slice(0, 10)
      .map((r) => ({
        id:             r.id,
        file_name:      r.file_name,
        created_at:     r.created_at,
        error_message:  r.error_message,
        result_summary: r.result_summary,
      }))

    // ── Stale uploads: completed > 48h ago (operational warning) ─────────
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const staleUploads = rows
      .filter((r) => r.status === 'completed' && r.created_at < cutoff48h)
      .slice(0, 5)
      .map((r) => ({ id: r.id, file_name: r.file_name, created_at: r.created_at }))

    // ── Last successful upload ─────────────────────────────────────────────
    const lastSuccessful = rows.find((r) => r.status === 'completed')
    const lastSuccessfulAt = lastSuccessful?.created_at ?? null

    // ── Overall health status ──────────────────────────────────────────────
    // critical: any failures in last 7 days OR orphaned sessions
    // degraded: partial failures > 20% of completed, OR no upload in last 7 days
    // healthy:  otherwise
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy'
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const recentFailed   = rows.filter((r) => (r.status === 'failed' || r.status === 'orphaned') && r.created_at >= since7d).length
    const noRecentUpload = !rows.some((r) => r.created_at >= since7d)

    if (recentFailed > 0 || orphaned > 0) {
      status = 'critical'
    } else if (noRecentUpload || (completed > 0 && partialFailures / completed > 0.2)) {
      status = 'degraded'
    }

    return reply.send({
      status,
      summary: {
        total_last_30d:   rows.length,
        completed,
        failed,
        orphaned,
        partial_failures: partialFailures,
        replay_uploads:   replayUploads,
      },
      recent_failures:          recentFailures,
      stale_uploads:            staleUploads,
      last_successful_upload:   lastSuccessfulAt,
    })
  })
}
