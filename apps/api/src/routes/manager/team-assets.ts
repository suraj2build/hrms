/**
 * Manager Team Assets — P6.7
 *
 * GET /manager/team/assets
 *   Returns all assets currently assigned to the caller's direct reports.
 *   Managers see only their own team; HR admins see the full tenant.
 *   Read-only — HR retains assign/return authority via /assets/:id/assign|return.
 */
import type { FastifyInstance } from 'fastify'
import {
  isHrAdmin, resolveManagerEmployeeId, getDirectReportIds,
} from '../../lib/manager-scope.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

export default async function managerTeamAssetsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/assets', auth, async (req: any, reply) => {
    let employeeIds: string[]

    if (isHrAdmin(req.userRole)) {
      const emps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .in('status', ['active', 'on_notice'])
          .range(from, to)
      )
      employeeIds = (emps as any[]).map(e => e.id)
    } else {
      const managerEmpId = await resolveManagerEmployeeId(fastify.supabase, req)
      if (!managerEmpId) return reply.send({ data: [] })
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, managerEmpId)
      if (!employeeIds.length) return reply.send({ data: [] })
    }

    const { data, error } = await fastify.supabase
      .from('assets')
      .select(`
        id, asset_code, name, serial_number, status, notes, created_at,
        asset_categories ( name ),
        employees:assigned_to ( id, first_name, last_name, employee_code )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'assigned')
      .in('assigned_to', employeeIds)
      .order('asset_code')

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = (data ?? []).map((a: any) => ({
      id:            a.id,
      asset_code:    a.asset_code,
      name:          a.name,
      serial_number: a.serial_number ?? null,
      notes:         a.notes ?? null,
      category_name: a.asset_categories?.name ?? null,
      employee_id:   a.employees?.id ?? null,
      employee_name: a.employees ? `${a.employees.first_name} ${a.employees.last_name}` : null,
      employee_code: a.employees?.employee_code ?? null,
    }))

    return reply.send({ data: rows, total: rows.length })
  })
}
