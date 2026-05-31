import type { FastifyInstance } from 'fastify'

/**
 * GET /employees/options
 *
 * Lightweight employee picker endpoint — returns only the fields needed
 * for dropdowns / autocomplete widgets.
 *
 * Query params:
 *   search  (string, optional) — filters first_name, last_name, email via ilike
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
    const { search, limit = '50' } = request.query as Record<string, string>

    // Cap at 200 to prevent accidental full-table scans
    const take = Math.min(Math.max(parseInt(limit) || 50, 1), 200)

    let query = fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', request.tenantId)
      .eq('status', 'active')           // only active employees in pickers
      .order('first_name', { ascending: true })
      .limit(take)

    if (search?.trim()) {
      const term = `%${search.trim()}%`
      query = query.or(
        `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`
      )
    }

    const { data, error } = await query

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })
}
