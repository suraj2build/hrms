/**
 * Manager Team Payroll Cost — P6.11
 *
 * GET /manager/team/payroll-cost?month=YYYY-MM
 *   Per-employee payroll figures for the caller's direct reports for a given
 *   payroll month. Reads payroll_slips (the authoritative per-employee payroll
 *   output). Managers see only their own team; HR admins may
 *   pass ?manager_employee_id to inspect a specific team, or see all employees
 *   when omitted.
 *
 *   Returns: { data[], month, run_status, total: { gross, net, ot_cost, lop } }
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  isHrAdmin, resolveManagerEmployeeId, getDirectReportIds,
} from '../../lib/manager-scope.js'
import { otFromBreakdown } from '../../lib/payroll-dept-snapshot.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

const monthRe = /^\d{4}-\d{2}$/

// Tenant-local current month — a bare server-UTC clock would default to the
// wrong month during the first ~5.5 hours of a new tenant-local month for an
// IST tenant (same bug class fixed in payroll/cost.ts).
async function currentMonth(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz).slice(0, 7)
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default async function managerTeamPayrollCostRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/manager/team/payroll-cost', auth, async (req: any, reply) => {
    const qSchema = z.object({
      month:               z.string().regex(monthRe, 'month must be YYYY-MM').optional(),
      manager_employee_id: z.string().uuid().optional(),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const month = parsed.data.month ?? await currentMonth(fastify, req.tenantId)
    const { manager_employee_id } = parsed.data

    let employeeIds: string[]

    if (isHrAdmin(req.userRole) && manager_employee_id) {
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, manager_employee_id)
    } else if (isHrAdmin(req.userRole)) {
      const emps = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .in('status', ['active', 'on_notice'])
          .range(from, to)
      )
      employeeIds = (emps as any[]).map(e => e.id)
    } else {
      const managerEmpId = await resolveManagerEmployeeId(fastify.supabase, req)
      if (!managerEmpId) return reply.send({ data: [], month, run_status: null, total: null })
      employeeIds = await getDirectReportIds(fastify.supabase, req.tenantId, managerEmpId)
    }

    if (!employeeIds.length) {
      return reply.send({ data: [], month, run_status: null, total: null })
    }

    // Find the payroll run for this month
    const { data: run, error: runError } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .maybeSingle()

    if (runError) return serverError(req, reply, runError, ErrorCode.QUERY_FAILED, 'Failed to fetch team payroll cost')

    if (!run) {
      return reply.send({ data: [], month, run_status: null, total: null, note: 'No payroll run for this month' })
    }

    // Per-employee figures come from payroll_slips — the authoritative per-employee
    // payroll output. (payroll_run_employees is read-only legacy: nothing writes it.)
    // OT cost is derived from the slip's component_breakdown; volatility is computed
    // against the prior month's net pay.
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select(`
            employee_id, gross_pay, net_pay, lop_amount, component_breakdown,
            employees!inner( id, first_name, last_name, employee_code, designations(name) )
          `)
          .eq('tenant_id', req.tenantId)
          .eq('run_id', run.id)
          .in('employee_id', employeeIds)
          .order('gross_pay', { ascending: false })
          .range(from, to)
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch team payroll cost')
    }

    // Prior-month net pay per employee → volatility = |net − prior| / prior × 100
    const priorNet = new Map<string, number>()
    const { data: priorRun, error: priorRunError } = await fastify.supabase
      .from('payroll_runs')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .eq('month', prevMonth(month))
      .maybeSingle()
    if (priorRunError) return serverError(req, reply, priorRunError, ErrorCode.QUERY_FAILED, 'Failed to fetch team payroll cost')
    if (priorRun) {
      const { data: priorSlips, error: priorSlipsError } = await fastify.supabase
        .from('payroll_slips')
        .select('employee_id, net_pay')
        .eq('tenant_id', req.tenantId)
        .eq('run_id', (priorRun as any).id)
        .in('employee_id', employeeIds)
      if (priorSlipsError) return serverError(req, reply, priorSlipsError, ErrorCode.QUERY_FAILED, 'Failed to fetch team payroll cost')
      for (const s of (priorSlips ?? []) as any[]) priorNet.set(s.employee_id, Number(s.net_pay ?? 0))
    }

    const data = (rows ?? []).map((r: any) => {
      const net   = Number(r.net_pay ?? 0)
      const prior = priorNet.get(r.employee_id)
      const volatility_index = prior && prior > 0
        ? Math.round((Math.abs(net - prior) / prior) * 10000) / 100
        : null
      return {
        employee_id:      r.employee_id,
        name:             r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
        employee_code:    r.employees?.employee_code ?? null,
        designation:      (Array.isArray(r.employees?.designations) ? r.employees.designations[0]?.name : r.employees?.designations?.name) ?? null,
        gross_pay:        Number(r.gross_pay ?? 0),
        net_pay:          net,
        ot_cost:          otFromBreakdown(r.component_breakdown),
        lop_deduction:    Number(r.lop_amount ?? 0),
        volatility_index,
      }
    })

    const total = data.reduce(
      (acc: { gross_pay: number; net_pay: number; ot_cost: number; lop_deduction: number }, r) => ({
        gross_pay:    acc.gross_pay    + r.gross_pay,
        net_pay:      acc.net_pay      + r.net_pay,
        ot_cost:      acc.ot_cost      + r.ot_cost,
        lop_deduction: acc.lop_deduction + r.lop_deduction,
      }),
      { gross_pay: 0, net_pay: 0, ot_cost: 0, lop_deduction: 0 },
    )

    return reply.send({ data, month, run_status: run.status, total })
  })
}
