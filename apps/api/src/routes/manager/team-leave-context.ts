/**
 * Manager Team Leave Context
 *
 * GET /manager/team/leave-context?employee_id=&from=&to=
 *
 * Powers the "Leave context" drawer on the Approval Inbox. When a manager
 * reviews a pending leave request they need decision context that the request
 * row alone does not carry:
 *
 *   • balances     — the employee's current balance per leave type (so the
 *                    approver can see whether this request is within balance)
 *   • team_overlap — teammates already off (APPROVED) during the requested
 *                    window, i.e. coverage risk
 *   • history      — the employee's recent leave requests (pattern context)
 *
 * Authorisation: HR admins may inspect anyone; a manager may only inspect their
 * own direct reports (employees.manager_id == caller). Scope mirrors the
 * canonical manager-scope model so there is one hierarchy source of truth.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  isHrAdmin, resolveCallerEmployeeId, isDirectReport, getDirectReportIds,
} from '../../lib/manager-scope.js'
import { fetchAttendanceTrend } from '../../lib/attendance-trend.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function managerTeamLeaveContextRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/leave-context', auth, async (req: any, reply) => {
    const parsed = z.object({
      employee_id: z.string().uuid(),
      from:        z.string().regex(dateRe, 'from must be YYYY-MM-DD'),
      to:          z.string().regex(dateRe, 'to must be YYYY-MM-DD'),
    }).safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { employee_id, from, to } = parsed.data
    const tenantId = req.tenantId as string
    const year = new Date().getFullYear()

    // ── Authorise: HR admin, or the employee is a direct report of the caller ──
    if (!isHrAdmin(req.userRole)) {
      const callerEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, tenantId)
      if (!callerEmpId) {
        return reply.code(403).send({ error: 'NO_EMPLOYEE_LINK', message: 'Profile not linked to an employee record' })
      }
      const ok = await isDirectReport(fastify.supabase, tenantId, callerEmpId, employee_id)
      if (!ok) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Employee is not one of your direct reports' })
      }
    }

    // ── Target employee (also gives us the team via manager_id) ───────────────
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code, manager_id')
      .eq('id', employee_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Teammates = other direct reports of the same manager (coverage cohort).
    const teammateIds = emp.manager_id
      ? (await getDirectReportIds(fastify.supabase, tenantId, emp.manager_id)).filter(id => id !== employee_id)
      : []

    // ── Parallel reads: balances, overlapping team leave, history, trend ──────
    const [{ data: balances }, { data: overlap }, { data: history }, attendance] = await Promise.all([
      fastify.supabase
        .from('employee_leave_balance')
        .select('leave_type_id, balance, leave_types(id, name, is_paid)')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employee_id)
        .eq('year', year),

      teammateIds.length
        ? fastify.supabase
            .from('leave_requests')
            .select('employee_id, from_date, to_date, computed_days, employees(first_name, last_name, employee_code), leave_types(name)')
            .eq('tenant_id', tenantId)
            .eq('status', 'APPROVED')
            .in('employee_id', teammateIds)
            .lte('from_date', to)
            .gte('to_date', from)
            .order('from_date', { ascending: true })
        : Promise.resolve({ data: [] as any[] }),

      fastify.supabase
        .from('leave_requests')
        .select('leave_type_id, from_date, to_date, computed_days, status, leave_types(name)')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employee_id)
        .order('from_date', { ascending: false })
        .limit(6),

      fetchAttendanceTrend(fastify.supabase, tenantId, employee_id, 30),
    ])

    const flat = (rel: any) => (Array.isArray(rel) ? rel[0] : rel)

    return reply.send({
      employee: {
        id:            emp.id,
        name:          `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
      },
      window: { from, to },
      balances: (balances ?? []).map((b: any) => {
        const lt = flat(b.leave_types)
        return {
          leave_type_id: b.leave_type_id,
          leave_type:    lt?.name ?? 'Unknown',
          is_paid:       lt?.is_paid ?? false,
          balance:       Number(b.balance ?? 0),
        }
      }),
      team_overlap: (overlap ?? []).map((o: any) => {
        const e = flat(o.employees)
        return {
          name:          e ? `${e.first_name} ${e.last_name}` : '—',
          employee_code: e?.employee_code ?? null,
          leave_type:    flat(o.leave_types)?.name ?? null,
          from_date:     o.from_date,
          to_date:       o.to_date,
          days:          Number(o.computed_days ?? 0),
        }
      }),
      history: (history ?? []).map((h: any) => ({
        leave_type: flat(h.leave_types)?.name ?? 'Unknown',
        from_date:  h.from_date,
        to_date:    h.to_date,
        days:       Number(h.computed_days ?? 0),
        status:     h.status,
      })),
      attendance,
    })
  })
}
