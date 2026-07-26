/**
 * routes/compliance — statutory deadline calendar (P2.1).
 *
 * Thin read-only API over the single ComplianceCalendarService. No deadline
 * logic lives here; both endpoints delegate to the service so the calendar and
 * the alert generators share one source of truth.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeComplianceCalendar, computeUpcoming } from '../../lib/compliance-calendar.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

export default async function complianceRoutes(fastify: FastifyInstance) {
  // HR admin only — this surfaces statutory registration numbers and filing
  // challan/reference numbers tenant-wide (ComplianceView.tsx, payroll's
  // ComplianceCalendar.tsx are both admin-only pages). Previously gated by
  // fastify.authenticate alone, so any authenticated employee of any role
  // could call these directly with no defense-in-depth from the API itself.
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /compliance/calendar — full window with status buckets + counts
  fastify.get('/calendar', auth, async (req: any, reply) => {
    const qs = z.object({
      back_months: z.coerce.number().int().min(0).max(12).optional(),
      fwd_months:  z.coerce.number().int().min(0).max(12).optional(),
    }).safeParse(req.query)

    const deadlines = await computeComplianceCalendar(fastify.supabase, req.tenantId, {
      backMonths: qs.success ? qs.data.back_months : undefined,
      fwdMonths:  qs.success ? qs.data.fwd_months : undefined,
    })

    const counts = {
      upcoming:  deadlines.filter(d => d.status === 'upcoming').length,
      due_soon:  deadlines.filter(d => d.status === 'due_soon').length,
      overdue:   deadlines.filter(d => d.status === 'overdue').length,
      completed: deadlines.filter(d => d.status === 'completed').length,
    }

    return reply.send({ data: deadlines, counts })
  })

  // GET /compliance/calendar/upcoming — actionable (due within N days + all overdue)
  fastify.get('/calendar/upcoming', auth, async (req: any, reply) => {
    const qs = z.object({ within_days: z.coerce.number().int().min(1).max(120).optional() }).safeParse(req.query)
    const within = qs.success && qs.data.within_days ? qs.data.within_days : 30
    const deadlines = await computeUpcoming(fastify.supabase, req.tenantId, within)
    return reply.send({ data: deadlines, within_days: within })
  })
}
