/**
 * POST /attendance/recompute
 *
 * Manually trigger an AttendanceEngine recompute for a date range.
 *
 * If `employee_id` is provided, recompute only that employee (synchronous).
 * Otherwise, recompute ALL active employees in the tenant for the date range
 * (background 202: returns immediately, updates attendance_recompute_runs).
 *
 * Protected: hr_admin / super_admin only.
 *
 * GET /attendance/recompute/runs
 * Returns the 10 most recent recompute run records for this tenant.
 * Used by the Muster Roll UI to show run status without polling the muster data.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange }              from '../../lib/attendance-engine.js'
import { fetchAllRows }                from '../../lib/supabase-paginate.js'
import { assertRangeNotFinalized, PeriodLockedError } from '../../lib/period-lock.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  employee_id: z.string().uuid().optional(),
  from_date:   z.string().regex(dateRe, 'from_date must be YYYY-MM-DD'),
  to_date:     z.string().regex(dateRe, 'to_date must be YYYY-MM-DD'),
})

export default async function attendanceRecomputeRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /attendance/recompute/runs ─────────────────────────────────────────
  fastify.get('/attendance/recompute/runs', adminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('attendance_recompute_runs')
      .select('run_id, trigger_source, from_date, to_date, employees_queued, employees_succeeded, employees_failed, rows_upserted, rows_protected, status, error_summary, started_at, finished_at')
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .limit(10)

    if (error) {
      req.log.error({ err: error }, 'recompute/runs query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch recompute runs' })
    }

    return reply.send({ runs: data ?? [] })
  })

  // ── POST /attendance/recompute ─────────────────────────────────────────────
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

        // Write a completed run record so it shows up in the runs list
        await fastify.supabase
          .from('attendance_recompute_runs')
          .insert({
            tenant_id:           req.tenantId,
            triggered_by:        req.userId,
            trigger_source:      'single_employee',
            from_date,
            to_date,
            employees_queued:    1,
            employees_succeeded: 1,
            employees_failed:    0,
            rows_upserted:       result.rows_upserted,
            rows_protected:      result.rows_protected,
            status:              'completed',
            finished_at:         new Date().toISOString(),
          })

        return reply.send({
          employees_processed: 1,
          rows_upserted:       result.rows_upserted,
          rows_protected:      result.rows_protected,
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
    //
    // fetchAllRows is robust at any server-side max-rows value: it advances by
    // the rows actually received and stops only on an empty page. (The previous
    // inline loop stopped on a short page — silently truncating the employee
    // list whenever max-rows < 1000, so recompute skipped most employees.)
    let empIds: string[]
    try {
      const empRows = await fetchAllRows<{ id: string }>((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .order('id')
          .range(from, to) as any,
      )
      empIds = empRows.map((e) => e.id)
    } catch (empErr: any) {
      req.log.error({ err: empErr }, 'failed to fetch employees for recompute')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
    }

    if (empIds.length === 0) {
      return reply.code(200).send({
        status:           'completed',
        employees_queued: 0,
        from_date,
        to_date,
      })
    }

    // Create the run record before returning 202 so the UI can poll it
    let runId: string | null = null
    {
      const { data: runRow, error: runErr } = await fastify.supabase
        .from('attendance_recompute_runs')
        .insert({
          tenant_id:        req.tenantId,
          triggered_by:     req.userId,
          trigger_source:   'process_button',
          from_date,
          to_date,
          employees_queued: empIds.length,
          status:           'running',
        })
        .select('run_id')
        .single()
      if (runErr) {
        req.log.warn({ err: runErr }, 'recompute: failed to create run log row — continuing without observability')
      } else {
        runId = (runRow as any).run_id
      }
    }

    reply.code(202).send({
      status:           'processing',
      run_id:           runId,
      employees_queued: empIds.length,
      from_date,
      to_date,
      message: `Recomputing attendance for ${empIds.length} employees. Check run status via GET /attendance/recompute/runs.`,
    })

    // Background recompute — runs after the HTTP response is flushed.
    // Capture everything we need before the request object may be GC'd.
    const tenantId  = req.tenantId
    const userId    = req.userId
    const log       = req.log

    setImmediate(async () => {
      const CONCURRENCY = 16
      let totalUpserted  = 0
      let totalProtected = 0
      let failedCount    = 0
      // Collect up to 100 per-employee errors for the error_summary JSONB column
      const errors: Array<{ employee_id: string; error: string }> = []

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
        for (let j = 0; j < results.length; j++) {
          const r     = results[j]!
          const empId = batch[j]!
          if (r.status === 'fulfilled') {
            totalUpserted  += r.value.rows_upserted
            totalProtected += r.value.rows_protected
          } else {
            failedCount++
            const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason)
            log.warn({ empId, from_date, to_date, err: errMsg }, 'bulk recompute: employee failed')
            if (errors.length < 100) {
              errors.push({ employee_id: empId, error: errMsg })
            }
          }
        }
      }

      const succeeded   = empIds.length - failedCount
      const finalStatus = failedCount === 0
        ? 'completed'
        : failedCount === empIds.length
          ? 'failed'
          : 'partial'

      log.info({
        event:         'bulk_recompute_done',
        run_id:        runId,
        from_date,
        to_date,
        employees:     empIds.length,
        succeeded,
        failed:        failedCount,
        rows_upserted: totalUpserted,
        rows_protected: totalProtected,
        status:        finalStatus,
      }, 'bulk recompute: done')

      if (runId) {
        const { error: updateErr } = await fastify.supabase
          .from('attendance_recompute_runs')
          .update({
            employees_succeeded: succeeded,
            employees_failed:    failedCount,
            rows_upserted:       totalUpserted,
            rows_protected:      totalProtected,
            status:              finalStatus,
            error_summary:       errors.length > 0 ? errors : null,
            finished_at:         new Date().toISOString(),
          })
          .eq('run_id', runId)
        if (updateErr) {
          log.warn({ err: updateErr, run_id: runId }, 'recompute: failed to update run log row')
        }
      }
    })
  })
}
