/**
 * POST /attendance/recompute
 *
 * Manually trigger an AttendanceEngine recompute for a date range.
 *
 * If `employee_id` is provided, recompute only that employee.
 * Otherwise, recompute ALL active employees in the tenant for the date range
 * (runs in parallel, bounded to the given date window).
 *
 * Protected: hr_admin / super_admin only.
 *
 * Response:
 *   { employees_processed, rows_upserted, from_date, to_date, duration_ms }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange }              from '../../lib/attendance-engine.js'
import { assertRangeNotFinalized, PeriodLockedError } from '../../lib/period-lock.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  employee_id: z.string().uuid().optional(),
  from_date:   z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
  to_date:     z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
})

export default async function attendanceRecomputeRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.post('/attendance/recompute', adminAuth, async (req: any, reply) => {

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, from_date, to_date } = parsed.data

    if (from_date > to_date) {
      return reply.code(400).send({
        error:   'INVALID_DATES',
        message: 'from_date must be ≤ to_date',
      })
    }

    // Period protection — refuse to recompute only if payroll is fully finalized.
    // LOCKED / PAYROLL_PROCESSING months are still recomputable by HR admins;
    // migration 262's DB trigger is the hard backstop for PAYROLL_FINALIZED.
    try {
      await assertRangeNotFinalized(fastify.supabase, req.tenantId, from_date, to_date)
    } catch (err) {
      if (err instanceof PeriodLockedError) {
        return reply.code(409).send({ error: 'PERIOD_LOCKED', message: err.message })
      }
      throw err
    }

    const started = Date.now()

    // ── Single employee ───────────────────────────────────────────────────────
    if (employee_id) {
      // Verify the employee belongs to the caller's tenant
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('id', employee_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      try {
        const result = await recomputeRange(fastify.supabase, {
          tenant_id:   req.tenantId,
          employee_id,
          from_date,
          to_date,
          changed_by:  req.userId,
        })

        return reply.send({
          employees_processed: 1,
          rows_upserted:       result.rows_upserted,
          from_date,
          to_date,
          duration_ms: Date.now() - started,
        })
      } catch (err) {
        req.log.error({ err, employee_id, from_date, to_date }, 'recompute failed')
        return reply.code(500).send({ error: 'RECOMPUTE_FAILED', message: 'Recompute failed' })
      }
    }

    // ── All active employees — runs in background, returns 202 immediately ───────
    // For large tenants (1000+ employees × 30 days) the loop takes 5–20 minutes,
    // far exceeding Railway's HTTP timeout.  We return 202 immediately and let
    // setImmediate carry the work so the HTTP response is never held.
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) {
      req.log.error({ err: empErr }, 'failed to fetch employees for recompute')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
    }

    const empIds = ((employees ?? []) as Array<{ id: string }>).map((e) => e.id)

    if (empIds.length === 0) {
      return reply.code(200).send({
        status:              'completed',
        employees_queued:    0,
        from_date,
        to_date,
      })
    }

    // Return 202 before the loop starts so the HTTP connection is released.
    reply.code(202).send({
      status:           'processing',
      employees_queued: empIds.length,
      from_date,
      to_date,
      message: `Recomputing attendance for ${empIds.length} employees. Refresh the muster roll in a few minutes.`,
    })

    // Background recompute — runs after the response is flushed.
    const tenantId  = req.tenantId
    const userId    = req.userId
    const log       = req.log
    setImmediate(async () => {
      const CONCURRENCY = 16
      let totalUpserted = 0
      let failedCount   = 0

      for (let i = 0; i < empIds.length; i += CONCURRENCY) {
        const batch = empIds.slice(i, i + CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map((empId) =>
            recomputeRange(fastify.supabase, {
              tenant_id:   tenantId,
              employee_id: empId,
              from_date,
              to_date,
              changed_by:  userId,
            }),
          ),
        )
        for (const r of results) {
          if (r.status === 'fulfilled') {
            totalUpserted += r.value.rows_upserted
          } else {
            failedCount++
            log.warn({ reason: r.reason }, 'bulk recompute: one employee failed')
          }
        }
      }

      log.info({ employees: empIds.length, failed: failedCount, rows_upserted: totalUpserted, from_date, to_date }, 'bulk recompute: done')
    })
  })
}
