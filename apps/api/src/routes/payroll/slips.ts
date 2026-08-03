/**
 * Payroll Slips (Employee Self-Service + Run Slip List)
 *
 * GET /payroll/runs/:id/slips   — list all employee slips for a run (hr_admin)
 * GET /payroll/slips/:id        — get a single payslip (employee self-service)
 * GET /payroll/my-slips         — ESS: employee views own finalized payslips
 * GET /payroll/slips/trend      — ESS: pay trend across recent finalized months
 *
 * Split out of the former monolithic routes/payroll/index.ts.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, forbidden, validationError, ErrorCode } from '../../lib/api-errors.js'
import { sanitizeOrFilterTerm } from '../../lib/postgrest-filter.js'
import {
  buildPayrollVisibilityState,
  buildEmployeePayslipView,
  employeeVisibilityLabel,
} from '../../lib/payroll-read-model.js'

export default async function payrollSlipsRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/payroll/runs/:id/slips', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).default(0),
      search: z.string().max(100).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }
    const { limit, offset, search } = parsed.data

    // Verify run belongs to tenant — fetch full run status for visibility computation
    const { data: run } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) return notFound(reply, 'NOT_FOUND', 'Run not found')

    // SYSCERT_AUDIT_2026-08-02.md H1: `search` was validated by the query
    // schema but never applied to the query — the slip search box was a
    // complete no-op. payroll_slips has no name/code columns of its own (the
    // employee's name/code live on the joined `employees` table), so resolve
    // matching employee_ids first, then filter slips by that set — same
    // two-step shape as /employees/search's ilike-OR pattern.
    let matchedEmployeeIds: string[] | null = null
    if (search && search.trim()) {
      const term = `%${sanitizeOrFilterTerm(search.trim())}%`
      const { data: matches, error: matchErr } = await fastify.supabase
        .from('employees')
        .select('id')
        .eq('tenant_id', req.tenantId)
        .or(`first_name.ilike.${term},last_name.ilike.${term},employee_code.ilike.${term}`)
        .limit(1000)
      if (matchErr) return serverError(req, reply, matchErr, ErrorCode.QUERY_FAILED, 'Failed to search employees')
      matchedEmployeeIds = (matches ?? []).map((m: { id: string }) => m.id)
      if (!matchedEmployeeIds.length) {
        return reply.send({ data: [], total: 0, limit, offset })
      }
    }

    // Use LEFT JOIN (no !inner) so orphaned slips remain visible when employee row
    // has been archived or soft-deleted — !inner would silently drop those slips.
    let q = fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, month, status, held_reason, warning,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay, employer_contributions,
        component_breakdown,
        employees(id, first_name, last_name, employee_code)
      `, { count: 'exact' })
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .range(offset, offset + limit - 1)

    if (matchedEmployeeIds) {
      q = q.in('employee_id', matchedEmployeeIds)
    }

    const { data, error, count } = await q
    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch slips')
    }

    const slips = (data ?? []).map((r: any) => {
      const emp = r.employees ?? null
      return buildEmployeePayslipView(
        {
          id:                    r.id,
          employee_id:           r.employee_id,
          run_id:                id,
          month:                 r.month,
          gross_pay:             r.gross_pay,
          net_pay:               r.net_pay,
          lop_days:              r.lop_days,
          lop_amount:            r.lop_amount,
          payable_days:          r.payable_days,
          total_working_days:    r.total_working_days,
          overtime_hours:        r.overtime_hours,
          ctc_monthly:           r.ctc_monthly,
          total_deductions:      r.total_deductions,
          employer_contributions:r.employer_contributions,
          component_breakdown:   r.component_breakdown ?? [],
          status:                r.status,
          held_reason:           r.held_reason ?? null,
          warning:               r.warning ?? null,
        },
        { id, status: run.status },
        emp ? { first_name: emp.first_name, last_name: emp.last_name, employee_code: emp.employee_code } : null,
      )
    })

    return reply.send({ data: slips, total: count ?? 0, limit, offset })
  })

  // ── GET /payroll/runs/:id/export ─────────────────────────────────────────────
  // CSV export of all slips for a run
  fastify.get('/payroll/slips/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const isAdmin = HR_ADMIN_ROLES.includes(req.userRole)

    // LEFT JOIN (no !inner) — orphan slips (archived employee) must remain retrievable by admin.
    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        *,
        payroll_runs!inner(id, status),
        employees(id, first_name, last_name, employee_code)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) {
      req.log.warn({ slip_id: id, tenant_id: req.tenantId, err: error }, 'payroll: slip not found or query error')
      return notFound(reply, 'NOT_FOUND', 'Slip not found')
    }

    const slip = data as any
    const run  = slip.payroll_runs ?? null
    const emp  = slip.employees    ?? null

    // Compute visibility state before access checks so we can return it in the response
    const visibility = buildPayrollVisibilityState(
      { status: slip.status, held_reason: slip.held_reason },
      run ? { status: run.status } : null,
    )

    // Non-admin can only see their own finalized slip
    if (!isAdmin) {
      const { data: profile, error: profileErr } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (profileErr) {
        return serverError(req, reply, profileErr, 'PROFILE_FETCH_FAILED', 'Unable to verify your employee identity')
      }

      if (profile?.employee_id !== slip.employee_id) {
        return forbidden(reply, 'FORBIDDEN', 'You can only view your own payslip')
      }

      if (!visibility.employee_visible) {
        return forbidden(reply, 'NOT_FINALIZED', employeeVisibilityLabel(visibility))
      }
    }

    return reply.send({
      data: {
        ...slip,
        payroll_runs:  undefined,
        employees:     undefined,
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code: emp?.employee_code ?? null,
        run_status:    run?.status ?? null,
        visibility,
      },
    })
  })

  // ── GET /payroll/runs/:id/blockers ──────────────────────────────────────────
  // Resolution Center data: grouped blockers + run health for a failed/partial run.
  // Returns: { groups, health, run }
  fastify.get('/payroll/my-slips', auth, async (req: any, reply) => {
    // Resolve employee_id from auth profile (tenant-scoped to prevent cross-tenant leaks)
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (profileErr) {
      return serverError(req, reply, profileErr, 'PROFILE_FETCH_FAILED', 'Unable to resolve your employee profile')
    }

    // Profile exists but no employee_id linked — return empty list (not an error)
    if (!profile?.employee_id) {
      return reply.send({ data: [] })
    }

    // Fetch all finalized slips with run context for visibility computation.
    // LEFT JOIN on payroll_runs (via run_id FK) to get run status.
    // Only finalized slips are returned to employees — the RLS policy ps_emp_read
    // already enforces status='finalized', but we filter here too for defence-in-depth.
    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select(`
        id, employee_id, run_id, month, status, held_reason, warning,
        total_working_days, payable_days, lop_days, overtime_hours,
        ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay,
        employer_contributions, component_breakdown, created_at,
        payroll_runs!inner(id, status)
      `)
      .eq('tenant_id',   req.tenantId)
      .eq('employee_id', profile.employee_id)
      .eq('status',      'finalized')
      .order('month', { ascending: false })

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payslips')
    }

    const slips = (data ?? []).map((r: any) => {
      const run = r.payroll_runs ?? null
      const visibility = buildPayrollVisibilityState(
        { status: r.status, held_reason: r.held_reason },
        run ? { status: run.status } : null,
      )
      return {
        slip_id:               r.id,
        employee_id:           r.employee_id,
        month:                 r.month,
        run_id:                r.run_id,
        run_status:            run?.status ?? null,
        gross_pay:             r.gross_pay,
        net_pay:               r.net_pay,
        lop_days:              r.lop_days,
        lop_amount:            r.lop_amount,
        payable_days:          r.payable_days,
        total_working_days:    r.total_working_days,
        overtime_hours:        r.overtime_hours,
        ctc_monthly:           r.ctc_monthly,
        total_deductions:      r.total_deductions,
        employer_contributions:r.employer_contributions,
        component_breakdown:   r.component_breakdown ?? [],
        status:                r.status,
        held_reason:           r.held_reason ?? null,
        warning:               r.warning ?? null,
        created_at:            r.created_at,
        visibility,
      }
    })

    return reply.send({ data: slips })
  })

  // ── GET /payroll/slips/trend ─────────────────────────────────────────────────
  // ESS: rolling month-by-month trend of the caller's net pay, gross pay, and
  // LOP days. Used to drive the EssCompensation chart.
  // Query params: months (1–24, default 12)
  fastify.get('/payroll/slips/trend', auth, async (req: any, reply) => {
    // Resolve employee_id from the authenticated user's profile
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', req.userId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (profileErr) {
      return serverError(req, reply, profileErr, 'PROFILE_FETCH_FAILED', 'Unable to resolve your employee profile')
    }

    if (!profile?.employee_id) {
      return reply.send({ data: [] })
    }

    const querySchema = z.object({
      months: z.coerce.number().int().min(1).max(24).default(12),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    }

    const { months } = parsed.data

    // Compute the earliest month to include: today's year-month minus (months - 1)
    const now      = new Date()
    const cutoffDt = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
    const cutoff   = `${cutoffDt.getFullYear()}-${String(cutoffDt.getMonth() + 1).padStart(2, '0')}`

    const { data, error } = await fastify.supabase
      .from('payroll_slips')
      .select('month, net_pay, gross_pay, lop_days, lop_amount, payable_days, ctc_monthly, status')
      .eq('employee_id', profile.employee_id)
      .eq('tenant_id', req.tenantId)
      .gte('month', cutoff)
      .order('month', { ascending: true })

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll trend')
    }

    // Only include finalized slips in the trend — draft/held slips are not yet authoritative
    const trend = (data ?? [])
      .filter((r: any) => r.status === 'finalized')
      .map((r: any) => ({
        month:        r.month,
        net_pay:      r.net_pay      ?? 0,
        gross_pay:    r.gross_pay    ?? 0,
        lop_days:     r.lop_days     ?? 0,
        lop_amount:   r.lop_amount   ?? 0,
        payable_days: r.payable_days ?? 0,
        ctc_monthly:  r.ctc_monthly  ?? 0,
      }))

    return reply.send({ data: trend, months_requested: months })
  })

  // ── POST /payroll/runs/:id/rollback ──────────────────────────────────────────
  // Roll a finalized/partial_failed run back to draft so it can be re-processed.
  // Only super_admin may rollback a finalized run; hr_admin can rollback drafts.
}
