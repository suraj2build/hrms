/**
 * Attendance Context Panel Endpoints
 *
 * GET /attendance/active-now               — count of employees checked in today
 * GET /attendance/missing-punches/today    — employees who checked in but haven't checked out
 * GET /attendance/ot-spike-employees       — employees with high OT this month
 *
 * Requires hr_admin, super_admin, or manager.
 */
import type { FastifyInstance } from 'fastify'

export default async function attendanceContextRoutes(fastify: FastifyInstance) {
  const auth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!['super_admin', 'hr_admin', 'manager'].includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin required' })
          return
        }
        done()
      },
    ],
  }

  // ── GET /attendance/active-now ───────────────────────────────────────────────
  fastify.get('/attendance/active-now', auth, async (req: any, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    try {
      const [activeRes, totalRes] = await Promise.all([
        fastify.supabase
          .from('attendance_daily')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('date', today)
          .in('status', ['present', 'late', 'late_arrival', 'half_day']),
        fastify.supabase
          .from('employees')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active'),
      ])
      return reply.send({ data: { count: activeRes.count ?? 0, total_employees: totalRes.count ?? 0 } })
    } catch {
      return reply.send({ data: { count: 0, total_employees: 0 } })
    }
  })

  // ── GET /attendance/missing-punches/today ────────────────────────────────────
  fastify.get('/attendance/missing-punches/today', auth, async (req: any, reply) => {
    const today = new Date().toISOString().slice(0, 10)
    try {
      // Employees who have a check_in today but no check_out
      const { data: logs } = await fastify.supabase
        .from('attendance_logs')
        .select('employee_id, check_in, employees(first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .gte('check_in', `${today}T00:00:00.000Z`)
        .lt('check_in', `${today}T23:59:59.999Z`)
        .is('check_out', null)
        .limit(50)

      const employees = ((logs ?? []) as any[]).map((l: any) => {
        const emp = Array.isArray(l.employees) ? l.employees[0] : l.employees
        return {
          id:    l.employee_id,
          name:  emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : l.employee_id,
          shift: 'Unknown',
        }
      })

      return reply.send({ data: { count: employees.length, employees } })
    } catch {
      return reply.send({ data: { count: 0, employees: [] } })
    }
  })

  // ── GET /attendance/ot-spike-employees?limit=5 ───────────────────────────────
  fastify.get('/attendance/ot-spike-employees', auth, async (req: any, reply) => {
    const limit     = Math.min(parseInt((req.query as any).limit ?? '5', 10) || 5, 50)
    const today     = new Date().toISOString().slice(0, 10)
    const monthStart = today.slice(0, 7) + '-01'

    try {
      const { data } = await fastify.supabase
        .from('overtime_requests')
        .select('employee_id, ot_hours, date, employees(first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .gte('date', monthStart)
        .lte('date', today)
        .order('ot_hours', { ascending: false })
        .limit(limit * 5) // over-fetch to allow aggregation

      // Aggregate by employee
      const empMap = new Map<string, { name: string; ot_hours: number; threshold: number }>()
      for (const r of ((data ?? []) as any[])) {
        const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
        const existing = empMap.get(r.employee_id)
        if (existing) {
          existing.ot_hours += r.ot_hours ?? 0
        } else {
          empMap.set(r.employee_id, {
            name:      emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : r.employee_id,
            ot_hours:  r.ot_hours ?? 0,
            threshold: 8, // standard monthly OT threshold (hours)
          })
        }
      }

      const result = Array.from(empMap.entries())
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.ot_hours - a.ot_hours)
        .slice(0, limit)

      return reply.send({ data: result })
    } catch {
      return reply.send({ data: [] })
    }
  })
}
