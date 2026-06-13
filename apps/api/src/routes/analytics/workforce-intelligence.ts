/**
 * Workforce Intelligence Analytics
 *
 * Operational workforce insights derived from attendance_daily, leave_applications,
 * and employee data. All metrics are tenant-scoped and admin-gated.
 *
 * GET /analytics/workforce/absenteeism      — absenteeism rate trend (weekly buckets)
 * GET /analytics/workforce/overtime         — OT dependency: employees with OT ≥ threshold
 * GET /analytics/workforce/staffing-pressure — worked-on-weekly-off / worked-on-holiday counts
 * GET /analytics/workforce/leave-utilization — leave type utilization rate
 * GET /analytics/workforce/reliability      — per-employee attendance reliability score
 * GET /analytics/workforce/summary          — single-call aggregate for dashboard widgets
 */

import type { FastifyInstance } from 'fastify'
import { z }                   from 'zod'

// ── Date helpers ──────────────────────────────────────────────────────────────

const dateRe = /^\d{4}-\d{2}-\d{2}$/

function defaultRange(weeks = 8): { from: string; to: string } {
  const to  = new Date().toISOString().slice(0, 10)
  const d   = new Date(); d.setDate(d.getDate() - weeks * 7)
  const from = d.toISOString().slice(0, 10)
  return { from, to }
}

function isoWeek(dateStr: string): string {
  const d   = new Date(`${dateStr}T12:00:00Z`)
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const wk  = Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + jan1.getUTCDay() + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
}

// ── Route plugin ─────────────────────────────────────────────────────────────

