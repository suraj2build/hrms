import type { FastifyInstance } from 'fastify'

/**
 * GET /employees/options
 *
 * Lightweight employee picker endpoint — returns only the fields needed
 * for dropdowns / autocomplete widgets.
 *
 * Query params:
 *   search  (string, optional) — filters first_name, last_name, employee_code, email via ilike
 *   limit   (number, optional) — max results, default 50, max 200
 *
 * Response:
 *   { data: { id, first_name, last_name, employee_code }[] }
 *
 * IMPORTANT: register this plugin BEFORE the /employees/:id route so Fastify
 * does not treat the literal segment "options" as an :id parameter.
 */
export default async function employeeOptionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/options', auth, async (request, reply) => {
    const { search, limit = '50', ids } = request.query as Record<string, string>

    // Cap at 200 to prevent accidental full-table scans
    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 200)

    let query = fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', request.tenantId)
      .order('first_name', { ascending: true })
      .limit(take)

    // ids mode: resolve specific employees by id (e.g. to label a preselected
    // value in a picker without showing a raw UUID). Bypasses the active filter
    // so an already-assigned but now-inactive employee still resolves.
    const idList = (ids ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (idList.length > 0) {
      query = query.in('id', idList.slice(0, 200))
    } else {
      query = query.eq('status', 'active')   // only active employees in live pickers
    }

    if (idList.length === 0 && search?.trim()) {
      const term = `%${search.trim()}%`
      // employee_code is the human-facing ID people actually search by (e.g.
      // "SK0001") — it must be matched here, not just names/email.
      query = query.or(
        `first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term},email.ilike.${term}`
      )
    }

    const { data, error } = await query

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })
}
