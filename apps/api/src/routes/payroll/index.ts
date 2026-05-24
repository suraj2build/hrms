/**
 * Payroll Routes
 *
 * POST   /payroll/runs                  — create or re-trigger a run for a month
 * GET    /payroll/runs                  — list all runs (paginated)
 * GET    /payroll/runs/blockers         — pre-run readiness: employees missing comp or attendance (Phase 10)
 * GET    /payroll/runs/:id              — get a single run with aggregated totals
 * POST   /payroll/runs/:id/finalize     — finalize a draft run (locks slips)
 * GET    /payroll/runs/:id/slips        — list all employee slips for a run
 * GET    /payroll/runs/:id/export       — CSV export of all slips
 * GET    /payroll/runs/:id/variance     — month-over-month variance vs previous run (Phase 10)
 * GET    /payroll/slips/:id             — get a single payslip (employee self-service)
 *
 * All write endpoints require hr_admin or super_admin.
 * Employees can read their own finalized slips via GET /payroll/slips/:id.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import {
  computePayrollSlip,
  countWorkingDaysInMonth,
  fetchAttendanceSummary,
  fetchActiveCompensation,
  type PayrollSlipResult,
} from '../../lib/payroll-engine.js'

const monthRe = /^\d{4}-\d{2}$/

export default async function payrollRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /payroll/runs ───────────────────────────────────────────────────────
  // Create or re-trigger a payroll run for a given month.
  // Idempotent: calling again for the same month replaces the existing draft run.
  fastify.post('/payroll/runs', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(monthRe, 'month must be YYYY-MM'),
      notes: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month, notes } = parsed.data
    const tenantId = req.tenantId as string

    // Fetch all active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')

    if (empErr) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })
    }

    const empList = (employees ?? []) as Array<{
      id: string
      first_name: string
      last_name:  string
      employee_code: string
    }>

    // Upsert the run row (draft)
    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .upsert({
        tenant_id:  tenantId,
        month,
        status:     'processing',
        notes:      notes ?? null,
        created_by: req.userId,
        employee_count: empList.length,
      }, { onConflict: 'tenant_id,month' })
      .select('id')
      .single()

    if (runErr || !run) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create payroll run' })
    }

    const runId = run.id as string

    // Delete existing slips for this run (re-compute fresh)
    await fastify.supabase
      .from('payroll_slips')
      .delete()
      .eq('run_id', runId)

    // Count working days once for the month
    const total_working_days = await countWorkingDaysInMonth(fastify.supabase, tenantId, month)

    // Compute per-employee slips
    const slipResults: PayrollSlipResult[] = []

    for (const emp of empList) {
      const [compensation, attendance] = await Promise.all([
        fetchActiveCompensation(fastify.supabase, tenantId, emp.id),
        fetchAttendanceSummary(fastify.supabase, tenantId, emp.id, month),
      ])

      const result = computePayrollSlip({
        tenantId,
        employeeId: emp.id,
        month,
        compensation,
        attendance,
        total_working_days,
      })

      slipResults.push(result)
    }

    // Bulk-insert slips
    if (slipResults.length) {
      const slipRows = slipResults.map(r => ({
        tenant_id:             tenantId,
        run_id:                runId,
        employee_id:           r.employeeId,
        month,
        total_working_days:    r.total_working_days,
        payable_days:          r.payable_days,
        lop_days:              r.lop_days,
        overtime_hours:        r.overtime_hours,
        ctc_monthly:           r.ctc_monthly,
        gross_pay:             r.gross_pay,
        lop_amount:            r.lop_amount,
        total_deductions:      r.total_deductions,
        net_pay:               r.net_pay,
        employer_contributions:r.employer_contributions,
        component_breakdown:   r.component_breakdown,
        status:                'draft',
      }))

      const { error: slipErr } = await fastify.supabase
        .from('payroll_slips')
        .insert(slipRows)

      if (slipErr) {
        req.log.error({ err: slipErr }, 'payroll slip insert failed')
        await fastify.supabase
          .from('payroll_runs')
          .update({ status: 'failed', error_message: slipErr.message })
          .eq('id', runId)
        return reply.code(500).send({ error: 'SLIP_INSERT_FAILED', message: 'Failed to save payroll slips' })
      }
    }

    // Aggregate totals and mark draft
    const totalGross       = slipResults.reduce((s, r) => s + r.gross_pay,              0)
    const totalDeductions  = slipResults.reduce((s, r) => s + r.total_deductions,       0)
    const totalNet         = slipResults.reduce((s, r) => s + r.net_pay,                0)
    const totalLop         = slipResults.reduce((s, r) => s + r.lop_amount,             0)

    await fastify.supabase
      .from('payroll_runs')
      .update({
        status:          'draft',
        employee_count:  slipResults.length,
        total_gross:     Math.round(totalGross * 100) / 100,
        total_deductions:Math.round(totalDeductions * 100) / 100,
        total_net:       Math.round(totalNet * 100) / 100,
        total_lop_amount:Math.round(totalLop * 100) / 100,
      })
      .eq('id', runId)

    return reply.code(201).send({
      run_id:          runId,
      month,
      employee_count:  slipResults.length,
      total_working_days,
      total_gross:     Math.round(totalGross * 100) / 100,
      total_net:       Math.round(totalNet * 100) / 100,
    })
  })

  // ── GET /payroll/runs ────────────────────────────────────────────────────────
  fastify.get('/payroll/runs', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(100).default(24),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset } = parsed.data

    const { data, error, count } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, total_gross, total_deductions, total_net, total_lop_amount, created_at, finalized_at', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch runs' })
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/runs/blockers?month=YYYY-MM ────────────────────────────────
  // Phase 10 — Pre-run readiness check.
  // Returns employees missing compensation or attendance data for the month,
  // plus a count of open attendance anomalies.
  // MUST be registered before /payroll/runs/:id (static segment beats param).
  fastify.get('/payroll/runs/blockers', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().regex(monthRe, 'month must be YYYY-MM'),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { month }    = parsed.data
    const tenantId     = req.tenantId as string
    const [year, mon]  = month.split('-').map(Number)
    const from         = `${month}-01`
    const to           = new Date(year, mon, 0).toISOString().slice(0, 10)

    // All active employees
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')
    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{
      id: string; first_name: string; last_name: string; employee_code: string
    }>

    // Parallel checks: active compensations, attendance presence, open anomalies
    const [
      { data: compRows },
      { data: attRows },
      { count: anomalyCount },
    ] = await Promise.all([
      fastify.supabase
        .from('employee_compensations')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
      fastify.supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .gte('date', from)
        .lte('date', to),
      fastify.supabase
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
        .gte('date', from)
        .lte('date', to),
    ])

    const hasComp = new Set<string>((compRows ?? []).map((r: { employee_id: string }) => r.employee_id))
    const hasAtt  = new Set<string>((attRows  ?? []).map((r: { employee_id: string }) => r.employee_id))

    type BlockerType = 'no_compensation' | 'no_attendance'
    type Blocker = { type: BlockerType; employee_id: string; employee_name: string; employee_code: string }
    const blockers: Blocker[] = []
    let readyCount = 0

    for (const emp of empList) {
      const name = `${emp.first_name} ${emp.last_name}`
      if (!hasComp.has(emp.id)) {
        blockers.push({ type: 'no_compensation', employee_id: emp.id, employee_name: name, employee_code: emp.employee_code })
      } else if (!hasAtt.has(emp.id)) {
        blockers.push({ type: 'no_attendance',   employee_id: emp.id, employee_name: name, employee_code: emp.employee_code })
      } else {
        readyCount++
      }
    }

    return reply.send({
      month,
      total_employees: empList.length,
      ready:           readyCount,
      no_compensation: blockers.filter(b => b.type === 'no_compensation').length,
      no_attendance:   blockers.filter(b => b.type === 'no_attendance').length,
      open_anomalies:  anomalyCount ?? 0,
      blockers,
    })
  })

  // ── GET /payroll/runs/:id ────────────────────────────────────────────────────
  fastify.get('/payroll/runs/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('payroll_runs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    return reply.send({ data })
  })

  // ── POST /payroll/runs/:id/finalize ──────────────────────────────────────────
  fastify.post('/payroll/runs/:id/finalize', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
    if (run.status === 'finalized') {
      return reply.code(409).send({ error: 'ALREADY_FINALIZED', message: 'Run is already finalized' })
    }
    if (run.status === 'failed') {
      return reply.code(409).send({ error: 'RUN_FAILED', message: 'Cannot finalize a failed run' })
    }

    // Finalize run and all its slips
    await Promise.all([
      fastify.supabase
        .from('payroll_runs')
        .update({ status: 'finalized', finalized_by: req.userId, finalized_at: new Date().toISOString() })
        .eq('id', id),
      fastify.supabase
        .from('payroll_slips')
        .update({ status: 'finalized' })
        .eq('run_id', id)
        .eq('status', 'draft'),
    ])

    return reply.send({ message: 'Payroll run finalized successfully' })
  })

  // ── GET /payroll/runs/:id/slips ──────────────────────────────────────────────
  fastify.get('/payroll/runs/:id/slips', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
      search: z.string().max(100).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset } = parsed.data

    // Verify run belongs to tenant
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    let q = fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, month, status,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay, employer_contributions,
        employees!inner(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .order('employees(employee_code)', { ascending: true })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch slips' })

    const slips = (data ?? []).map((r: any) => ({
      id:                    r.id,
      employee_id:           r.employee_id,
      employee_name:         r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : null,
      employee_code:         r.employees?.employee_code ?? null,
      month:                 r.month,
      status:                r.status,
      total_working_days:    r.total_working_days,
      payable_days:          r.payable_days,
      lop_days:              r.lop_days,
      overtime_hours:        r.overtime_hours,
      ctc_monthly:           r.ctc_monthly,
      gross_pay:             r.gross_pay,
      lop_amount:            r.lop_amount,
      total_deductions:      r.total_deductions,
      net_pay:               r.net_pay,
      employer_contributions:r.employer_contributions,
    }))

    return reply.send({ data: slips, total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/runs/:id/export ─────────────────────────────────────────────
  // CSV export of all slips for a run
  fastify.get('/payroll/runs/:id/export', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('month, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    const { data: slips } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        employee_id, month,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay,
        employees!inner(first_name, last_name, employee_code)
      `)
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .order('employees(employee_code)', { ascending: true })

    const header = [
      'Employee Code', 'Employee Name', 'Month',
      'Working Days', 'Payable Days', 'LOP Days', 'OT Hours',
      'CTC Monthly', 'Gross Pay', 'LOP Amount', 'Deductions', 'Net Pay',
    ].join(',')

    const rows = (slips ?? []).map((r: any) => {
      const name = r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : ''
      return [
        r.employees?.employee_code ?? '',
        `"${name}"`,
        r.month,
        r.total_working_days,
        r.payable_days,
        r.lop_days,
        r.overtime_hours,
        r.ctc_monthly,
        r.gross_pay,
        r.lop_amount,
        r.total_deductions,
        r.net_pay,
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')
    reply.header('Content-Type', 'text/csv')
    reply.header('Content-Disposition', `attachment; filename="payroll-${run.month}.csv"`)
    return reply.send(csv)
  })

  // ── GET /payroll/runs/:id/variance ──────────────────────────────────────────
  // Phase 10 — Month-over-month variance.
  // Compares this run to the most recent run for the previous month.
  // Employees sorted by absolute net-pay change (largest movers first).
  fastify.get('/payroll/runs/:id/variance', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const r2 = (n: number) => Math.round(n * 100) / 100

    // Current run
    const { data: currentRun } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()
    if (!currentRun) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })

    // Derive previous month string
    const [cy, cm]  = currentRun.month.split('-').map(Number)
    const pd        = new Date(cy, cm - 2, 1)
    const prevMonth = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`

    // Fetch current slips + previous run in parallel
    const [
      { data: currentSlips },
      { data: prevRun },
    ] = await Promise.all([
      fastify.supabase
        .from('payroll_slips')
        .select(`
          employee_id, gross_pay, net_pay, lop_days, lop_amount,
          payable_days, total_deductions,
          employees!inner(first_name, last_name, employee_code)
        `)
        .eq('run_id', id)
        .eq('tenant_id', tenantId),
      fastify.supabase
        .from('payroll_runs')
        .select('id, month')
        .eq('tenant_id', tenantId)
        .eq('month', prevMonth)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const totalCurrGross = r2((currentSlips ?? []).reduce((s: number, r: any) => s + r.gross_pay, 0))
    const totalCurrNet   = r2((currentSlips ?? []).reduce((s: number, r: any) => s + r.net_pay,   0))

    // No previous run — return current totals with no comparison
    if (!prevRun) {
      return reply.send({
        current_month:  currentRun.month,
        previous_month: prevMonth,
        has_previous:   false,
        summary: {
          total_employees:     (currentSlips ?? []).length,
          employees_changed:   0,
          gross_change:        0,
          gross_change_pct:    0,
          net_change:          0,
          net_change_pct:      0,
          total_current_gross: totalCurrGross,
          total_current_net:   totalCurrNet,
          total_prev_gross:    0,
          total_prev_net:      0,
        },
        employees: [],
      })
    }

    // Fetch previous run slips
    const { data: prevSlips } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, gross_pay, net_pay, lop_days, lop_amount, payable_days, total_deductions')
      .eq('run_id', prevRun.id)
      .eq('tenant_id', tenantId)

    const prevMap = new Map<string, any>((prevSlips ?? []).map((s: any) => [s.employee_id, s]))

    type EmpVariance = {
      employee_id:   string
      employee_name: string | null
      employee_code: string | null
      current:  { gross_pay: number; net_pay: number; lop_days: number; lop_amount: number; payable_days: number; total_deductions: number }
      previous: { gross_pay: number; net_pay: number; lop_days: number; lop_amount: number; payable_days: number; total_deductions: number } | null
      diff:     { gross_pay: number; net_pay: number; lop_days: number }
      is_new:   boolean
    }

    const employees: EmpVariance[] = (currentSlips ?? []).map((curr: any) => {
      const prev = prevMap.get(curr.employee_id) ?? null
      const emp  = curr.employees as { first_name: string; last_name: string; employee_code: string } | null
      return {
        employee_id:   curr.employee_id,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
        current: {
          gross_pay:        curr.gross_pay,
          net_pay:          curr.net_pay,
          lop_days:         curr.lop_days,
          lop_amount:       curr.lop_amount,
          payable_days:     curr.payable_days,
          total_deductions: curr.total_deductions,
        },
        previous: prev ? {
          gross_pay:        prev.gross_pay,
          net_pay:          prev.net_pay,
          lop_days:         prev.lop_days,
          lop_amount:       prev.lop_amount,
          payable_days:     prev.payable_days,
          total_deductions: prev.total_deductions,
        } : null,
        diff: {
          gross_pay: r2(curr.gross_pay - (prev?.gross_pay ?? 0)),
          net_pay:   r2(curr.net_pay   - (prev?.net_pay   ?? 0)),
          lop_days:  curr.lop_days     - (prev?.lop_days  ?? 0),
        },
        is_new: !prev,
      }
    })
    // Largest absolute net-pay movers first
    employees.sort((a, b) => Math.abs(b.diff.net_pay) - Math.abs(a.diff.net_pay))

    const totalPrevGross = r2((prevSlips ?? []).reduce((s: number, r: any) => s + r.gross_pay, 0))
    const totalPrevNet   = r2((prevSlips ?? []).reduce((s: number, r: any) => s + r.net_pay,   0))
    const grossChange    = r2(totalCurrGross - totalPrevGross)
    const netChange      = r2(totalCurrNet   - totalPrevNet)

    return reply.send({
      current_month:  currentRun.month,
      previous_month: prevMonth,
      has_previous:   true,
      summary: {
        total_employees:     (currentSlips ?? []).length,
        employees_changed:   employees.filter(e => e.diff.net_pay !== 0 || e.diff.gross_pay !== 0).length,
        gross_change:        grossChange,
        gross_change_pct:    totalPrevGross > 0 ? r2((grossChange / totalPrevGross) * 100) : 0,
        net_change:          netChange,
        net_change_pct:      totalPrevNet   > 0 ? r2((netChange   / totalPrevNet)   * 100) : 0,
        total_current_gross: totalCurrGross,
        total_current_net:   totalCurrNet,
        total_prev_gross:    totalPrevGross,
        total_prev_net:      totalPrevNet,
      },
      employees,
    })
  })

  // ── GET /payroll/slips/:id ───────────────────────────────────────────────────
  // Full slip with component breakdown. HR admins can access all; employees only own finalized.
  fastify.get('/payroll/slips/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isAdmin = HR_ADMIN_ROLES.includes(req.userRole)

    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        *,
        employees!inner(id, first_name, last_name, employee_code)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Slip not found' })

    // Non-admin can only see their own finalized slip
    if (!isAdmin) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .maybeSingle()

      if (profile?.employee_id !== data.employee_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own payslip' })
      }
      if (data.status !== 'finalized') {
        return reply.code(403).send({ error: 'NOT_FINALIZED', message: 'Payslip is not yet finalized' })
      }
    }

    const emp = (data as any).employees
    return reply.send({
      data: {
        ...data,
        employees: undefined,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
      },
    })
  })

  // ── GET /payroll/my-slips ────────────────────────────────────────────────────
  // ESS: employee views own finalized payslips (list)
  fastify.get('/payroll/my-slips', auth, async (req: any, reply) => {
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .maybeSingle()

    if (!profile?.employee_id) return reply.send([])

    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select('id, month, status, gross_pay, total_deductions, net_pay, lop_days, payable_days, created_at')
      .eq('tenant_id',   req.tenantId)
      .eq('employee_id', profile.employee_id)
      .eq('status',      'finalized')
      .order('month', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch payslips' })
    return reply.send(data ?? [])
  })
}
