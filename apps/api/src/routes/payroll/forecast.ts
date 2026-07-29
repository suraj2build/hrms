/**
 * Payroll Forecast Engine — Phase 4
 *
 * Predictive payroll operations: projects expected payroll for an upcoming month
 * using compensation records, OT trends, pending revisions, and headcount.
 *
 * GET  /analytics/payroll/forecast          — retrieve stored forecast (or generate)
 * POST /analytics/payroll/forecast/generate — trigger fresh generation
 *
 * Forecast algorithm:
 *   1. Base: active employee_compensations → expected monthly gross
 *   2. OT delta: 3-month rolling avg OT cost per department
 *   3. Revision impact: approved compensation revisions effective in target month
 *   4. Headcount projection: count active employees (no attrition model — operational only)
 *   5. Risk factors: flagged OT trends, pending revisions, leave-heavy periods
 *
 * Access: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { eventBus }            from '../../lib/event-bus.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchTenantTz }  from '../../lib/attendance-engine.js'
import { getLocalDate }   from '../../lib/org-context.js'
import { fetchAllRows }   from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const monthRe = /^\d{4}-\d{2}$/

function addMonths(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Default forecast target = next tenant-local calendar month. A bare
 * server-UTC clock would default to the wrong month during the first ~5.5
 * hours of a new tenant-local month for an IST tenant (the same bug class
 * already fixed via fetchTenantTz/getLocalDate in simulate.ts et al.).
 */
async function nextMonthStr(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  const currentMonth = getLocalDate(new Date().toISOString(), tz).slice(0, 7)
  return addMonths(currentMonth, 1)
}

