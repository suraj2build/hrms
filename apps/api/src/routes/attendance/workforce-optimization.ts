/**
 * Workforce Optimization Engine Routes
 *
 * GET  /attendance/workforce-optimization/fairness-balance    — OT/weekend/night fairness scores
 * GET  /attendance/workforce-optimization/consecutive-shifts  — employees with long consecutive runs
 * GET  /attendance/workforce-optimization/rest-gaps           — insufficient rest between shifts
 * GET  /attendance/workforce-optimization/ot-distribution     — overtime concentration analysis
 * GET  /attendance/workforce-optimization/staffing-hints      — daily staffing pressure snapshot
 * GET  /attendance/workforce-optimization/shift-overload      — employees working > 10 h/day
 * GET  /attendance/workforce-optimization/hints               — paginated optimization hints
 * POST /attendance/workforce-optimization/hints/:id/resolve   — mark a hint resolved (admin)
 * POST /attendance/workforce-optimization/compute             — compute & persist shift balance (admin)
 *
 * Auth: fastify.authenticate on every route.
 *       Write routes require hr_admin or super_admin.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Employees working more than this many hours in a day are flagged as overloaded. */
const OVERLOAD_THRESHOLD_HOURS = 10

/** Minimum required rest gap between consecutive shifts (hours). */
const MIN_REST_GAP_HOURS = 8

/** Consecutive-shift violation thresholds. */
const CONSEC_MEDIUM   = 5
const CONSEC_HIGH     = 6
const CONSEC_CRITICAL = 7

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Convert overtime_minutes (number | null) to fractional hours, clamped to 0. */
function otMinutesToHours(minutes: number | null | undefined): number {
  return Math.max(0, (minutes ?? 0) / 60)
}

/**
 * Given a sorted array of ISO date strings for a single employee, return the
 * longest run of consecutive calendar days and the dates that make up that run.
 */
function longestConsecutiveRun(sortedDates: string[]): { count: number; dates: string[] } {
  if (sortedDates.length === 0) return { count: 0, dates: [] }

  let best: string[] = []
  let current: string[] = [sortedDates[0]]

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(`${sortedDates[i - 1]}T12:00:00Z`)
    const curr = new Date(`${sortedDates[i]}T12:00:00Z`)
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)

    if (diffDays === 1) {
      current.push(sortedDates[i])
    } else {
      if (current.length > best.length) best = current
      current = [sortedDates[i]]
    }
  }
  if (current.length > best.length) best = current

  return { count: best.length, dates: best }
}

/** Map consecutive count to a severity label. */
function consecutiveSeverity(count: number): 'medium' | 'high' | 'critical' {
  if (count >= CONSEC_CRITICAL) return 'critical'
  if (count >= CONSEC_HIGH) return 'high'
  return 'medium'
}

/**
 * Fairness score for an employee relative to the team average (0-100).
 * 100 = perfectly fair (exactly at team average), 0 = extreme outlier.
 */
