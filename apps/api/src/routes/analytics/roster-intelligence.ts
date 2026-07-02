/**
 * Roster Intelligence Analytics — Phase 3
 *
 * Operational shift/roster analytics derived from shift_roster, employee_shifts,
 * and attendance_daily. All endpoints are tenant-scoped and admin-gated.
 *
 * GET /analytics/roster/coverage     — daily coverage: staffed vs expected per shift
 * GET /analytics/roster/heatmap      — employee × weekday work-hours heatmap
 * GET /analytics/roster/burnout      — burnout risk: OT + weekly-off worked + late
 * GET /analytics/roster/gaps         — understaffed days (below min_headcount)
 * GET /analytics/roster/summary      — single-call aggregate for dashboard widget
 */

import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'
import { HR_ADMIN_ROLES }      from '../../lib/rbac.js'

// ── Date helpers ──────────────────────────────────────────────────────────────

const dateRe  = /^\d{4}-\d{2}-\d{2}$/
const monthRe = /^\d{4}-\d{2}$/

function expandDateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${from}T12:00:00.000Z`)
  const end = new Date(`${to}T12:00:00.000Z`)
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

function defaultRange(weeks = 4): { from: string; to: string } {
  const to  = new Date().toISOString().slice(0, 10)
  const d   = new Date(); d.setDate(d.getDate() - weeks * 7)
  return { from: d.toISOString().slice(0, 10), to }
}

function monthBounds(monthStr: string): { from: string; to: string } {
  const [y, mo] = monthStr.split('-').map(Number)
  const from = `${monthStr}-01`
  const to   = new Date(y, mo, 0).toISOString().slice(0, 10)
  return { from, to }
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export default async function rosterIntelligenceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /analytics/roster/coverage ──────────────────────────────────────────
  //
  // For each day in range, computes per-shift: scheduled (from shift_roster + standing
  // employee_shifts) vs actually present (from attendance_daily).
  // Returns: [{ date, shift_id, shift_name, scheduled, present, absent, coverage_pct }]
  fastify.get('/analytics/roster/coverage', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const qs = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    }).safeParse(req.query)
    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })

    const { from, to } = qs.data.from ? { from: qs.data.from, to: qs.data.to! } : defaultRange(4)
    const dates = expandDateRange(from, to)

    // ── Fetch all data in parallel ─────────────────────────────────────────────
    const [
      { data: rosterRows },
      { data: standingRows },
      { data: shifts },
      { data: dailyRows },
    ] = await Promise.all([
      // Roster overrides
      fastify.supabase
        .from('shift_roster')
        .select('employee_id, date, shift_id')
        .eq('tenant_id', req.tenantId)
        .in('date', dates),
      // Standing assignments (is_current = true)
      fastify.supabase
        .from('employee_shifts')
        .select('employee_id, shift_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
      // All shifts
      fastify.supabase
        .from('shifts')
        .select('id, name, code')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
      // Attendance status
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, status')
        .eq('tenant_id', req.tenantId)
        .in('date', dates)
        .in('status', ['present', 'late']),
    ])

    const shiftMap  = new Map((shifts ?? []).map((s: any) => [s.id, s]))
    const standMap  = new Map((standingRows ?? []).map((r: any) => [r.employee_id, r.shift_id]))

    // Override map: `${employee_id}:${date}` → shift_id
    const overrideMap = new Map<string, string>()
    for (const r of rosterRows ?? []) {
      overrideMap.set(`${r.employee_id}:${r.date}`, r.shift_id)
    }

    // Present set: `${employee_id}:${date}`
    const presentSet = new Set<string>(
      (dailyRows ?? []).map((r: any) => `${r.employee_id}:${r.date}`)
    )

    // Build: date × shift → { scheduled, present }
    type CoverageKey = string  // `${date}:${shift_id}`
    const coverage = new Map<CoverageKey, { scheduled: number; present: number }>()

    // Every employee that has any shift assignment (roster override OR standing)
    const allEmployeeIds = new Set([
      ...(rosterRows ?? []).map((r: any) => r.employee_id),
      ...(standingRows ?? []).map((r: any) => r.employee_id),
    ])

    for (const date of dates) {
      for (const empId of allEmployeeIds) {
        const shiftId = overrideMap.get(`${empId}:${date}`) ?? standMap.get(empId)
        if (!shiftId) continue
        const key = `${date}:${shiftId}`
        const entry = coverage.get(key) ?? { scheduled: 0, present: 0 }
        entry.scheduled++
        if (presentSet.has(`${empId}:${date}`)) entry.present++
        coverage.set(key, entry)
      }
    }

    const result = Array.from(coverage.entries()).map(([key, val]) => {
      const [date, shiftId] = key.split(':')
      const shift = shiftMap.get(shiftId) as any
      return {
        date,
        shift_id:     shiftId,
        shift_name:   shift?.name ?? 'Unknown',
        shift_code:   shift?.code ?? null,
        scheduled:    val.scheduled,
        present:      val.present,
        absent:       val.scheduled - val.present,
        coverage_pct: val.scheduled > 0
          ? Math.round((val.present / val.scheduled) * 100)
          : 0,
      }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.shift_name.localeCompare(b.shift_name))

    return reply.send({ range: { from, to }, coverage: result })
  })

  // ── GET /analytics/roster/heatmap ───────────────────────────────────────────
  //
  // Returns a weekday × shift heatmap: average work hours per slot.
  // Used to identify which shift/day combinations see the most burnout.
  // Returns: [{ shift_name, weekday: 0-6, avg_work_hours, record_count }]
  fastify.get('/analytics/roster/heatmap', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const qs = z.object({
      month: z.string().regex(monthRe).optional(),
    }).safeParse(req.query)
    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })

    const now = new Date()
    const monthStr = qs.data.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const { from, to } = monthBounds(monthStr)
    const dates = expandDateRange(from, to)

    const [
      { data: rosterRows },
      { data: standingRows },
      { data: shifts },
      { data: dailyRows },
    ] = await Promise.all([
      fastify.supabase
        .from('shift_roster')
        .select('employee_id, date, shift_id')
        .eq('tenant_id', req.tenantId)
        .in('date', dates),
      fastify.supabase
        .from('employee_shifts')
        .select('employee_id, shift_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
      fastify.supabase
        .from('shifts')
        .select('id, name, code')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, work_hours, status')
        .eq('tenant_id', req.tenantId)
        .in('date', dates)
        .in('status', ['present', 'late', 'half_day']),
    ])

    const shiftMap   = new Map((shifts ?? []).map((s: any) => [s.id, s]))
    const standMap   = new Map((standingRows ?? []).map((r: any) => [r.employee_id, r.shift_id]))
    const overrideMap = new Map<string, string>()
    for (const r of rosterRows ?? []) {
      overrideMap.set(`${r.employee_id}:${r.date}`, r.shift_id)
    }
    const dailyMap = new Map<string, number>(
      (dailyRows ?? []).map((r: any) => [`${r.employee_id}:${r.date}`, r.work_hours])
    )

    // Accumulate: `${shift_id}:${weekday}` → { totalHours, count }
    const heatmap = new Map<string, { totalHours: number; count: number }>()

    for (const date of dates) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()  // 0=Sun…6=Sat
      for (const empId of new Set([
        ...(rosterRows ?? []).map((r: any) => r.employee_id),
        ...(standingRows ?? []).map((r: any) => r.employee_id),
      ])) {
        const shiftId  = overrideMap.get(`${empId}:${date}`) ?? standMap.get(empId)
        const hours    = dailyMap.get(`${empId}:${date}`)
        if (!shiftId || hours == null) continue
        const key   = `${shiftId}:${weekday}`
        const entry = heatmap.get(key) ?? { totalHours: 0, count: 0 }
        entry.totalHours += hours
        entry.count++
        heatmap.set(key, entry)
      }
    }

    const result = Array.from(heatmap.entries()).map(([key, val]) => {
      const [shiftId, wdStr] = key.split(':')
      const shift = shiftMap.get(shiftId) as any
      return {
        shift_id:       shiftId,
        shift_name:     shift?.name ?? 'Unknown',
        weekday:        Number(wdStr),
        avg_work_hours: val.count > 0
          ? Math.round((val.totalHours / val.count) * 10) / 10
          : 0,
        record_count:   val.count,
      }
    }).sort((a, b) => a.shift_name.localeCompare(b.shift_name) || a.weekday - b.weekday)

    return reply.send({ month: monthStr, heatmap: result })
  })

  // ── GET /analytics/roster/burnout ────────────────────────────────────────────
  //
  // Identifies employees at burnout risk based on:
  //   - OT minutes > threshold (chronic overtime)
  //   - worked_on_weekly_off > threshold (sacrificed rest days)
  //   - late_minutes total > threshold (stress indicator)
  //
  // Returns sorted list: [{ employee_id, name, code, ot_minutes, weekly_off_days,
  //                         late_minutes, risk_score, severity }]
  fastify.get('/analytics/roster/burnout', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const qs = z.object({
      month: z.string().regex(monthRe).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).safeParse(req.query)
    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })

    const now = new Date()
    const monthStr = qs.data.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const { from, to } = monthBounds(monthStr)

    const [
      { data: employees },
      { data: dailyRows },
    ] = await Promise.all([
      fastify.supabase
        .from('employees')
        .select('id, employee_code, first_name, last_name')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'active'),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes, late_minutes, worked_on_weekly_off, worked_on_holiday, status')
        .eq('tenant_id', req.tenantId)
        .gte('date', from)
        .lte('date', to),
    ])

    const empMap = new Map((employees ?? []).map((e: any) => [e.id, e]))

    // Aggregate per employee
    const agg = new Map<string, {
      ot_minutes:       number
      weekly_off_days:  number
      holiday_days:     number
      late_minutes:     number
      total_days:       number
    }>()

    for (const r of dailyRows ?? []) {
      const e = agg.get(r.employee_id) ?? { ot_minutes: 0, weekly_off_days: 0, holiday_days: 0, late_minutes: 0, total_days: 0 }
      e.ot_minutes      += r.overtime_minutes ?? 0
      e.weekly_off_days += r.worked_on_weekly_off ? 1 : 0
      e.holiday_days    += r.worked_on_holiday   ? 1 : 0
      e.late_minutes    += r.late_minutes ?? 0
      e.total_days++
      agg.set(r.employee_id, e)
    }

    // Compute risk score (0-100): weighted sum of normalized indicators
    // Thresholds: OT 120h/mo = max, 3 WO days = max, 200 late min = max
    const OT_MAX    = 120 * 60   // 120 hours in minutes
    const WO_MAX    = 3
    const LATE_MAX  = 200

    const scored = Array.from(agg.entries()).map(([empId, vals]) => {
      const emp = empMap.get(empId) as any
      if (!emp) return null

      const otScore   = Math.min(vals.ot_minutes / OT_MAX, 1) * 40
      const woScore   = Math.min(vals.weekly_off_days / WO_MAX, 1) * 35
      const lateScore = Math.min(vals.late_minutes / LATE_MAX, 1) * 25
      const riskScore = Math.round(otScore + woScore + lateScore)

      const severity = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low'

      return {
        employee_id:     empId,
        employee_code:   emp.employee_code,
        name:            `${emp.first_name} ${emp.last_name}`,
        ot_minutes:      vals.ot_minutes,
        ot_hours:        Math.round(vals.ot_minutes / 60 * 10) / 10,
        weekly_off_days: vals.weekly_off_days,
        holiday_days:    vals.holiday_days,
        late_minutes:    vals.late_minutes,
        total_days:      vals.total_days,
        risk_score:      riskScore,
        severity,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null && r.risk_score > 0)
    .sort((a, b) => b.risk_score - a.risk_score)
    .slice(0, qs.data.limit)

    const summary = {
      high:   scored.filter(r => r.severity === 'high').length,
      medium: scored.filter(r => r.severity === 'medium').length,
      low:    scored.filter(r => r.severity === 'low').length,
      total:  scored.length,
    }

    return reply.send({ month: monthStr, summary, employees: scored })
  })

  // ── GET /analytics/roster/gaps ───────────────────────────────────────────────
  //
  // Detects days where actual coverage dropped below a threshold.
  // A "gap" is defined as: scheduled headcount > 0 AND coverage_pct < min_coverage_pct
  //
  // Returns: [{ date, shift_id, shift_name, scheduled, present, coverage_pct, severity }]
  fastify.get('/analytics/roster/gaps', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const qs = z.object({
      from:             z.string().regex(dateRe).optional(),
      to:               z.string().regex(dateRe).optional(),
      min_coverage_pct: z.coerce.number().int().min(0).max(100).default(70),
    }).safeParse(req.query)
    if (!qs.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })

    const { from, to } = qs.data.from ? { from: qs.data.from, to: qs.data.to! } : defaultRange(4)
    const minCovPct = qs.data.min_coverage_pct

    // Re-use coverage logic
    const dates = expandDateRange(from, to)

    const [
      { data: rosterRows },
      { data: standingRows },
      { data: shifts },
      { data: dailyRows },
    ] = await Promise.all([
      fastify.supabase
        .from('shift_roster')
        .select('employee_id, date, shift_id')
        .eq('tenant_id', req.tenantId)
        .in('date', dates),
      fastify.supabase
        .from('employee_shifts')
        .select('employee_id, shift_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
      fastify.supabase
        .from('shifts')
        .select('id, name, code')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, status')
        .eq('tenant_id', req.tenantId)
        .in('date', dates)
        .in('status', ['present', 'late']),
    ])

    const shiftMap    = new Map((shifts ?? []).map((s: any) => [s.id, s]))
    const standMap    = new Map((standingRows ?? []).map((r: any) => [r.employee_id, r.shift_id]))
    const overrideMap = new Map<string, string>()
    for (const r of rosterRows ?? []) overrideMap.set(`${r.employee_id}:${r.date}`, r.shift_id)
    const presentSet  = new Set<string>((dailyRows ?? []).map((r: any) => `${r.employee_id}:${r.date}`))

    const coverage = new Map<string, { scheduled: number; present: number }>()
    const allEmpIds = new Set([
      ...(rosterRows ?? []).map((r: any) => r.employee_id),
      ...(standingRows ?? []).map((r: any) => r.employee_id),
    ])

    for (const date of dates) {
      for (const empId of allEmpIds) {
        const shiftId = overrideMap.get(`${empId}:${date}`) ?? standMap.get(empId)
        if (!shiftId) continue
        const key   = `${date}:${shiftId}`
        const entry = coverage.get(key) ?? { scheduled: 0, present: 0 }
        entry.scheduled++
        if (presentSet.has(`${empId}:${date}`)) entry.present++
        coverage.set(key, entry)
      }
    }

    const gaps = Array.from(coverage.entries())
      .map(([key, val]) => {
        const [date, shiftId] = key.split(':')
        const pct   = val.scheduled > 0 ? Math.round((val.present / val.scheduled) * 100) : 0
        if (pct >= minCovPct) return null
        const shift = shiftMap.get(shiftId) as any
        return {
          date,
          shift_id:     shiftId,
          shift_name:   shift?.name ?? 'Unknown',
          shift_code:   shift?.code ?? null,
          scheduled:    val.scheduled,
          present:      val.present,
          absent:       val.scheduled - val.present,
          coverage_pct: pct,
          severity:     pct < 50 ? 'high' : pct < minCovPct ? 'medium' : 'low',
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.coverage_pct - b.coverage_pct || a.date.localeCompare(b.date))

    // Emit coverage gap events for high-severity gaps
    for (const gap of gaps.filter(g => g.severity === 'high')) {
      // Non-blocking — fire-and-forget to the event bus
      setImmediate(async () => {
        try {
          const { eventBus } = await import('../../lib/event-bus.js')
          eventBus.emit({
            type:          'roster.coverage.gap',
            tenantId:      req.tenantId,
            correlationId: 'system',
            payload:       {
              tenantId: req.tenantId,
              date:     gap.date,
              shiftId:  gap.shift_id,
              gapType:  gap.present === 0 ? 'uncovered' : 'understaffed',
              severity: 'high',
            },
          })
        } catch { /* Non-fatal */ }
      })
    }

    return reply.send({
      range:            { from, to },
      min_coverage_pct: minCovPct,
      total_gaps:       gaps.length,
      high_severity:    gaps.filter(g => g.severity === 'high').length,
      gaps,
    })
  })

  // ── GET /analytics/roster/summary ────────────────────────────────────────────
  //
  // Single-call widget for the roster intelligence dashboard card.
  // Returns aggregate burnout + coverage stats for the current month.
  fastify.get('/analytics/roster/summary', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const now      = new Date()
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const { from, to } = monthBounds(monthStr)

    const [
      { data: dailyRows },
      { data: rosterRows },
      { data: standingRows },
    ] = await Promise.all([
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, overtime_minutes, worked_on_weekly_off, worked_on_holiday')
        .eq('tenant_id', req.tenantId)
        .gte('date', from)
        .lte('date', to),
      fastify.supabase
        .from('shift_roster')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .gte('date', from)
        .lte('date', to),
      fastify.supabase
        .from('employee_shifts')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_current', true),
    ])

    const daily = dailyRows ?? []
    const totalOtMinutes     = daily.reduce((s: number, r: any) => s + (r.overtime_minutes ?? 0), 0)
    const weeklyOffWorked    = daily.filter((r: any) => r.worked_on_weekly_off).length
    const holidaysWorked     = daily.filter((r: any) => r.worked_on_holiday).length

    const rosterCoveredCount = new Set([
      ...(rosterRows ?? []).map((r: any) => r.employee_id),
      ...(standingRows ?? []).map((r: any) => r.employee_id),
    ]).size

    return reply.send({
      month: monthStr,
      roster: {
        covered_employees:   rosterCoveredCount,
        total_ot_hours:      Math.round(totalOtMinutes / 60 * 10) / 10,
        weekly_off_worked:   weeklyOffWorked,
        holidays_worked:     holidaysWorked,
      },
    })
  })
}
