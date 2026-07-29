/**
 * Executive Intelligence Analytics
 *
 * C-suite / executive dashboard analytics — composite metrics derived from
 * attendance, staffing snapshots, payroll, exceptions, and operational data.
 * All routes are tenant-scoped and restricted to hr_admin / super_admin.
 *
 * GET /analytics/executive/workforce-stability      — attendance + turnover KPIs
 * GET /analytics/executive/staffing-sustainability  — coverage ratio + pressure for a month
 * GET /analytics/executive/payroll-volatility       — OT and LOP risk metrics
 * GET /analytics/executive/operational-sla          — exception + incident SLA breach rates
 * GET /analytics/executive/exception-resolution     — exception resolution funnel
 * GET /analytics/executive/burnout-exposure         — at-risk employees (sustained overload)
 * GET /analytics/executive/reliability-trends       — monthly reliability trend (N months)
 * GET /analytics/executive/dashboard                — composite snapshot for executive cards
 *
 * Auth: JWT required. hr_admin / super_admin only.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES }       from '../../lib/rbac.js'
import { fetchAllRows }         from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz }        from '../../lib/attendance-engine.js'
import { getLocalDate }         from '../../lib/org-context.js'
const dateRe   = /^\d{4}-\d{2}-\d{2}$/
const monthRe  = /^\d{4}-\d{2}$/

// ── Helpers ──────────────────────────────────────────────────────────────────

// Tenant-local "today" — a bare server-UTC clock would default every
// "last 30 days"/"this month" boundary below to the wrong day for a
// tenant ahead of UTC (e.g. IST) during the skew window around midnight.
async function tenantToday(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

function daysBeforeISO(today: string, days: number): string {
  return new Date(new Date(`${today}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

function defaultRange(today: string, days = 30): { from: string; to: string } {
  return { from: daysBeforeISO(today, days), to: today }
}

function safeRate(numerator: number, denominator: number, decimals = 1): number {
  return denominator > 0
    ? parseFloat(((numerator / denominator) * 100).toFixed(decimals))
    : 0
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export default async function executiveIntelligenceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /analytics/executive/workforce-stability ──────────────────────────
  fastify.get('/analytics/executive/workforce-stability', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const today = await tenantToday(fastify, req.tenantId)
    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(today, 30)

    const periodDays = Math.round(
      (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000,
    ) + 1

    const [rows, employeeRes, separationRes] = await Promise.all([
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('status')
          .eq('tenant_id', req.tenantId)
          .gte('date', range.from)
          .lte('date', range.to)
          .range(from, to),
      ),

      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .in('status', ['active', 'on_notice']),

      fastify.supabase
        .from('employee_separation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('last_working_date', range.from)
        .lte('last_working_date', range.to),
    ])

    // A transient failure on either would otherwise silently render as a
    // fabricated 0 employee_count/turnover_rate on this executive KPI.
    if (employeeRes.error || separationRes.error) {
      return serverError(req, reply, employeeRes.error ?? separationRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch workforce stability data')
    }

    const total        = rows.length
    const presentCount = rows.filter((r: any) => r.status === 'present' || r.status === 'late').length
    const absentCount  = rows.filter((r: any) => r.status === 'absent').length

    const attendance_rate    = safeRate(presentCount, total)
    const absence_rate       = safeRate(absentCount, total)
    const employee_count     = employeeRes.count ?? 0
    const separations        = separationRes.count ?? 0
    const turnover_rate      = employee_count > 0
      ? parseFloat(((separations / employee_count) * 100).toFixed(1))
      : 0

    // Consistency score: proportion of expected working days that have any record
    const expected_records   = employee_count * periodDays
    const consistency_score  = safeRate(total, expected_records)

    return reply.send({
      attendance_rate,
      absence_rate,
      consistency_score,
      turnover_rate,
      period_days:  periodDays,
      employee_count,
      range,
    })
  })

  // ── GET /analytics/executive/staffing-sustainability ─────────────────────
  fastify.get('/analytics/executive/staffing-sustainability', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      month: z.string().regex(monthRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const month = parsed.data.month ?? (await tenantToday(fastify, req.tenantId)).slice(0, 7)
    const from  = `${month}-01`
    // Last day of month
    const nextMonth = new Date(`${month}-01`)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const to = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10)

    // A snapshot is unique per dept/day, so a tenant with 33+ departments
    // exceeds PostgREST's 1,000-row cap within a single month.
    let rows: any[]
    try {
      rows = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('workforce_staffing_snapshots')
          .select('coverage_ratio, staffing_pressure, snapshot_date')
          .eq('tenant_id', req.tenantId)
          .gte('snapshot_date', from)
          .lte('snapshot_date', to)
          .range(rangeFrom, rangeTo),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch staffing snapshots')
    }
    const count = rows.length

    const avg_coverage = count > 0
      ? parseFloat((rows.reduce((s: number, r: any) => s + (r.coverage_ratio ?? 0), 0) / count).toFixed(3))
      : 0

    // staffing_pressure is a TEXT enum ('low'|'normal'|'elevated'|'critical' —
    // migration 086), not a number. Averaging/bucketing it as a number
    // silently coerced every row to NaN (string + number, and every numeric
    // comparison against a string is always false), so avg_staffing_pressure
    // was always null and pressure_distribution was always []. Map the real
    // labels to a numeric weight for the average, and bucket by the actual
    // DB label for the distribution.
    const PRESSURE_WEIGHT: Record<string, number> = { low: 0.15, normal: 0.4, elevated: 0.7, critical: 0.95 }
    const avg_staffing_pressure = count > 0
      ? parseFloat((rows.reduce((s: number, r: any) => s + (PRESSURE_WEIGHT[r.staffing_pressure] ?? 0), 0) / count).toFixed(3))
      : 0

    const understaffed_days = rows.filter((r: any) => (r.coverage_ratio ?? 1) < 1).length
    const overstaffed_days  = rows.filter((r: any) => (r.coverage_ratio ?? 1) > 1.1).length
    const critical_days     = rows.filter((r: any) => (r.coverage_ratio ?? 1) < 0.7).length

    // Pressure distribution bucketing — returned as array so frontend can .map() it directly.
    // Shape: [{ pressure: string, count: number }] (matches StaffingSustainabilityResponse.pressure_distribution)
    const pressureCounts = new Map<string, number>()
    for (const r of rows as any[]) {
      const p = r.staffing_pressure ?? 'unknown'
      pressureCounts.set(p, (pressureCounts.get(p) ?? 0) + 1)
    }
    const pressure_distribution = [...pressureCounts.entries()]
      .map(([pressure, count]) => ({ pressure, count }))
      .filter(pd => pd.count > 0)

    return reply.send({
      month,
      avg_coverage,
      understaffed_days,
      overstaffed_days,
      critical_days,
      avg_staffing_pressure,
      pressure_distribution,
      snapshot_count: count,
    })
  })

  // ── GET /analytics/executive/payroll-volatility ───────────────────────────
  fastify.get('/analytics/executive/payroll-volatility', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const today = await tenantToday(fastify, req.tenantId)
    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(today, 30)

    // otRows/allRows are paginated — a date-range attendance_daily fetch
    // across the whole tenant can exceed PostgREST's 1,000-row ceiling,
    // understating OT hours and (worse) the total_records denominator below.
    let otRows: any[]
    let allRows: any[]
    let lopRes: { count: number | null; error: any }
    try {
      ;[otRows, lopRes, allRows] = await Promise.all([
        fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, overtime_minutes')
            .eq('tenant_id', req.tenantId)
            .gte('date', range.from)
            .lte('date', range.to)
            .gt('overtime_minutes', 0)
            .range(from, to),
        ),

        fastify.supabase
          .from('attendance_daily')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .gte('date', range.from)
          .lte('date', range.to)
          .eq('status', 'absent')
          .eq('is_payable', false),

        fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id')
            .eq('tenant_id', req.tenantId)
            .gte('date', range.from)
            .lte('date', range.to)
            .range(from, to),
        ),
      ])
    } catch (err) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch OT data')
    }

    // lopRes is a plain count query, not fetchAllRows — it resolves (never
    // throws) on failure, so the try/catch above does not cover it; without
    // this check a real error here silently fabricates lop_count: 0.
    if (lopRes.error) {
      return serverError(req, reply, lopRes.error, ErrorCode.QUERY_FAILED, 'Failed to fetch LOP data')
    }

    const lop_count   = lopRes.count ?? 0
    const total_records = allRows.length

    // Per-employee OT hours
    const empOtMap = new Map<string, number>()
    for (const row of otRows) {
      empOtMap.set(
        row.employee_id,
        (empOtMap.get(row.employee_id) ?? 0) + (row.overtime_minutes ?? 0),
      )
    }

    const empOtHours  = [...empOtMap.values()].map(m => m / 60)
    const uniqueEmps  = new Set(allRows.map((r: any) => r.employee_id)).size

    const avg_ot_hours = uniqueEmps > 0
      ? parseFloat((empOtHours.reduce((s, h) => s + h, 0) / uniqueEmps).toFixed(2))
      : 0
    const max_ot_hours = empOtHours.length > 0
      ? parseFloat(Math.max(...empOtHours).toFixed(2))
      : 0

    const lop_rate = safeRate(lop_count, total_records)

    // Risk score: weighted blend of OT concentration and LOP rate (0–100)
    const payroll_risk_score = Math.min(
      100,
      Math.round(avg_ot_hours * 2 + lop_rate * 0.5),
    )

    return reply.send({
      avg_ot_hours,
      max_ot_hours,
      lop_rate,
      lop_count,
      payroll_risk_score,
      period: range,
    })
  })

  // ── GET /analytics/executive/operational-sla ─────────────────────────────
  fastify.get('/analytics/executive/operational-sla', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const today = await tenantToday(fastify, req.tenantId)
    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(today, 30)

    const [excTotalRes, excBreachedRes, excOpenRes, incTotalRes, incBreachedRes, incOpenRes] = await Promise.all([
      // Total exceptions in period
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', range.from)
        .lte('created_at', range.to),

      // SLA-breached exceptions
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('sla_breached', true)
        .gte('created_at', range.from)
        .lte('created_at', range.to),

      // Open exceptions
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),

      // Total incidents in period
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', range.from)
        .lte('created_at', range.to),

      // SLA-breached incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('sla_breached', true)
        .gte('created_at', range.from)
        .lte('created_at', range.to),

      // Open incidents
      fastify.supabase
        .from('operational_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'open'),
    ])

    // A transient failure on any of these would otherwise silently read as
    // 0 (via `.count ?? 0`) — a false "all clear" on an executive risk
    // dashboard instead of a visible error.
    for (const res of [excTotalRes, excBreachedRes, excOpenRes, incTotalRes, incBreachedRes, incOpenRes]) {
      if (res.error) return serverError(req, reply, res.error, ErrorCode.QUERY_FAILED, 'Failed to fetch SLA metrics')
    }

    // Resolution hours for resolved exceptions — a real .select() (not
    // count-only), so it must be paginated separately from the head:true
    // count queries above, which are exempt from the 1,000-row cap.
    const resolutionRows = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('attendance_exceptions')
        .select('created_at, resolved_at')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'resolved')
        .gte('created_at', range.from)
        .lte('created_at', range.to)
        .not('resolved_at', 'is', null)
        .range(from, to),
    )

    const exc_total   = excTotalRes.count   ?? 0
    const exc_breached = excBreachedRes.count ?? 0
    const open_exceptions = excOpenRes.count  ?? 0
    const inc_total   = incTotalRes.count   ?? 0
    const inc_breached = incBreachedRes.count ?? 0
    const open_incidents = incOpenRes.count  ?? 0

    const avg_resolution_hours = resolutionRows.length > 0
      ? parseFloat(
          (resolutionRows.reduce((s: number, r: any) => s + ((r.resolved_at && r.created_at) ? (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000 : 0), 0) / resolutionRows.length).toFixed(1),
        )
      : 0

    return reply.send({
      exception_sla_breach_rate: safeRate(exc_breached, exc_total),
      incident_sla_breach_rate:  safeRate(inc_breached, inc_total),
      avg_resolution_hours,
      open_exceptions,
      open_incidents,
      range,
    })
  })

  // ── GET /analytics/executive/exception-resolution ─────────────────────────
  fastify.get('/analytics/executive/exception-resolution', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const today = await tenantToday(fastify, req.tenantId)
    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(today, 30)

    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_exceptions')
          .select('status, severity, exception_type, created_at, resolved_at')
          .eq('tenant_id', req.tenantId)
          .gte('created_at', range.from)
          .lte('created_at', range.to)
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch exception data')
    }

    const allRows       = (rows as any[]).map((r: any) => ({
      ...r,
      resolution_hours: (r.resolved_at && r.created_at)
        ? (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000
        : null,
    }))
    const total         = allRows.length
    const resolved      = allRows.filter((r: any) => r.status === 'resolved')
    const resolved_count = resolved.length
    const resolution_rate = safeRate(resolved_count, total)

    // Avg resolution hours (only resolved with a value)
    const resolvedWithHours = resolved.filter((r: any) => r.resolution_hours !== null && r.resolution_hours !== undefined)
    const avg_resolution_hours = resolvedWithHours.length > 0
      ? parseFloat(
          (resolvedWithHours.reduce((s: number, r: any) => s + (r.resolution_hours ?? 0), 0) / resolvedWithHours.length).toFixed(1),
        )
      : 0

    // Group by severity
    const bySeverityMap = new Map<string, { total: number; resolved: number }>()
    for (const row of allRows) {
      const sev = row.severity ?? 'unknown'
      const bucket = bySeverityMap.get(sev) ?? { total: 0, resolved: 0 }
      bucket.total++
      if (row.status === 'resolved') bucket.resolved++
      bySeverityMap.set(sev, bucket)
    }
    // by_severity as array so frontend can .map() — shape: [{ severity, count, pct }]
    // Matches ExceptionResolutionResponse.by_severity = ExceptionSeverityRow[]
    const by_severity = [...bySeverityMap.entries()].map(([sev, b]) => ({
      severity:        sev,
      count:           b.total,
      pct:             safeRate(b.total, total),
      resolution_rate: safeRate(b.resolved, b.total),
    }))

    // Group by exception type
    const byTypeMap = new Map<string, { total: number; resolved: number }>()
    for (const row of allRows) {
      const typ = row.exception_type ?? 'unknown'
      const bucket = byTypeMap.get(typ) ?? { total: 0, resolved: 0 }
      bucket.total++
      if (row.status === 'resolved') bucket.resolved++
      byTypeMap.set(typ, bucket)
    }
    const by_type = Object.fromEntries(
      [...byTypeMap.entries()].map(([typ, b]) => [
        typ,
        { ...b, resolution_rate: safeRate(b.resolved, b.total) },
      ]),
    )

    return reply.send({
      total_exceptions: total,
      resolved_count,
      resolution_rate,
      by_severity,
      by_type,
      avg_resolution_hours,
      range,
    })
  })

  // ── GET /analytics/executive/burnout-exposure ─────────────────────────────
  fastify.get('/analytics/executive/burnout-exposure', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      period: z.string().regex(monthRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const period = parsed.data.period ?? (await tenantToday(fastify, req.tenantId)).slice(0, 7)
    const from   = `${period}-01`
    const nextMonth = new Date(`${period}-01`)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const to = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10)

    // Paginated — a month's rows across the whole tenant can exceed
    // PostgREST's 1,000-row ceiling, silently understating both burnout
    // hints and sustained-overload detection.
    const [hints, overloadRows] = await Promise.all([
      // Workforce optimization hints for burnout-related types
      fetchAllRows((from2, to2) =>
        fastify.supabase
          .from('workforce_optimization_hints')
          .select('hint_type, severity, employee_id')
          .eq('tenant_id', req.tenantId)
          .in('hint_type', ['consecutive_shift_overload', 'ot_concentration'])
          .gte('created_at', from)
          .lte('created_at', to)
          .range(from2, to2),
      ),

      // Employees with sustained overload: work_hours > 9 on 5+ days in period
      fetchAllRows((from2, to2) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, work_hours')
          .eq('tenant_id', req.tenantId)
          .gte('date', from)
          .lte('date', to)
          .gt('work_hours', 9)
          .range(from2, to2),
      ),
    ])

    // Count overload days per employee
    const overloadDaysMap = new Map<string, number>()
    for (const row of overloadRows) {
      overloadDaysMap.set(row.employee_id, (overloadDaysMap.get(row.employee_id) ?? 0) + 1)
    }

    // Employees with 5+ sustained overload days
    const sustained_overload_employees = [...overloadDaysMap.entries()]
      .filter(([, days]) => days >= 5)
      .map(([employee_id, overload_days]) => ({ employee_id, overload_days }))
      .sort((a, b) => b.overload_days - a.overload_days)

    // Unique at-risk employees (from hints + sustained overload)
    const hintEmployeeIds = new Set(hints.map((h: any) => h.employee_id).filter(Boolean))
    const overloadEmpIds  = new Set(sustained_overload_employees.map(e => e.employee_id))
    const at_risk_employees = new Set([...hintEmployeeIds, ...overloadEmpIds]).size

    // Hint counts by severity
    const hintsBySeverityMap = new Map<string, number>()
    for (const hint of hints) {
      const sev = hint.severity ?? 'unknown'
      hintsBySeverityMap.set(sev, (hintsBySeverityMap.get(sev) ?? 0) + 1)
    }
    const hint_count_by_severity = Object.fromEntries(hintsBySeverityMap.entries())

    // overload_concentration: ratio (0–1) of employees with sustained overload vs any overload.
    // Frontend uses it as a decimal and multiplies by 100 for display (e.g. 0.35 → "35.0%").
    const overload_total = overloadDaysMap.size
    const overload_concentration = overload_total > 0
      ? parseFloat((sustained_overload_employees.length / overload_total).toFixed(3))
      : 0

    // Keep the detailed list as a separate field for consumers that need it.
    const sustained_overload_employees_list = sustained_overload_employees.slice(0, 10)

    return reply.send({
      period,
      at_risk_employees,
      hint_count:            hints.length,
      hint_count_by_severity,
      overload_concentration,
      sustained_overload_employees: sustained_overload_employees_list,
    })
  })

  // ── GET /analytics/executive/reliability-trends ───────────────────────────
  fastify.get('/analytics/executive/reliability-trends', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      months: z.coerce.number().int().min(1).max(24).default(3),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const monthCount = parsed.data.months
    const today      = await tenantToday(fastify, req.tenantId)
    const [todayY, todayM] = today.split('-').map(Number)

    // Build month boundaries (oldest first) — pure Date.UTC() arithmetic,
    // anchored on the tenant-local "today" string, so it never mixes a
    // UTC-string-parsed date with the server's local getMonth()/setMonth().
    const monthBoundaries: Array<{ month: string; from: string; to: string }> = []
    for (let i = monthCount - 1; i >= 0; i--) {
      const target   = new Date(Date.UTC(todayY, todayM - 1 - i, 1))
      const y        = target.getUTCFullYear()
      const m        = target.getUTCMonth()
      const monthStr = `${y}-${String(m + 1).padStart(2, '0')}`
      const from     = `${monthStr}-01`
      const lastDay  = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
      const to       = `${monthStr}-${String(lastDay).padStart(2, '0')}`
      monthBoundaries.push({ month: monthStr, from, to })
    }

    const oldest = monthBoundaries[0]?.from ?? defaultRange(today, monthCount * 30).from
    const newest = monthBoundaries[monthBoundaries.length - 1]?.to ?? today

    const allRows = await fetchAllRows((from, to) =>
      fastify.supabase
        .from('attendance_daily')
        .select('date, status')
        .eq('tenant_id', req.tenantId)
        .gte('date', oldest)
        .lte('date', newest)
        .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])
        .range(from, to),
    )

    const trends = monthBoundaries.map(({ month, from, to }) => {
      const monthRows = allRows.filter((r: any) => r.date >= from && r.date <= to)
      const total     = monthRows.length
      const present   = monthRows.filter((r: any) => r.status === 'present').length
      const late      = monthRows.filter((r: any) => r.status === 'late').length
      const absent    = monthRows.filter((r: any) => r.status === 'absent' || r.status === 'leave').length

      return {
        month,
        present_rate: safeRate(present, total),
        late_rate:    safeRate(late, total),
        absent_rate:  safeRate(absent, total),
        total_records: total,
      }
    })

    // NOTE: field renamed `trends` → `months` to match frontend ReliabilityTrendsResponse type.
    // `month_count` echoes the query param as a number (was previously the conflicting `months` field).
    return reply.send({ months: trends, month_count: monthCount })
  })

  // ── GET /analytics/executive/dashboard ───────────────────────────────────
  // Composite executive dashboard snapshot — aggregates all key metrics in one call.
  fastify.get('/analytics/executive/dashboard', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const today   = await tenantToday(fastify, req.tenantId)
    const range   = defaultRange(today, 30)
    const period  = today.slice(0, 7)
    const from30  = range.from
    const to30    = range.to

    // One hour ago for SLA queries
    const now          = new Date()
    const from30Dt     = `${from30}T00:00:00`

    // attendance_daily/workforce_staffing_snapshots/workforce_optimization_hints
    // are paginated — date-range fetches across the whole tenant can exceed
    // PostgREST's 1,000-row ceiling, silently understating attendance rate,
    // OT hours, LOP, total_records (used as a denominator), and burnout
    // detection. The count:exact+head:true queries are unaffected by the
    // row cap and left as plain Supabase responses.
    const [
      dailyRows,
      employeeRes,
      separationRes,
      snapshots,
      otRows,
      lopRes,
      allRows,
      excTotalRes,
      excBreachedRes,
      hints,
      overloadRows,
    ] = await Promise.all([
      // Workforce stability
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('status, employee_id')
          .eq('tenant_id', req.tenantId)
          .gte('date', from30)
          .lte('date', to30)
          .range(from, to),
      ),

      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .in('status', ['active', 'on_notice']),

      fastify.supabase
        .from('employee_separation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('last_working_date', from30)
        .lte('last_working_date', to30),

      // Staffing sustainability
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('workforce_staffing_snapshots')
          .select('coverage_ratio, staffing_pressure')
          .eq('tenant_id', req.tenantId)
          .gte('snapshot_date', `${period}-01`)
          .lte('snapshot_date', to30)
          .range(from, to),
      ),

      // Payroll volatility OT
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, overtime_minutes')
          .eq('tenant_id', req.tenantId)
          .gte('date', from30)
          .lte('date', to30)
          .gt('overtime_minutes', 0)
          .range(from, to),
      ),

      // LOP
      fastify.supabase
        .from('attendance_daily')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('date', from30)
        .lte('date', to30)
        .eq('status', 'absent')
        .eq('is_payable', false),

      // All daily for period (for total records)
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .gte('date', from30)
          .lte('date', to30)
          .range(from, to),
      ),

      // Exception SLA
      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('created_at', from30Dt),

      fastify.supabase
        .from('attendance_exceptions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('sla_breached', true)
        .gte('created_at', from30Dt),

      // Burnout hints
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('workforce_optimization_hints')
          .select('employee_id, severity')
          .eq('tenant_id', req.tenantId)
          .in('hint_type', ['consecutive_shift_overload', 'ot_concentration'])
          .gte('created_at', `${period}-01`)
          .range(from, to),
      ),

      // Sustained overload
      fetchAllRows((from, to) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .gte('date', `${period}-01`)
          .lte('date', to30)
          .gt('work_hours', 9)
          .range(from, to),
      ),
    ])

    // A transient failure on any of these plain count queries would otherwise
    // silently render as a fabricated 0 on this composite executive dashboard.
    for (const res of [employeeRes, separationRes, lopRes, excTotalRes, excBreachedRes]) {
      if (res.error) return serverError(req, reply, res.error, ErrorCode.QUERY_FAILED, 'Failed to compute executive dashboard')
    }

    // ── Workforce stability ──
    const totalDaily  = dailyRows.length
    const presentCount = dailyRows.filter((r: any) => r.status === 'present' || r.status === 'late').length
    const absentCount  = dailyRows.filter((r: any) => r.status === 'absent').length
    const employee_count = employeeRes.count ?? 0
    const separations    = separationRes.count ?? 0
    const expected       = employee_count * 30
    const consistency_score = safeRate(totalDaily, expected)

    const workforce_stability = {
      attendance_rate:  safeRate(presentCount, totalDaily),
      absence_rate:     safeRate(absentCount, totalDaily),
      consistency_score,
      turnover_rate:    employee_count > 0
        ? parseFloat(((separations / employee_count) * 100).toFixed(1))
        : 0,
      employee_count,
    }

    // ── Staffing sustainability ──
    const snapCount = snapshots.length
    const avg_coverage = snapCount > 0
      ? parseFloat((snapshots.reduce((s: number, r: any) => s + (r.coverage_ratio ?? 0), 0) / snapCount).toFixed(3))
      : 0
    const understaffed_days = snapshots.filter((r: any) => (r.coverage_ratio ?? 1) < 1).length
    const critical_days     = snapshots.filter((r: any) => (r.coverage_ratio ?? 1) < 0.7).length

    const staffing_sustainability = { avg_coverage, understaffed_days, critical_days }

    // ── Payroll volatility ──
    const lop_count = lopRes.count ?? 0
    const total_records = allRows.length
    const uniqueEmps = new Set(allRows.map((r: any) => r.employee_id)).size

    const empOtMap = new Map<string, number>()
    for (const row of otRows) {
      empOtMap.set(row.employee_id, (empOtMap.get(row.employee_id) ?? 0) + (row.overtime_minutes ?? 0))
    }
    const empOtHours = [...empOtMap.values()].map(m => m / 60)
    const avg_ot_hours = uniqueEmps > 0
      ? parseFloat((empOtHours.reduce((s, h) => s + h, 0) / uniqueEmps).toFixed(2))
      : 0
    const lop_rate = safeRate(lop_count, total_records)
    const payroll_risk_score = Math.min(100, Math.round(avg_ot_hours * 2 + lop_rate * 0.5))

    const payroll_volatility = { avg_ot_hours, lop_rate, payroll_risk_score }

    // ── Operational SLA ──
    const exc_total    = excTotalRes.count   ?? 0
    const exc_breached = excBreachedRes.count ?? 0
    const operational_sla = {
      exception_sla_breach_rate: safeRate(exc_breached, exc_total),
    }

    // ── Burnout exposure ──
    const overloadDaysMap = new Map<string, number>()
    for (const row of overloadRows) {
      overloadDaysMap.set(row.employee_id, (overloadDaysMap.get(row.employee_id) ?? 0) + 1)
    }
    const hintEmpIds    = new Set(hints.map((h: any) => h.employee_id).filter(Boolean))
    const overloadEmpIds = new Set([...overloadDaysMap.entries()].filter(([, d]) => d >= 5).map(([id]) => id))
    const at_risk_employees = new Set([...hintEmpIds, ...overloadEmpIds]).size

    const burnout_exposure = { at_risk_employees, hint_count: hints.length }

    // Flatten to match frontend ExecutiveDashboard interface (flat fields, not nested objects).
    // Components read data.attendance_rate etc. directly — no nested destructuring needed.
    return reply.send({
      // ── Workforce stability ──
      attendance_rate:           workforce_stability.attendance_rate,
      absence_rate:              workforce_stability.absence_rate,
      consistency_score:         workforce_stability.consistency_score,
      // ── Operational SLA ── (only exception breach rate queried in this endpoint)
      exception_sla_breach_rate: operational_sla.exception_sla_breach_rate,
      incident_sla_breach_rate:  0,   // use /analytics/executive/operational-sla for full data
      open_exceptions:           0,   // use /analytics/executive/operational-sla for full data
      open_incidents:            0,   // use /analytics/executive/operational-sla for full data
      // ── Payroll volatility ──
      avg_ot_hours:              payroll_volatility.avg_ot_hours,
      lop_rate:                  payroll_volatility.lop_rate,
      payroll_risk_score:        payroll_volatility.payroll_risk_score,
      // ── Extra context (not required by interface but useful) ──
      generated_at: now.toISOString(),
      period:       { from: from30, to: to30 },
    })
  })
}
