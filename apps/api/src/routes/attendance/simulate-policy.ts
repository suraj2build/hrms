/**
 * Attendance Policy Simulation Route
 *
 * POST /attendance/simulate-policy — stateless simulation of policy changes' impact
 *
 * No DB writes. Loads attendance_daily for a target_date, applies scenario
 * transformations in-memory, and returns per-employee + aggregate impact data.
 *
 * Auth: hr_admin / super_admin only.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

// ── Zod schema ────────────────────────────────────────────────────────────────

const simulateSchema = z.object({
  // Accept target_date directly, or date_from/date_to (UI sends a range; we simulate on date_from)
  target_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'target_date must be YYYY-MM-DD').optional(),
  date_from:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date_from must be YYYY-MM-DD').optional(),
  date_to:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // accepted for FE compat, not used
  employee_ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  scenarios: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type:                  z.literal('grace_change'),
          current_grace_minutes: z.number().int().min(0).max(60),
          new_grace_minutes:     z.number().int().min(0).max(60),
        }),
        z.object({
          type:                    z.literal('halfday_threshold_change'),
          current_threshold_pct:   z.number().min(10).max(90),
          new_threshold_pct:       z.number().min(10).max(90),
        }),
        z.object({
          type:              z.literal('late_cap_change'),
          current_cap_minutes: z.number().int().min(0).max(480),
          new_cap_minutes:   z.number().int().min(0).max(480),
        }),
        z.object({
          type:                z.literal('ot_threshold_change'),
          current_ot_minutes:  z.number().int().min(0),
          new_ot_minutes:      z.number().int().min(0),
        }),
      ]),
    )
    .min(1)
    .max(5),
})

type SimulateInput = z.infer<typeof simulateSchema>
type Scenario      = SimulateInput['scenarios'][number]

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DailyRow {
  employee_id:      string
  status:           string | null
  work_hours:       number | null
  late_minutes:     number | null
  overtime_minutes: number | null
  is_payable:       boolean | null
  day_fraction:     number | null
  employees:        { first_name: string; last_name: string; employee_code: string } | null
}

interface SimEmployee {
  employee_id:             string
  employee_code:           string
  name:                    string
  original_status:         string
  simulated_status:        string
  original_late_minutes:   number
  simulated_late_minutes:  number
  original_ot_minutes:     number
  simulated_ot_minutes:    number
  original_is_payable:     boolean
  simulated_is_payable:    boolean
  changed:                 boolean
  explanation:             string
}

function applyScenarios(
  row: DailyRow,
  scenarios: Scenario[],
): {
  status:         string
  late_minutes:   number
  ot_minutes:     number
  is_payable:     boolean
  explanations:   string[]
} {
  let status       = row.status        ?? 'unknown'
  let lateMinutes  = row.late_minutes  ?? 0
  let otMinutes    = row.overtime_minutes ?? 0
  let isPayable    = row.is_payable    ?? true
  const workHours  = row.work_hours    ?? 0
  const explanations: string[] = []

  for (const scenario of scenarios) {
    switch (scenario.type) {
      case 'grace_change': {
        // Re-evaluate: if employee was 'late', check if the extra grace covers their late_minutes
        if (status === 'late' && lateMinutes > 0) {
          const graceDelta = scenario.new_grace_minutes - scenario.current_grace_minutes
          const newLate    = Math.max(0, lateMinutes - graceDelta)
          if (newLate === 0) {
            status      = 'present'
            isPayable   = true
            explanations.push(
              `grace_change: late_minutes ${lateMinutes}→0 with +${graceDelta}m grace — status changed late→present`,
            )
          } else {
            explanations.push(
              `grace_change: late_minutes ${lateMinutes}→${newLate} with +${graceDelta}m grace`,
            )
          }
          lateMinutes = newLate
        } else {
          explanations.push('grace_change: no effect (employee was not late)')
        }
        break
      }

      case 'halfday_threshold_change': {
        // Re-evaluate half-day threshold.
        // Shift hours assumed to be work_hours's reference (simplified: 8h standard shift).
        const STANDARD_SHIFT_HOURS = 8
        const currentHalfDayHours  = (scenario.current_threshold_pct / 100) * STANDARD_SHIFT_HOURS
        const newHalfDayHours      = (scenario.new_threshold_pct / 100) * STANDARD_SHIFT_HOURS

        const wasHalfDay = status === 'half_day'
        const isAbove    = workHours >= newHalfDayHours
        const wasBelow   = workHours < currentHalfDayHours

        if (wasHalfDay && isAbove && newHalfDayHours < currentHalfDayHours) {
          // Threshold lowered — half_day becomes present
          status    = 'present'
          isPayable = true
          explanations.push(
            `halfday_threshold_change: threshold ${scenario.current_threshold_pct}%→${scenario.new_threshold_pct}% — ${workHours}h now above new threshold → present`,
          )
        } else if (status === 'present' && !isAbove && newHalfDayHours > currentHalfDayHours) {
          // Threshold raised — present becomes half_day
          status    = 'half_day'
          isPayable = false
          explanations.push(
            `halfday_threshold_change: threshold ${scenario.current_threshold_pct}%→${scenario.new_threshold_pct}% — ${workHours}h now below new threshold → half_day`,
          )
        } else if (status === 'absent' && workHours >= newHalfDayHours && wasBelow) {
          // Was absent, but now qualifies as half_day
          status    = 'half_day'
          isPayable = false
          explanations.push(
            `halfday_threshold_change: threshold ${scenario.current_threshold_pct}%→${scenario.new_threshold_pct}% — ${workHours}h now meets half_day threshold → half_day`,
          )
        } else {
          explanations.push('halfday_threshold_change: no status change')
        }
        break
      }

      case 'late_cap_change': {
        if (lateMinutes > 0) {
          const capped = Math.min(lateMinutes, scenario.new_cap_minutes)
          if (capped !== lateMinutes) {
            explanations.push(
              `late_cap_change: late_minutes ${lateMinutes}→${capped} (cap ${scenario.current_cap_minutes}→${scenario.new_cap_minutes})`,
            )
            lateMinutes = capped
          } else {
            explanations.push('late_cap_change: late_minutes within new cap — no change')
          }
        } else {
          explanations.push('late_cap_change: no late minutes to cap')
        }
        break
      }

      case 'ot_threshold_change': {
        // If employee had OT computed under old threshold but not new (or vice versa)
        const STANDARD_SHIFT_MINUTES = 8 * 60
        const effectiveWorkMinutes   = workHours * 60

        const otUnderOld = Math.max(0, effectiveWorkMinutes - STANDARD_SHIFT_MINUTES - scenario.current_ot_minutes)
        const otUnderNew = Math.max(0, effectiveWorkMinutes - STANDARD_SHIFT_MINUTES - scenario.new_ot_minutes)

        if (otUnderNew !== otMinutes) {
          explanations.push(
            `ot_threshold_change: ot_minutes ${otMinutes}→${Math.round(otUnderNew)} (threshold ${scenario.current_ot_minutes}→${scenario.new_ot_minutes})`,
          )
          otMinutes = Math.max(0, Math.round(otUnderNew))
        } else {
          explanations.push('ot_threshold_change: overtime unchanged under new threshold')
        }
        break
      }
    }
  }

  return { status, late_minutes: lateMinutes, ot_minutes: otMinutes, is_payable: isPayable, explanations }
}

function scenarioLabel(s: Scenario): { description: string; label: string } {
  switch (s.type) {
    case 'grace_change':
      return {
        description: `Change grace period from ${s.current_grace_minutes} min to ${s.new_grace_minutes} min`,
        label:       `Grace ${s.current_grace_minutes}m → ${s.new_grace_minutes}m`,
      }
    case 'halfday_threshold_change':
      return {
        description: `Change half-day threshold from ${s.current_threshold_pct}% to ${s.new_threshold_pct}% of shift hours`,
        label:       `Half-day threshold ${s.current_threshold_pct}% → ${s.new_threshold_pct}%`,
      }
    case 'late_cap_change':
      return {
        description: `Change late minutes cap from ${s.current_cap_minutes} min to ${s.new_cap_minutes} min`,
        label:       `Late cap ${s.current_cap_minutes}m → ${s.new_cap_minutes}m`,
      }
    case 'ot_threshold_change':
      return {
        description: `Change OT threshold from ${s.current_ot_minutes} min to ${s.new_ot_minutes} min above shift`,
        label:       `OT threshold ${s.current_ot_minutes}m → ${s.new_ot_minutes}m`,
      }
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function simulatePolicyRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /attendance/simulate-policy ──────────────────────────────────────
  fastify.post('/attendance/simulate-policy', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = simulateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { target_date: rawTargetDate, date_from, employee_ids, scenarios } = parsed.data
    const target_date = rawTargetDate ?? date_from
    if (!target_date) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: 'target_date or date_from is required',
      })
    }

    // Load attendance_daily records for target_date
    let rows: DailyRow[]
    try {
      rows = await fetchAllRows((from, to) => {
        let q = fastify.supabase
          .from('attendance_daily')
          .select(
            `
              employee_id, status, work_hours, late_minutes,
              overtime_minutes, is_payable, day_fraction,
              employees!inner(first_name, last_name, employee_code)
            `,
          )
          .eq('tenant_id', req.tenantId)
          .eq('date', target_date)

        if (employee_ids && employee_ids.length > 0) {
          q = q.in('employee_id', employee_ids)
        }

        return q.range(from, to)
      }) as unknown as DailyRow[]
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance data')
    }

    if (rows.length === 0) {
      return reply.send({
        target_date,
        scenarios: scenarios.map((s) => ({ type: s.type, ...scenarioLabel(s) })),
        employees_analyzed:     0,
        employees_affected:     0,
        status_changes:         {},
        payroll_impact_estimate: 0,
        by_employee:            [],
        note: 'Simulation only — no changes were applied.',
      })
    }

    // Apply simulation per employee
    const byEmployee: SimEmployee[] = []
    const statusChangeCounts: Record<string, number> = {}
    let payrollChanges = 0

    for (const row of rows) {
      const emp             = Array.isArray(row.employees) ? (row.employees as any[])[0] : row.employees
      const originalStatus  = row.status        ?? 'unknown'
      const originalLate    = row.late_minutes   ?? 0
      const originalOt      = row.overtime_minutes ?? 0
      const originalPayable = row.is_payable     ?? true

      const sim = applyScenarios(row, scenarios)

      const changed = (
        sim.status      !== originalStatus ||
        sim.late_minutes !== originalLate  ||
        sim.ot_minutes   !== originalOt
      )

      if (changed) {
        // Track status transition
        if (sim.status !== originalStatus) {
          const key = `${originalStatus}->${sim.status}`
          statusChangeCounts[key] = (statusChangeCounts[key] ?? 0) + 1
        }
        // Track payability change
        if (sim.is_payable !== originalPayable) {
          payrollChanges++
        }
      }

      byEmployee.push({
        employee_id:            row.employee_id,
        employee_code:          emp?.employee_code ?? '',
        name:                   emp ? `${emp.first_name} ${emp.last_name}` : row.employee_id,
        original_status:        originalStatus,
        simulated_status:       sim.status,
        original_late_minutes:  originalLate,
        simulated_late_minutes: sim.late_minutes,
        original_ot_minutes:    originalOt,
        simulated_ot_minutes:   sim.ot_minutes,
        original_is_payable:    originalPayable,
        simulated_is_payable:   sim.is_payable,
        changed,
        explanation: sim.explanations.join('; ') || 'No change',
      })
    }

    // Payroll impact estimate:
    // payroll_changes × (average_monthly_ctc / 22 working days)
    // We don't have CTC data — use a rough estimate of ₹30,000/month average.
    const ROUGH_AVG_MONTHLY_CTC = 30_000
    const WORKING_DAYS_PER_MONTH = 22
    const payrollImpactEstimate = Math.round(
      (payrollChanges * (ROUGH_AVG_MONTHLY_CTC / WORKING_DAYS_PER_MONTH)) * 100,
    ) / 100

    const employeesAffected = byEmployee.filter((e) => e.changed).length

    return reply.send({
      target_date,
      scenarios: scenarios.map((s) => ({ type: s.type, ...scenarioLabel(s) })),
      employees_analyzed:      rows.length,
      employees_affected:      employeesAffected,
      status_changes:          statusChangeCounts,
      payroll_impact_estimate: payrollImpactEstimate,
      by_employee:             byEmployee,
      note: 'Simulation only — no changes were applied.',
    })
  })
}