function fairnessScore(value: number, teamAvg: number): number {
  if (teamAvg === 0 && value === 0) return 100
  if (teamAvg === 0) return 0
  const ratio = value / teamAvg
  // score falls off as ratio moves away from 1
  const deviation = Math.abs(ratio - 1)
  return Math.max(0, Math.round((1 - Math.min(deviation, 1)) * 100))
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function workforceOptimizationRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── Schema definitions ────────────────────────────────────────────────────

  const dateRangeSchema = z.object({
    from: z.string().regex(DATE_RE, 'from must be YYYY-MM-DD'),
    to:   z.string().regex(DATE_RE, 'to must be YYYY-MM-DD'),
  })

  // ── 1. GET /attendance/workforce-optimization/fairness-balance ────────────
  //
  // Aggregate OT / weekend / night shift fairness scores per employee,
  // sourced from workforce_shift_balance and workforce_optimization_hints.

  const fairnessQuerySchema = dateRangeSchema.extend({
    department_id: z.string().uuid().optional(),
  })

  fastify.get('/attendance/workforce-optimization/fairness-balance', auth, async (req: any, reply) => {
    const parsed = fairnessQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from, to, department_id } = parsed.data

    // Fetch shift balance records for the period. fetchAllRows() — fresh
    // audit finding: this was the only endpoint in the file still using a
    // plain query, so it silently truncated at PostgREST's 1,000-row
    // ceiling at real scale while every sibling endpoint here already
    // paginates.
    let balanceRows: any[]
    try {
      balanceRows = await fetchAllRows((rangeFrom, rangeTo) => {
        let q = fastify.supabase
          .from('workforce_shift_balance')
          .select(
            `
              id, employee_id, period_start, period_end,
              ot_fairness_score, weekend_fairness_score, night_fairness_score:night_shift_fairness_score,
              total_ot_hours, weekend_shifts_count, night_shifts_count,
              max_consecutive_days, rest_gap_violations, computed_at,
              employees!inner(id, first_name, last_name, employee_code,
                job_history!job_history_employee_id_fkey(department_id))
            `,
          )
          .eq('tenant_id', req.tenantId)
          .gte('period_start', from)
          .lte('period_end', to)
          .order('ot_fairness_score', { ascending: true })

        if (department_id) {
          q = q.eq('employees.job_history.department_id', department_id)
        }

        return q.range(rangeFrom, rangeTo)
      })
    } catch (balanceErr) {
      // Table may not exist yet — return empty gracefully
      req.log.warn({ err: balanceErr }, 'workforce_shift_balance fetch failed — returning empty')
      return reply.send({ avg_ot_fairness: 0, avg_weekend_fairness: 0, avg_night_fairness: 0, violations_count: 0, employees: [], hints: [] })
    }

    // Fetch open hints for the period
    let hintRows: any[] = []
    let hintsFailed = false
    try {
      hintRows = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('workforce_optimization_hints')
          .select('id, employee_id, hint_type, severity, message:explanation, hint_date:created_at, resolved')
          .eq('tenant_id', req.tenantId)
          .gte('created_at', from)
          .lte('created_at', to)
          .eq('resolved', false)
          .order('created_at', { ascending: false })
          .range(rangeFrom, rangeTo),
      )
    } catch (hintsErr) {
      // Table may not exist yet — continue with empty hints rather than 500
      req.log.warn({ err: hintsErr }, 'workforce_optimization_hints fetch failed — continuing with empty hints')
      hintsFailed = true
    }

    const rows  = balanceRows as any[]
    const hints = hintsFailed ? [] : hintRows

    // Build per-employee list with frontend-expected field names
    const employees = rows.map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      const otF = r.ot_fairness_score      ?? 0
      const weF = r.weekend_fairness_score ?? 0
      const niF = r.night_fairness_score   ?? 0
      return {
        employee_id:      r.employee_id,
        name:             emp ? `${emp.first_name} ${emp.last_name}` : '',
        employee_code:    emp?.employee_code ?? '',
        ot_fairness:      otF,
        weekend_fairness: weF,
        night_fairness:   niF,
        balance_score:    round2((otF + weF + niF) / 3),
      }
    })

    // Compute summary averages
    const count = employees.length
    const avgOf = (key: 'ot_fairness' | 'weekend_fairness' | 'night_fairness') => {
      if (count === 0) return 0
      return round2(employees.reduce((acc, e) => acc + e[key], 0) / count)
    }
    const violationsCount = hints.filter(
      (h) => ['high', 'critical', 'HIGH', 'CRITICAL'].includes(h.severity),
    ).length

    return reply.send({
      avg_ot_fairness:      avgOf('ot_fairness'),
      avg_weekend_fairness: avgOf('weekend_fairness'),
      avg_night_fairness:   avgOf('night_fairness'),
      violations_count:     violationsCount,
      employees,
      hints: hints.map((h) => ({
        id:             h.id,
        severity:       h.severity,
        title:          String(h.hint_type ?? '').replace(/_/g, ' '),
        explanation:    h.message ?? '',
        affected_dates: [] as string[],
      })),
    })
  })

  // ── 2. GET /attendance/workforce-optimization/consecutive-shifts ──────────
  //
  // Find employees who have worked many consecutive days (present / late).

  fastify.get('/attendance/workforce-optimization/consecutive-shifts', auth, async (req: any, reply) => {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from, to } = parsed.data

    // fetchAllRows() (not a plain query) — fresh audit finding: no
    // employee_id filter here at all, so this scans the WHOLE tenant's
    // attendance_daily for the period. Easily exceeds PostgREST's 1,000-row
    // ceiling at real scale, silently truncating which employees get
    // evaluated for consecutive-shift violations.
    let data: any[]
    try {
      data = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, date, status,
              employees!inner(id, first_name, last_name, employee_code)
            `,
          )
          .eq('tenant_id', req.tenantId)
          .in('status', ['present', 'late'])
          .gte('date', from)
          .lte('date', to)
          .order('employee_id')
          .order('date')
          .range(rangeFrom, rangeTo),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance records')
    }

    // Group by employee
    const byEmployee = new Map<string, { emp: any; dates: string[] }>()
    for (const row of ((data ?? []) as any[])) {
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
      if (!byEmployee.has(row.employee_id)) {
        byEmployee.set(row.employee_id, { emp, dates: [] })
      }
      byEmployee.get(row.employee_id)!.dates.push(row.date)
    }

    // Compute longest consecutive run per employee; filter violations
    const violations: Array<{
      employee_id:      string
      employee_name:    string | null
      employee_code:    string | null
      max_consecutive:  number
      violation_dates:  string[]
      severity:         'medium' | 'high' | 'critical'
    }> = []

    for (const [empId, { emp, dates }] of byEmployee.entries()) {
      // dates already ordered ascending
      const { count, dates: runDates } = longestConsecutiveRun(dates)
      if (count >= CONSEC_MEDIUM) {
        violations.push({
          employee_id:     empId,
          employee_name:   emp ? `${emp.first_name} ${emp.last_name}` : '',
          employee_code:   emp?.employee_code ?? '',
          max_consecutive: count,
          violation_dates: runDates,
          severity:        consecutiveSeverity(count),
        })
      }
    }

    // Sort by severity then count desc
    const severityOrder = { critical: 0, high: 1, medium: 2 }
    violations.sort((a, b) => {
      const sd = severityOrder[a.severity] - severityOrder[b.severity]
      return sd !== 0 ? sd : b.max_consecutive - a.max_consecutive
    })

    return reply.send({ violations })
  })

  // ── 3. GET /attendance/workforce-optimization/rest-gaps ───────────────────
  //
  // Find employees whose back-to-back shift end→next-shift start gap is < 8 h.

  fastify.get('/attendance/workforce-optimization/rest-gaps', auth, async (req: any, reply) => {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from, to } = parsed.data

    // Fetch attendance records with roster/shift metadata. fetchAllRows()
    // (not a plain query) — fresh audit finding: no employee_id filter, so
    // this scans the whole tenant's attendance_daily for the period —
    // easily exceeds the 1,000-row ceiling at real scale.
    let data: any[]
    try {
      data = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, date, shift_start_time, shift_end_time,
              employees!inner(id, first_name, last_name, employee_code),
              shifts:expected_shift_id(id, name)
            `,
          )
          .eq('tenant_id', req.tenantId)
          .in('status', ['present', 'late', 'half_day'])
          .gte('date', from)
          .lte('date', to)
          .order('employee_id')
          .order('date')
          .range(rangeFrom, rangeTo),
      )
    } catch (error) {
      req.log.warn({ err: error }, 'attendance_daily rest-gaps fetch failed — returning empty')
      return reply.send({ gaps: [] })
    }

    // Group by employee, then check consecutive pairs
    const byEmployee = new Map<string, { emp: any; records: any[] }>()
    for (const row of ((data ?? []) as any[])) {
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
      if (!byEmployee.has(row.employee_id)) {
        byEmployee.set(row.employee_id, { emp, records: [] })
      }
      byEmployee.get(row.employee_id)!.records.push(row)
    }

    const violations: Array<{
      employee_id:   string
      name:          string | null
      employee_code: string | null
      gap_hours:     number
      date1:         string
      date2:         string
      shift1:        string | null
      shift2:        string | null
    }> = []

    for (const [empId, { emp, records }] of byEmployee.entries()) {
      for (let i = 0; i < records.length - 1; i++) {
        const rec1 = records[i]
        const rec2 = records[i + 1]

        const shift1 = Array.isArray(rec1.shifts) ? rec1.shifts[0] : rec1.shifts
        const shift2 = Array.isArray(rec2.shifts) ? rec2.shifts[0] : rec2.shifts

        // Scheduled shift end of day 1 → next day's scheduled start
        // (shift times are denormalized onto attendance_daily).
        const endStr:   string | null = rec1.shift_end_time   ? `${rec1.date}T${rec1.shift_end_time}`   : null
        const startStr: string | null = rec2.shift_start_time ? `${rec2.date}T${rec2.shift_start_time}` : null

        if (!endStr || !startStr) continue

        const endMs   = new Date(endStr).getTime()
        const startMs = new Date(startStr).getTime()

        // Only process if rec2 is the next calendar day (avoid same-day comparisons)
        const dayDiff = Math.round(
          (new Date(`${rec2.date}T12:00:00Z`).getTime() - new Date(`${rec1.date}T12:00:00Z`).getTime()) / 86_400_000,
        )
        if (dayDiff !== 1) continue

        const gapMs    = startMs - endMs
        const gapHours = round2(gapMs / 3_600_000)

        if (gapHours < MIN_REST_GAP_HOURS) {
          violations.push({
            employee_id:   empId,
            name:          emp ? `${emp.first_name} ${emp.last_name}` : null,
            employee_code: emp?.employee_code ?? null,
            gap_hours:     gapHours,
            date1:         rec1.date,
            date2:         rec2.date,
            shift1:        shift1?.name ?? null,
            shift2:        shift2?.name ?? null,
          })
        }
      }
    }

    // Sort by smallest gap first (worst violations first)
    violations.sort((a, b) => a.gap_hours - b.gap_hours)

    return reply.send({ gaps: violations })
  })

  // ── 4. GET /attendance/workforce-optimization/ot-distribution ─────────────
  //
  // Overtime concentration analysis across all employees in the period.

  fastify.get('/attendance/workforce-optimization/ot-distribution', auth, async (req: any, reply) => {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from, to } = parsed.data

    // fetchAllRows() (not a plain query) — fresh audit finding: no
    // employee_id filter, scans the whole tenant's attendance_daily for the
    // period — easily exceeds the 1,000-row ceiling, silently understating
    // OT concentration for a subset of employees with no truncation signal.
    let data: any[]
    try {
      data = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, overtime_minutes,
              employees!inner(id, first_name, last_name, employee_code, department_id,
                departments(name))
            `,
          )
          .eq('tenant_id', req.tenantId)
          .gt('overtime_minutes', 0)
          .gte('date', from)
          .lte('date', to)
          .order('employee_id')
          .range(rangeFrom, rangeTo),
      )
    } catch (error) {
      req.log.warn({ err: error }, 'attendance_daily ot-distribution fetch failed — returning empty')
      return reply.send({ team_avg_ot_hours: 0, max_ot_hours: 0, concentration_index: 0, employees: [] })
    }

    // Aggregate per employee
    const otMap = new Map<string, { emp: any; totalMinutes: number; days: number }>()
    for (const row of ((data ?? []) as any[])) {
      const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees
      if (!otMap.has(row.employee_id)) {
        otMap.set(row.employee_id, { emp, totalMinutes: 0, days: 0 })
      }
      const entry = otMap.get(row.employee_id)!
      entry.totalMinutes += row.overtime_minutes ?? 0
      entry.days++
    }

    if (otMap.size === 0) {
      return reply.send({
        team_avg_ot_hours:   0,
        max_ot_hours:        0,
        concentration_index: 0,
        employees:           [],
      })
    }

    const allOtHours = Array.from(otMap.values()).map((e) => otMinutesToHours(e.totalMinutes))
    const teamTotal  = allOtHours.reduce((a, b) => a + b, 0)
    const teamAvg    = round2(teamTotal / otMap.size)
    const maxOt      = round2(Math.max(...allOtHours))

    // Concentration index — Herfindahl-style: sum of squared shares (0-1 scale)
    let concentrationIndex = 0
    if (teamTotal > 0) {
      for (const h of allOtHours) {
        const share = h / teamTotal
        concentrationIndex += share * share
      }
      concentrationIndex = round2(concentrationIndex)
    }

    const employees = Array.from(otMap.entries()).map(([empId, { emp, totalMinutes, days }]) => {
      const totalOtHours = round2(otMinutesToHours(totalMinutes))
      return {
        employee_id:    empId,
        name:           emp ? `${emp.first_name} ${emp.last_name}` : '',
        employee_code:  emp?.employee_code ?? '',
        ot_hours:       totalOtHours,
        ot_days:        days,
        avg_ot_per_day: days > 0 ? round2(totalOtHours / days) : 0,
        vs_team_avg:    round2(totalOtHours - teamAvg),
        fairness_score: fairnessScore(totalOtHours, teamAvg),
      }
    })

    employees.sort((a, b) => b.ot_hours - a.ot_hours)

    return reply.send({
      team_avg_ot_hours:   teamAvg,
      max_ot_hours:        maxOt,
      concentration_index: concentrationIndex,
      employees,
    })
  })

  // ── 5. GET /attendance/workforce-optimization/staffing-hints ─────────────
  //
  // Daily staffing pressure per department from workforce_staffing_snapshots.

  const staffingQuerySchema = z.object({
    date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD').optional(),
  })

  fastify.get('/attendance/workforce-optimization/staffing-hints', auth, async (req: any, reply) => {
    const parsed = staffingQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const date = parsed.data.date ?? todayIso()

    const { data, error } = await fastify.supabase
      .from('workforce_staffing_snapshots')
      .select(
        `
          id, snapshot_date, department_id, scheduled_count:scheduled_headcount,
          present_count:present_headcount, coverage_ratio,
          staffing_pressure, understaffed, overstaffed,
          departments(id, name)
        `,
      )
      .eq('tenant_id', req.tenantId)
      .eq('snapshot_date', date)
      .order('staffing_pressure', { ascending: false })

    if (error) {
      req.log.warn({ err: error }, 'workforce_staffing_snapshots fetch failed — returning empty')
      return reply.send({ date, by_department: [] })
    }

    const rows = ((data ?? []) as any[])

    const departments = rows.map((r) => {
      const dept = r.departments ? (Array.isArray(r.departments) ? r.departments[0] : r.departments) : null
      return {
        department_id:     r.department_id,
        department:        dept?.name ?? r.department_id ?? '',
        snapshot_date:     r.snapshot_date,
        scheduled_count:   r.scheduled_count,
        present_count:     r.present_count,
        absent_count:      Math.max(0, (r.scheduled_count ?? 0) - (r.present_count ?? 0)),
        coverage_ratio:    r.coverage_ratio,
        staffing_pressure: r.staffing_pressure,
        understaffed:      r.understaffed,
        overstaffed:       r.overstaffed,
      }
    })

    return reply.send({ date, departments })
  })

  // ── 6. GET /attendance/workforce-optimization/shift-overload ─────────────
  //
  // Employees who exceeded OVERLOAD_THRESHOLD_HOURS (10 h) on one or more days.

  fastify.get('/attendance/workforce-optimization/shift-overload', auth, async (req: any, reply) => {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from, to } = parsed.data

    // fetchAllRows() (not a plain query) — fresh audit finding: no
    // employee_id filter, scans the whole tenant's attendance_daily for the
    // period — easily exceeds the 1,000-row ceiling at real scale.
    let data: any[]
    try {
      data = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, date, work_hours,
              employees!inner(id, first_name, last_name, employee_code)
            `,
          )
          .eq('tenant_id', req.tenantId)
          .gt('work_hours', OVERLOAD_THRESHOLD_HOURS)
          .gte('date', from)
          .lte('date', to)
          .order('employee_id')
          .order('date')
          .range(rangeFrom, rangeTo),
      )
    } catch (error) {
      req.log.warn({ err: error }, 'attendance_daily shift-overload fetch failed — returning empty')
      return reply.send({ employees: [] })
    }

    // Aggregate per employee
    const byEmployee = new Map<
      string,
      { emp: any; days: string[]; totalExcessHours: number }
    >()

    for (const row of ((data ?? []) as any[])) {
      const emp        = Array.isArray(row.employees) ? row.employees[0] : row.employees
      const excessHours = round2((row.work_hours ?? 0) - OVERLOAD_THRESHOLD_HOURS)
      if (!byEmployee.has(row.employee_id)) {
        byEmployee.set(row.employee_id, { emp, days: [], totalExcessHours: 0 })
      }
      const entry = byEmployee.get(row.employee_id)!
      entry.days.push(row.date)
      entry.totalExcessHours = round2(entry.totalExcessHours + excessHours)
    }

    const overloads = Array.from(byEmployee.entries()).map(([empId, { emp, days, totalExcessHours }]) => ({
      employee_id:    empId,
      name:           emp ? `${emp.first_name} ${emp.last_name}` : '',
      employee_code:  emp?.employee_code ?? '',
      overload_days:  days.length,
      excess_hours:   totalExcessHours,
      affected_dates: days,
    }))

    overloads.sort((a, b) => b.excess_hours - a.excess_hours)

    return reply.send({ employees: overloads })
  })

  // ── 7. GET /attendance/workforce-optimization/hints ───────────────────────
  //
  // Paginated optimization hints with employee names joined.

  const hintsListSchema = z.object({
    from:     z.string().regex(DATE_RE, 'from must be YYYY-MM-DD').optional(),
    to:       z.string().regex(DATE_RE, 'to must be YYYY-MM-DD').optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    resolved: z.enum(['true', 'false']).default('false'),
    limit:    z.coerce.number().int().min(1).max(500).default(50),
    offset:   z.coerce.number().int().min(0).default(0),
  })

  fastify.get('/attendance/workforce-optimization/hints', auth, async (req: any, reply) => {
    const parsed = hintsListSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
      })
    }

    const { from: rawFrom, to: rawTo, severity, resolved, limit, offset } = parsed.data
    // Default: last 30 days → today when frontend omits date range
    const to   = rawTo   ?? todayIso()
    const from = rawFrom ?? (() => {
      const d = new Date(to)
      d.setUTCDate(d.getUTCDate() - 30)
      return d.toISOString().slice(0, 10)
    })()
    const resolvedBool = resolved === 'true'

    let q = fastify.supabase
      .from('workforce_optimization_hints')
      .select(
        `
          id, employee_id, hint_type, severity, message:explanation,
          hint_date:created_at, resolved, resolved_at, created_at,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .gte('created_at', from)
      .lte('created_at', to)
      .eq('resolved', resolvedBool)
      .order('created_at', { ascending: false })
      .order('severity', { ascending: false })
      .range(offset, offset + limit - 1)

    if (severity) q = q.eq('severity', severity)

    const { data, error, count } = await q

    if (error) {
      req.log.warn({ err: error }, 'workforce_optimization_hints list failed — returning empty')
      return reply.send({ hints: [], total: 0, limit, offset })
    }

    const rows = ((data ?? []) as any[]).map((h) => {
      const emp  = Array.isArray(h.employees) ? h.employees[0] : h.employees
      return {
        id:              h.id,
        employee_id:     h.employee_id,
        hint_type:       h.hint_type,
        severity:        h.severity,
        title:           String(h.hint_type ?? '').replace(/_/g, ' '),
        explanation:     h.message ?? '',
        metric_value:    0,
        threshold_value: 0,
        payroll_impact:  null as null,
        resolved:        h.resolved,
        hint_date:       h.hint_date,
        resolved_at:     h.resolved_at,
        resolved_by:     null,
        // extras for display
        employee_name:   emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:   emp?.employee_code ?? null,
        created_at:      h.created_at,
      }
    })

    return reply.send({ hints: rows, total: count ?? 0, limit, offset })
  })

  // ── 8. POST /attendance/workforce-optimization/hints/:id/resolve ──────────
  //
  // Mark a workforce_optimization_hint as resolved (admin only).

  fastify.post<{ Params: { id: string } }>(
    '/attendance/workforce-optimization/hints/:id/resolve',
    auth,
    async (req: any, reply) => {
      if (!requireAdmin(req, reply)) return

      const { id } = req.params

      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid hint id' })
      }

      // Verify the hint belongs to this tenant
      const { data: existing, error: fetchErr } = await fastify.supabase
        .from('workforce_optimization_hints')
        .select('id, resolved')
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (fetchErr) return serverError(req, reply, fetchErr, ErrorCode.QUERY_FAILED, 'Failed to fetch hint')

      if (!existing) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Hint not found' })
      }

      // Fold resolved=false into the UPDATE's own WHERE clause — the read
      // above is only for a friendly 404 vs 409 distinction; a concurrent
      // resolve request can't race past this and double-resolve the hint.
      const now = new Date().toISOString()
      const { data: updated, error: updateErr } = await fastify.supabase
        .from('workforce_optimization_hints')
        .update({
          resolved:    true,
          resolved_at: now,
        })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)
        .eq('resolved', false)
        .select('id')
        .maybeSingle()

      if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to resolve hint')
      if (!updated) {
        return reply.code(409).send({ error: 'ALREADY_RESOLVED', message: 'Hint is already resolved' })
      }

      return reply.send({ id, resolved: true, resolved_at: now, resolved_by: req.userId })
    },
  )

  // ── 9. POST /attendance/workforce-optimization/compute ────────────────────
  //
  // Compute shift balance scores for all active employees in the given period.
  // Upserts to workforce_shift_balance and generates workforce_optimization_hints.

  const computeQuerySchema = dateRangeSchema

  fastify.post('/attendance/workforce-optimization/compute', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    // Frontend sends from/to as a JSON body (it's a POST action, not a GET
    // list), but this validated req.query — which fetch() never populates for
    // a POST body — so every call 400'd here regardless of what the client sent.
    const parsed = computeQuerySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { from, to } = parsed.data

    // ── Step 1: Fetch all active employees for this tenant ──────────────────
    let employees: any[]
    try {
      employees = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id, first_name, last_name, employee_code')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .range(from, to),
      )
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch active employees')
    }
    if (employees.length === 0) {
      return reply.send({ employees_computed: 0, hints_generated: 0 })
    }

    const employeeIds = employees.map((e) => e.id)

    // ── Step 2: Fetch attendance_daily for the period ───────────────────────
    // fetchAllRows() (not a plain query) — fresh audit finding: employeeIds
    // can span the tenant's full active headcount, so this easily exceeds
    // the 1,000-row ceiling at real scale, silently dropping the tail of
    // employees from OT/night-shift/rest-gap hint generation.
    let dailyRows: any[]
    try {
      dailyRows = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, date, status, overtime_minutes, work_hours,
              shift_start_time, shift_end_time, shift_is_night_shift
            `,
          )
          .eq('tenant_id', req.tenantId)
          .in('employee_id', employeeIds)
          .in('status', ['present', 'late', 'half_day'])
          .gte('date', from)
          .lte('date', to)
          .order('employee_id')
          .order('date')
          .range(rangeFrom, rangeTo),
      )
    } catch (dailyErr) {
      return serverError(req, reply, dailyErr, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance data')
    }

    const daily = dailyRows as any[]

    // ── Step 3: Aggregate per employee ─────────────────────────────────────
    interface EmpMetrics {
      dates:                 string[]
      otMinutes:             number
      weekendShifts:         number
      nightShifts:           number
      totalWorkHours:        number
      restGapViolations:     number
      // for rest-gap computation we need ordered records with shift info
      records:               any[]
    }

    const metricsMap = new Map<string, EmpMetrics>()
    for (const emp of employees) {
      metricsMap.set(emp.id, {
        dates:             [],
        otMinutes:         0,
        weekendShifts:     0,
        nightShifts:       0,
        totalWorkHours:    0,
        restGapViolations: 0,
        records:           [],
      })
    }

    for (const row of daily) {
      const m = metricsMap.get(row.employee_id)
      if (!m) continue

      m.dates.push(row.date)
      m.otMinutes += row.overtime_minutes ?? 0
      m.totalWorkHours += row.work_hours ?? 0
      m.records.push(row)

      // Weekend: JS day 0=Sun, 6=Sat
      const dow = new Date(`${row.date}T12:00:00Z`).getUTCDay()
      if (dow === 0 || dow === 6) m.weekendShifts++

      // Night shift flag (denormalized on attendance_daily)
      if (row.shift_is_night_shift) m.nightShifts++
    }

    // Compute rest-gap violations per employee
    for (const [, m] of metricsMap.entries()) {
      for (let i = 0; i < m.records.length - 1; i++) {
        const rec1   = m.records[i]
        const rec2   = m.records[i + 1]
        const endStr:   string | null = rec1.shift_end_time   ? `${rec1.date}T${rec1.shift_end_time}`   : null
        const startStr: string | null = rec2.shift_start_time ? `${rec2.date}T${rec2.shift_start_time}` : null

        if (!endStr || !startStr) continue

        const dayDiff = Math.round(
          (new Date(`${rec2.date}T12:00:00Z`).getTime() - new Date(`${rec1.date}T12:00:00Z`).getTime()) / 86_400_000,
        )
        if (dayDiff !== 1) continue

        const gapHours = (new Date(startStr).getTime() - new Date(endStr).getTime()) / 3_600_000
        if (gapHours < MIN_REST_GAP_HOURS) m.restGapViolations++
      }
    }

    // ── Step 4: Compute team averages (for fairness scoring) ───────────────
    let teamTotalOtHours      = 0
    let teamTotalWeekend      = 0
    let teamTotalNight        = 0
    let activeCount           = 0

    for (const [, m] of metricsMap.entries()) {
      if (m.dates.length === 0) continue
      teamTotalOtHours += otMinutesToHours(m.otMinutes)
      teamTotalWeekend += m.weekendShifts
      teamTotalNight   += m.nightShifts
      activeCount++
    }

    const teamAvgOt      = activeCount > 0 ? teamTotalOtHours / activeCount : 0
    const teamAvgWeekend = activeCount > 0 ? teamTotalWeekend / activeCount : 0
    const teamAvgNight   = activeCount > 0 ? teamTotalNight / activeCount : 0

    // ── Step 5: Build upsert rows ───────────────────────────────────────────
    const now            = new Date().toISOString()
    const balanceUpserts: any[] = []
    const hintsToInsert:  any[] = []

    for (const emp of employees) {
      const m = metricsMap.get(emp.id)!
      if (m.dates.length === 0) continue // no data in period, skip

      const totalOtHours        = round2(otMinutesToHours(m.otMinutes))
      const { count: maxConsec } = longestConsecutiveRun(m.dates)

      const otFairness      = fairnessScore(totalOtHours,    teamAvgOt)
      const weekendFairness = fairnessScore(m.weekendShifts, teamAvgWeekend)
      const nightFairness   = fairnessScore(m.nightShifts,   teamAvgNight)

      balanceUpserts.push({
        tenant_id:                  req.tenantId,
        employee_id:                emp.id,
        period_start:               from,
        period_end:                 to,
        ot_fairness_score:          otFairness,
        weekend_fairness_score:     weekendFairness,
        night_shift_fairness_score: nightFairness,
        total_ot_hours:             totalOtHours,
        weekend_shifts_count:       m.weekendShifts,
        night_shifts_count:         m.nightShifts,
        max_consecutive_days:       maxConsec,
        rest_gap_violations:        m.restGapViolations,
        computed_at:                now,
      })

      // Generate hints for notable issues. period_start/period_end/title/
      // explanation are NOT NULL on workforce_optimization_hints, and
      // hint_type is CHECK-constrained (migration 086) — using the wrong
      // column names/values here previously made every insert fail.
      if (maxConsec >= CONSEC_MEDIUM) {
        const severity = consecutiveSeverity(maxConsec)
        hintsToInsert.push({
          tenant_id:    req.tenantId,
          employee_id:  emp.id,
          period_start: from,
          period_end:   to,
          hint_type:    'consecutive_shift_overload',
          severity,
          title:        `Consecutive shift overload — ${emp.first_name} ${emp.last_name}`,
          explanation:  `${emp.first_name} ${emp.last_name} worked ${maxConsec} consecutive days (${from} to ${to}).`,
          resolved:     false,
        })
      }

      if (m.restGapViolations > 0) {
        hintsToInsert.push({
          tenant_id:    req.tenantId,
          employee_id:  emp.id,
          period_start: from,
          period_end:   to,
          hint_type:    'rest_gap_violation',
          severity:     m.restGapViolations >= 3 ? 'high' : 'medium',
          title:        `Rest gap violation — ${emp.first_name} ${emp.last_name}`,
          explanation:  `${emp.first_name} ${emp.last_name} had ${m.restGapViolations} rest-gap violation(s) (< ${MIN_REST_GAP_HOURS}h) in the period.`,
          resolved:     false,
        })
      }

      if (otFairness < 40 && totalOtHours > 0) {
        hintsToInsert.push({
          tenant_id:    req.tenantId,
          employee_id:  emp.id,
          period_start: from,
          period_end:   to,
          hint_type:    'ot_concentration',
          severity:     otFairness < 20 ? 'high' : 'medium',
          title:        `Overtime imbalance — ${emp.first_name} ${emp.last_name}`,
          explanation:  `${emp.first_name} ${emp.last_name} has an OT fairness score of ${otFairness}/100 (${totalOtHours}h OT vs team avg ${round2(teamAvgOt)}h).`,
          resolved:     false,
        })
      }

      if (weekendFairness < 40 && m.weekendShifts > 0) {
        hintsToInsert.push({
          tenant_id:    req.tenantId,
          employee_id:  emp.id,
          period_start: from,
          period_end:   to,
          hint_type:    'weekend_imbalance',
          severity:     weekendFairness < 20 ? 'high' : 'medium',
          title:        `Weekend shift imbalance — ${emp.first_name} ${emp.last_name}`,
          explanation:  `${emp.first_name} ${emp.last_name} has a weekend-shift fairness score of ${weekendFairness}/100 (${m.weekendShifts} weekend shifts).`,
          resolved:     false,
        })
      }
    }

    // ── Step 6: Upsert balance records in batches ───────────────────────────
    const BATCH = 100

    for (let i = 0; i < balanceUpserts.length; i += BATCH) {
      const batch = balanceUpserts.slice(i, i + BATCH)
      const { error: upsertErr } = await fastify.supabase
        // lint-tenant-ok: batch rows already carry tenant_id (balanceUpserts.push includes tenant_id: req.tenantId above) — upsert payload is tenant-scoped even though the literal isn't inline in this query chain
        .from('workforce_shift_balance')
        .upsert(batch, {
          onConflict: 'tenant_id,employee_id,period_start,period_end',
        })

      if (upsertErr) return serverError(req, reply, upsertErr, ErrorCode.UPDATE_FAILED, 'Failed to persist shift balance records')
    }

    // ── Step 7: Insert hints (delete stale open hints first for this period) ─
    if (hintsToInsert.length > 0) {
      // Match on period_start/period_end (the computed period), not created_at
      // (row-insertion timestamp) — the two are unrelated, and comparing a
      // timestamptz column against bare from/to DATE strings never matched
      // the previous computation of this exact period, leaving stale hints
      // behind indefinitely instead of de-duplicating them.
      await fastify.supabase
        .from('workforce_optimization_hints')
        .delete()
        .eq('tenant_id', req.tenantId)
        .in('employee_id', employeeIds)
        .eq('period_start', from)
        .eq('period_end', to)
        .eq('resolved', false)

      let hintsInserted = 0
      for (let i = 0; i < hintsToInsert.length; i += BATCH) {
        const batch = hintsToInsert.slice(i, i + BATCH)
        const { error: hintErr } = await fastify.supabase
          .from('workforce_optimization_hints')
          .insert(batch)

        if (hintErr) {
          req.log.error({ err: hintErr, batch_start: i }, 'workforce_optimization_hints insert failed')
          // Non-fatal: still return partial success
          req.log.warn('Hint generation had errors; balance records were persisted successfully')
          break
        }
        hintsInserted += batch.length
      }

      return reply.send({
        employees_computed: balanceUpserts.length,
        hints_generated:    hintsInserted,
      })
    }

    return reply.send({
      employees_computed: balanceUpserts.length,
      hints_generated:    0,
    })
  })
}
