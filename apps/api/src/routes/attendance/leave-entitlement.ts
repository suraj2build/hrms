/**
 * Leave Entitlement Operations — admin-triggered batch jobs
 *
 * Endpoints:
 *   POST /leave/entitlement/monthly        – run monthly accrual for a month
 *   POST /leave/entitlement/yearly         – credit full year entitlement at year start
 *   POST /leave/entitlement/carry-forward  – year-end: move balance to next year
 *
 * Access: hr_admin / super_admin only
 *
 * These endpoints trigger the entitlement engine (leave-entitlement-service.ts)
 * and return a BatchResult describing what was credited.
 *
 * Typical usage:
 *   • Scheduled job calls POST /leave/entitlement/monthly on the 1st of each month
 *   • POST /leave/entitlement/yearly called once at year start (Jan 1 or Apr 1)
 *   • POST /leave/entitlement/carry-forward called once at year end (Dec 31 or Mar 31)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  runMonthlyAccrual,
  runYearlyCredit,
  runCarryForward,
}                               from '../../lib/leave-entitlement-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { checkIdempotency, storeIdempotency, claimIdempotency, releaseIdempotencyClaim } from '../../lib/idempotency.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function leaveEntitlementRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── POST /leave/entitlement/monthly ───────────────────────────────────────
  // Credit 1/12th of the annual entitlement to all eligible employees.
  // Body: { year: number, month: number }  — month is 1-indexed (1 = Jan)
  fastify.post('/leave/entitlement/monthly', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      year:  z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // This batch job double-credits every eligible employee if run twice for
    // the same month (creditEmployeeDays has no run-dedup of its own). A
    // plain check-then-work-then-store Idempotency-Key guard still has a
    // race window between the check and the eventual store — two requests
    // with the same key arriving close together (client retry, double-click)
    // can both miss the cache and both run the accrual. Claim the key
    // atomically before doing the work so a concurrent duplicate is rejected
    // outright instead of racing.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    const scope = 'leave-entitlement-monthly'
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
      const claimed = await claimIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (!claimed) {
        return reply.code(409).send({ error: 'DUPLICATE_REQUEST', message: 'An identical request is already being processed' })
      }
    }

    let result
    try {
      result = await runMonthlyAccrual(
        fastify.supabase,
        req.tenantId,
        parsed.data.year,
        parsed.data.month,
      )
    } catch (err: unknown) {
      if (iKey) await releaseIdempotencyClaim(fastify.supabase, req.tenantId, iKey, scope)
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to run monthly accrual')
    }

    const responseBody = {
      data: result,
      message: `Monthly accrual complete — ${result.employees_processed} employees credited, ${result.total_days_credited} days total`,
    }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, scope, 200, responseBody)
    return reply.send(responseBody)
  })

  // ── POST /leave/entitlement/yearly ────────────────────────────────────────
  // Credit the full (prorated) annual entitlement at year start.
  // Body: { leave_year: number }
  fastify.post('/leave/entitlement/yearly', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      leave_year: z.number().int().min(2000).max(2100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // Same double-credit risk as /monthly — claim the key atomically so a
    // concurrent duplicate request is rejected instead of racing past the
    // cache check and running the credit twice.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    const scope = 'leave-entitlement-yearly'
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
      const claimed = await claimIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (!claimed) {
        return reply.code(409).send({ error: 'DUPLICATE_REQUEST', message: 'An identical request is already being processed' })
      }
    }

    let result
    try {
      result = await runYearlyCredit(
        fastify.supabase,
        req.tenantId,
        parsed.data.leave_year,
      )
    } catch (err: unknown) {
      if (iKey) await releaseIdempotencyClaim(fastify.supabase, req.tenantId, iKey, scope)
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to run yearly credit')
    }

    const responseBody = {
      data: result,
      message: `Yearly credit complete — ${result.employees_processed} employees credited, ${result.total_days_credited} days total`,
    }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, scope, 200, responseBody)
    return reply.send(responseBody)
  })

  // ── POST /leave/entitlement/carry-forward ─────────────────────────────────
  // Move eligible remaining balance from fromYear to toYear.
  // Body: { from_year: number, to_year: number }  — to_year must = from_year + 1
  fastify.post('/leave/entitlement/carry-forward', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const schema = z.object({
      from_year: z.number().int().min(2000).max(2100),
      to_year:   z.number().int().min(2000).max(2100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { from_year, to_year } = parsed.data
    if (to_year !== from_year + 1) {
      return reply.code(400).send({
        error:   'INVALID_YEARS',
        message: '`to_year` must be exactly `from_year + 1`',
      })
    }

    // runCarryForward's own docstring: "running it twice would double-credit
    // ... Run it exactly once." Claim the key atomically before doing the
    // work — a plain check-then-store guard has a race window where two
    // requests with the same key can both miss the cache and both run the
    // carry-forward (a deliberate second run days apart is still an
    // operator responsibility this doesn't protect against).
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    const scope = 'leave-entitlement-carry-forward'
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
      const claimed = await claimIdempotency(fastify.supabase, req.tenantId, iKey, scope)
      if (!claimed) {
        return reply.code(409).send({ error: 'DUPLICATE_REQUEST', message: 'An identical request is already being processed' })
      }
    }

    let result
    try {
      result = await runCarryForward(
        fastify.supabase,
        req.tenantId,
        from_year,
        to_year,
      )
    } catch (err: unknown) {
      if (iKey) await releaseIdempotencyClaim(fastify.supabase, req.tenantId, iKey, scope)
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to run carry-forward')
    }

    const responseBody = {
      data: result,
      message: `Carry-forward complete — ${result.employees_processed} employees processed, ${result.total_days_credited} days carried`,
    }
    if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, scope, 200, responseBody)
    return reply.send(responseBody)
  })
}
