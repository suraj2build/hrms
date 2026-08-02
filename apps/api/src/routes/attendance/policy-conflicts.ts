/**
 * Attendance Policy Conflicts Routes
 *
 * GET /attendance/policy-conflicts                         — List policy conflicts
 * GET /attendance/policy-conflicts/summary                 — Summary by conflict type for a month
 * GET /attendance/policy-conflicts/employee/:employeeId    — Conflicts for one employee
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const dateRe  = /^\d{4}-\d{2}-\d{2}$/
const monthRe = /^\d{4}-\d{2}$/

const listQuerySchema = z.object({
  employee_id:       z.string().uuid().optional(),
  from:              z.string().regex(dateRe).optional(),
  to:                z.string().regex(dateRe).optional(),
  conflict_type:     z.string().optional(),
  payroll_impacting: z.enum(['true', 'false']).optional(),
  limit:             z.coerce.number().int().min(1).max(200).default(100),
  offset:            z.coerce.number().int().min(0).default(0),
})

const summaryQuerySchema = z.object({
  month: z.string().regex(monthRe).optional(),
})

const employeeQuerySchema = z.object({
  from: z.string().regex(dateRe).optional(),
  to:   z.string().regex(dateRe).optional(),
})

function monthDateRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number)
  const from = `${month}-01`
  const lastDay = new Date(year, mon, 0).getDate()
  const to = `${month}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

// Pure UTC-ms arithmetic anchored on the tenant-local "today" string, so it
// never gets reinterpreted through the server's local timezone.
function daysBeforeISO(today: string, n: number): string {
  return new Date(new Date(`${today}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

export default async function attendancePolicyConflictsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/policy-conflicts ──────────────────────────────────────────
  fastify.get('/attendance/policy-conflicts', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from, to, conflict_type, payroll_impacting, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('attendance_policy_conflict_log')
      .select(
        `
          id, date, conflict_type, severity:conflict_severity, payroll_impacting,
          policy_a, policy_b, resolution:resolution_source, note:conflict_explanation,
          created_at, updated_at:created_at,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employee_id)       q = q.eq('employee_id', employee_id)
    if (from)              q = q.gte('date', from)
    if (to)                q = q.lte('date', to)
    if (conflict_type)     q = q.eq('conflict_type', conflict_type)
    if (payroll_impacting) q = q.eq('payroll_impacting', payroll_impacting === 'true')

    const { data, error, count } = await q

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy conflicts')
    }

    const rows = ((data ?? []) as Array<Record<string, any>>).map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        ...r,
        employees:     undefined,
        employee_id:   emp?.id            ?? null,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/policy-conflicts/summary ──────────────────────────────────
  fastify.get('/attendance/policy-conflicts/summary', auth, async (req: any, reply) => {
    // Sibling routes in this same file gate on HR_ADMIN_ROLES — this one was
    // missing that check, letting any authenticated employee read tenant-wide
    // policy-conflict aggregates.
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

    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const todayStr = getLocalDate(new Date().toISOString(), tz)
    const month = parsed.data.month ?? todayStr.slice(0, 7)
    const { from, to } = monthDateRange(month)

    let rows: Array<{ conflict_type: string; severity: string; payroll_impacting: boolean }>
    try {
      rows = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_policy_conflict_log')
          .select('conflict_type, severity:conflict_severity, payroll_impacting')
          .eq('tenant_id', req.tenantId)
          .gte('date', from)
          .lte('date', to)
          .range(rangeFrom, rangeTo),
      ) as Array<{ conflict_type: string; severity: string; payroll_impacting: boolean }>
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy conflict summary')
    }

    const by_type: Record<string, number>     = {}
    const by_severity: Record<string, number> = {}
    let payroll_impacting = 0

    for (const row of rows) {
      by_type[row.conflict_type] = (by_type[row.conflict_type] ?? 0) + 1
      by_severity[row.severity]  = (by_severity[row.severity]  ?? 0) + 1
      if (row.payroll_impacting) payroll_impacting++
    }

    return reply.send({
      by_type,
      by_severity,
      payroll_impacting,
      total: rows.length,
    })
  })

  // ── GET /attendance/policy-conflicts/employee/:employeeId ─────────────────────
  fastify.get('/attendance/policy-conflicts/employee/:employeeId', auth, async (req: any, reply) => {
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

    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const todayStr = getLocalDate(new Date().toISOString(), tz)
    const from = parsed.data.from ?? daysBeforeISO(todayStr, 90)
    const to   = parsed.data.to   ?? todayStr

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
      .from('attendance_policy_conflict_log')
      .select(
        'id, date, conflict_type, severity:conflict_severity, payroll_impacting, policy_a, policy_b, resolution:resolution_source, note:conflict_explanation, created_at, updated_at:created_at',
      )
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('created_at', { ascending: false })

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch policy conflicts')
    }

    const rows = (data ?? []) as Array<{
      id: string
      date: string
      conflict_type: string
      severity: string
      payroll_impacting: boolean
      policy_a: string | null
      policy_b: string | null
      resolution: string | null
      note: string | null
      created_at: string
      updated_at: string
    }>

    const unique_types = [...new Set(rows.map((r) => r.conflict_type))]
    const payroll_impacting_count = rows.filter((r) => r.payroll_impacting).length

    return reply.send({
      data: rows,
      total: rows.length,
      unique_types,
      payroll_impacting_count,
    })
  })
}
