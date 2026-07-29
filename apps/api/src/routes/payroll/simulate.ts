/**
 * Payroll Simulation Engine — Phase 6
 *
 * Stateless what-if engine: computes projected payroll impact of hypothetical
 * changes WITHOUT writing to the database. Fully explainable output.
 *
 * POST /analytics/payroll/simulate
 *
 * Supported scenario types:
 *   - ot_change:        Adjust OT hours/cost by percentage across a department or all
 *   - headcount_change: Add or remove N employees at avg dept salary
 *   - revision:         Apply a compensation change (annual delta) to specific employees
 *   - lop_rate_change:  Change LOP deduction rate (affects payable days denominator)
 *   - allowance_change: Apply a flat monthly delta to a department or all employees
 *
 * Returns: base + simulated totals, per-scenario breakdown, per-department impact.
 * Access: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const scenarioSchema = z.discriminatedUnion('type', [
  z.object({
    type:           z.literal('ot_change'),
    label:          z.string().max(80).optional(),
    department_id:  z.string().uuid().optional(),   // omit = all departments
    change_pct:     z.number().min(-100).max(500),  // +50 = 50% more OT cost
  }),
  z.object({
    type:           z.literal('headcount_change'),
    label:          z.string().max(80).optional(),
    department_id:  z.string().uuid().optional(),
    delta:          z.number().int().min(-500).max(500), // negative = reduction
  }),
  z.object({
    type:           z.literal('revision'),
    label:          z.string().max(80).optional(),
    employee_ids:   z.array(z.string().uuid()).min(1).max(500),
    new_ctc_annual: z.number().positive(),
  }),
  z.object({
    type:           z.literal('lop_rate_change'),
    label:          z.string().max(80).optional(),
    working_days:   z.number().int().min(20).max(31).default(26),
    lop_days_delta: z.number().int().min(-10).max(10), // per-employee average
  }),
  z.object({
    type:           z.literal('allowance_change'),
    label:          z.string().max(80).optional(),
    department_id:  z.string().uuid().optional(),
    monthly_delta:  z.number(),  // can be negative (remove allowance)
  }),
])

const simulateBodySchema = z.object({
  base_month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // default = current month
  scenarios:  z.array(scenarioSchema).min(1).max(10),
})

type Scenario = z.infer<typeof scenarioSchema>

interface DeptBase {
  id:        string
  name:      string
  headcount: number
  gross:     number
  otCost:    number
  avgGross:  number
}

export default async function payrollSimulateRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── POST /analytics/payroll/simulate ──────────────────────────────────────
  fastify.post('/analytics/payroll/simulate', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = simulateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { base_month: bm, scenarios } = parsed.data
    const { tenantId } = req
    // Tenant-local month default — a bare server-UTC clock would default to
    // the wrong month during the first ~5.5 hours of a new tenant-local
    // month for an IST tenant (the same bug class already fixed in
    // tds.ts/it-statement.ts/ytd-statement.ts).
    const tz = await fetchTenantTz(fastify.supabase, tenantId)
    const baseMonth = bm ?? getLocalDate(new Date().toISOString(), tz).slice(0, 7)

    // ── 1. Load base payroll data ─────────────────────────────────────────
    // Primary: active compensations (real-time base) — paginated via
    // fetchAllRows since a tenant can have >1000 active compensation rows
    // and a silently-truncated base would understate the simulation.
    let comps: any[]
    try {
      comps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employee_compensations')
          .select(`
            id, employee_id, ctc_monthly, ctc_annual,
            employees!inner(id, status, job_history!job_history_employee_id_fkey(department_id, is_current, departments(id, name)))
          `)
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
          .range(from, to),
      )
    } catch (compsErr) {
      return serverError(req, reply, compsErr, ErrorCode.QUERY_FAILED, 'Failed to load compensation data for simulation')
    }

    const activeComps = ((comps ?? []) as any[]).filter(
      (c) => c.employees?.status === 'active',
    )

    // Build dept base map
    const deptMap = new Map<string, DeptBase>()
    const empDeptMap = new Map<string, string>() // employee_id → dept_id

    for (const c of activeComps) {
      const jh     = c.employees?.job_history?.find((j: any) => j.is_current)
      const deptId = jh?.department_id ?? 'unassigned'
      const deptName = jh?.departments?.name ?? 'Unassigned'
      const monthly  = Number(c.ctc_monthly ?? 0)

      const entry = deptMap.get(deptId) ?? {
        id: deptId, name: deptName, headcount: 0, gross: 0, otCost: 0, avgGross: 0,
      }
      entry.headcount++
      entry.gross += monthly
      deptMap.set(deptId, entry)
      empDeptMap.set(c.employee_id, deptId)
    }

    // Load 3-month avg OT from snapshots
    const prior3: string[] = []
    for (let i = 1; i <= 3; i++) {
      const d = new Date(baseMonth + '-01')
      d.setMonth(d.getMonth() - i)
      prior3.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const { data: otSnaps, error: otSnapsErr } = await fastify.supabase
      .from('payroll_dept_snapshots')
      .select('department_id, total_ot_cost')
      .eq('tenant_id', tenantId)
      .in('month', prior3)
    if (otSnapsErr) return serverError(req, reply, otSnapsErr, ErrorCode.QUERY_FAILED, 'Failed to load OT snapshot data for simulation')

    // Average OT per dept across snapshot months
    const otAccum = new Map<string, { sum: number; count: number }>()
    for (const row of (otSnaps ?? []) as any[]) {
      const e = otAccum.get(row.department_id) ?? { sum: 0, count: 0 }
      e.sum += Number(row.total_ot_cost ?? 0)
      e.count++
      otAccum.set(row.department_id, e)
    }

    // Global OT avg as fallback
    let globalOtSum = 0; let globalOtCount = 0
    for (const e of otAccum.values()) { globalOtSum += e.sum; globalOtCount += e.count }
    const globalAvgOt = globalOtCount > 0 ? globalOtSum / globalOtCount : 0

    // Populate OT cost and avgGross into deptMap
    for (const [deptId, dept] of deptMap.entries()) {
      const otEntry = otAccum.get(deptId)
      dept.otCost   = otEntry ? otEntry.sum / otEntry.count : globalAvgOt / Math.max(deptMap.size, 1)
      dept.avgGross = dept.headcount > 0 ? dept.gross / dept.headcount : 0
    }

    // ── 2. Compute base totals ─────────────────────────────────────────────
    let baseTotalGross = 0
    let baseTotalOt    = 0
    for (const dept of deptMap.values()) {
      baseTotalGross += dept.gross
      baseTotalOt    += dept.otCost
    }
    const baseTotal = Math.round(baseTotalGross + baseTotalOt)

    // Per-employee ctc map for revision scenarios
    const empCtcMap = new Map<string, number>() // employee_id → monthly ctc
    for (const c of activeComps) {
      empCtcMap.set(c.employee_id, Number(c.ctc_monthly ?? 0))
    }

    // ── 3. Apply scenarios (additive, order-independent) ──────────────────
    // Work on mutable copies per scenario
    const scenarioResults: Array<{
      type:        string
      label:       string
      delta:       number
      delta_pct:   number
      explanation: string
    }> = []

    // Running simulation totals (start from base)
    let simGross = baseTotalGross
    let simOt    = baseTotalOt

    // Clone dept map for per-dept simulation
    const simDeptMap = new Map<string, DeptBase>()
    for (const [k, v] of deptMap.entries()) simDeptMap.set(k, { ...v })

    for (const scenario of scenarios) {
      let scenarioDelta = 0
      const label = (scenario as any).label ?? scenario.type.replace('_', ' ')

      switch (scenario.type) {

        case 'ot_change': {
          const { change_pct, department_id } = scenario
          if (department_id) {
            const dept = simDeptMap.get(department_id)
            if (dept) {
              const before = dept.otCost
              dept.otCost  = dept.otCost * (1 + change_pct / 100)
              scenarioDelta = dept.otCost - before
              simOt += scenarioDelta
            }
          } else {
            const before = simOt
            simOt = simOt * (1 + change_pct / 100)
            scenarioDelta = simOt - before
            for (const dept of simDeptMap.values()) {
              dept.otCost = dept.otCost * (1 + change_pct / 100)
            }
          }
          scenarioResults.push({
            type:  scenario.type,
            label,
            delta: Math.round(scenarioDelta),
            delta_pct: baseTotalOt > 0
              ? Math.round((scenarioDelta / baseTotalOt) * 10000) / 100
              : 0,
            explanation: `OT cost ${change_pct > 0 ? 'increased' : 'decreased'} by ${Math.abs(change_pct)}%${department_id ? ' for selected department' : ' across all departments'}`,
          })
          break
        }

        case 'headcount_change': {
          const { delta, department_id } = scenario
          if (department_id) {
            const dept = simDeptMap.get(department_id)
            if (dept) {
              const avgGross   = dept.avgGross
              scenarioDelta    = delta * avgGross
              dept.gross      += scenarioDelta
              dept.headcount  += delta
              simGross        += scenarioDelta
            }
          } else {
            // Distribute across all depts proportionally
            const totalHc = activeComps.length
            const globalAvgGross = totalHc > 0 ? baseTotalGross / totalHc : 0
            scenarioDelta = delta * globalAvgGross
            simGross += scenarioDelta
            // Proportionally adjust all depts
            const fraction = scenarioDelta / Math.max(baseTotalGross, 1)
            for (const dept of simDeptMap.values()) {
              dept.gross += dept.gross * fraction
            }
          }
          scenarioResults.push({
            type:  scenario.type,
            label,
            delta: Math.round(scenarioDelta),
            delta_pct: baseTotalGross > 0
              ? Math.round((scenarioDelta / baseTotalGross) * 10000) / 100
              : 0,
            explanation: `${Math.abs(delta)} employee(s) ${delta >= 0 ? 'added' : 'removed'} at average salary${department_id ? ' in selected department' : ''}`,
          })
          break
        }

        case 'revision': {
          const { employee_ids, new_ctc_annual } = scenario
          const newMonthly = new_ctc_annual / 12

          for (const empId of employee_ids) {
            const oldMonthly = empCtcMap.get(empId) ?? 0
            const diff       = newMonthly - oldMonthly
            scenarioDelta   += diff
            simGross        += diff
            empCtcMap.set(empId, newMonthly)

            // Update dept gross
            const deptId = empDeptMap.get(empId)
            if (deptId) {
              const dept = simDeptMap.get(deptId)
              if (dept) dept.gross += diff
            }
          }

          scenarioResults.push({
            type:  scenario.type,
            label,
            delta: Math.round(scenarioDelta),
            delta_pct: baseTotalGross > 0
              ? Math.round((scenarioDelta / baseTotalGross) * 10000) / 100
              : 0,
            explanation: `${employee_ids.length} employee compensation revised to ₹${Math.round(new_ctc_annual / 1000)}K CTC annual`,
          })
          break
        }

        case 'lop_rate_change': {
          const { working_days, lop_days_delta } = scenario
          const totalEmps = activeComps.length
          if (totalEmps > 0 && working_days > 0) {
            // LOP deduction per employee = (lop_days / working_days) * monthly_gross
            // Delta = aggregate change from lop_days_delta applied to all active employees
            let delta = 0
            for (const [empId, monthly] of empCtcMap.entries()) {
              delta += -(lop_days_delta / working_days) * monthly  // negative = more deduction
            }
            scenarioDelta = delta
            simGross += delta
          }
          scenarioResults.push({
            type:  scenario.type,
            label,
            delta: Math.round(scenarioDelta),
            delta_pct: baseTotalGross > 0
              ? Math.round((scenarioDelta / baseTotalGross) * 10000) / 100
              : 0,
            explanation: `${Math.abs(lop_days_delta)} additional LOP day(s) per employee (of ${working_days} working days)`,
          })
          break
        }

        case 'allowance_change': {
          const { monthly_delta, department_id } = scenario
          if (department_id) {
            const dept = simDeptMap.get(department_id)
            if (dept) {
              scenarioDelta = monthly_delta * dept.headcount
              dept.gross   += scenarioDelta
              simGross     += scenarioDelta
            }
          } else {
            scenarioDelta = monthly_delta * activeComps.length
            simGross     += scenarioDelta
            for (const dept of simDeptMap.values()) {
              dept.gross += monthly_delta * dept.headcount
            }
          }
          scenarioResults.push({
            type:  scenario.type,
            label,
            delta: Math.round(scenarioDelta),
            delta_pct: baseTotalGross > 0
              ? Math.round((scenarioDelta / baseTotalGross) * 10000) / 100
              : 0,
            explanation: `₹${Math.abs(Math.round(monthly_delta)).toLocaleString()} monthly allowance ${monthly_delta >= 0 ? 'added' : 'removed'} per employee${department_id ? ' in selected department' : ''}`,
          })
          break
        }
      }
    }

    // ── 4. Final simulated totals ──────────────────────────────────────────
    const simTotal    = Math.round(simGross + simOt)
    const totalDelta  = simTotal - baseTotal
    const totalDeltaPct = baseTotal > 0
      ? Math.round(((simTotal - baseTotal) / baseTotal) * 10000) / 100
      : 0

    // ── 5. Per-department simulated breakdown ─────────────────────────────
    const byDepartment = Array.from(simDeptMap.values()).map((dept) => {
      const base = deptMap.get(dept.id)
      const baseDeptTotal = Math.round((base?.gross ?? 0) + (base?.otCost ?? 0))
      const simDeptTotal  = Math.round(dept.gross + dept.otCost)
      return {
        department_id:   dept.id,
        department_name: dept.name,
        headcount:       dept.headcount,
        base_gross:      Math.round(base?.gross ?? 0),
        sim_gross:       Math.round(dept.gross),
        base_total:      baseDeptTotal,
        sim_total:       simDeptTotal,
        delta:           simDeptTotal - baseDeptTotal,
        delta_pct:       baseDeptTotal > 0
          ? Math.round(((simDeptTotal - baseDeptTotal) / baseDeptTotal) * 10000) / 100
          : 0,
      }
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

    // ── 6. Response ────────────────────────────────────────────────────────
    return reply.send({
      base_month:      baseMonth,
      base_headcount:  activeComps.length,
      base_total:      baseTotal,
      base_gross:      Math.round(baseTotalGross),
      base_ot:         Math.round(baseTotalOt),
      simulated_total: simTotal,
      simulated_gross: Math.round(simGross),
      simulated_ot:    Math.round(simOt),
      total_delta:     totalDelta,
      total_delta_pct: totalDeltaPct,
      scenarios:       scenarioResults,
      by_department:   byDepartment,
      note:            'Simulation is stateless — no data has been modified.',
    })
  })
}
