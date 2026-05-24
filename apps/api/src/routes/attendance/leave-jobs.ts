/**
 * Leave Job Trigger Endpoints
 *
 * Allows HR admins to manually trigger any leave job and inspect job history.
 * The same handlers used by the internal scheduler — HTTP just wraps them.
 *
 * All endpoints require hr_admin / super_admin role.
 *
 * GET  /leave/jobs                     — list last 20 runs for this tenant
 * GET  /leave/jobs/:jobId              — single run detail
 * POST /leave/jobs/monthly-accrual     — { year, month }
 * POST /leave/jobs/co-expiry           — { as_of? }   (default: today)
 * POST /leave/jobs/carry-forward       — { from_year, to_year }
 * POST /leave/jobs/recalculate         — { leave_type_id, year }
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  monthlyAccrualJob,
  yearlyAccrualJob,
  coExpiryJob,
  carryForwardJob,
  policyRecalculateJob,
} from '../../lib/leave-jobs.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function leaveJobsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /leave/jobs — list recent runs ───────────────────────────────────────
  fastify.get('/leave/jobs', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { data, error } = await fastify.supabase
      .from('leave_job_log')
      .select('id, job_type, status, started_at, completed_at, duration_ms, params, result, error_msg')
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .limit(20)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── GET /leave/jobs/:jobId — single run ──────────────────────────────────────
  fastify.get('/leave/jobs/:jobId', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { jobId } = req.params as { jobId: string }

    const { data, error } = await fastify.supabase
      .from('leave_job_log')
      .select('*')
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Job run not found' })
    return reply.send({ data })
  })

  // ── POST /leave/jobs/monthly-accrual ─────────────────────────────────────────
  fastify.post('/leave/jobs/monthly-accrual', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      year:  z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await monthlyAccrualJob(
      fastify.supabase,
      req.tenantId,
      parsed.data.year,
      parsed.data.month,
      req.userId,
    )

    return reply.send({
      data: result,
      message: `Monthly accrual ${result.status}: ${result.employees_processed} employees credited ${result.total_days_credited} days`,
    })
  })

  // ── POST /leave/jobs/yearly-accrual ─────────────────────────────────────────
  fastify.post('/leave/jobs/yearly-accrual', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      leave_year: z.number().int().min(2000).max(2100),
      as_of:      z.string().regex(dateRe).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await yearlyAccrualJob(
      fastify.supabase,
      req.tenantId,
      parsed.data.leave_year,
      req.userId,
      parsed.data.as_of,
    )

    return reply.send({
      data: result,
      message: `Yearly accrual ${result.status}: ${result.employees_processed} employees credited ${result.total_days_credited} days`,
    })
  })

  // ── POST /leave/jobs/co-expiry ───────────────────────────────────────────────
  fastify.post('/leave/jobs/co-expiry', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      as_of: z.string().regex(dateRe).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const asOf = parsed.data.as_of
      ? new Date(`${parsed.data.as_of}T12:00:00.000Z`)
      : new Date()

    const result = await coExpiryJob(fastify.supabase, req.tenantId, asOf, req.userId)

    const expired = -result.total_days_credited   // positive number for display
    return reply.send({
      data: result,
      message: `CO expiry ${result.status}: ${result.employees_processed} employees, ${expired} day(s) expired`,
    })
  })

  // ── POST /leave/jobs/carry-forward ───────────────────────────────────────────
  fastify.post('/leave/jobs/carry-forward', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      from_year: z.number().int().min(2000).max(2100),
      to_year:   z.number().int().min(2000).max(2100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { from_year, to_year } = parsed.data
    if (to_year !== from_year + 1) {
      return reply.code(400).send({
        error:   'INVALID_YEARS',
        message: '`to_year` must be exactly `from_year + 1`',
      })
    }

    const result = await carryForwardJob(
      fastify.supabase, req.tenantId, from_year, to_year, req.userId,
    )

    return reply.send({
      data: result,
      message: `Carry-forward ${result.status}: ${result.employees_processed} employees, ${result.total_days_credited} days carried`,
    })
  })

  // ── POST /leave/jobs/recalculate ─────────────────────────────────────────────
  fastify.post('/leave/jobs/recalculate', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      leave_type_id: z.string().uuid(),
      year:          z.number().int().min(2000).max(2100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await policyRecalculateJob(
      fastify.supabase, req.tenantId,
      parsed.data.leave_type_id, parsed.data.year, req.userId,
    )

    const sign  = result.total_days_credited >= 0 ? '+' : ''
    return reply.send({
      data: result,
      message: `Policy recalculate ${result.status}: ${result.employees_processed} adjusted (${sign}${result.total_days_credited} days net)`,
    })
  })
}
