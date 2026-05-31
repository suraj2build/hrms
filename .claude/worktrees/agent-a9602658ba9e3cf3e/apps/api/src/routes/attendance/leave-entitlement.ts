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

export default async function leaveEntitlementRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
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

    const result = await runMonthlyAccrual(
      fastify.supabase,
      req.tenantId,
      parsed.data.year,
      parsed.data.month,
    )

    return reply.send({
      data: result,
      message: `Monthly accrual complete — ${result.employees_processed} employees credited, ${result.total_days_credited} days total`,
    })
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

    const result = await runYearlyCredit(
      fastify.supabase,
      req.tenantId,
      parsed.data.leave_year,
    )

    return reply.send({
      data: result,
      message: `Yearly credit complete — ${result.employees_processed} employees credited, ${result.total_days_credited} days total`,
    })
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

    const result = await runCarryForward(
      fastify.supabase,
      req.tenantId,
      from_year,
      to_year,
    )

    return reply.send({
      data: result,
      message: `Carry-forward complete — ${result.employees_processed} employees processed, ${result.total_days_credited} days carried`,
    })
  })
}
