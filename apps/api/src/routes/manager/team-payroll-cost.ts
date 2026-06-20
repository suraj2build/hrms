/**
 * Manager Team Payroll Cost — P6.11
 *
 * GET /manager/team/payroll-cost?month=YYYY-MM
 *   Per-employee payroll figures for the caller's direct reports for a given
 *   payroll month. Reads payroll_run_employees (any run status — draft is
 *   shown with a flag). Managers see only their own team; HR admins may
 *   pass ?manager_employee_id to inspect a specific team, or see all employees
 *   when omitted.
 *
 *   Returns: { data[], month, run_status, total: { gross, net, ot_cost, lop } }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  isHrAdmin, resolveManagerEmployeeId, getDirectReportIds,
} from '../../lib/manager-scope.js'

const monthRe = /^\d{4}-\d{2}$/

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function managerTeamPayrollCostRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/payroll-cost', auth, async (req: any, reply) => {
    const qSchema = z.object({
      month:               z.string().regex(monthRe, 'month must be YYYY-MM').default(currentMonth()),
      manager_employee_id: z.string().uuid().optional(),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, manager_employee_id } = parsed.data

    let employeeIds: string[]

    if (isHrAdmin(req.userRole) && manager_employee_id) {
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, manager_employee_id)
    } else if (isHrAdmin(req.userRole)) {
      const { data: emps } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .in('status', ['active', 'on_notice'])
      employeeIds = ((emps ?? []) as any[]).map(e => e.id)
    } else {
      const managerEmpId = await resolveManagerEmployeeId(fastify.supabase, req)
      if (!managerEmpId) return reply.send({ data: [], month, run_status: null, total: null })
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, managerEmpId)
    }

    if (!employeeIds.length) {
      return reply.send({ data: [], month, run_status: null, total: null })
    }

    // Find the payroll run for this month
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .maybeSingle()

    if (!run) {
      return reply.send({ data: [], month, run_status: null, total: null, note: 'No payroll run for this month' })
    }

    const { data: rows, error } = await fastify.supabase
      .from('payroll_run_employees')
      .select(`
        employee_id, gross_pay, net_pay, ot_cost, lop_deduction, volatility_index,
        employees!inner( id, first_name, last_name, employee_code, designations(name) )
      `)
      .eq('tenant_id', req.tenantId)
      .eq('payroll_run_id', run.id)
      .in('employee_id', employeeIds)
      .order('gross_pay', { ascending: false })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const data = (rows ?? []).map((r: any) => ({
      employee_id:      r.employee_id,
      name:             r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      employee_code:    r.employees?.employee_code ?? null,
      designation:      (Array.isArray(r.employees?.designations) ? r.employees.designations[0]?.name : r.employees?.designations?.name) ?? null,
      gross_pay:        Number(r.gross_pay  ?? 0),
      net_pay:          Number(r.net_pay    ?? 0),
      ot_cost:          Number(r.ot_cost    ?? 0),
      lop_deduction:    Number(r.lop_deduction ?? 0),
      volatility_index: r.volatility_index != null ? Number(r.volatility_index) : null,
    }))

    const total = data.reduce(
      (acc: { gross_pay: number; net_pay: number; ot_cost: number; lop_deduction: number }, r) => ({
        gross_pay:    acc.gross_pay    + r.gross_pay,
        net_pay:      acc.net_pay      + r.net_pay,
        ot_cost:      acc.ot_cost      + r.ot_cost,
        lop_deduction: acc.lop_deduction + r.lop_deduction,
      }),
      { gross_pay: 0, net_pay: 0, ot_cost: 0, lop_deduction: 0 },
    )

    return reply.send({ data, month, run_status: run.status, total })
  })
}
