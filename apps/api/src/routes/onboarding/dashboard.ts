import type { FastifyInstance } from 'fastify'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function onboardingDashboardRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /onboarding/dashboard ─────────────────────────────────────────────
  fastify.get('/dashboard', auth, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const tenantId: string = req.tenantId

    // Current month boundaries
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    // Run all stats queries in parallel
    const [
      totalResult,
      pendingReviewResult,
      extractionFailedResult,
      approvedThisMonthResult,
      rejectedThisMonthResult,
      recentSessionsResult,
      duplicateRisksResult,
    ] = await Promise.all([
      // total_sessions
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .neq('status', 'archived'),

      // pending_review: status in ('draft_ready', 'hr_review')
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['draft_ready', 'hr_review']),

      // extraction_failed: docs with extraction_status = 'failed'
      fastify.supabase
        .from('onboarding_documents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('extraction_status', 'failed'),

      // approved_this_month: sessions with status = 'employee_created' updated this month
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'employee_created')
        .gte('updated_at', monthStart)
        .lte('updated_at', monthEnd),

      // rejected_this_month
      fastify.supabase
        .from('onboarding_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'rejected')
        .gte('updated_at', monthStart)
        .lte('updated_at', monthEnd),

      // recent_sessions (last 10)
      fastify.supabase
        .from('onboarding_sessions')
        .select(`
          id, candidate_name, status, created_at,
          onboarding_documents(count)
        `)
        .eq('tenant_id', tenantId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(10),

      // duplicate_risks: drafts with non-null/non-empty duplicate_risk
      fastify.supabase
        .from('draft_employee_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .not('duplicate_risk', 'is', null),
    ])

    if (totalResult.error)             return serverError(req, reply, totalResult.error,             ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (pendingReviewResult.error)      return serverError(req, reply, pendingReviewResult.error,      ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (extractionFailedResult.error)   return serverError(req, reply, extractionFailedResult.error,   ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (approvedThisMonthResult.error)  return serverError(req, reply, approvedThisMonthResult.error,  ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (rejectedThisMonthResult.error)  return serverError(req, reply, rejectedThisMonthResult.error,  ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (recentSessionsResult.error)     return serverError(req, reply, recentSessionsResult.error,     ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    if (duplicateRisksResult.error)     return serverError(req, reply, duplicateRisksResult.error,     ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')

    // Both queries below are real .select()s (not count-only), so — unlike
    // the head:true count queries above — they're subject to PostgREST's
    // 1,000-row cap and must be paginated separately.
    let confidenceRows: Array<{ overall_confidence: number | null }>
    let statusRows: Array<{ status: string }>
    try {
      ;[confidenceRows, statusRows] = await Promise.all([
        fetchAllRows<{ overall_confidence: number | null }>((from, to) =>
          fastify.supabase
            .from('draft_employee_profiles')
            .select('overall_confidence')
            .eq('tenant_id', tenantId)
            .range(from, to),
        ),
        fetchAllRows<{ status: string }>((from, to) =>
          fastify.supabase
            .from('onboarding_sessions')
            .select('status')
            .eq('tenant_id', tenantId)
            .neq('status', 'archived')
            .range(from, to),
        ),
      ])
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch onboarding dashboard stats')
    }

    // Calculate avg confidence
    const validConfidences = confidenceRows
      .map((r) => r.overall_confidence)
      .filter((v): v is number => typeof v === 'number')
    const avgConfidence =
      validConfidences.length > 0
        ? Math.round((validConfidences.reduce((sum, v) => sum + v, 0) / validConfidences.length) * 1000) / 1000
        : 0

    // Aggregate sessions_by_status
    const statusCounts: Record<string, number> = {}
    for (const row of statusRows) {
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
    }
    const sessionsByStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }))

    // Format recent sessions
    const recentSessions = (recentSessionsResult.data ?? []).map((s: any) => ({
      id: s.id,
      candidate_name: s.candidate_name,
      status: s.status,
      doc_count: Array.isArray(s.onboarding_documents)
        ? s.onboarding_documents[0]?.count ?? 0
        : 0,
      created_at: s.created_at,
    }))

    return reply.send({
      data: {
        total_sessions: totalResult.count ?? 0,
        pending_review: pendingReviewResult.count ?? 0,
        extraction_failed: extractionFailedResult.count ?? 0,
        approved_this_month: approvedThisMonthResult.count ?? 0,
        rejected_this_month: rejectedThisMonthResult.count ?? 0,
        avg_confidence_score: avgConfidence,
        sessions_by_status: sessionsByStatus,
        recent_sessions: recentSessions,
        duplicate_risks: duplicateRisksResult.count ?? 0,
      },
    })
  })
}
