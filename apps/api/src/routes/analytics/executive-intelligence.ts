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
const dateRe   = /^\d{4}-\d{2}-\d{2}$/
const monthRe  = /^\d{4}-\d{2}$/

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultRange(days = 30): { from: string; to: string } {
  const to  = new Date().toISOString().slice(0, 10)
  const d   = new Date(); d.setDate(d.getDate() - days)
  const from = d.toISOString().slice(0, 10)
  return { from, to }
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
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

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(30)

    const periodDays = Math.round(
      (new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000,
    ) + 1

    const [dailyRes, employeeRes, separationRes] = await Promise.all([
      fastify.supabase
        .from('attendance_daily')
        .select('status')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to),

      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),

      fastify.supabase
        .from('employee_separation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('last_working_date', range.from)
        .lte('last_working_date', range.to),
    ])

    if (dailyRes.error) {
      req.log.error({ err: dailyRes.error }, 'workforce stability attendance query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance data' })
    }

    const rows         = dailyRes.data ?? []
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

    const month = parsed.data.month ?? currentMonth()
    const from  = `${month}-01`
    // Last day of month
    const nextMonth = new Date(`${month}-01`)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const to = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10)

    const { data: snapshots, error } = await fastify.supabase
      .from('workforce_staffing_snapshots')
      .select('coverage_ratio, staffing_pressure, snapshot_date')
      .eq('tenant_id', req.tenantId)
      .gte('snapshot_date', from)
      .lte('snapshot_date', to)

    if (error) {
      req.log.error({ err: error }, 'staffing snapshots query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch staffing snapshots' })
    }

    const rows = snapshots ?? []
    const count = rows.length

    const avg_coverage = count > 0
      ? parseFloat((rows.reduce((s: number, r: any) => s + (r.coverage_ratio ?? 0), 0) / count).toFixed(3))
      : 0

    const avg_staffing_pressure = count > 0
      ? parseFloat((rows.reduce((s: number, r: any) => s + (r.staffing_pressure ?? 0), 0) / count).toFixed(3))
      : 0

    const understaffed_days = rows.filter((r: any) => (r.coverage_ratio ?? 1) < 1).length
    const overstaffed_days  = rows.filter((r: any) => (r.coverage_ratio ?? 1) > 1.1).length
    const critical_days     = rows.filter((r: any) => (r.coverage_ratio ?? 1) < 0.7).length

    // Pressure distribution bucketing — returned as array so frontend can .map() it directly.
    // Shape: [{ pressure: string, count: number }] (matches StaffingSustainabilityResponse.pressure_distribution)
    const pressure_distribution = [
      { pressure: 'low',      count: rows.filter((r: any) => (r.staffing_pressure ?? 0) < 0.3).length },
      { pressure: 'moderate', count: rows.filter((r: any) => (r.staffing_pressure ?? 0) >= 0.3 && (r.staffing_pressure ?? 0) < 0.7).length },
      { pressure: 'high',     count: rows.filter((r: any) => (r.staffing_pressure ?? 0) >= 0.7).length },
    ].filter(pd => pd.count > 0)

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

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(30)

    const [otRes, lopRes, empRes] = await Promise.all([
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to)
        .gt('overtime_minutes', 0),

      fastify.supabase
        .from('attendance_daily')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to)
        .eq('status', 'absent')
        .eq('is_payable', false),

      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to),
    ])

    if (otRes.error) {
      req.log.error({ err: otRes.error }, 'payroll volatility OT query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch OT data' })
    }

    const otRows      = otRes.data ?? []
    const allRows     = empRes.data ?? []
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

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(30)

    const [excTotalRes, excBreachedRes, excOpenRes, incTotalRes, incBreachedRes, incOpenRes, resolutionRes] = await Promise.all([
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

      // Resolution hours for resolved exceptions
      fastify.supabase
        .from('attendance_exceptions')
        .select('created_at, resolved_at')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'resolved')
        .gte('created_at', range.from)
        .lte('created_at', range.to)
        .not('resolved_at', 'is', null),
    ])

    const exc_total   = excTotalRes.count   ?? 0
    const exc_breached = excBreachedRes.count ?? 0
    const open_exceptions = excOpenRes.count  ?? 0
    const inc_total   = incTotalRes.count   ?? 0
    const inc_breached = incBreachedRes.count ?? 0
    const open_incidents = incOpenRes.count  ?? 0

    const resRows = resolutionRes.data ?? []
    const avg_resolution_hours = resRows.length > 0
      ? parseFloat(
          (resRows.reduce((s: number, r: any) => s + ((r.resolved_at && r.created_at) ? (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000 : 0), 0) / resRows.length).toFixed(1),
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

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(30)

    const { data: rows, error } = await fastify.supabase
      .from('attendance_exceptions')
      .select('status, severity, exception_type, created_at, resolved_at')
      .eq('tenant_id', req.tenantId)
      .gte('created_at', range.from)
      .lte('created_at', range.to)

    if (error) {
      req.log.error({ err: error }, 'exception resolution query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch exception data' })
    }

    const allRows       = ((rows ?? []) as any[]).map((r: any) => ({
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

    const period = parsed.data.period ?? currentMonth()
    const from   = `${period}-01`
    const nextMonth = new Date(`${period}-01`)
    nextMonth.setMonth(nextMonth.getMonth() + 1)
    const to = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10)

    const [hintsRes, overloadRes] = await Promise.all([
      // Workforce optimization hints for burnout-related types
      fastify.supabase
        .from('workforce_optimization_hints')
        .select('hint_type, severity, employee_id')
        .eq('tenant_id', req.tenantId)
        .in('hint_type', ['consecutive_shift_overload', 'ot_concentration'])
        .gte('created_at', from)
        .lte('created_at', to),

      // Employees with sustained overload: work_hours > 9 on 5+ days in period
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, work_hours')
        .eq('tenant_id', req.tenantId)
        .gte('date', from)
        .lte('date', to)
        .gt('work_hours', 9),
    ])

    const hints         = hintsRes.data  ?? []
    const overloadRows  = overloadRes.data ?? []

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
    const today      = new Date()

    // Build month boundaries (oldest first)
    const monthBoundaries: Array<{ month: string; from: string; to: string }> = []
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const monthStr = d.toISOString().slice(0, 7)
      const from     = `${monthStr}-01`
      const lastDay  = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const to       = lastDay.toISOString().slice(0, 10)
      monthBoundaries.push({ month: monthStr, from, to })
    }

    const oldest = monthBoundaries[0]?.from ?? defaultRange(monthCount * 30).from
    const newest = monthBoundaries[monthBoundaries.length - 1]?.to ?? defaultRange(0).to

    const { data: rows, error } = await fastify.supabase
      .from('attendance_daily')
      .select('date, status')
      .eq('tenant_id', req.tenantId)
      .gte('date', oldest)
      .lte('date', newest)
      .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])

    if (error) {
      req.log.error({ err: error }, 'reliability trends query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance data' })
    }

    const allRows = rows ?? []

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

    const range   = defaultRange(30)
    const period  = currentMonth()
    const from30  = range.from
    const to30    = range.to

    // One hour ago for SLA queries
    const now          = new Date()
    const from30Dt     = `${from30}T00:00:00`

    const [
      dailyRes,
      employeeRes,
      separationRes,
      snapshotRes,
      otRes,
      lopRes,
      allDailyRes,
      excTotalRes,
      excBreachedRes,
      hintsRes,
      overloadRes,
    ] = await Promise.all([
      // Workforce stability
      fastify.supabase
        .from('attendance_daily')
        .select('status, employee_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', from30)
        .lte('date', to30),

      fastify.supabase
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),

      fastify.supabase
        .from('employee_separation')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .gte('last_working_date', from30)
        .lte('last_working_date', to30),

      // Staffing sustainability
      fastify.supabase
        .from('workforce_staffing_snapshots')
        .select('coverage_ratio, staffing_pressure')
        .eq('tenant_id', req.tenantId)
        .gte('snapshot_date', `${period}-01`)
        .lte('snapshot_date', to30),

      // Payroll volatility OT
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes')
        .eq('tenant_id', req.tenantId)
        .gte('date', from30)
        .lte('date', to30)
        .gt('overtime_minutes', 0),

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
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', from30)
        .lte('date', to30),

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
      fastify.supabase
        .from('workforce_optimization_hints')
        .select('employee_id, severity')
        .eq('tenant_id', req.tenantId)
        .in('hint_type', ['consecutive_shift_overload', 'ot_concentration'])
        .gte('created_at', `${period}-01`),

      // Sustained overload
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', `${period}-01`)
        .lte('date', to30)
        .gt('work_hours', 9),
    ])

    // ── Workforce stability ──
    const dailyRows   = dailyRes.data ?? []
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
    const snapshots = snapshotRes.data ?? []
    const snapCount = snapshots.length
    const avg_coverage = snapCount > 0
      ? parseFloat((snapshots.reduce((s: number, r: any) => s + (r.coverage_ratio ?? 0), 0) / snapCount).toFixed(3))
      : 0
    const understaffed_days = snapshots.filter((r: any) => (r.coverage_ratio ?? 1) < 1).length
    const critical_days     = snapshots.filter((r: any) => (r.coverage_ratio ?? 1) < 0.7).length

    const staffing_sustainability = { avg_coverage, understaffed_days, critical_days }

    // ── Payroll volatility ──
    const otRows    = otRes.data ?? []
    const allRows   = allDailyRes.data ?? []
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
    const hints         = hintsRes.data    ?? []
    const overloadRows2 = overloadRes.data ?? []

    const overloadDaysMap = new Map<string, number>()
    for (const row of overloadRows2) {
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