function priorMonths(base: string, count: number): string[] {
  const [y, m] = base.split('-').map(Number)
  const months: string[] = []
  for (let i = count; i >= 1; i--) {
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

async function generateForecast(
  fastify: FastifyInstance,
  tenantId: string,
  targetMonth: string,
  generatedBy: string,
): Promise<Record<string, unknown>> {
  // ── 1. Active compensation → base expected gross ─────────────────────────
  // Paginated — a tenant can have >1000 active compensation rows, and a
  // silently-truncated base would understate the forecast with no signal.
  const comps = await fetchAllRows((from, to) =>
    fastify.supabase
      .from('employee_compensations')
      .select(`
        id, employee_id, ctc_monthly,
        employees!inner(id, status, job_history!job_history_employee_id_fkey(department_id, is_current, departments(id, name)))
      `)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .range(from, to),
  )

  const activeComps = ((comps ?? []) as any[]).filter(c => c.employees?.status === 'active')
  const headcount   = activeComps.length

  let baseGross = activeComps.reduce((s, c) => s + Number(c.ctc_monthly ?? 0), 0)

  // Per-department base
  const deptBase = new Map<string, { id: string; name: string; gross: number; count: number }>()
  for (const c of activeComps) {
    const jh = c.employees?.job_history?.find((j: any) => j.is_current)
    const deptId   = jh?.department_id   ?? 'unassigned'
    const deptName = jh?.departments?.name ?? 'Unassigned'
    const e = deptBase.get(deptId) ?? { id: deptId, name: deptName, gross: 0, count: 0 }
    e.gross += Number(c.ctc_monthly ?? 0)
    e.count++
    deptBase.set(deptId, e)
  }

  // ── 2. OT trend: 3-month rolling avg ────────────────────────────────────
  const prior3 = priorMonths(targetMonth, 3)
  const { data: otSnaps } = await fastify.supabase
    .from('payroll_dept_snapshots')
    .select('month, total_ot_cost')
    .eq('tenant_id', tenantId)
    .in('month', prior3)

  const avgOtCost = (otSnaps ?? []).length > 0
    ? (otSnaps as any[]).reduce((s, r) => s + Number(r.total_ot_cost ?? 0), 0) / (otSnaps as any[]).length
    : 0

  // ── 3. Pending compensation revisions effective in target month ───────────
  const [y, mo] = targetMonth.split('-').map(Number)
  const monthStart = `${targetMonth}-01`
  // `new Date(y, mo, 0)` (day 0 of next month = last day of this month) is
  // constructed in the server's LOCAL timezone, then `.toISOString()` re-
  // serializes it in UTC — for any positive-UTC-offset host (e.g. IST) that
  // shifts local midnight back a day, so `monthEnd` silently lands one day
  // early and excludes revisions effective on the actual last day of the
  // month. Use `.getDate()` (still local, but never re-interpreted as UTC)
  // to build the string directly, matching the fix already applied in
  // workspace/stats.ts / analytics/reports.ts (monthEndDate).
  const lastDay  = new Date(y, mo, 0).getDate()
  const monthEnd = `${targetMonth}-${String(lastDay).padStart(2, '0')}`

  const { data: pendingRevs } = await fastify.supabase
    .from('compensation_revisions')
    .select('employee_id, new_ctc_annual, before_ctc_annual, delta_amount, effective_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .gte('effective_date', monthStart)
    .lte('effective_date', monthEnd)

  const revisionImpactMonthly = ((pendingRevs ?? []) as any[]).reduce(
    (s, r) => s + (r.delta_amount ? Number(r.delta_amount) / 12 : 0),
    0,
  )
  const pendingRevisionCount = (pendingRevs ?? []).length

  // ── 4. Total forecast gross ───────────────────────────────────────────────
  const forecastTotalGross = Math.round(baseGross + avgOtCost + revisionImpactMonthly)
  const forecastTotalNet   = Math.round(forecastTotalGross * 0.85)  // rough 85% net ratio
  const forecastTotalOtCost = Math.round(avgOtCost)

  // ── 5. Prior month comparison ─────────────────────────────────────────────
  const baseMonth = priorMonths(targetMonth, 1)[0]
  const { data: priorRun } = await fastify.supabase
    .from('payroll_runs')
    .select('total_gross')
    .eq('tenant_id', tenantId)
    .eq('month', baseMonth)
    .in('status', ['finalized', 'frozen'])
    .limit(1)
    .maybeSingle()

  const baseTotalGross = priorRun ? Number(priorRun.total_gross) : null
  const variancePct = baseTotalGross && baseTotalGross > 0
    ? Math.round(((forecastTotalGross - baseTotalGross) / baseTotalGross) * 10000) / 100
    : null

  // ── 6. Risk factors ───────────────────────────────────────────────────────
  const riskFactors: Array<{ type: string; description: string; impact_amount: number; severity: string }> = []

  if (avgOtCost > baseGross * 0.10) {
    riskFactors.push({
      type:          'ot_trend',
      description:   `3-month avg OT cost ₹${Math.round(avgOtCost).toLocaleString()} exceeds 10% of base payroll`,
      impact_amount: Math.round(avgOtCost),
      severity:      avgOtCost > baseGross * 0.20 ? 'high' : 'medium',
    })
  }
  if (pendingRevisionCount > 0) {
    riskFactors.push({
      type:          'pending_revision',
      description:   `${pendingRevisionCount} pending compensation revision(s) effective in ${targetMonth}`,
      impact_amount: Math.round(revisionImpactMonthly),
      severity:      'medium',
    })
  }
  if (variancePct !== null && Math.abs(variancePct) > 5) {
    riskFactors.push({
      type:          'gross_variance',
      description:   `Forecast is ${variancePct > 0 ? '▲' : '▼'}${Math.abs(variancePct)}% vs ${baseMonth}`,
      impact_amount: Math.round(forecastTotalGross - (baseTotalGross ?? forecastTotalGross)),
      severity:      Math.abs(variancePct) > 15 ? 'high' : 'medium',
    })
  }

  // ── 7. Confidence ─────────────────────────────────────────────────────────
  let confidence = 85
  if (!priorRun) confidence -= 10
  if (pendingRevisionCount > 5) confidence -= 5
  if (avgOtCost > baseGross * 0.20) confidence -= 5
  confidence = Math.max(50, Math.min(95, confidence))

  // ── 8. By department ─────────────────────────────────────────────────────
  const byDepartment = Array.from(deptBase.values()).map(d => ({
    department_id:   d.id,
    department_name: d.name,
    headcount:       d.count,
    forecast_gross:  Math.round(d.gross),
    forecast_ot:     d.count > 0 ? Math.round((avgOtCost * d.count) / headcount) : 0,
  })).sort((a, b) => b.forecast_gross - a.forecast_gross)

  const assumptions = [
    { key: 'base_headcount',      label: 'Active employees with compensation', value: headcount },
    { key: 'avg_ot_cost',         label: '3-month avg OT cost (₹)', value: Math.round(avgOtCost) },
    { key: 'pending_revisions',   label: 'Pending revisions effective this month', value: pendingRevisionCount },
    { key: 'net_ratio',           label: 'Net-to-gross ratio assumed (%)', value: 85 },
  ]

  const forecast = {
    tenant_id:             tenantId,
    target_month:          targetMonth,
    generated_by:          generatedBy,
    forecast_headcount:    headcount,
    forecast_total_gross:  forecastTotalGross,
    forecast_total_net:    forecastTotalNet,
    forecast_total_ot_cost: forecastTotalOtCost,
    base_month:            baseMonth,
    base_total_gross:      baseTotalGross,
    variance_pct:          variancePct,
    confidence_pct:        confidence,
    by_department:         byDepartment,
    risk_factors:          riskFactors,
    assumptions,
  }

  return forecast
}

export default async function payrollForecastRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /analytics/payroll/forecast ─────────────────────────────────────────
  fastify.get('/analytics/payroll/forecast', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const targetMonth = (req.query as any).month || await nextMonthStr(fastify, req.tenantId)
    if (!monthRe.test(targetMonth)) {
      return reply.code(400).send({ error: 'INVALID_PARAM', message: 'month must be YYYY-MM' })
    }

    // Try existing forecast first (stale if > 24h)
    const { data: existing } = await fastify.supabase
      .from('payroll_forecasts')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('target_month', targetMonth)
      .maybeSingle()

    if (existing) {
      const ageHours = (Date.now() - new Date((existing as any).generated_at).getTime()) / 3_600_000
      return reply.send({
        data: existing,
        cached: true,
        age_hours: Math.round(ageHours),
        stale: ageHours > 24,
      })
    }

    // Generate fresh forecast
    const forecast = await generateForecast(fastify, req.tenantId, targetMonth, 'system')

    const { data: saved, error } = await fastify.supabase
      .from('payroll_forecasts')
      .upsert(forecast, { onConflict: 'tenant_id,target_month' })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to generate forecast')

    return reply.send({ data: saved, cached: false, age_hours: 0, stale: false })
  })

  // ── POST /analytics/payroll/forecast/generate ────────────────────────────────
  fastify.post('/analytics/payroll/forecast/generate', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { month } = req.body as { month?: string }
    const targetMonth = month || await nextMonthStr(fastify, req.tenantId)
    if (!monthRe.test(targetMonth)) {
      return reply.code(400).send({ error: 'INVALID_PARAM', message: 'month must be YYYY-MM' })
    }

    // Get existing for change detection
    const { data: prior } = await fastify.supabase
      .from('payroll_forecasts')
      .select('forecast_total_gross')
      .eq('tenant_id', req.tenantId)
      .eq('target_month', targetMonth)
      .maybeSingle()

    const forecast = await generateForecast(fastify, req.tenantId, targetMonth, req.userId)

    const { data: saved, error } = await fastify.supabase
      .from('payroll_forecasts')
      .upsert(forecast, { onConflict: 'tenant_id,target_month' })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save forecast')

    // Emit forecast changed event if significant shift (> 5%)
    if (prior) {
      const priorGross = Number((prior as any).forecast_total_gross ?? 0)
      const newGross   = Number((forecast as any).forecast_total_gross ?? 0)
      const changePct  = priorGross > 0
        ? Math.round(((newGross - priorGross) / priorGross) * 10000) / 100
        : 0

      if (Math.abs(changePct) >= 5) {
        eventBus.emit({
          type:          'payroll.forecast.changed',
          correlationId: `${req.tenantId}:${targetMonth}:forecast`,
          payload: {
            tenantId:      req.tenantId,
            targetMonth,
            priorForecast: priorGross,
            newForecast:   newGross,
            changePct,
            triggerReason: 'manual_regeneration',
          },
          tenantId: req.tenantId,
        })
      }
    }

    return reply.code(201).send({
      data:       saved,
      regenerated: true,
      message:    `Forecast for ${targetMonth} generated successfully`,
    })
  })
}
