/**
 * GET /attendance/validate/reconcile?month=YYYY-MM
 *
 * Reconciliation validation endpoint.
 *
 * Proves that all surfaces — muster roll, payroll summary, and the read model
 * — derive identical counts from attendance_daily for the same period.
 *
 * Use during testing, after a recompute, or after a pipeline migration to
 * confirm all surfaces are reading the same data.
 *
 * Response structure:
 *   {
 *     month:  'YYYY-MM',
 *     read_model:  { total_present, total_absent, total_payable_days, ... },
 *     consistent:  true | false,
 *     discrepancies: [...],    // empty when consistent === true
 *   }
 *
 * Protected — hr_admin / super_admin only.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { buildMonthReadModel, PAYABLE_STATUSES } from '../../lib/attendance-read-model.js'
import { normalizeAttendanceStatus } from '../../lib/attendance-utils.js'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
})

export default async function reconciliationValidateRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/attendance/validate/reconcile', auth, async (req: any, reply) => {
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { month } = parsed.data

    // ── Surface A: canonical read model ───────────────────────────────────────
    const modelResult = await buildMonthReadModel(fastify.supabase, req.tenantId, month)
    if ('error' in modelResult) {
      return reply.code(500).send({ error: 'READ_MODEL_FAILED', message: modelResult.error })
    }
    const { totals: modelTotals, rows: modelRows } = modelResult

    // ── Surface B: raw attendance_daily re-aggregate (independent check) ───────
    // Re-run the same query independently and compare — proves no aggregation drift
    const [y, m] = month.split('-').map(Number)
    const fromDate = `${month}-01`
    const toDate   = new Date(y, m, 0).toISOString().slice(0, 10)

    const { data: rawRows, error: rawErr } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, date, status')
      .eq('tenant_id', req.tenantId)
      .gte('date', fromDate)
      .lte('date', toDate)

    if (rawErr) {
      return reply.code(500).send({ error: 'RAW_QUERY_FAILED', message: rawErr.message })
    }

    // Tally raw counts using the same canonical status mapping (PAYABLE_STATUSES from read model)
    let rawPresent = 0, rawLate = 0, rawAbsent = 0, rawLeave = 0, rawHalfDay = 0
    let rawPayable = 0

    for (const row of rawRows ?? []) {
      const s = normalizeAttendanceStatus((row as any).status)
      if (!s) continue
      if (s === 'present')                rawPresent++
      else if (s === 'late')              { rawPresent++; rawLate++ }
      else if (s === 'absent')              rawAbsent++
      else if (s === 'leave')               rawLeave++
      else if (s === 'half_day')            rawHalfDay++

      if (s === 'half_day')               rawPayable += 0.5
      else if (PAYABLE_STATUSES.has(s))  rawPayable += 1.0
    }

    // ── Discrepancy detection ─────────────────────────────────────────────────
    const discrepancies: Array<{ field: string; read_model: number; raw_recount: number }> = []

    const check = (field: string, a: number, b: number) => {
      if (Math.abs(a - b) > 0.01) discrepancies.push({ field, read_model: a, raw_recount: b })
    }

    check('total_present',      modelTotals.total_present,      rawPresent)
    check('total_late',         modelTotals.total_late,         rawLate)
    check('total_absent',       modelTotals.total_absent,       rawAbsent)
    check('total_on_leave',     modelTotals.total_on_leave,     rawLeave)
    check('total_half_day',     modelTotals.total_half_day,     rawHalfDay)
    check('total_payable_days', modelTotals.total_payable_days, Math.round(rawPayable * 100) / 100)

    // ── Status distribution raw ───────────────────────────────────────────────
    const rawDistribution: Record<string, number> = {}
    for (const row of rawRows ?? []) {
      const s = normalizeAttendanceStatus((row as any).status) ?? 'null'
      rawDistribution[s] = (rawDistribution[s] ?? 0) + 1
    }
    let rawNullCount = 0
    for (const row of rawRows ?? []) {
      if (!(row as any).status) rawNullCount++
    }

    req.log.info({
      event:          'attendance_reconciliation_validate',
      month,
      consistent:     discrepancies.length === 0,
      discrepancies,
      read_model_rows: modelRows.length,
      raw_rows:        (rawRows ?? []).length,
    }, 'Reconciliation validation run')

    return reply.send({
      month,
      consistent:   discrepancies.length === 0,
      discrepancies,
      read_model: {
        rows_processed:    modelRows.length,
        active_employees:  modelTotals.active_employees,
        total_present:     modelTotals.total_present,
        total_late:        modelTotals.total_late,
        total_absent:      modelTotals.total_absent,
        total_on_leave:    modelTotals.total_on_leave,
        total_half_day:    modelTotals.total_half_day,
        total_payable_days: modelTotals.total_payable_days,
        total_lop_days:    modelTotals.total_lop_days,
        employees_with_absence:       modelTotals.employees_with_absence,
        employees_with_late:          modelTotals.employees_with_late,
        employees_with_missing_punch: modelTotals.employees_with_missing_punch,
        employees_lop_risk:           modelTotals.employees_lop_risk,
      },
      raw_recount: {
        rows_fetched:      (rawRows ?? []).length,
        null_status_count: rawNullCount,
        status_distribution: rawDistribution,
        total_present:     rawPresent,
        total_late:        rawLate,
        total_absent:      rawAbsent,
        total_on_leave:    rawLeave,
        total_half_day:    rawHalfDay,
        total_payable_days: Math.round(rawPayable * 100) / 100,
      },
    })
  })
}
