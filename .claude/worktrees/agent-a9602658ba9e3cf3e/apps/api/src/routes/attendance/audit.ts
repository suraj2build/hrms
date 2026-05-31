/**
 * Attendance Audit Log
 *
 * GET /attendance/audit
 *
 * Query params:
 *   from        — YYYY-MM-DD (filter by date ≥)
 *   to          — YYYY-MM-DD (filter by date ≤)
 *   employee_id — UUID (optional; filter to one employee)
 *   source      — 'system' | 'regularisation' | 'leave' (optional)
 *   limit       — 1–200, default 100
 *   offset      — default 0
 *
 * Access: hr_admin and super_admin only.
 * Returns paginated rows with employee name and changed_by name.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const querySchema = z.object({
  from:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  employee_id: z.string().uuid().optional(),
  source:      z.enum(['system', 'regularisation', 'leave']).optional(),
  limit:       z.coerce.number().int().min(1).max(200).default(100),
  offset:      z.coerce.number().int().min(0).default(0),
})

export default async function attendanceAuditRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/audit ─────────────────────────────────────────────────────
  fastify.get('/attendance/audit', auth, async (req: any, reply) => {
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

    const { from, to, employee_id, source, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('attendance_audit_log')
      .select(
        `
        id, date, source, before_status, after_status, created_at, metadata,
        employees!inner(id, first_name, last_name, employee_code),
        profiles(id, full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from)        q = q.gte('date', from)
    if (to)          q = q.lte('date', to)
    if (employee_id) q = q.eq('employee_id', employee_id)
    if (source)      q = q.eq('source', source)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance audit query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch audit log' })
    }

    const rows = (data ?? []).map((r: any) => ({
      id:              r.id,
      date:            r.date,
      source:          r.source,
      before_status:   r.before_status,
      after_status:    r.after_status,
      created_at:      r.created_at,
      metadata:        r.metadata,
      employee_id:     r.employees?.id           ?? null,
      employee_name:   r.employees
        ? `${r.employees.first_name} ${r.employees.last_name}`
        : null,
      employee_code:   r.employees?.employee_code ?? null,
      changed_by_name: r.profiles?.full_name      ?? null,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })
}
