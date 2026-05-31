/**
 * Payroll Summary Route
 *
 * GET /attendance/payroll-summary?month=YYYY-MM
 *
 * Aggregates attendance_daily per employee for a given month and returns
 * per-employee totals alongside a tenant-wide summary StatCard rollup.
 *
 * Auth: hr_admin / super_admin only.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

const monthRe = /^\d{4}-\d{2}$/

const querySchema = z.object({
  month: z.string().regex(monthRe, 'month must be YYYY-MM'),
})

export default async function payrollSummaryRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/attendance/payroll-summary', auth, async (req: any, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { month } = parsed.data
    const [year, mon] = month.split('-').map(Number)

    // First and last day of the month
    const from = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()  // 0th day of next month = last day of this month
    const to   = `${month}-${String(lastDay).padStart(2, '0')}`

    // Fetch all active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code, first_name, last_name')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .order('employee_code')

    if (empErr) {
      req.log.error({ err: empErr }, 'payroll-summary employees query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
    }

    // Fetch all daily attendance rows for the month
    const { data: daily, error: dailyErr } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, date, status, is_payable, day_fraction')
      .eq('tenant_id', req.tenantId)
      .gte('date', from)
      .lte('date', to)

    if (dailyErr) {
      req.log.error({ err: dailyErr }, 'payroll-summary daily query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance data' })
    }

    // Group daily rows by employee
    const byEmployee = new Map<string, typeof daily>()
    for (const row of daily ?? []) {
      const empId = row.employee_id as string
      if (!byEmployee.has(empId)) byEmployee.set(empId, [])
      byEmployee.get(empId)!.push(row)
    }

    // Compute per-employee summary
    const employeeSummaries = (employees ?? []).map((emp: any) => {
      const rows    = byEmployee.get(emp.id) ?? []
      const total_days    = lastDay                                                               // calendar days in month
      const present       = rows.filter((r: any) => r.status === 'present' || r.status === 'late').length
      const absent        = rows.filter((r: any) => r.status === 'absent').length
      const on_leave      = rows.filter((r: any) => r.status === 'leave').length
      const payable_days  = rows.filter((r: any) => r.is_payable === true)
                               .reduce((sum: number, r: any) => sum + (Number(r.day_fraction) || 1), 0)
      const lop_days      = rows.filter((r: any) => r.status === 'absent').length

      return {
        employee_id:   emp.id,
        employee_code: emp.employee_code,
        name:          `${emp.first_name} ${emp.last_name}`,
        total_days,
        present,
        absent,
        on_leave,
        payable_days,
        lop_days,
      }
    })

    // Tenant-wide totals for StatCards
    const totals = employeeSummaries.reduce(
      (acc, e) => ({
        total_employees: acc.total_employees + 1,
        total_payable_days:  acc.total_payable_days  + e.payable_days,
        total_lop_days:      acc.total_lop_days      + e.lop_days,
        total_present:       acc.total_present       + e.present,
        total_absent:        acc.total_absent        + e.absent,
        total_on_leave:      acc.total_on_leave      + e.on_leave,
      }),
      { total_employees: 0, total_payable_days: 0, total_lop_days: 0, total_present: 0, total_absent: 0, total_on_leave: 0 },
    )

    return reply.send({
      month,
      from,
      to,
      totals,
      employees: employeeSummaries,
    })
  })
}
