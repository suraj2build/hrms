/**
 * Manager Team Helpdesk — P6.8
 *
 * GET /manager/team/helpdesk[?status=open|in_progress|resolved|closed]
 *   Read-only visibility into direct reports' helpdesk tickets.
 *   Managers can see tickets raised by their team but cannot resolve them —
 *   ticket resolution remains an HR function.
 *   HR admins have their own full queue at /helpdesk/tickets.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  isHrAdmin, resolveManagerEmployeeId, getDirectReportIds,
} from '../../lib/manager-scope.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function managerTeamHelpdeskRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/helpdesk', auth, async (req: any, reply) => {
    const qSchema = z.object({
      status:              z.string().optional(),
      manager_employee_id: z.string().uuid().optional(),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { status, manager_employee_id } = parsed.data

    let employeeIds: string[]

    if (isHrAdmin(req.userRole) && manager_employee_id) {
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, manager_employee_id)
    } else if (isHrAdmin(req.userRole)) {
      // HR admin without specific manager: show all active employees.
      // Paginated — an unbounded .select() truncates at PostgREST's
      // 1,000-row ceiling for a large tenant, silently hiding tickets
      // raised by employees past that cutoff.
      const emps = await fetchAllRows<{ id: string }>((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .range(from, to),
      )
      employeeIds = emps.map(e => e.id)
    } else {
      const managerEmpId = await resolveManagerEmployeeId(fastify.supabase, req)
      if (!managerEmpId) return reply.send({ data: [], summary: { total: 0, open: 0, in_progress: 0, awaiting_employee: 0, resolved: 0, breached: 0 } })
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, managerEmpId)
    }

    if (!employeeIds.length) {
      return reply.send({ data: [], summary: { total: 0, open: 0, in_progress: 0, awaiting_employee: 0, resolved: 0, breached: 0 } })
    }

    const VALID_STATUSES = ['open', 'in_progress', 'awaiting_employee', 'resolved', 'closed']

    // Paginated — a hard .limit(200) with no page/count signal silently
    // undercounted the SLA/breach summary for any team whose tickets exceeded
    // 200 rows (the summary below is computed from these rows, not a separate
    // exact count). Mirrors the fetchAllRows() fix already applied to the
    // employees lookup above.
    let data: any[]
    try {
      data = await fetchAllRows<any>((from, to) => {
        let q = fastify.supabase
          .from('helpdesk_tickets')
          .select(`
            id, subject, category, priority, status,
            created_at, sla_due_at, resolution_due_at,
            sla_breached_at, first_response_at, resolved_at, closed_at,
            employees!inner( id, first_name, last_name, employee_code )
          `)
          .eq('tenant_id', req.tenantId)
          .in('employee_id', employeeIds)
          .order('created_at', { ascending: false })
          .range(from, to)
        if (status && VALID_STATUSES.includes(status)) {
          q = q.eq('status', status)
        }
        return q
      })
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch team helpdesk tickets')
    }

    const now = Date.now()
    const rows = (data ?? []).map((t: any) => {
      const slaBreached =
        t.sla_breached_at != null ||
        (t.sla_due_at && new Date(t.sla_due_at).getTime() < now && !['resolved', 'closed'].includes(t.status))
      return {
        id:               t.id,
        subject:          t.subject,
        category:         t.category,
        priority:         t.priority,
        status:           t.status,
        created_at:       t.created_at,
        sla_due_at:       t.sla_due_at ?? null,
        resolution_due_at: t.resolution_due_at ?? null,
        first_response_at: t.first_response_at ?? null,
        sla_breached:     slaBreached,
        resolved_at:      t.resolved_at ?? null,
        closed_at:        t.closed_at ?? null,
        employee_id:      t.employees?.id ?? null,
        employee_name:    t.employees ? `${t.employees.first_name} ${t.employees.last_name}` : null,
        employee_code:    t.employees?.employee_code ?? null,
      }
    })

    const summary = {
      total:             rows.length,
      open:              rows.filter((r: any) => r.status === 'open').length,
      in_progress:       rows.filter((r: any) => r.status === 'in_progress').length,
      awaiting_employee: rows.filter((r: any) => r.status === 'awaiting_employee').length,
      resolved:          rows.filter((r: any) => ['resolved', 'closed'].includes(r.status)).length,
      breached:          rows.filter((r: any) => r.sla_breached).length,
    }

    return reply.send({ data: rows, summary })
  })
}
