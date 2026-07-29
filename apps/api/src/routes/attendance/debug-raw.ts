/**
 * GET /attendance/debug/raw?month=YYYY-MM
 *
 * Raw attendance_daily inspection endpoint for aggregation debugging.
 *
 * Returns:
 *  - status_distribution  : count of each distinct status value as-stored in DB
 *  - sample_rows          : first 100 rows (employee_id, date, status, computed_source,
 *                           is_payable, day_fraction, work_hours)
 *  - total_rows           : total count matching tenant + month
 *  - employee_id_check    : all employee_ids in attendance_daily vs all active employee ids
 *                           — spots tenant_id or ID mismatches immediately
 *  - null_status_count    : rows where status IS NULL (should always be 0)
 *
 * This endpoint exists to definitively answer:
 *   1. Are status values lowercase ('present') or mixed case ('Present')?
 *   2. Does attendance_daily have rows for this tenant+month at all?
 *   3. Do employee_ids in attendance_daily match those in the employees table?
 *   4. What is the exact status distribution stored in the DB?
 *
 * Protected: hr_admin / super_admin only.
 * Development/diagnostic use — not surfaced in production UI.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
})

export default async function attendanceDebugRawRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/debug/raw',
    { preHandler: [fastify.authenticate] },
    async (req: any, reply) => {
      if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      }

      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({
          error:   'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message,
        })
      }

      const { month }  = parsed.data
      const tenantId   = req.tenantId
      const fromDate   = `${month}-01`
      const [y, m]     = month.split('-').map(Number)
      const toDate     = new Date(y, m, 0).toISOString().slice(0, 10)

      // ── Run bounded queries in parallel ──────────────────────────────────────
      const [
        totalCountResult,
        sampleRowsResult,
        nullStatusResult,
      ] = await Promise.all([
        // Total row count for this tenant + month
        fastify.supabase
          .from('attendance_daily')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .gte('date', fromDate)
          .lte('date', toDate),

        // First 100 rows — exact field values as stored in DB
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, date, status, computed_source, is_payable, day_fraction, work_hours, late_minutes')
          .eq('tenant_id', tenantId)
          .gte('date', fromDate)
          .lte('date', toDate)
          .order('date', { ascending: true })
          .order('employee_id', { ascending: true })
          .limit(100),

        // Count of rows where status IS NULL — should be 0 (engine always writes a status)
        fastify.supabase
          .from('attendance_daily')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .gte('date', fromDate)
          .lte('date', toDate)
          .is('status', null),
      ])

      // count/head:true queries and the plain select above resolve (never
      // throw) on failure — this is a diagnostic endpoint built specifically
      // to answer "does attendance_daily have data at all?", so a swallowed
      // error here would render a false "0 rows / no nulls" verdict.
      if (totalCountResult.error || sampleRowsResult.error || nullStatusResult.error) {
        return serverError(
          req, reply,
          totalCountResult.error ?? sampleRowsResult.error ?? nullStatusResult.error,
          ErrorCode.QUERY_FAILED,
          'Failed to fetch attendance debug data',
        )
      }

      // All active employees and all distinct employee_ids in attendance_daily —
      // use fetchAllRows to bypass the 1000-row PostgREST cap
      type EmpRow = { id: string; employee_code: string }
      let activeEmployees: EmpRow[]
      let dailyRows: { employee_id: string }[]
      try {
        ;[activeEmployees, dailyRows] = await Promise.all([
          fetchAllRows((from, to) =>
            fastify.supabase
              .from('employees')
              .select('id, employee_code')
              .eq('tenant_id', tenantId)
              .eq('status', 'active')
              .order('employee_code')
              .range(from, to),
          ),
          fetchAllRows((from, to) =>
            fastify.supabase
              .from('attendance_daily')
              .select('employee_id')
              .eq('tenant_id', tenantId)
              .gte('date', fromDate)
              .lte('date', toDate)
              .range(from, to),
          ),
        ]) as [EmpRow[], { employee_id: string }[]]
      } catch (err) {
        req.log.error({ err }, 'debug-raw: employee/daily-emp fetch failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employee data' })
      }

      // ── Build status distribution from sample rows ───────────────────────────
      // Note: this is from the first 100 rows only — use total_rows for full picture
      type DailyRow = {
        employee_id: string; date: string; status: string | null;
        computed_source: string; is_payable: boolean; day_fraction: number;
        work_hours: number; late_minutes: number;
      }
      const rows = (sampleRowsResult.data ?? []) as DailyRow[]
      const statusDist: Record<string, number> = {}
      for (const row of rows) {
        const key = row.status ?? '__NULL__'
        statusDist[key] = (statusDist[key] ?? 0) + 1
      }

      // ── Employee ID cross-check ──────────────────────────────────────────────
      const activeEmpIds = new Set(activeEmployees.map(e => e.id))
      const dailyEmpIds  = new Set(dailyRows.map(r => r.employee_id))

      // IDs in attendance_daily that are NOT in the active employees table
      const orphanDailyIds  = [...dailyEmpIds].filter(id => !activeEmpIds.has(id))
      // Active employees with NO rows in attendance_daily this period
      const missingFromDaily = activeEmployees.filter(e => !dailyEmpIds.has(e.id))
                                              .map(e => ({ id: e.id, employee_code: e.employee_code }))

      // ── Computed_source distribution ─────────────────────────────────────────
      const sourceDist: Record<string, number> = {}
      for (const row of rows) {
        const key = row.computed_source ?? '__NULL__'
        sourceDist[key] = (sourceDist[key] ?? 0) + 1
      }

      // ── Log for server-side visibility ──────────────────────────────────────
      req.log.info({
        event:                    'attendance_debug_raw',
        month,
        tenant_id:                tenantId,
        total_rows:               totalCountResult.count ?? 0,
        sample_size:              rows.length,
        status_distribution_sample: statusDist,
        source_distribution_sample: sourceDist,
        null_status_rows:         nullStatusResult.count ?? 0,
        active_employees:         activeEmployees.length,
        employees_in_daily:       dailyEmpIds.size,
        orphan_daily_ids_count:   orphanDailyIds.length,
        missing_from_daily_count: missingFromDaily.length,
      })

      return reply.send({
        // ── Query parameters ──────────────────────────────────────────────────
        month,
        tenant_id:   tenantId,
        from_date:   fromDate,
        to_date:     toDate,

        // ── Row counts ────────────────────────────────────────────────────────
        total_rows:         totalCountResult.count ?? 0,
        null_status_count:  nullStatusResult.count ?? 0,
        null_status_samples: [],

        // ── Status distribution (from first 100 rows) ─────────────────────────
        // If total_rows > 100, this is a sample; exact distribution needs SQL.
        // KEY DIAGNOSTIC: all keys here should be lowercase ('present', not 'Present')
        status_distribution_sample: statusDist,

        // ── Computed source distribution ──────────────────────────────────────
        source_distribution_sample: sourceDist,

        // ── Employee ID cross-check ────────────────────────────────────────────
        active_employees_count:    activeEmployees.length,
        employees_in_daily_count:  dailyEmpIds.size,
        // Employees in attendance_daily whose ID is NOT in the active employees list
        // If this is non-empty: either tenant mismatch or inactive employee has data
        orphan_daily_employee_ids: orphanDailyIds.slice(0, 20),  // cap at 20 for readability
        // Active employees with ZERO attendance_daily rows this period
        // If this equals active_employees_count: no data was recomputed for this tenant
        employees_missing_from_daily: missingFromDaily.slice(0, 20),

        // ── Raw sample rows (first 100) ────────────────────────────────────────
        // Use these to verify exact status case, is_payable, day_fraction values
        sample_rows: rows,
      })
    },
  )
}
