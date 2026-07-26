/**
 * Employee Shift History Route
 *
 * GET /employees/:id/shift-history
 *
 * Returns all shift assignments for an employee, newest first,
 * with the related shift details (name, code, start/end time).
 *
 * Protected: hr_admin or super_admin (only caller is the admin Employee
 * Profile console). The docstring previously claimed "same as job-history"
 * but job-history.ts actually enforces self-or-HR-admin — this route had
 * no check at all.
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

export default async function shiftHistoryRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /employees/:id/shift-history
  fastify.get('/employees/:id/shift-history', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('employee_shifts')
      .select(`
        id,
        effective_from,
        is_current,
        created_at,
        shifts(id, name, code, start_time, end_time)
      `)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
