/**
 * Payroll Investigation Route — Phase 2
 *
 * GET /payroll/investigate/:employeeId?month=YYYY-MM
 *
 * Returns a comprehensive investigation context for one employee × one month:
 *   - Attendance summary (payable days, LOP, OT, work hours)
 *   - Approved leaves overlapping the month
 *   - Approved attendance corrections
 *   - Open anomalies
 *   - Recompute / audit history
 *   - Current month payroll slip (if computed)
 *   - Previous month payroll slip (for MoM variance)
 *   - Derived variance metrics
 *   - Payroll blocker analysis
 *   - Explainability ledger entries
 *
 * Auth: hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const from   = `${month}-01`
  // Date.UTC (not new Date(y, m, 0), which anchors to the process's local TZ)
  // so month-end is correct regardless of the server process's TZ setting.
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from, to: lastDay }
}

function prevMonthStr(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function payrollInvestigateRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/payroll/investigate/:employeeId', auth, async (req: any, reply) => {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { employeeId } = req.params as { employeeId: string }
    const qs = z.object({
      month: z.string().regex(monthRe, 'month must be YYYY-MM'),
    }).safeParse(req.query)

    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })
    }

    const { month } = qs.data
    const { from, to } = monthRange(month)
    const prev   = prevMonthStr(month)

    // ── Verify employee belongs to tenant ────────────────────────────────────
    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('id', employeeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (empErr) return serverError(req, reply, empErr, ErrorCode.QUERY_FAILED, 'Failed to look up employee')
    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Fetch current job info (department/designation)
    const { data: jobRow, error: jobErr } = await fastify.supabase
      .from('job_history')
      .select('departments(name), designations(name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
      .maybeSingle()

    if (jobErr) return serverError(req, reply, jobErr, ErrorCode.QUERY_FAILED, 'Failed to look up job history')

    const deptArr  = jobRow ? (Array.isArray((jobRow as any).departments) ? (jobRow as any).departments : [(jobRow as any).departments]) : []
    const desigArr = jobRow ? (Array.isArray((jobRow as any).designations) ? (jobRow as any).designations : [(jobRow as any).designations]) : []

    // ── Parallel data fetches ────────────────────────────────────────────────
    const [
      attRes,
      leaveRes,
      corrRes,
      anomalyRes,
      auditRes,
      slipRes,
      prevSlipRes,
      ledgerRes,
    ] = await Promise.all([

      // 1. Attendance daily rows for the month
      fastify.supabase
        .from('attendance_daily')
        .select('date, status, work_hours, late_minutes, overtime_minutes, is_payable, day_fraction')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .gte('date', from)
        .lte('date', to)
        .order('date'),

      // 2. Approved leaves overlapping the month — canonical leave_requests
      fastify.supabase
        .from('leave_requests')
        .select('id, from_date, to_date, reason, status, approved_at, leave_types(id, name, is_paid)')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .lte('from_date', to)
        .gte('to_date', from)
        .order('from_date'),

      // 3. Approved corrections for this month
      fastify.supabase
        .from('attendance_regularisation')
        .select('id, date, reason, status, approved_at, requested_check_in, requested_check_out')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('status', 'approved')
        .gte('date', from)
        .lte('date', to)
        .order('date'),

      // 4. Anomalies for this month (open + resolved)
      fastify.supabase
        .from('attendance_anomalies')
        .select('id, date, type, severity, message, resolved, resolved_at')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: false }),

      // 5. Attendance audit log for this month (recompute history)
      fastify.supabase
        .from('attendance_audit_log')
        .select('id, date, source, before_status, after_status, created_at')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .gte('date', from)
        .lte('date', to)
        .order('created_at', { ascending: false })
        .limit(30),

      // 6. Current month payroll slip
      fastify.supabase
        .from('payroll_slips')
        .select(`
          id, gross_pay, lop_amount, total_deductions, net_pay,
          payable_days, lop_days, total_working_days, overtime_hours,
          ctc_monthly, status, component_breakdown, held_reason, warning,
          payroll_runs(id, month, status, finalized_at)
        `)
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('month', month)
        .maybeSingle(),

      // 7. Previous month payroll slip
      fastify.supabase
        .from('payroll_slips')
        .select('id, gross_pay, lop_amount, total_deductions, net_pay, payable_days, lop_days, total_working_days, overtime_hours, ctc_monthly, status')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('month', prev)
        .maybeSingle(),

      // 8. Explainability ledger entries
      fastify.supabase
        .from('payroll_explainability_ledger')
        .select('id, event_type, event_description, impact_type, impact_amount, before_value, after_value, source_entity_type, source_entity_id, created_at, profiles(full_name)')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .eq('month', month)
        .order('created_at', { ascending: false }),
    ])

    const firstError = [attRes, leaveRes, corrRes, anomalyRes, auditRes, slipRes, prevSlipRes, ledgerRes]
      .map(r => r.error).find(Boolean)
    if (firstError) {
      return serverError(req, reply, firstError, ErrorCode.QUERY_FAILED, 'Failed to load payroll investigation data')
    }

    // ── Compute attendance summary ────────────────────────────────────────────
    const days = (attRes.data ?? []) as Array<{
      date: string; status: string | null; work_hours: number
      late_minutes: number; overtime_minutes: number; is_payable: boolean; day_fraction: number
    }>

    const attSummary = {
      total_days:         days.length,
      payable_days:       days.filter(d => d.is_payable).length,
      lop_days:           days.filter(d => !d.is_payable && d.status === 'absent').length,
      present_days:       days.filter(d => ['present', 'late'].includes(d.status ?? '')).length,
      late_days:          days.filter(d => d.status === 'late').length,
      absent_days:        days.filter(d => d.status === 'absent').length,
      leave_days:         days.filter(d => d.status === 'leave').length,
      holiday_days:       days.filter(d => ['holiday', 'weekly_off', 'weekend'].includes(d.status ?? '')).length,
      half_days:          days.filter(d => d.status === 'half_day').length,
      // work_hours is NUMERIC(5,2) — coerce or the very first row's string throws
      // (a string has no .toFixed()), 500ing this endpoint for any employee with
      // attendance data that month (G13 sweep).
      total_work_hours:   parseFloat(days.reduce((s, d) => s + Number(d.work_hours ?? 0), 0).toFixed(2)),
      total_ot_hours:     parseFloat((days.reduce((s, d) => s + (d.overtime_minutes ?? 0), 0) / 60).toFixed(2)),
      total_late_minutes: days.reduce((s, d) => s + (d.late_minutes ?? 0), 0),
    }

    // ── MoM variance ─────────────────────────────────────────────────────────
    const curSlip  = slipRes.data  as (typeof slipRes.data & { payroll_runs?: any }) | null
    const prevSlip = prevSlipRes.data

    const variance = (curSlip && prevSlip) ? {
      net_pay_diff:      Math.round((curSlip.net_pay - prevSlip.net_pay) * 100) / 100,
      gross_pay_diff:    Math.round((curSlip.gross_pay - prevSlip.gross_pay) * 100) / 100,
      deductions_diff:   Math.round((curSlip.total_deductions - prevSlip.total_deductions) * 100) / 100,
      lop_days_diff:     (curSlip.lop_days ?? 0) - (prevSlip.lop_days ?? 0),
      payable_days_diff: (curSlip.payable_days ?? 0) - (prevSlip.payable_days ?? 0),
      ot_hours_diff:     Math.round(((curSlip.overtime_hours ?? 0) - (prevSlip.overtime_hours ?? 0)) * 100) / 100,
      lop_amount_diff:   Math.round(((curSlip.lop_amount ?? 0) - (prevSlip.lop_amount ?? 0)) * 100) / 100,
      prev_month:        prev,
    } : null

    // ── Payroll blocker analysis ──────────────────────────────────────────────
    const openAnomalies = (anomalyRes.data ?? []).filter(a => !a.resolved)
    const blockers: string[] = []

    if (attSummary.total_days === 0) {
      blockers.push('No attendance records found for this month')
    }
    if (openAnomalies.length > 0) {
      blockers.push(`${openAnomalies.length} unresolved attendance anomaly(ies) may affect accuracy`)
    }
    if (!curSlip) {
      blockers.push('Payroll not yet computed for this month')
    }

    // ── Format leaves ─────────────────────────────────────────────────────────
    const leaves = (leaveRes.data ?? []).map((l: any) => ({
      id:          l.id,
      from_date:   l.from_date,
      to_date:     l.to_date,
      status:      l.status,
      approved_at: l.approved_at,
      reason:      l.reason,
      leave_type:  l.leave_types?.name  ?? null,
      leave_type_id: l.leave_types?.id ?? null,
      is_paid:     l.leave_types?.is_paid ?? false,
    }))

    // ── Format ledger entries ─────────────────────────────────────────────────
    const ledger = (ledgerRes.data ?? []).map((e: any) => ({
      id:                e.id,
      event_type:        e.event_type,
      event_description: e.event_description,
      impact_type:       e.impact_type,
      impact_amount:     e.impact_amount,
      before_value:      e.before_value,
      after_value:       e.after_value,
      source_entity_type: e.source_entity_type,
      source_entity_id:  e.source_entity_id,
      created_at:        e.created_at,
      created_by_name:   (Array.isArray(e.profiles) ? e.profiles[0] : e.profiles)?.full_name ?? null,
    }))

    return reply.send({
      employee: {
        id:          emp.id,
        name:        `${emp.first_name} ${emp.last_name}`,
        code:        emp.employee_code,
        department:  (deptArr[0] as any)?.name ?? null,
        designation: (desigArr[0] as any)?.name ?? null,
      },
      month,
      range:             { from, to },
      attendance:        attSummary,
      leaves,
      corrections:       corrRes.data   ?? [],
      anomalies:         anomalyRes.data ?? [],
      recompute_history: auditRes.data  ?? [],
      current_slip:      curSlip ?? null,
      prev_slip:         prevSlip ? { ...prevSlip, month: prev } : null,
      variance,
      blocker:           { is_blocked: blockers.length > 0, reasons: blockers },
      ledger,
    })
  })
}
