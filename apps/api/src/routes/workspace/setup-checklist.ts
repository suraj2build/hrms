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
