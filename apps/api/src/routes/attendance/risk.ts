/**
 * Attendance Risk Profile Routes
 *
 * GET  /attendance/risk                       — list risk profiles (admin only)
 * GET  /attendance/risk/summary               — tenant risk summary (admin only)
 * GET  /attendance/risk/employee/:employeeId  — risk profile for one employee
 * POST /attendance/risk/compute               — compute/refresh risk profiles (admin only)
 *
 * Auth: hr_admin / super_admin for all routes.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

function computeRiskLevel(score: number): RiskLevel {
  if (score < 20) return 'low'
  if (score < 40) return 'medium'
  if (score < 70) return 'high'
  return 'critical'
}

// ── Route ────────────────────────────────────────────────────────────────────

export default async function attendanceRiskRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/risk ──────────────────────────────────────────────────
  // List risk profiles for the tenant (admin only).
  const listQuerySchema = z.object({
    risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    period_end: z.string().optional(),   // accepts YYYY-MM-DD or any period string; non-dates fall back to today
    limit:      z.coerce.number().int().min(1).max(500).default(100),
    offset:     z.coerce.number().int().min(0).default(0),
  })

  fastify.get('/attendance/risk', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { risk_level, period_end, limit, offset } = parsed.data
    // Accept YYYY-MM-DD only for DB comparison; anything else (e.g. "2026-Q2") falls back to today
    const effectivePeriodEnd = (period_end && DATE_RE.test(period_end)) ? period_end : todayIso()

    let q = fastify.supabase
      .from('attendance_risk_profiles')
      .select(
        `
          id, employee_id, period_start, period_end,
          risk_score, risk_level, computed_at,
          chronic_late_count, correction_abuse_count,
          punch_anomaly_count, attendance_volatility,
          employees!inner(id, first_name, last_name, employee_code)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .lte('period_end', effectivePeriodEnd)
      .order('risk_score', { ascending: false })
      .order('computed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (risk_level) q = q.eq('risk_level', risk_level)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance_risk_profiles list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch risk profiles' })
    }

    const rows = ((data ?? []) as any[]).map((r) => {
      const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
      return {
        id:                      r.id,
        employee_id:             r.employee_id,
        // nested employees object expected by frontend
        employees:               emp ? {
          first_name:    emp.first_name,
          last_name:     emp.last_name,
          employee_code: emp.employee_code,
        } : null,
        period:                  r.period_end ?? r.period_start,
        period_start:            r.period_start,
        period_end:              r.period_end,
        risk_score:              r.risk_score,
        risk_level:              r.risk_level,
        computed_at:             r.computed_at,
        chronic_late_count:      r.chronic_late_count,
        // absence_streak_days mapped from punch_anomaly_count (closest available metric)
        absence_streak_days:     r.punch_anomaly_count ?? 0,
        correction_abuse_count:  r.correction_abuse_count,
        // volatility_score mapped from attendance_volatility
        volatility_score:        r.attendance_volatility ?? 0,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/risk/summary ──────────────────────────────────────────
  // Tenant-wide risk summary — latest profile per employee, aggregated by level.
  const summaryQuerySchema = z.object({
    period_end: z.string().optional(),   // accepts any string; non-dates fall back to today
  })

  fastify.get('/attendance/risk/summary', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = summaryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const rawEnd = parsed.data.period_end
    const effectivePeriodEnd = (rawEnd && DATE_RE.test(rawEnd)) ? rawEnd : todayIso()

    // Fetch all latest profiles per employee (latest computed_at for each employee_id)
    const { data, error } = await fastify.supabase
      .from('attendance_risk_profiles')
      .select('employee_id, risk_score, risk_level, computed_at')
      .eq('tenant_id', req.tenantId)
      .lte('period_end', effectivePeriodEnd)
      .order('computed_at', { ascending: false })

    if (error) {
      req.log.error({ err: error }, 'attendance_risk_profiles summary failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch risk summary' })
    }

    // Deduplicate — keep only the most recent profile per employee
    const seen = new Set<string>()
    const latest: Array<{ employee_id: string; risk_score: number; risk_level: string }> = []
    for (const row of (data ?? []) as any[]) {
      if (!seen.has(row.employee_id)) {
        seen.add(row.employee_id)
        latest.push(row)
      }
    }

    const byLevel = { low: 0, medium: 0, high: 0, critical: 0 }
    let scoreSum = 0

    for (const row of latest) {
      const lvl = (row.risk_level ?? 'low') as RiskLevel
      if (lvl in byLevel) byLevel[lvl]++
      scoreSum += row.risk_score ?? 0
    }

    const totalEmployees = latest.length
    const avgRiskScore   = totalEmployees > 0 ? Math.round((scoreSum / totalEmployees) * 100) / 100 : 0
    const elevated       = byLevel.high + byLevel.critical
    const elevatedPct    = totalEmployees > 0 ? Math.round((elevated / totalEmployees) * 10000) / 100 : 0

    return reply.send({
      by_level: byLevel,
      total_employees:  totalEmployees,
      avg_risk_score:   avgRiskScore,
      elevated_pct:     elevatedPct,
    })
  })

  // ── GET /attendance/risk/employee/:employeeId ─────────────────────────────
  // Risk profile history for a single employee — current + prior period.
  fastify.get<{ Params: { employeeId: string } }>(
    '/attendance/risk/employee/:employeeId',
    auth,
    async (req: any, reply) => {
      const { employeeId } = req.params

      // Employees can view their own; admins can view anyone.
      const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
      if (!isAdmin) {
        // Verify the caller is the employee being queried
        const { data: profile } = await fastify.supabase
          .from('profiles')
          .select('employee_id')
          .eq('id', req.userId)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if ((profile as any)?.employee_id !== employeeId) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
        }
      }

      // Confirm employee belongs to tenant
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id, first_name, last_name, employee_code, department_id, departments(name)')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // Fetch last 2 risk profiles ordered newest first
      const { data: profiles, error } = await fastify.supabase
        .from('attendance_risk_profiles')
        .select(
          `id, period_start, period_end, risk_score, risk_level, computed_at,
           chronic_late_count, correction_abuse_count,
           punch_anomaly_count, attendance_volatility`,
        )
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .order('computed_at', { ascending: false })
        .limit(2)

      if (error) {
        req.log.error({ err: error }, 'employee risk profile fetch failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch risk profile' })
      }

      const rows = (profiles ?? []) as any[]
      const e    = emp as any

      return reply.send({
        current: rows[0] ?? null,
        prior:   rows[1] ?? null,
        employee: {
          id:         e.id,
          name:       `${e.first_name} ${e.last_name}`,
          code:       e.employee_code,
          department: e.departments?.name ?? null,
        },
      })
    },
  )

  // ── POST /attendance/risk/compute ─────────────────────────────────────────
  // Compute or refresh risk profiles for a set of employees (or all active).
  const computeBodySchema = z.object({
    employee_ids: z.array(z.string().uuid()).max(500).optional(),
    period_days:  z.number().int().min(7).max(365).default(90),
  })

  fastify.post('/attendance/risk/compute', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = computeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_ids, period_days } = parsed.data
    const periodEnd   = todayIso()
    const periodStart = addDays(periodEnd, -period_days)

    // Resolve employee list
    let targetIds: string[] = employee_ids ?? []
    if (targetIds.length === 0) {
      const { data: activeEmps, error: empErr } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .eq('employment_status', 'active')
        .limit(500)

      if (empErr) {
        req.log.error({ err: empErr }, 'employee fetch for risk compute failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch active employees' })
      }
      targetIds = ((activeEmps ?? []) as any[]).map((e) => e.id)
    }

    if (targetIds.length === 0) {
      return reply.send({ computed: 0, elevated: 0 })
    }

    // For each employee, gather metrics then upsert
    let computedCount = 0
    let elevatedCount = 0

    // Batch queries across all employees at once for efficiency
    const [
      { data: lateDays },
      { data: correctionRows },
      { data: dailyRows },
    ] = await Promise.all([
      // Chronic late count per employee
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, status')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', targetIds)
        .eq('status', 'late')
        .gte('date', periodStart)
        .lte('date', periodEnd),

      // Correction/regularisation abuse count per employee
      fastify.supabase
        .from('attendance_regularisation')
        .select('employee_id, status')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', targetIds)
        .in('status', ['pending', 'approved'])
        .gte('date', periodStart)
        .lte('date', periodEnd),

      // All daily records for volatility calculation
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id, is_payable')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', targetIds)
        .gte('date', periodStart)
        .lte('date', periodEnd),
    ])

    // Punch anomalies — table may not exist; wrap in try/catch
    let anomalyMap: Map<string, number> = new Map()
    try {
      const { data: anomalyRows } = await fastify.supabase
        .from('attendance_anomalies')
        .select('employee_id')
        .eq('tenant_id', req.tenantId)
        .in('employee_id', targetIds)
        .gte('date', periodStart)
        .lte('date', periodEnd)

      for (const row of (anomalyRows ?? []) as any[]) {
        anomalyMap.set(row.employee_id, (anomalyMap.get(row.employee_id) ?? 0) + 1)
      }
    } catch {
      // Table may not exist — default to 0
    }

    // Aggregate maps
    const lateMap: Map<string, number>       = new Map()
    const corrMap: Map<string, number>       = new Map()
    const totalDaysMap: Map<string, number>  = new Map()
    const nonPayableMap: Map<string, number> = new Map()

    for (const row of (lateDays ?? []) as any[]) {
      lateMap.set(row.employee_id, (lateMap.get(row.employee_id) ?? 0) + 1)
    }
    for (const row of (correctionRows ?? []) as any[]) {
      corrMap.set(row.employee_id, (corrMap.get(row.employee_id) ?? 0) + 1)
    }
    for (const row of (dailyRows ?? []) as any[]) {
      totalDaysMap.set(row.employee_id, (totalDaysMap.get(row.employee_id) ?? 0) + 1)
      if (!row.is_payable) {
        nonPayableMap.set(row.employee_id, (nonPayableMap.get(row.employee_id) ?? 0) + 1)
      }
    }

    // Build upsert payload
    const now = new Date().toISOString()
    const upsertRows = targetIds.map((empId) => {
      const chronicLate      = lateMap.get(empId) ?? 0
      const correctionAbuse  = corrMap.get(empId) ?? 0
      const punchAnomalies   = anomalyMap.get(empId) ?? 0
      const totalDays        = totalDaysMap.get(empId) ?? 0
      const nonPayable       = nonPayableMap.get(empId) ?? 0
      const volatility       = totalDays > 0 ? Math.round((nonPayable / totalDays) * 100) : 0
      const rawScore         = chronicLate * 3 + correctionAbuse * 5 + volatility
      const riskScore        = Math.min(100, rawScore)
      const riskLevel        = computeRiskLevel(riskScore)

      if (['high', 'critical'].includes(riskLevel)) elevatedCount++
      computedCount++

      return {
        tenant_id:              req.tenantId,
        employee_id:            empId,
        period_start:           periodStart,
        period_end:             periodEnd,
        risk_score:             riskScore,
        risk_level:             riskLevel,
        chronic_late_count:     chronicLate,
        correction_abuse_count: correctionAbuse,
        punch_anomaly_count:    punchAnomalies,
        attendance_volatility:  volatility,
        computed_at:            now,
      }
    })

    // Upsert in batches of 100
    const BATCH = 100
    for (let i = 0; i < upsertRows.length; i += BATCH) {
      const batch = upsertRows.slice(i, i + BATCH)
      const { error: upsertErr } = await fastify.supabase
        .from('attendance_risk_profiles')
        .upsert(batch, {
          onConflict: 'tenant_id,employee_id,period_start,period_end',
        })

      if (upsertErr) {
        req.log.error({ err: upsertErr, batch_start: i }, 'risk profile upsert failed')
        return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to persist risk profiles' })
      }
    }

    return reply.send({ computed: computedCount, elevated: elevatedCount })
  })
}
