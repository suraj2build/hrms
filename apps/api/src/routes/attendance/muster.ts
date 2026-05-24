/**
 * GET /attendance/muster?month=YYYY-MM
 *
 * Returns the muster roll for a month: all active employees × all calendar days,
 * with their attendance_daily status, work_hours, and late_minutes.
 *
 * Days with no attendance_daily row are returned with status=null.
 *
 * Protected — requires hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
})

export default async function musterRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/muster',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      }

      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({
          error:   'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message,
        })
      }

      const { month } = parsed.data
      const fromDate = `${month}-01`
      // Last day of the month
      const [y, m] = month.split('-').map(Number)
      const toDate = new Date(y, m, 0).toISOString().slice(0, 10)  // day 0 of next month = last day of this month

      // Fetch all active employees
      const { data: employees, error: empError } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active')
        .order('employee_code')

      if (empError) {
        req.log.error({ err: empError }, 'muster employees query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
      }

      if (!employees || employees.length === 0) {
        return reply.send({ month, employees: [] })
      }

      // Fetch all attendance_daily rows for this tenant + month in one query
      const { data: daily, error: dailyError } = await fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, status, work_hours, late_minutes')
        .eq('tenant_id', req.tenantId)
        .gte('date', fromDate)
        .lte('date', toDate)

      if (dailyError) {
        req.log.error({ err: dailyError }, 'muster daily query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance records' })
      }

      // Build a lookup: employeeId → date → daily row
      type DailyRecord = { date: string; status: string; work_hours: number; late_minutes: number }
      const empDailyMap = new Map<string, Map<string, DailyRecord>>()

      for (const row of (daily ?? []) as (DailyRecord & { employee_id: string })[]) {
        let dateMap = empDailyMap.get(row.employee_id)
        if (!dateMap) {
          dateMap = new Map()
          empDailyMap.set(row.employee_id, dateMap)
        }
        dateMap.set(row.date, {
          date:         row.date,
          status:       row.status,
          work_hours:   Number(row.work_hours),
          late_minutes: Number(row.late_minutes),
        })
      }

      // Build all calendar days for the month
      const allDays: string[] = []
      const cur = new Date(`${fromDate}T12:00:00.000Z`)
      const end = new Date(`${toDate}T12:00:00.000Z`)
      while (cur <= end) {
        allDays.push(cur.toISOString().slice(0, 10))
        cur.setUTCDate(cur.getUTCDate() + 1)
      }

      // Assemble per-employee rows
      const result = (employees as { id: string; first_name: string; last_name: string; employee_code: string }[])
        .map((emp) => {
          const dateMap = empDailyMap.get(emp.id) ?? new Map<string, DailyRecord>()
          const days = allDays.map((d) => {
            const rec = dateMap.get(d)
            return rec
              ? { date: d, status: rec.status, work_hours: rec.work_hours, late_minutes: rec.late_minutes }
              : { date: d, status: null,        work_hours: 0,             late_minutes: 0             }
          })
          return {
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            name:          `${emp.first_name} ${emp.last_name}`,
            days,
          }
        })

      return reply.send({ month, employees: result })
    },
  )
}
