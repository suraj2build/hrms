/**
 * Attendance Confidence Routes
 *
 * GET /attendance/confidence/employee/:employeeId — Confidence history for one employee
 * GET /attendance/confidence/summary              — Tenant-level confidence summary for a month
 * GET /attendance/confidence/low                  — Employees with confidence issues (admin only)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const dateRe  = /^\d{4}-\d{2}-\d{2}$/
const monthRe = /^\d{4}-\d{2}$/

const employeeQuerySchema = z.object({
  from: z.string().regex(dateRe).optional(),
  to:   z.string().regex(dateRe).optional(),
})

const summaryQuerySchema = z.object({
  month: z.string().regex(monthRe).optional(),
})

const lowQuerySchema = z.object({
  month: z.string().regex(monthRe).optional(),
  level: z.enum(['low', 'critical', 'all']).default('low'),
})

function currentMonthStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthDateRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number)
  const from = `${month}-01`
  const lastDay = new Date(year, mon, 0).getDate()
  const to = `${month}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function nDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function attendanceConfidenceRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/confidence/employee/:employeeId ───────────────────────────
  fastify.get('/attendance/confidence/employee/:employeeId', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const { employeeId } = req.params as { employeeId: string }

    const parsed = employeeQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const from = parsed.data.from ?? nDaysAgo(30)
    const to   = parsed.data.to   ?? today()

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('attendance_daily')
      .select('id, date, confidence_score, confidence_level, confidence_factors, status, work_hours')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch confidence history')
    }

    const rows = (data ?? []) as Array<{
      id: string
      date: string
      confidence_score: number | null
      confidence_level: string | null
      confidence_factors: unknown
      status: string
      work_hours: number | null
    }>

    const scored = rows.filter((r) => r.confidence_score != null)
    const total_days   = rows.length
    const avg_score    = scored.length > 0 ? scored.reduce((s, r) => s + (r.confidence_score ?? 0), 0) / scored.length : null
    const min_score    = scored.length > 0 ? Math.min(...scored.map((r) => r.confidence_score ?? 100)) : null
    const critical_days = rows.filter((r) => r.confidence_level === 'critical').length
    const low_days      = rows.filter((r) => r.confidence_level === 'low').length

    return reply.send({
      data: rows,
      stats: {
        avg_score:    avg_score != null ? Math.round(avg_score * 100) / 100 : null,
        min_score,
        critical_days,
        low_days,
        total_days,
      },
    })
  })

  // ── GET /attendance/confidence/summary ────────────────────────────────────────
  fastify.get('/attendance/confidence/summary', auth, async (req: any, reply) => {
    // Sibling routes in this file (/employee/:id, /low) both gate on
    // HR_ADMIN_ROLES, and the consuming page is documented as
    // "hr_admin, super_admin only" — this endpoint was missing that check,
    // letting any authenticated employee read tenant-wide confidence-score
    // aggregates.
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const parsed = summaryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const month = parsed.data.month ?? currentMonthStr()
    const { from, to } = monthDateRange(month)

    let rows: Array<{ confidence_score: number | null; confidence_level: string | null }>
    try {
      rows = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select('confidence_score, confidence_level')
          .eq('tenant_id', req.tenantId)
          .gte('date', from)
          .lte('date', to)
          .range(rangeFrom, rangeTo),
      ) as Array<{ confidence_score: number | null; confidence_level: string | null }>
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch confidence summary')
    }

    const by_level: Record<string, number> = { high: 0, medium: 0, low: 0, critical: 0 }
    const scored = rows.filter((r) => r.confidence_score != null)
    const avg_confidence_score = scored.length > 0
      ? Math.round((scored.reduce((s, r) => s + (r.confidence_score ?? 0), 0) / scored.length) * 100) / 100
      : null

    for (const row of rows) {
      const lvl = row.confidence_level
      if (lvl && lvl in by_level) {
        by_level[lvl]++
      }
    }

    return reply.send({
      month,
      avg_confidence_score,
      by_level,
      total_records: rows.length,
    })
  })

  // ── GET /attendance/confidence/low ────────────────────────────────────────────
  fastify.get('/attendance/confidence/low', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = lowQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const month = parsed.data.month ?? currentMonthStr()
    const level = parsed.data.level
    const { from, to } = monthDateRange(month)

    // fetchAllRows(): tenant-wide, month-range, no employee filter — a plain
    // query would silently under-report confidence issues for a tenant with
    // >1,000 qualifying rows in the month. .order('date').order('id') keeps
    // the existing chronological ordering as primary and adds a stable
    // tie-breaker so .range() pagination is deterministic across pages.
    let data: any[]
    try {
      data = await fetchAllRows((from_, to_) => {
        let query = fastify.supabase
          .from('attendance_daily')
          .select(`
            employee_id, date, confidence_score, confidence_level,
            employees!inner(id, first_name, last_name, employee_code)
          `)
          .eq('tenant_id', req.tenantId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from_, to_)

        query = level === 'all'
          ? query.in('confidence_level', ['low', 'critical'])
          : query.eq('confidence_level', level)

        return query
      })
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch confidence issues')
    }

    // Group by employee and filter to those with >= 3 days
    const byEmployee = new Map<string, {
      employee_id:   string
      employee_code: string
      name:          string
      dates:         string[]
      scores:        number[]
    }>()

    for (const row of data as Array<Record<string, any>>) {
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
      if (!emp) continue

      const empId = row.employee_id as string
      if (!byEmployee.has(empId)) {
        byEmployee.set(empId, {
          employee_id:   empId,
          employee_code: emp.employee_code,
          name:          `${emp.first_name} ${emp.last_name}`,
          dates:         [],
          scores:        [],
        })
      }
      const entry = byEmployee.get(empId)!
      entry.dates.push(row.date as string)
      if (row.confidence_score != null) {
        entry.scores.push(row.confidence_score as number)
      }
    }

    const result = []
    for (const entry of byEmployee.values()) {
      if (entry.dates.length < 3) continue
      const avg_score = entry.scores.length > 0
        ? Math.round((entry.scores.reduce((s, v) => s + v, 0) / entry.scores.length) * 100) / 100
        : null
      result.push({
        employee_id:    entry.employee_id,
        employee_code:  entry.employee_code,
        name:           entry.name,
        days_with_issue: entry.dates.length,
        avg_score,
        dates:          entry.dates,
      })
    }

    // Sort by most days with issue desc
    result.sort((a, b) => b.days_with_issue - a.days_with_issue)

    return reply.send({ data: result })
  })
}
