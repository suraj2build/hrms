/**
 * Roster Context Panel Endpoints
 *
 * GET /roster/uncovered-shifts?month=YYYY-MM&limit=5     — shifts with absent employees
 * GET /roster/weekly-off-conflicts?month=YYYY-MM&limit=5 — employees worked on their weekly off
 * GET /holidays?month=YYYY-MM&upcoming=true&limit=3      — upcoming holidays for the month
 *
 * Requires hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const monthRe = /^\d{4}-\d{2}$/
const DAYS    = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async function rosterContextRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /roster/uncovered-shifts?month=YYYY-MM&limit=5 ──────────────────────
  fastify.get('/roster/uncovered-shifts', hrAdminAuth, async (req: any, reply) => {
    const query = req.query as any
    const month = query.month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }
    const limit = Math.min(parseInt(query.limit ?? '5', 10) || 5, 50)

    const [y, m] = month.split('-').map(Number)
    const from   = `${month}-01`
    const to     = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

    // Absent employees with a shift assignment are "uncovered". Paginated —
    // a hard .limit(200) over the whole tenant for a full month silently
    // truncated the dataset the "top uncovered shifts" ranking below is
    // built from, for any tenant whose absence count for the month exceeds
    // 200 rows.
    let data: any[]
    try {
      data = await fetchAllRows<any>((rFrom, rTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select('date, employee_id, status')
          .eq('tenant_id', req.tenantId)
          .gte('date', from)
          .lte('date', to)
          .in('status', ['absent', 'not_marked'])
          .range(rFrom, rTo),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch uncovered shifts')
    }

    if (!data.length) return reply.send({ data: [] })

    const empIds = [...new Set(data.map((r: any) => r.employee_id))]

    // Lookup assigned shifts for those employees in that month via shift_roster
    const { data: rosterRows, error: rosterErr } = await fastify.supabase
      .from('shift_roster')
      .select('employee_id, date, shifts(name)')
      .eq('tenant_id', req.tenantId)
      .gte('date', from)
      .lte('date', to)
      .in('employee_id', empIds)
    if (rosterErr) return serverError(req, reply, rosterErr, ErrorCode.QUERY_FAILED, 'Failed to fetch uncovered shifts')

    const rosterMap = new Map<string, string>() // "empId::date" → shift name
    for (const r of ((rosterRows ?? []) as any[])) {
      const shift = Array.isArray(r.shifts) ? r.shifts[0] : r.shifts
      rosterMap.set(`${r.employee_id}::${r.date}`, shift?.name ?? 'Unknown')
    }

    // Group by date + shift, count uncovered employees
    const byKey = new Map<string, { date: string; shift_name: string; count: number }>()
    for (const r of data) {
      const shiftName = rosterMap.get(`${r.employee_id}::${r.date}`)
      if (!shiftName) continue // no roster assignment → not "uncovered" per se
      const key = `${r.date}::${shiftName}`
      const existing = byKey.get(key)
      if (existing) {
        existing.count++
      } else {
        byKey.set(key, { date: r.date, shift_name: shiftName, count: 1 })
      }
    }

    const result = Array.from(byKey.values())
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, limit)
      .map(r => ({ date: r.date, shift_name: r.shift_name, employee_count_needed: r.count }))

    return reply.send({ data: result })
  })

  // ── GET /roster/weekly-off-conflicts?month=YYYY-MM&limit=5 ──────────────────
  fastify.get('/roster/weekly-off-conflicts', hrAdminAuth, async (req: any, reply) => {
    const query = req.query as any
    const month = query.month as string | undefined
    if (!month || !monthRe.test(month)) {
      return reply.code(400).send({ error: 'INVALID_MONTH', message: 'month must be YYYY-MM' })
    }
    const limit = Math.min(parseInt(query.limit ?? '5', 10) || 5, 50)

    const [y, m] = month.split('-').map(Number)
    const from   = `${month}-01`
    const to     = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

    // Employees who were present on a day they had a weekly_off roster entry
    const { data, error } = await fastify.supabase
      .from('attendance_daily')
      .select('date, employee_id, status, employees(first_name, last_name)')
      .eq('tenant_id', req.tenantId)
      .gte('date', from)
      .lte('date', to)
      .eq('status', 'weekly_off_worked')
      .order('date', { ascending: true })
      .limit(limit)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch weekly-off conflicts')

    const result = ((data ?? []) as any[]).map((r: any) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        employee_name: emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : r.employee_id,
        conflict_date: r.date,
        conflict_type: 'worked_on_weekly_off',
      }
    })
    return reply.send({ data: result })
  })

  // ── GET /holidays?month=YYYY-MM&upcoming=true&limit=3 ───────────────────────
  fastify.get('/holidays', hrAdminAuth, async (req: any, reply) => {
    const query   = req.query as any
    const month   = query.month as string | undefined
    const limit   = Math.min(parseInt(query.limit ?? '10', 10) || 10, 50)
    const upcoming = query.upcoming === 'true'

    let q = fastify.supabase
      .from('holiday_calendar')
      .select('id, date, name, is_optional')
      .eq('tenant_id', req.tenantId)
      .order('date', { ascending: true })
      .limit(limit)

    if (month && monthRe.test(month)) {
      const [y, m] = month.split('-').map(Number)
      q = q.gte('date', `${month}-01`).lte('date', new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10))
    }

    if (upcoming) {
      q = q.gte('date', new Date().toISOString().slice(0, 10))
    }

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch holidays')

    const result = ((data ?? []) as any[]).map((h: any) => ({
      date: h.date,
      name: h.name,
      day:  DAYS[new Date(h.date + 'T00:00:00').getDay()] ?? '',
    }))

    return reply.send({ data: result })
  })
}
