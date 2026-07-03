/**
 * Attendance Health Index Routes
 *
 * GET  /attendance/health-index                         — list health scores (admin only)
 * GET  /attendance/health-index/summary                 — tenant health summary for a month (admin only)
 * GET  /attendance/health-index/employee/:employeeId    — health trend for one employee (last 6 months)
 * POST /attendance/health-index/compute                 — compute health scores for a month (admin only)
 *
 * Auth: hr_admin / super_admin for all routes.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentYearMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Return the YYYY-MM strings for the last N months ending at (and including) endMonth. */
function lastNMonths(endMonth: string, n: number): string[] {
  const [year, month] = endMonth.split('-').map(Number)
  const result: string[] = []
  for (let i = 0; i < n; i++) {
    let m = month - i
    let y = year
    while (m <= 0) { m += 12; y-- }
    result.unshift(`${y}-${String(m).padStart(2, '0')}`)
  }
  return result
}

/** First and last day of a YYYY-MM month. */
function monthBounds(yearMonth: string): { start: string; end: string } {
  const [year, month] = yearMonth.split('-').map(Number)
  const start = `${yearMonth}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F'

function computeHealthGrade(score: number): HealthGrade {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 45) return 'D'
  return 'F'
}

// ── Route ────────────────────────────────────────────────────────────────────

export default async function attendanceHealthIndexRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/health-index ──────────────────────────────────────────
  // List health scores filtered by scope and period_month (admin only).
  const listQuerySchema = z.object({
    scope:        z.enum(['employee', 'department', 'site', 'tenant']).optional(),
    period_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    limit:        z.coerce.number().int().min(1).max(500).default(100),
    offset:       z.coerce.number().int().min(0).default(0),
  })

  fastify.get('/attendance/health-index', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { scope, period_month, limit, offset } = parsed.data
    const effectiveMonth = period_month ?? currentYearMonth()

    let q = fastify.supabase
      .from('attendance_health_scores')
      .select(
        `
          id, scope, scope_id, period_month,
          health_score, health_grade, score_breakdown,
          missing_punch_rate, anomaly_rate, correction_rate,
          inference_rate, instability_score,
          computed_at
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .eq('period_month', effectiveMonth)
      .order('health_score', { ascending: true })   // worst first for ops review
      .range(offset, offset + limit - 1)

    if (scope) q = q.eq('scope', scope)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'attendance_health_scores list failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch health scores' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/health-index/summary ──────────────────────────────────
  // Aggregate employee-scope health scores for a given month (admin only).
  const summaryQuerySchema = z.object({
    period_month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  })

  fastify.get('/attendance/health-index/summary', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = summaryQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const effectiveMonth = parsed.data.period_month ?? currentYearMonth()

    const { data, error } = await fastify.supabase
      .from('attendance_health_scores')
      .select('health_score, health_grade')
      .eq('tenant_id', req.tenantId)
      .eq('scope', 'employee')
      .eq('period_month', effectiveMonth)

    if (error) {
      req.log.error({ err: error }, 'attendance_health_scores summary failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch health summary' })
    }

    const rows = (data ?? []) as Array<{ health_score: number; health_grade: string }>

    const byGrade: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
    let scoreSum = 0

    for (const row of rows) {
      const grade = (row.health_grade ?? 'F') as HealthGrade
      if (grade in byGrade) byGrade[grade]++
      scoreSum += row.health_score ?? 0
    }

    const totalEmployees  = rows.length
    const avgHealthScore  = totalEmployees > 0 ? Math.round((scoreSum / totalEmployees) * 100) / 100 : 0
    const atRisk          = (byGrade['D'] ?? 0) + (byGrade['F'] ?? 0)

    return reply.send({
      period_month:    effectiveMonth,
      avg_health_score: avgHealthScore,
      by_grade:        byGrade,
      total_employees: totalEmployees,
      at_risk:         atRisk,
    })
  })

  // ── GET /attendance/health-index/employee/:employeeId ─────────────────────
  // Last 6 months of health scores for a single employee.
  fastify.get<{ Params: { employeeId: string } }>(
    '/attendance/health-index/employee/:employeeId',
    auth,
    async (req: any, reply) => {
      const { employeeId } = req.params

      // Employees can view own; admins see anyone.
      const isAdmin = (HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)
      if (!isAdmin) {
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
        .select('id, first_name, last_name, employee_code')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // Build the last-6-months list so we can filter the query
      const currentMonth = currentYearMonth()
      const months       = lastNMonths(currentMonth, 6)

      const { data, error } = await fastify.supabase
        .from('attendance_health_scores')
        .select(
          `period_month, health_score, health_grade, score_breakdown,
           missing_punch_rate, anomaly_rate, correction_rate,
           inference_rate, instability_score, computed_at`,
        )
        .eq('tenant_id', req.tenantId)
        .eq('scope', 'employee')
        .eq('scope_id', employeeId)
        .in('period_month', months)
        .order('period_month', { ascending: true })

      if (error) {
        req.log.error({ err: error }, 'employee health score trend fetch failed')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch health trend' })
      }

      const e = emp as any

      return reply.send({
        data: data ?? [],
        employee: {
          id:   e.id,
          name: `${e.first_name} ${e.last_name}`,
          code: e.employee_code,
        },
      })
    },
  )

  // ── POST /attendance/health-index/compute ─────────────────────────────────
  // Compute (or re-compute) health scores for a month (admin only).
  const computeBodySchema = z.object({
    period_month: z.string().regex(/^\d{4}-\d{2}$/),
    scope:        z.enum(['employee', 'department', 'tenant']).default('employee'),
    employee_ids: z.array(z.string().uuid()).max(500).optional(),
  })

  fastify.post('/attendance/health-index/compute', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = computeBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { period_month, scope, employee_ids } = parsed.data
    const { start: monthStart, end: monthEnd } = monthBounds(period_month)

    // ── Employee scope ────────────────────────────────────────────────────
    if (scope === 'employee') {
      // Resolve target employees
      let targetIds: string[] = employee_ids ?? []
      if (targetIds.length === 0) {
        const { data: activeEmps, error: empErr } = await fastify.supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('status', 'active')
          .limit(500)

        if (empErr) {
          req.log.error({ err: empErr }, 'employee fetch for health compute failed')
          return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch active employees' })
        }
        targetIds = ((activeEmps ?? []) as any[]).map((e) => e.id)
      }

      if (targetIds.length === 0) {
        return reply.send({ computed: 0, period_month })
      }

      // Batch-fetch all relevant data across employees
      const [
        { data: dailyRows },
        { data: correctionRows },
        { data: inferenceRows },
      ] = await Promise.all([
        // attendance_daily — for anomaly_rate + missing_punch_rate
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, status, confidence_level, is_payable')
          .eq('tenant_id', req.tenantId)
          .in('employee_id', targetIds)
          .gte('date', monthStart)
          .lte('date', monthEnd),

        // attendance_regularisation — for correction_rate
        fastify.supabase
          .from('attendance_regularisation')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .in('employee_id', targetIds)
          .gte('date', monthStart)
          .lte('date', monthEnd),

        // attendance_inference_log — for inference_rate
        fastify.supabase
          .from('attendance_inference_log')
          .select('employee_id')
          .eq('tenant_id', req.tenantId)
          .in('employee_id', targetIds)
          .gte('date', monthStart)
          .lte('date', monthEnd),
      ])

      // Aggregate per employee
      type DayRow = { employee_id: string; status: string; confidence_level: string | null }

      const totalDaysMap:    Map<string, number> = new Map()
      const absentMap:       Map<string, number> = new Map()
      const lateMap:         Map<string, number> = new Map()
      const leaveMap:        Map<string, number> = new Map()
      const lowConfMap:      Map<string, number> = new Map()
      const correctionMap:   Map<string, number> = new Map()
      const inferenceMap:    Map<string, number> = new Map()

      for (const row of (dailyRows ?? []) as DayRow[]) {
        totalDaysMap.set(row.employee_id, (totalDaysMap.get(row.employee_id) ?? 0) + 1)
        if (row.status === 'absent') {
          absentMap.set(row.employee_id, (absentMap.get(row.employee_id) ?? 0) + 1)
        }
        if (row.status === 'late') {
          lateMap.set(row.employee_id, (lateMap.get(row.employee_id) ?? 0) + 1)
        }
        if (row.status === 'leave') {
          leaveMap.set(row.employee_id, (leaveMap.get(row.employee_id) ?? 0) + 1)
        }
        if (row.confidence_level === 'low' || row.confidence_level === 'critical') {
          lowConfMap.set(row.employee_id, (lowConfMap.get(row.employee_id) ?? 0) + 1)
        }
      }
      for (const row of (correctionRows ?? []) as any[]) {
        correctionMap.set(row.employee_id, (correctionMap.get(row.employee_id) ?? 0) + 1)
      }
      for (const row of (inferenceRows ?? []) as any[]) {
        inferenceMap.set(row.employee_id, (inferenceMap.get(row.employee_id) ?? 0) + 1)
      }

      const now        = new Date().toISOString()
      const upsertRows = targetIds.map((empId) => {
        const totalDays       = totalDaysMap.get(empId) ?? 0
        const absent          = absentMap.get(empId) ?? 0
        const late            = lateMap.get(empId) ?? 0
        const leave           = leaveMap.get(empId) ?? 0
        const lowConf         = lowConfMap.get(empId) ?? 0
        const corrections     = correctionMap.get(empId) ?? 0
        const inferences      = inferenceMap.get(empId) ?? 0

        const anomalyRate      = totalDays > 0 ? (absent      / totalDays) * 100 : 0
        const missingPunchRate = totalDays > 0 ? (lowConf     / totalDays) * 100 : 0
        const correctionRate   = totalDays > 0 ? (corrections / totalDays) * 100 : 0
        const inferenceRate    = totalDays > 0 ? (inferences  / totalDays) * 100 : 0
        const instabilityScore = 0

        const rawScore    = 100
          - anomalyRate      * 0.4
          - missingPunchRate * 0.3
          - correctionRate   * 0.2
          - inferenceRate    * 0.1
        const healthScore = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100))
        const healthGrade = computeHealthGrade(healthScore)

        // Canonical reliability (R0 C5) — same formula as /analytics/workforce/reliability:
        // clamp(0,100, round(100 - (absent+leave)/total*60 - late/total*20))
        const relAbsentFrac    = totalDays > 0 ? (absent + leave) / totalDays : 0
        const relLateFrac      = totalDays > 0 ? late / totalDays : 0
        const reliabilityScore = Math.max(0, Math.min(100, Math.round(100 - relAbsentFrac * 60 - relLateFrac * 20)))
        const reliabilityGrade: 'A' | 'B' | 'C' | 'D' =
          reliabilityScore >= 90 ? 'A' : reliabilityScore >= 75 ? 'B' : reliabilityScore >= 60 ? 'C' : 'D'

        return {
          tenant_id:          req.tenantId,
          scope:              'employee' as const,
          scope_id:           empId,
          period_month,
          health_score:       healthScore,
          health_grade:       healthGrade,
          missing_punch_rate: Math.round(missingPunchRate * 100) / 100,
          anomaly_rate:       Math.round(anomalyRate * 100) / 100,
          correction_rate:    Math.round(correctionRate * 100) / 100,
          inference_rate:     Math.round(inferenceRate * 100) / 100,
          instability_score:  instabilityScore,
          score_breakdown: {
            total_days:        totalDays,
            absent_days:       absent,
            late_days:         late,
            leave_days:        leave,
            low_conf_days:     lowConf,
            correction_count:  corrections,
            inference_count:   inferences,
            reliability_score: reliabilityScore,
            reliability_grade: reliabilityGrade,
            absent_rate_pct:   parseFloat((relAbsentFrac * 100).toFixed(1)),
            late_rate_pct:     parseFloat((relLateFrac   * 100).toFixed(1)),
          },
          computed_at: now,
        }
      })

      // Upsert in batches of 100
      const BATCH = 100
      for (let i = 0; i < upsertRows.length; i += BATCH) {
        const batch = upsertRows.slice(i, i + BATCH)
        const { error: upsertErr } = await fastify.supabase
          .from('attendance_health_scores')
          .upsert(batch, { onConflict: 'tenant_id,scope,scope_id,period_month' })

        if (upsertErr) {
          req.log.error({ err: upsertErr, batch_start: i }, 'health score upsert failed')
          return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to persist health scores' })
        }
      }

      return reply.send({ computed: upsertRows.length, period_month })
    }

    // ── Department / tenant scope (simplified aggregation) ────────────────
    // For department and tenant scopes, we aggregate from employee scores
    // that must already exist for the same period_month.
    if (scope === 'department') {
      const { data: empScores, error: scErr } = await fastify.supabase
        .from('attendance_health_scores')
        .select('scope_id, health_score')
        .eq('tenant_id', req.tenantId)
        .eq('scope', 'employee')
        .eq('period_month', period_month)

      if (scErr) {
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employee scores for department aggregation' })
      }

      // Fetch employee → department mapping
      const empIds = ((empScores ?? []) as any[]).map((r) => r.scope_id)
      if (empIds.length === 0) {
        return reply.send({ computed: 0, period_month })
      }

      const { data: empDepts } = await fastify.supabase
        .from('employees')
        .select('id, job_history!job_history_employee_id_fkey(department_id, is_current)')
        .eq('tenant_id', req.tenantId)
        .in('id', empIds)

      const deptScoreMap: Map<string, number[]> = new Map()
      const empDeptLookup: Map<string, string> = new Map()
      for (const e of (empDepts ?? []) as any[]) {
        const jh = (e.job_history ?? []).find((j: any) => j.is_current) ?? (e.job_history ?? [])[0] ?? null
        if (jh?.department_id) empDeptLookup.set(e.id, jh.department_id)
      }
      for (const s of (empScores ?? []) as any[]) {
        const deptId = empDeptLookup.get(s.scope_id)
        if (!deptId) continue
        if (!deptScoreMap.has(deptId)) deptScoreMap.set(deptId, [])
        deptScoreMap.get(deptId)!.push(s.health_score)
      }

      const now        = new Date().toISOString()
      const deptUpsert = Array.from(deptScoreMap.entries()).map(([deptId, scores]) => {
        const avg   = scores.reduce((a, b) => a + b, 0) / scores.length
        const score = Math.round(avg * 100) / 100
        return {
          tenant_id:    req.tenantId,
          scope:        'department' as const,
          scope_id:     deptId,
          period_month,
          health_score: score,
          health_grade: computeHealthGrade(score),
          score_breakdown: { employee_count: scores.length },
          computed_at:  now,
        }
      })

      if (deptUpsert.length > 0) {
        const { error: upsertErr } = await fastify.supabase
          .from('attendance_health_scores')
          .upsert(deptUpsert, { onConflict: 'tenant_id,scope,scope_id,period_month' })
        if (upsertErr) {
          return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to persist department health scores' })
        }
      }

      return reply.send({ computed: deptUpsert.length, period_month })
    }

    // tenant scope
    if (scope === 'tenant') {
      const { data: empScores, error: scErr } = await fastify.supabase
        .from('attendance_health_scores')
        .select('health_score')
        .eq('tenant_id', req.tenantId)
        .eq('scope', 'employee')
        .eq('period_month', period_month)

      if (scErr) {
        return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employee scores for tenant aggregation' })
      }

      const scores = ((empScores ?? []) as any[]).map((r) => r.health_score as number)
      if (scores.length === 0) {
        return reply.send({ computed: 0, period_month })
      }

      const avg   = scores.reduce((a, b) => a + b, 0) / scores.length
      const score = Math.round(avg * 100) / 100

      const { error: upsertErr } = await fastify.supabase
        .from('attendance_health_scores')
        .upsert(
          {
            tenant_id:    req.tenantId,
            scope:        'tenant',
            scope_id:     req.tenantId,
            period_month,
            health_score: score,
            health_grade: computeHealthGrade(score),
            score_breakdown: { employee_count: scores.length },
            computed_at:  new Date().toISOString(),
          },
          { onConflict: 'tenant_id,scope,scope_id,period_month' },
        )

      if (upsertErr) {
        return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to persist tenant health score' })
      }

      return reply.send({ computed: 1, period_month })
    }

    return reply.send({ computed: 0, period_month })
  })
}
