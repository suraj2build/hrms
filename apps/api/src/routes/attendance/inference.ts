/**
 * Attendance Inference Routes
 *
 * GET  /attendance/inference                       — List inference log entries
 * GET  /attendance/inference/employee/:employeeId  — Inference history for one employee
 * POST /attendance/inference/:logId/approve        — HR approves an inference record (admin only)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const listQuerySchema = z.object({
  employee_id:    z.string().uuid().optional(),
  from:           z.string().regex(dateRe).optional(),
  to:             z.string().regex(dateRe).optional(),
  inference_type: z.string().optional(),
  limit:          z.coerce.number().int().min(1).max(200).default(100),
  offset:         z.coerce.number().int().min(0).default(0),
})

const employeeQuerySchema = z.object({
  from: z.string().regex(dateRe).optional(),
  to:   z.string().regex(dateRe).optional(),
})

function nDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function attendanceInferenceRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /attendance/inference ─────────────────────────────────────────────────
  fastify.get('/attendance/inference', auth, async (req: any, reply) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from, to, inference_type, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('attendance_inference_log')
      .select(
        `
          id, date, inference_type,
          confidence_penalty:inference_confidence_penalty,
          reason:inference_reason, inference_explanation,
          approved_by, approved_at, created_at,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employee_id)    q = q.eq('employee_id', employee_id)
    if (from)           q = q.gte('date', from)
    if (to)             q = q.lte('date', to)
    if (inference_type) q = q.eq('inference_type', inference_type)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance_inference_log query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch inference log' })
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

  // ── GET /attendance/inference/employee/:employeeId ────────────────────────────
  fastify.get('/attendance/inference/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const parsed = employeeQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const from = parsed.data.from ?? nDaysAgo(60)
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
      .from('attendance_inference_log')
      .select(
        'id, date, inference_type, confidence_penalty:inference_confidence_penalty, reason:inference_reason, inference_explanation, approved_by, approved_at, created_at',
      )
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .gte('date', from)
      .lte('date', to)
      .order('created_at', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'inference employee query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch inference history' })
    }

    const rows = (data ?? []) as Array<{
      id: string
      date: string
      inference_type: string
      confidence_penalty: number | null
      reason: string | null
      inference_explanation: string | null
      approved_by: string | null
      approved_at: string | null
      created_at: string
    }>

    const total_inferences = rows.length

    const penalties = rows.filter((r) => r.confidence_penalty != null).map((r) => r.confidence_penalty as number)
    const avg_confidence_penalty = penalties.length > 0
      ? Math.round((penalties.reduce((s, v) => s + v, 0) / penalties.length) * 1000) / 1000
      : null

    // Most common inference_type
    const typeCount: Record<string, number> = {}
    for (const r of rows) {
      typeCount[r.inference_type] = (typeCount[r.inference_type] ?? 0) + 1
    }
    const most_common_type = Object.keys(typeCount).sort((a, b) => typeCount[b] - typeCount[a])[0] ?? null

    return reply.send({
      data: rows,
      stats: {
        total_inferences,
        avg_confidence_penalty,
        most_common_type,
      },
    })
  })

  // ── POST /attendance/inference/:logId/approve ─────────────────────────────────
  fastify.post('/attendance/inference/:logId/approve', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { logId } = req.params as { logId: string }

    const { data, error } = await fastify.supabase
      .from('attendance_inference_log')
      .update({
        approved_by: req.userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', logId)
      .eq('tenant_id', req.tenantId)
      .select()
      .maybeSingle()

    if (error) {
      req.log.error({ err: error, log_id: logId }, 'inference approve failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to approve inference record' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Inference log entry not found' })
    }

    return reply.send({ data })
  })
}
