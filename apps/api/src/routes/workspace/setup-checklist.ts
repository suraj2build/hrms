/**
 * GET /workspace/setup-checklist
 *
 * Returns counts of key master-data tables so the frontend "Getting Started"
 * checklist can determine which setup steps are done without needing 7
 * separate API calls.
 *
 * All queries run in parallel via Promise.all — typical p99 < 40 ms.
 */

import type { FastifyInstance } from 'fastify'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function setupChecklistRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/workspace/setup-checklist', auth, async (req: any, reply) => {
    const tenantId = req.tenantId

    const [
      depts,
      desigs,
      grades,
      sites,
      workLocs,
      leaveTypes,
      salaryComps,
    ] = await Promise.all([
      fastify.supabase
        .from('departments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('designations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('grades')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('sites')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('work_locations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('leave_types')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      fastify.supabase
        .from('salary_components')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
    ])

    // Any one of these failing (RLS misconfig, transient DB error, table
    // rename) previously left `count` null/undefined, silently reported as
    // 0 — indistinguishable from a tenant that genuinely has no rows yet,
    // which would tell an HR admin a setup step is incomplete when it may
    // just be a query failure.
    const failed = [depts, desigs, grades, sites, workLocs, leaveTypes, salaryComps]
      .find(r => r.error)
    if (failed?.error) {
      return serverError(req, reply, failed.error, ErrorCode.QUERY_FAILED, 'Failed to load setup checklist')
    }

    return reply.send({
      data: {
        departments:       depts.count       ?? 0,
        designations:      desigs.count      ?? 0,
        grades:            grades.count      ?? 0,
        sites:             sites.count       ?? 0,
        work_locations:    workLocs.count    ?? 0,
        leave_types:       leaveTypes.count  ?? 0,
        salary_components: salaryComps.count ?? 0,
      },
    })
  })
}
