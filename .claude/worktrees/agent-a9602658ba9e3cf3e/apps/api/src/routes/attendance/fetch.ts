/**
 * GET /attendance/:employeeId
 *
 * Returns attendance_daily + attendance_logs for an employee.
 * Query params:
 *   from  — YYYY-MM-DD  (default: first day of current month)
 *   to    — YYYY-MM-DD  (default: today)
 *
 * Protected — requires authenticated user in same tenant.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const querySchema = z.object({
  from: z.string().regex(dateRe, 'from must be YYYY-MM-DD').optional(),
  to:   z.string().regex(dateRe, 'to must be YYYY-MM-DD').optional(),
})

export default async function fetchRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/:employeeId',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const { employeeId } = req.params as { employeeId: string }

      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message,
        })
      }

      // Default date range: current month
      const today    = new Date().toISOString().slice(0, 10)
      const monthStart = today.slice(0, 7) + '-01'
      const from = parsed.data.from ?? monthStart
      const to   = parsed.data.to   ?? today

      // Verify employee belongs to tenant
      const { data: employee, error: empError } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (empError || !employee) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // Fetch daily summary
      const { data: daily, error: dailyError } = await fastify.supabase
        .from('attendance_daily')
        .select('id, date, work_hours, late_minutes, overtime_minutes, status, is_payable')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: false })

      if (dailyError) {
        req.log.error({ err: dailyError, module: 'attendance', route: 'fetch' }, 'daily query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch daily records' })
      }

      // Fetch check-in/out log entries
      const { data: logs, error: logsError } = await fastify.supabase
        .from('attendance_logs')
        .select('id, check_in, check_out')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .gte('check_in', `${from}T00:00:00.000Z`)
        .lte('check_in', `${to}T23:59:59.999Z`)
        .order('check_in', { ascending: false })

      if (logsError) {
        req.log.error({ err: logsError, module: 'attendance', route: 'fetch' }, 'logs query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch log entries' })
      }

      // Aggregate summary stats for the range
      const totalDays     = (daily ?? []).length
      const presentDays   = (daily ?? []).filter((d: { status: string }) => ['present','late'].includes(d.status)).length
      const absentDays    = (daily ?? []).filter((d: { status: string }) => d.status === 'absent').length
      const lateDays      = (daily ?? []).filter((d: { status: string }) => d.status === 'late').length
      const totalHours    = (daily ?? []).reduce((sum: number, d: { work_hours: number }) => sum + Number(d.work_hours), 0)
      const avgHours      = totalDays > 0 ? parseFloat((totalHours / totalDays).toFixed(2)) : 0
      const payableDays   = (daily ?? []).filter((d: { is_payable: boolean }) => d.is_payable === true).length
      const lopDays       = absentDays  // LOP = days absent (not payable, not on leave)

      return reply.send({
        employee: {
          id:            employee.id,
          name:          `${employee.first_name} ${employee.last_name}`,
          employee_code: employee.employee_code,
        },
        range:   { from, to },
        summary: {
          total_days:   totalDays,
          present:      presentDays,
          absent:       absentDays,
          late:         lateDays,
          payable_days: payableDays,
          lop_days:     lopDays,
          avg_hours:    avgHours,
          total_hours:  parseFloat(totalHours.toFixed(2)),
        },
        daily:   daily ?? [],
        logs:    logs  ?? [],
      })
    },
  )
}
