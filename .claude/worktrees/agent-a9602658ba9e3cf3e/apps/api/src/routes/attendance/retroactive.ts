/**
 * Attendance Retroactive Impact Routes
 *
 * GET  /attendance/retroactive                      — List retroactive impacts (admin only)
 * GET  /attendance/retroactive/employee/:employeeId — Impact history for one employee
 * POST /attendance/retroactive/detect               — Scan for retroactive impacts (admin only)
 * PUT  /attendance/retroactive/:id/status           — Update propagation status (admin only)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const PROPAGATION_STATUSES = ['propagating', 'completed', 'failed', 'skipped'] as const

const listQuerySchema = z.object({
  employee_id:         z.string().uuid().optional(),
  from:                z.string().regex(dateRe).optional(),
  to:                  z.string().regex(dateRe).optional(),
  trigger_source:      z.string().optional(),
  propagation_status:  z.enum(PROPAGATION_STATUSES).optional(),
  limit:               z.coerce.number().int().min(1).max(200).default(100),
  offset:              z.coerce.number().int().min(0).default(0),
})

const employeeQuerySchema = z.object({
  from: z.string().regex(dateRe).optional(),
  to:   z.string().regex(dateRe).optional(),
})

const detectBodySchema = z.object({
  employee_id: z.string().uuid().optional(),
  from_date:   z.string().regex(dateRe),
  to_date:     z.string().regex(dateRe),
})

const updateStatusBodySchema = z.object({
  propagation_status: z.enum(PROPAGATION_STATUSES),
})

function nDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function attendanceRetroactiveRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/retroactive ───────────────────────────────────────────────
  fastify.get('/attendance/retroactive', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from, to, trigger_source, propagation_status, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('attendance_retroactive_impacts')
      .select(
        `
          id, date, impact_type, trigger_source, propagation_status,
          before_value, after_value, payroll_run_id, note,
          created_at, updated_at,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employee_id)        q = q.eq('employee_id', employee_id)
    if (from)               q = q.gte('date', from)
    if (to)                 q = q.lte('date', to)
    if (trigger_source)     q = q.eq('trigger_source', trigger_source)
    if (propagation_status) q = q.eq('propagation_status', propagation_status)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance_retroactive_impacts query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch retroactive impacts' })
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

  // ── GET /attendance/retroactive/employee/:employeeId ──────────────────────────
  fastify.get('/attendance/retroactive/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const parsed = employeeQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const from = parsed.data.from ?? nDaysAgo(90)
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
      .from('attendance_retroactive_impacts')
      .select(
        'id, date, impact_type, trigger_source, propagation_status, before_value, after_value, payroll_run_id, note, created_at, updated_at',
      )
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('created_at', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'retroactive employee query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch retroactive impacts' })
    }

    const rows = (data ?? []) as Array<{ impact_type: string; [key: string]: unknown }>

    // Summarise impact_types across all records
    const typeCount: Record<string, number> = {}
    for (const row of rows) {
      typeCount[row.impact_type] = (typeCount[row.impact_type] ?? 0) + 1
    }

    return reply.send({
      data: rows,
      summary: {
        total:        rows.length,
        impact_types: typeCount,
      },
    })
  })

  // ── POST /attendance/retroactive/detect ───────────────────────────────────────
  fastify.post('/attendance/retroactive/detect', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = detectBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from_date, to_date } = parsed.data

    // 1. Query audit log for status changes from regularisation or leave sources
    let auditQ = fastify.supabase
      .from('attendance_audit_log')
      .select('id, employee_id, date, source, before_status, after_status, created_at')
      .eq('tenant_id', req.tenantId)
      .in('source', ['regularisation', 'leave'])
      .gte('date', from_date)
      .lte('date', to_date)

    if (employee_id) auditQ = auditQ.eq('employee_id', employee_id)

    const { data: auditRows, error: auditError } = await auditQ

    if (auditError) {
      req.log.error({ err: auditError }, 'retroactive detect audit query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to query audit log' })
    }

    // Filter to rows where before_status != after_status (actual changes)
    const changes = ((auditRows ?? []) as Array<{
      id: string
      employee_id: string
      date: string
      source: string
      before_status: string | null
      after_status: string | null
      created_at: string
    }>).filter((r) => r.before_status !== r.after_status)

    if (changes.length === 0) {
      return reply.send({ detected: 0, inserted: 0 })
    }

    // 2. For each changed date, check if a payroll run exists for that period
    // Extract unique YYYY-MM months from change dates
    const months = [...new Set(changes.map((c) => c.date.slice(0, 7)))]

    const { data: payrollRuns } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('tenant_id', req.tenantId)
      .in('month', months)

    const runsByMonth = new Map<string, { id: string; month: string; status: string }>()
    for (const run of (payrollRuns ?? []) as Array<{ id: string; month: string; status: string }>) {
      runsByMonth.set(run.month, run)
    }

    // 3. Build impact rows only for changes where a payroll run exists
    const now = new Date().toISOString()
    const impactRows = changes
      .filter((c) => runsByMonth.has(c.date.slice(0, 7)))
      .map((c) => {
        const run = runsByMonth.get(c.date.slice(0, 7))!
        return {
          tenant_id:          req.tenantId,
          employee_id:        c.employee_id,
          date:               c.date,
          impact_type:        c.source === 'regularisation' ? 'correction_after_payroll' : 'leave_after_payroll',
          trigger_source:     c.source,
          propagation_status: 'propagating',
          before_value:       c.before_status,
          after_value:        c.after_status,
          payroll_run_id:     run.id,
          note:               `Audit log id: ${c.id}. Payroll run month: ${run.month}, status: ${run.status}`,
          created_at:         now,
          updated_at:         now,
        }
      })

    let inserted = 0

    if (impactRows.length > 0) {
      const { error: insertError, data: insertedData } = await fastify.supabase
        .from('attendance_retroactive_impacts')
        .insert(impactRows)
        .select('id')

      if (insertError) {
        req.log.error({ err: insertError }, 'retroactive detect insert failed')
        return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to insert retroactive impact records' })
      }

      inserted = (insertedData ?? []).length
    }

    return reply.send({ detected: impactRows.length, inserted })
  })

  // ── PUT /attendance/retroactive/:id/status ────────────────────────────────────
  fastify.put('/attendance/retroactive/:id/status', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const parsed = updateStatusBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { propagation_status } = parsed.data

    const { data, error } = await fastify.supabase
      .from('attendance_retroactive_impacts')
      .update({
        propagation_status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, impact_id: id }, 'retroactive status update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update propagation status' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Retroactive impact record not found' })
    }

    return reply.send({ data })
  })
}
