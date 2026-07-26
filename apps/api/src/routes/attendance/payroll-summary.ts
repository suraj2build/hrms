/**
 * Payroll Summary Route
 *
 * GET /attendance/payroll-summary?month=YYYY-MM
 *
 * Aggregates attendance_daily per employee for a given month and returns
 * per-employee totals alongside a tenant-wide summary for StatCards.
 *
 * ── Source of truth ────────────────────────────────────────────────────────
 * All aggregation is delegated to attendance-read-model.ts.
 *
 * Previous implementation queried is_payable + day_fraction directly, which
 * produced wrong results for CSV-sourced rows (recomputeRange only writes
 * status/work_hours — is_payable and day_fraction remain NULL for those rows).
 *
 * The read model derives payable_days and lop_days from status using the
 * canonical PAYABLE_STATUSES / LOP_STATUSES constants, which is correct for
 * all pipeline sources.
 *
 * Auth: hr_admin / super_admin only.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { buildMonthReadModel } from '../../lib/attendance-read-model.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const monthRe = /^\d{4}-\d{2}$/

const querySchema = z.object({
  month: z.string().regex(monthRe, 'month must be YYYY-MM'),
})

export default async function payrollSummaryRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/attendance/payroll-summary', auth, async (req: any, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { month } = parsed.data
    const [year, mon] = month.split('-').map(Number)
    const lastDay     = new Date(year, mon, 0).getDate()
    const from        = `${month}-01`
    const to          = `${month}-${String(lastDay).padStart(2, '0')}`

    // Build full read model: employees + daily rows + per-employee summaries + totals
    const result = await buildMonthReadModel(fastify.supabase, req.tenantId, month)

    if ('error' in result) {
      return serverError(req, reply, result.error, ErrorCode.QUERY_FAILED, 'Failed to build payroll summary')
    }

    const { summaries, totals } = result

    // Map to the response shape callers expect
    const employees = summaries.map(s => ({
      employee_id:   s.employee_id,
      employee_code: s.employee_code ?? '',
      name:          s.name          ?? '',
      total_days:    lastDay,
      present:       s.present,
      absent:        s.absent,
      on_leave:      s.on_leave,
      half_day:      s.half_day,
      late:          s.late,
      overtime:      s.overtime,
      missing_punch: s.missing_punch,
      payable_days:  s.payable_days,
      lop_days:      s.lop_days,
    }))

    return reply.send({
      month,
      from,
      to,
      totals: {
        total_employees:    totals.active_employees,
        total_payable_days: totals.total_payable_days,
        total_lop_days:     totals.total_lop_days,
        total_present:      totals.total_present,
        total_absent:       totals.total_absent,
        total_on_leave:     totals.total_on_leave,
        total_late:         totals.total_late,
        total_half_day:     totals.total_half_day,
        total_overtime:     totals.total_overtime,
        total_missing_punch: totals.total_missing_punch,
        employees_with_absence:       totals.employees_with_absence,
        employees_with_late:          totals.employees_with_late,
        employees_with_missing_punch: totals.employees_with_missing_punch,
        employees_lop_risk:           totals.employees_lop_risk,
      },
      employees,
    })
  })
}