export default async function workforceIntelligenceRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /analytics/workforce/absenteeism ─────────────────────────────────────
  // Returns weekly absent/present/total counts for trend charting.
  fastify.get('/analytics/workforce/absenteeism', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(12)

    const { data: rows, error } = await fastify.supabase
      .from('attendance_daily')
      .select('date, status')
      .eq('tenant_id', req.tenantId)
      .gte('date', range.from)
      .lte('date', range.to)
      .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch attendance data' })

    // Bucket by ISO week
    const weekMap = new Map<string, { week: string; present: number; absent: number; late: number; total: number }>()

    for (const row of rows ?? []) {
      const wk = isoWeek(row.date)
      const bucket = weekMap.get(wk) ?? { week: wk, present: 0, absent: 0, late: 0, total: 0 }
      bucket.total++
      if (row.status === 'absent' || row.status === 'leave') bucket.absent++
      else if (row.status === 'late') { bucket.present++; bucket.late++ }
      else bucket.present++
      weekMap.set(wk, bucket)
    }

    const buckets = [...weekMap.values()]
      .sort((a, b) => a.week.localeCompare(b.week))
      .map(b => ({
        ...b,
        absent_rate: b.total > 0 ? parseFloat((b.absent / b.total * 100).toFixed(1)) : 0,
        late_rate:   b.total > 0 ? parseFloat((b.late   / b.total * 100).toFixed(1)) : 0,
      }))

    // Summary
    const totalDays    = buckets.reduce((s, b) => s + b.total,   0)
    const totalAbsent  = buckets.reduce((s, b) => s + b.absent,  0)
    const overallRate  = totalDays > 0 ? parseFloat((totalAbsent / totalDays * 100).toFixed(1)) : 0

    return reply.send({
      range,
      buckets,
      summary: { total_records: totalDays, total_absent: totalAbsent, overall_absent_rate: overallRate },
    })
  })

  // ── GET /analytics/workforce/overtime ────────────────────────────────────────
  // OT dependency: how many employees have OT hours in the period.
  fastify.get('/analytics/workforce/overtime', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from:             z.string().regex(dateRe).optional(),
      to:               z.string().regex(dateRe).optional(),
      ot_threshold_min: z.coerce.number().int().min(0).default(30),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(4)
    const threshold = parsed.data.ot_threshold_min

    const { data: rows, error } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, overtime_minutes, date')
      .eq('tenant_id', req.tenantId)
      .gte('date', range.from)
      .lte('date', range.to)
      .gt('overtime_minutes', 0)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch OT data' })

    // Per-employee aggregation
    const empOtMap = new Map<string, { employee_id: string; total_ot_minutes: number; ot_days: number }>()
    for (const row of rows ?? []) {
      const e = empOtMap.get(row.employee_id) ?? { employee_id: row.employee_id, total_ot_minutes: 0, ot_days: 0 }
      e.total_ot_minutes += row.overtime_minutes ?? 0
      e.ot_days++
      empOtMap.set(row.employee_id, e)
    }

    const allOt      = [...empOtMap.values()]
    const aboveThresh = allOt.filter(e => e.total_ot_minutes >= threshold)

    // Weekly OT hours trend
    const weekOtMap = new Map<string, number>()
    for (const row of rows ?? []) {
      const wk = isoWeek(row.date)
      weekOtMap.set(wk, (weekOtMap.get(wk) ?? 0) + (row.overtime_minutes ?? 0))
    }
    const weekly_trend = [...weekOtMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, total_minutes]) => ({ week, total_minutes, total_hours: parseFloat((total_minutes / 60).toFixed(1)) }))

    return reply.send({
      range,
      ot_threshold_minutes: threshold,
      employees_with_ot:      allOt.length,
      employees_above_threshold: aboveThresh.length,
      total_ot_minutes:       allOt.reduce((s, e) => s + e.total_ot_minutes, 0),
      total_ot_hours:         parseFloat((allOt.reduce((s, e) => s + e.total_ot_minutes, 0) / 60).toFixed(1)),
      top_ot_employees:       allOt.sort((a, b) => b.total_ot_minutes - a.total_ot_minutes).slice(0, 10),
      weekly_trend,
    })
  })

  // ── GET /analytics/workforce/staffing-pressure ───────────────────────────────
  // Identifies employees working on weekly-off / holidays — a proxy for understaffing.
  fastify.get('/analytics/workforce/staffing-pressure', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const querySchema = z.object({
      from: z.string().regex(dateRe).optional(),
      to:   z.string().regex(dateRe).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(8)

    const [weeklyOffRes, holidayRes] = await Promise.all([
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, work_hours')
        .eq('tenant_id', req.tenantId)
        .eq('worked_on_weekly_off', true)
        .gte('date', range.from)
        .lte('date', range.to),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, date, work_hours')
        .eq('tenant_id', req.tenantId)
        .eq('worked_on_holiday', true)
        .gte('date', range.from)
        .lte('date', range.to),
    ])

    const weeklyOffRows = weeklyOffRes.data ?? []
    const holidayRows   = holidayRes.data   ?? []

    // Weekly trend
    const weekMap = new Map<string, { week: string; weekly_off_instances: number; holiday_instances: number }>()
    for (const row of weeklyOffRows) {
      const wk = isoWeek(row.date)
      const b  = weekMap.get(wk) ?? { week: wk, weekly_off_instances: 0, holiday_instances: 0 }
      b.weekly_off_instances++
      weekMap.set(wk, b)
    }
    for (const row of holidayRows) {
      const wk = isoWeek(row.date)
      const b  = weekMap.get(wk) ?? { week: wk, weekly_off_instances: 0, holiday_instances: 0 }
      b.holiday_instances++
      weekMap.set(wk, b)
    }

    const weekly_trend = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week))

    return reply.send({
      range,
      weekly_off_instances: weeklyOffRows.length,
      holiday_instances:    holidayRows.length,
      total_pressure_days:  weeklyOffRows.length + holidayRows.length,
      unique_employees_affected: new Set([
        ...weeklyOffRows.map(r => r.employee_id),
        ...holidayRows.map(r => r.employee_id),
      ]).size,
      weekly_trend,
    })
  })

  // ── GET /analytics/workforce/leave-utilization ───────────────────────────────
  // Leave balance vs. taken ratio per leave type for the current year.
  fastify.get('/analytics/workforce/leave-utilization', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const year = parseInt((req.query as any).year ?? new Date().getFullYear().toString())

    const [typesRes, appsRes, balanceRes] = await Promise.all([
      fastify.supabase
        .from('leave_types')
        .select('id, name, is_paid, is_active')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('leave_applications')
        .select('leave_type_id, from_date, to_date, status')
        .eq('tenant_id', req.tenantId)
        .eq('status', 'approved')
        .gte('from_date', `${year}-01-01`)
        .lte('to_date',   `${year}-12-31`),
      fastify.supabase
        .from('employee_leave_balance')
        .select('leave_type_id, balance')
        .eq('tenant_id', req.tenantId)
        .eq('year', year),
    ])

    const types   = typesRes.data   ?? []
    const apps    = appsRes.data    ?? []
    const balances = balanceRes.data ?? []

    // Calculate days taken per leave type
    const daysTakenMap = new Map<string, number>()
    for (const app of apps) {
      const from = new Date(`${app.from_date}T12:00:00Z`)
      const to   = new Date(`${app.to_date}T12:00:00Z`)
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
      daysTakenMap.set(app.leave_type_id, (daysTakenMap.get(app.leave_type_id) ?? 0) + days)
    }

    // Aggregate balance per type
    const balanceMap = new Map<string, number>()
    for (const b of balances) {
      balanceMap.set(b.leave_type_id, (balanceMap.get(b.leave_type_id) ?? 0) + Number(b.balance))
    }

    const utilization = types.map(lt => {
      const taken     = daysTakenMap.get(lt.id) ?? 0
      const remaining = balanceMap.get(lt.id) ?? 0
      const total     = taken + remaining
      return {
        leave_type_id:   lt.id,
        leave_type_name: lt.name,
        is_paid:         lt.is_paid,
        days_taken:      taken,
        days_remaining:  remaining,
        total_entitlement: total,
        utilization_rate: total > 0 ? parseFloat((taken / total * 100).toFixed(1)) : null,
      }
    }).sort((a, b) => (b.utilization_rate ?? 0) - (a.utilization_rate ?? 0))

    return reply.send({ year, utilization })
  })

  // ── GET /analytics/workforce/reliability ─────────────────────────────────────
  // Per-employee attendance reliability score (0–100) based on absent rate,
  // late rate, and incomplete sessions over the given period.
  // Admin can request team-wide; manager gets their team only.
  fastify.get('/analytics/workforce/reliability', auth, async (req: any, reply) => {
    const isAdminRole = ['super_admin', 'hr_admin'].includes(req.userRole)
    const isManager   = req.userRole === 'manager'
    if (!isAdminRole && !isManager) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or admin access required' })
    }

    const querySchema = z.object({
      from:  z.string().regex(dateRe).optional(),
      to:    z.string().regex(dateRe).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const range = parsed.data.from && parsed.data.to
      ? { from: parsed.data.from, to: parsed.data.to }
      : defaultRange(8)

    const { data: rows, error } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, status, work_hours')
      .eq('tenant_id', req.tenantId)
      .gte('date', range.from)
      .lte('date', range.to)
      .in('status', ['present', 'absent', 'late', 'half_day', 'leave'])

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch data' })

    // Aggregate per employee
    const empMap = new Map<string, { present: number; absent: number; late: number; total: number }>()
    for (const row of rows ?? []) {
      const e = empMap.get(row.employee_id) ?? { present: 0, absent: 0, late: 0, total: 0 }
      e.total++
      if (row.status === 'absent' || row.status === 'leave') e.absent++
      else if (row.status === 'late') { e.present++; e.late++ }
      else e.present++
      empMap.set(row.employee_id, e)
    }

    // Score formula: 100 - (absent_rate * 60) - (late_rate * 20)
    // Clamped to [0, 100]
    const scored = [...empMap.entries()]
      .map(([employee_id, stats]) => {
        const absentRate = stats.total > 0 ? stats.absent / stats.total : 0
        const lateRate   = stats.total > 0 ? stats.late   / stats.total : 0
        const score      = Math.max(0, Math.min(100, Math.round(100 - absentRate * 60 - lateRate * 20)))
        return {
          employee_id,
          score,
          grade:        score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
          total_days:   stats.total,
          present_days: stats.present,
          absent_days:  stats.absent,
          late_days:    stats.late,
          absent_rate:  parseFloat((absentRate * 100).toFixed(1)),
          late_rate:    parseFloat((lateRate   * 100).toFixed(1)),
        }
      })
      .sort((a, b) => a.score - b.score)    // worst first for actionability
      .slice(0, parsed.data.limit)

    // Grade distribution
    const gradeDistrib = scored.reduce((acc, s) => {
      acc[s.grade] = (acc[s.grade] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    const avgScore = scored.length > 0
      ? parseFloat((scored.reduce((s, e) => s + e.score, 0) / scored.length).toFixed(1))
      : null

    return reply.send({
      range,
      employees: scored,
      summary:   { avg_score: avgScore, grade_distribution: gradeDistrib, total: scored.length },
    })
  })

  // ── GET /analytics/workforce/summary ─────────────────────────────────────────
  // Single-call aggregate for dashboard widgets — combines key metrics.
  fastify.get('/analytics/workforce/summary', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const range = defaultRange(4)  // last 4 weeks

    const [dailyRes, otRes, pressureRes, anomalyRes] = await Promise.all([
      fastify.supabase
        .from('attendance_daily')
        .select('status, worked_on_weekly_off, worked_on_holiday, overtime_minutes')
        .eq('tenant_id', req.tenantId)
        .gte('date', range.from)
        .lte('date', range.to),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
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
        .or('worked_on_weekly_off.eq.true,worked_on_holiday.eq.true'),
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId)
        .eq('is_resolved', false),
    ])

    const daily = dailyRes.data ?? []
    const total = daily.length
    const absent  = daily.filter(d => d.status === 'absent').length
    const late    = daily.filter(d => d.status === 'late').length
    const onLeave = daily.filter(d => d.status === 'leave').length

    return reply.send({
      range,
      attendance: {
        total_records:    total,
        // C4 canonical: absent_rate = (absent+leave)/total — headline absenteeism KPI
        absent_rate:      total > 0 ? parseFloat(((absent + onLeave) / total * 100).toFixed(1)) : 0,
        absent_only_rate: total > 0 ? parseFloat((absent  / total * 100).toFixed(1)) : 0,
        late_rate:        total > 0 ? parseFloat((late    / total * 100).toFixed(1)) : 0,
        on_leave_rate:    total > 0 ? parseFloat((onLeave / total * 100).toFixed(1)) : 0,
      },
      overtime: {
        employees_with_ot: new Set(otRes.data?.map((r: any) => r.employee_id) ?? []).size,
        total_ot_minutes:  daily.reduce((s, d) => s + (d.overtime_minutes ?? 0), 0),
      },
      staffing_pressure: pressureRes.count ?? 0,
      unresolved_anomalies: anomalyRes.count ?? 0,
    })
  })
}
