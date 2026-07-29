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
import { MANAGER_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate }  from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function attendanceContextRoutes(fastify: FastifyInstance) {
  const auth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!MANAGER_ROLES.includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin required' })
          return
        }
        done()
      },
    ],
  }

  // ── GET /attendance/active-now ───────────────────────────────────────────────
  fastify.get('/attendance/active-now', auth, async (req: any, reply) => {
    // Resolve "today" in the tenant's own timezone, not the server's (UTC)
    // clock — otherwise this undercounts/miscounts near the UTC/local-midnight
    // boundary, same bug class already fixed in manager-dashboard.ts.
    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const today = getLocalDate(new Date().toISOString(), tz)
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
          .in('status', ['active', 'on_notice']),
      ])
      // count/head:true queries resolve (never throw) on failure, so the
      // surrounding try/catch never sees a DB error here — check explicitly,
      // otherwise a real failure silently renders as "0 active employees".
      if (activeRes.error || totalRes.error) {
        return serverError(req, reply, activeRes.error ?? totalRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch active-now count')
      }
      return reply.send({ data: { count: activeRes.count ?? 0, total_employees: totalRes.count ?? 0 } })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch active-now count')
    }
  })

  // ── GET /attendance/missing-punches/today ────────────────────────────────────
  fastify.get('/attendance/missing-punches/today', auth, async (req: any, reply) => {
    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const today = getLocalDate(new Date().toISOString(), tz)
    try {
      // Employees who have a check_in today but no check_out
      const { data: logs, error } = await fastify.supabase
        .from('attendance_logs')
        .select('employee_id, check_in, employees(first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .gte('check_in', `${today}T00:00:00.000Z`)
        .lt('check_in', `${today}T23:59:59.999Z`)
        .is('check_out', null)
        .limit(50)
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch missing punches')

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
    const tz        = await fetchTenantTz(fastify.supabase, req.tenantId)
    const today     = getLocalDate(new Date().toISOString(), tz)
    const monthStart = today.slice(0, 7) + '-01'

    try {
      const { data, error } = await fastify.supabase
        .from('overtime_requests')
        .select('employee_id, raw_ot_minutes, attendance_date, employees(first_name, last_name)')
        .eq('tenant_id', req.tenantId)
        .gte('attendance_date', monthStart)
        .lte('attendance_date', today)
        .order('raw_ot_minutes', { ascending: false })
        .limit(limit * 5) // over-fetch to allow aggregation
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch OT-spike employees')

      // Aggregate by employee
      const empMap = new Map<string, { name: string; ot_hours: number; threshold: number }>()
      for (const r of ((data ?? []) as any[])) {
        const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
        const existing = empMap.get(r.employee_id)
        const otHours = (r.raw_ot_minutes ?? 0) / 60   // overtime_requests stores minutes
        if (existing) {
          existing.ot_hours += otHours
        } else {
          empMap.set(r.employee_id, {
            name:      emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : r.employee_id,
            ot_hours:  otHours,
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
