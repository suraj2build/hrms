/**
 * Attendance Exceptions Routes
 *
 * GET  /attendance/exceptions           — List exceptions with filters (admin only)
 * GET  /attendance/exceptions/summary   — Counts by category and severity (admin only)
 * POST /attendance/exceptions           — Manually create an exception (admin only)
 * PUT  /attendance/exceptions/:id       — Update status / resolve (admin only)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { EXCEPTION_TAXONOMY, getExceptionMeta, computeSlaAt } from '../../lib/exception-taxonomy.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, forbidden, ErrorCode } from '../../lib/api-errors.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const EXCEPTION_STATUSES = ['open', 'acknowledged', 'resolved', 'escalated', 'dismissed'] as const
const EXCEPTION_CATEGORIES = ['punch', 'shift', 'roster', 'policy', 'device', 'geo', 'integrity', 'payroll'] as const
const EXCEPTION_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

const listQuerySchema = z.object({
  employee_id:           z.string().uuid().optional(),
  date_from:             z.string().regex(dateRe).optional(),
  date_to:               z.string().regex(dateRe).optional(),
  category:              z.enum(EXCEPTION_CATEGORIES).optional(),
  severity:              z.enum(EXCEPTION_SEVERITIES).optional(),
  status:                z.enum(EXCEPTION_STATUSES).optional(),
  payroll_impacting:     z.enum(['true', 'false']).optional(),
  requires_investigation:z.enum(['true', 'false']).optional(),
  sla_breached:          z.enum(['true', 'false']).optional(),
  limit:                 z.coerce.number().int().min(1).max(200).default(100),
  offset:                z.coerce.number().int().min(0).default(0),
})

const summaryQuerySchema = z.object({
  date_from: z.string().regex(dateRe).optional(),
  date_to:   z.string().regex(dateRe).optional(),
})

const createBodySchema = z.object({
  employee_id:    z.string().uuid(),
  date:           z.string().regex(dateRe),
  exception_type: z.string().min(1),
  note:           z.string().max(1000).optional(),
})

const updateBodySchema = z.object({
  status:          z.enum(EXCEPTION_STATUSES),
  resolution_note: z.string().max(1000).optional(),
})

export default async function attendanceExceptionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/exceptions ────────────────────────────────────────────────
  // HR admin only — every consumer (ExceptionGovernance.tsx, ControlCenter.tsx)
  // is an admin-only page; this route previously had no role check at all,
  // so any authenticated employee could list every exception tenant-wide
  // (or target a specific coworker via ?employee_id=) with no filter.
  fastify.get('/attendance/exceptions', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return forbidden(reply, 'FORBIDDEN', 'HR admin access required')
    }

    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const {
      employee_id, date_from, date_to, category, severity, status,
      payroll_impacting, requires_investigation, sla_breached,
      limit, offset,
    } = parsed.data

    let q = fastify.supabase
      .from('attendance_exceptions')
      .select(
        `
          id, date, exception_type, exception_category, severity, status,
          payroll_impacting, requires_investigation, sla_due_at, sla_breached,
          source, resolution_note, resolved_by, resolved_at,
          created_at, updated_at,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employee_id)            q = q.eq('employee_id', employee_id)
    if (date_from)              q = q.gte('date', date_from)
    if (date_to)                q = q.lte('date', date_to)
    if (category)               q = q.eq('exception_category', category)
    if (severity)               q = q.eq('severity', severity)
    if (status)                 q = q.eq('status', status)
    if (payroll_impacting)      q = q.eq('payroll_impacting', payroll_impacting === 'true')
    if (requires_investigation) q = q.eq('requires_investigation', requires_investigation === 'true')
    if (sla_breached)           q = q.eq('sla_breached', sla_breached === 'true')

    const { data, error, count } = await q

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch exceptions')
    }

    const rows = ((data ?? []) as Array<Record<string, any>>).map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        ...r,
        employees:          undefined,
        category:           r.exception_category ?? null,  // alias for API consumers
        employee_id:        emp?.id            ?? null,
        employee_name:      emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:      emp?.employee_code ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/exceptions/summary ────────────────────────────────────────
  fastify.get('/attendance/exceptions/summary', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return forbidden(reply, 'FORBIDDEN', 'HR admin access required')
    }

    const parsed = summaryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { date_from, date_to } = parsed.data

    let rows: Array<{
      id: string
      exception_category: string
      severity: string
      status: string
      payroll_impacting: boolean
      sla_breached: boolean
      requires_investigation: boolean
    }>
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('attendance_exceptions')
          .select(
            'id, exception_category, severity, status, payroll_impacting, sla_breached, requires_investigation',
          )
          .eq('tenant_id', req.tenantId)
          .in('status', ['open', 'acknowledged'])

        if (date_from) q = q.gte('date', date_from)
        if (date_to)   q = q.lte('date', date_to)

        return q.range(from, to)
      }) as Array<{
        id: string
        exception_category: string
        severity: string
        status: string
        payroll_impacting: boolean
        sla_breached: boolean
        requires_investigation: boolean
      }>
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch exceptions summary')
    }

    // by_category/by_severity are consumed by ExceptionGovernance.tsx as arrays
    // ({category|severity, count, open_count}) — count/open_count are tracked
    // separately per category (this endpoint's own query already scopes to
    // 'open'/'acknowledged'; open_count narrows further to status === 'open').
    const categoryCounts = new Map<string, { count: number; open_count: number }>()
    const severityCounts = new Map<string, number>()
    let total_payroll_impacting = 0
    let total_sla_breached = 0
    let requires_investigation = 0

    for (const row of rows) {
      const cat = categoryCounts.get(row.exception_category) ?? { count: 0, open_count: 0 }
      cat.count++
      if (row.status === 'open') cat.open_count++
      categoryCounts.set(row.exception_category, cat)

      severityCounts.set(row.severity, (severityCounts.get(row.severity) ?? 0) + 1)

      if (row.payroll_impacting)    total_payroll_impacting++
      if (row.sla_breached)         total_sla_breached++
      if (row.requires_investigation) requires_investigation++
    }

    return reply.send({
      data: {
        by_category: Array.from(categoryCounts.entries()).map(([category, v]) => ({ category, ...v })),
        by_severity: Array.from(severityCounts.entries()).map(([severity, count]) => ({ severity, count })),
        total_open:             rows.length,
        total_payroll_impacting,
        total_sla_breached,
        requires_investigation,
      },
    })
  })

  // ── POST /attendance/exceptions ───────────────────────────────────────────────
  fastify.post('/attendance/exceptions', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = createBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, date, exception_type, note } = parsed.data

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const meta = getExceptionMeta(exception_type)
    const now = new Date()
    const slaDue = computeSlaAt(now, meta.slaHours)

    const { data: inserted, error } = await fastify.supabase
      .from('attendance_exceptions')
      .insert({
        tenant_id:              req.tenantId,
        employee_id,
        date,
        exception_type,
        exception_category:     meta.category,
        severity:               meta.defaultSeverity,
        status:                 'open',
        payroll_impacting:      meta.payrollImpacting,
        requires_investigation: meta.requiresInvestigation,
        sla_due_at:             slaDue?.toISOString() ?? null,
        sla_breached:           false,
        source:                 'manual',
        resolution_note:        note ?? null,
        created_at:             now.toISOString(),
        updated_at:             now.toISOString(),
      })
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'attendance_exceptions insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create exception' })
    }

    return reply.code(201).send({ data: inserted })
  })

  // ── PUT /attendance/exceptions/:id ────────────────────────────────────────────
  fastify.put('/attendance/exceptions/:id', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { status, resolution_note } = parsed.data

    // Fetch current row to check sla_due_at
    const { data: existing, error: existingErr } = await fastify.supabase
      .from('attendance_exceptions')
      .select('id, status, sla_due_at, sla_breached')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (existingErr) return serverError(req, reply, existingErr, ErrorCode.QUERY_FAILED, 'Failed to fetch exception')
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Exception not found' })
    }

    const now = new Date()
    const updates: Record<string, unknown> = {
      status,
      resolution_note: resolution_note ?? null,
      updated_at:      now.toISOString(),
    }

    if (status === 'resolved') {
      updates.resolved_by = req.userId
      updates.resolved_at = now.toISOString()

      // If resolved past SLA due date, ensure sla_breached stays true
      if (existing.sla_due_at && new Date(existing.sla_due_at) < now) {
        updates.sla_breached = true
      }
    }

    // Fold "not already in a terminal state" into the UPDATE's own WHERE
    // clause — the read above is advisory only; without this, two admins
    // acting concurrently on the same exception (e.g. one resolves while
    // another dismisses) could both succeed, the second silently
    // overwriting the first's status/resolution_note/resolved_by with no
    // conflict surfaced, matching the race class already closed for
    // corrections.ts's approve/retry/reject transitions.
    const { data, error } = await fastify.supabase
      .from('attendance_exceptions')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .not('status', 'in', '("resolved","dismissed")')
      .select()
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, exception_id: id }, 'attendance_exceptions update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update exception' })
    }
    if (!data) {
      return reply.code(409).send({ error: 'CONFLICT', message: 'This exception was already resolved or dismissed' })
    }

    return reply.send({ data })
  })
}
