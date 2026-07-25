/**
 * GET /attendance/muster?month=YYYY-MM
 *
 * Returns the muster roll for a month: all active employees × all calendar days,
 * with their attendance_daily status, work_hours, and late_minutes.
 *
 * Days with no attendance_daily row are returned with status=null.
 *
 * Protected — requires hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { normalizeAttendanceStatus } from '../../lib/attendance-utils.js'
import { HR_ADMIN_ROLES, MANAGER_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

const MUSTER_ROW_LIMIT = 200_000

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
})

export default async function musterRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/muster',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const isAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
      const isMgr   = req.userRole === 'manager'
      if (!isAdmin && !isMgr) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin or manager access required' })
      }

      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({
          error:   'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message,
        })
      }

      const { month } = parsed.data
      const fromDate = `${month}-01`
      // Last day of the month
      const [y, m] = month.split('-').map(Number)
      const toDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)  // day 0 of next month = last day of this month

      // For managers: resolve their employee_id so we can scope to direct reports
      let managerEmployeeId: string | null = null
      if (isMgr) {
        const { data: profile } = await fastify.supabase
          .from('profiles')
          .select('employee_id')
          .eq('id', req.userId)
          .eq('tenant_id', req.tenantId)
          .single()
        managerEmployeeId = (profile as any)?.employee_id ?? null
        if (!managerEmployeeId) {
          return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Manager profile not linked to an employee record' })
        }
      }

      // Fetch active employees — for managers, only direct reports.
      // PostgREST caps results at max-rows (default 1000) so we paginate in
      // batches of 1000 until the page is shorter than the batch size.
      type EmpRow = { id: string; first_name: string; last_name: string; employee_code: string; joining_date: string | null }

      let reportIdFilter: string[] | null = null
      if (isMgr && managerEmployeeId) {
        const { data: reports } = await fastify.supabase
          .from('job_history')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .eq('manager_id', managerEmployeeId)
          .eq('is_current', true)
        reportIdFilter = (reports ?? []).map((r: any) => r.employee_id)
        if (reportIdFilter.length === 0) {
          return reply.send({ month, employees: [] })
        }
      }

      // Paginate both employees and attendance_daily via fetchAllRows, which is
      // robust at ANY server-side max-rows value: it advances by the rows actually
      // received and stops only on an empty page. (An inline copy of this loop
      // previously stopped when a page came back shorter than the requested batch —
      // silently truncating results whenever max-rows < batch size.)
      let employees: EmpRow[]
      try {
        employees = await fetchAllRows<EmpRow>((from, to) => {
          let q = fastify.supabase
            .from('employees')
            .select('id, first_name, last_name, employee_code, joining_date')
            .eq('tenant_id', req.tenantId)
            .eq('status', 'active')
            .order('employee_code')
            .range(from, to)
          if (reportIdFilter) q = q.in('id', reportIdFilter)
          return q as any
        })
      } catch (empError: any) {
        req.log.error({ err: empError }, 'muster employees query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
      }

      if (employees.length === 0) {
        return reply.send({ month, employees: [] })
      }

      type DailyRawRow = { date: string; status: string; muster_code: string | null; work_hours: number; late_minutes: number; employee_id: string }
      let daily: DailyRawRow[]
      try {
        // ORDER BY (employee_id, date) gives multi-page pagination a stable,
        // unique sort key so pages never overlap or skip rows.
        daily = await fetchAllRows<DailyRawRow>((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, status, muster_code, work_hours, late_minutes')
            .eq('tenant_id', req.tenantId)
            .gte('date', fromDate)
            .lte('date', toDate)
            .order('employee_id')
            .order('date')
            .range(from, to) as any,
        )
      } catch (dailyError: any) {
        req.log.error({ err: dailyError }, 'muster daily query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance records' })
      }

      // Build a lookup: employeeId → date → daily row
      type DailyRecord = { date: string; status: string | null; muster_code: string | null; work_hours: number; late_minutes: number }
      const empDailyMap = new Map<string, Map<string, DailyRecord>>()

      for (const row of daily) {
        let dateMap = empDailyMap.get(row.employee_id)
        if (!dateMap) {
          dateMap = new Map()
          empDailyMap.set(row.employee_id, dateMap)
        }
        dateMap.set(row.date, {
          date:         row.date,
          // normalizeAttendanceStatus ensures lowercase regardless of DB storage case
          // ('Present' → 'present', 'LATE' → 'late', etc.)
          status:       normalizeAttendanceStatus(row.status),
          muster_code:  row.muster_code ?? null,
          work_hours:   Number(row.work_hours),
          late_minutes: Number(row.late_minutes),
        })
      }

      // Build all calendar days for the month
      const allDays: string[] = []
      const cur = new Date(`${fromDate}T12:00:00.000Z`)
      const end = new Date(`${toDate}T12:00:00.000Z`)
      while (cur <= end) {
        allDays.push(cur.toISOString().slice(0, 10))
        cur.setUTCDate(cur.getUTCDate() + 1)
      }

      // Assemble per-employee rows
      const result = (employees as EmpRow[])
        .map((emp) => {
          const dateMap = empDailyMap.get(emp.id) ?? new Map<string, DailyRecord>()
          const days = allDays.map((d) => {
            const rec = dateMap.get(d)
            return rec
              ? { date: d, status: rec.status, muster_code: rec.muster_code, work_hours: rec.work_hours, late_minutes: rec.late_minutes }
              : { date: d, status: null,        muster_code: null,            work_hours: 0,             late_minutes: 0             }
          })
          return {
            employee_id:   emp.id,
            employee_code: emp.employee_code,
            name:          `${emp.first_name} ${emp.last_name}`,
            joining_date:  emp.joining_date ?? null,
            days,
          }
        })

      // ── Payload trace — logged at INFO so it appears in every environment ──
      // This lets us verify exactly what attendance_daily returned vs. what
      // the frontend will display in the grid and summary widgets.
      const traceStatusDist: Record<string, number> = {}
      let traceNullDays    = 0
      let traceNonNullDays = 0
      for (const emp of result) {
        for (const day of emp.days) {
          if (day.status) {
            traceStatusDist[day.status] = (traceStatusDist[day.status] ?? 0) + 1
            traceNonNullDays++
          } else {
            traceNullDays++
          }
        }
      }
      req.log.info({
        event:               'muster_payload_trace',
        month,
        employees_active:    result.length,
        days_in_month:       allDays.length,
        attendance_rows_fetched: (daily ?? []).length,
        days_with_status:    traceNonNullDays,
        days_without_status: traceNullDays,
        status_distribution: traceStatusDist,
        // First employee sample for quick sanity-check — names/IDs omitted for brevity
        first_employee_sample: result[0]
          ? {
              employee_code: result[0].employee_code,
              days_with_status: result[0].days.filter(d => d.status !== null).length,
              status_sample:    result[0].days.filter(d => d.status !== null).slice(0, 5).map(d => ({ date: d.date, status: d.status })),
            }
          : null,
      })

      return reply.send({ month, employees: result })
    },
  )

  // ── GET /attendance/muster/latest-month ────────────────────────────────────
  // Returns the most recent YYYY-MM in which this tenant has any attendance_daily
  // rows.  Used by the Muster Roll frontend to auto-navigate to the last active
  // period instead of defaulting to the current real-world month (which may have
  // no data when attendance is uploaded for a historical period).
  //
  // Response:
  //   { month: 'YYYY-MM' }                    — most recent month with data
  //   { month: null }                          — no attendance_daily rows at all
  //   { month: null, current_month: 'YYYY-MM'} — no data, fallback provided
  fastify.get(
    '/attendance/muster/latest-month',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      if (!(MANAGER_ROLES as readonly string[]).includes(req.userRole)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin or manager access required' })
      }

      // Fetch the single most recent attendance_daily date for this tenant
      const { data, error } = await fastify.supabase
        .from('attendance_daily')
        .select('date')
        .eq('tenant_id', req.tenantId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        req.log.error({ err: error }, 'muster/latest-month query failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch latest month' })
      }

      const currentMonth = new Date().toISOString().slice(0, 7)  // YYYY-MM
      if (!data?.date) {
        return reply.send({ month: null, current_month: currentMonth })
      }

      const latestMonth = (data.date as string).slice(0, 7)  // YYYY-MM
      return reply.send({ month: latestMonth, current_month: currentMonth })
    },
  )
}
