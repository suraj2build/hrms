/**
 * Employee Context-Data Routes
 *
 * Lightweight per-employee endpoints consumed by the EmployeeResolutionWorkspace
 * drawer (queue management) and similar HR tools that need a quick cross-domain
 * view of one employee without loading full pages.
 *
 * Routes:
 *   GET /employees/:id/attendance?limit=N    — last N attendance_daily rows
 *   GET /employees/:id/overtime?limit=N      — last N overtime_requests
 *   GET /employees/:id/payroll-summary       — most-recent payslip summary
 *   GET /employees/:id/activity-log          — stub (returns []) until an audit table is wired
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const HR_ROLES = ['super_admin', 'hr_admin']
const ALLOWED_ROLES = [...HR_ROLES, 'manager']

export default async function employeeContextDataRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Helper: verify employee belongs to tenant ────────────────────────────
  async function getEmployee(id: string, tenantId: string) {
    const { data } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return data
  }

  // ==========================================================================
  // GET /employees/:id/attendance?limit=N
  // Returns the last N attendance_daily records for this employee.
  // Response: plain array (no { data: [] } wrapper) — consumed directly by queue UI.
  // ==========================================================================
  fastify.get('/employees/:id/attendance', auth, async (req: any, reply) => {
    if (!ALLOWED_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorised' })
    }

    const { id } = req.params as { id: string }
    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(90).default(14),
    }).safeParse(req.query)
    const limit = qs.data?.limit ?? 14

    const emp = await getEmployee(id, req.tenantId)
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('attendance_daily')
      .select('date, work_hours, late_minutes, overtime_minutes, status, is_payable')
      .eq('employee_id', id)
      .eq('tenant_id', req.tenantId)
      .order('date', { ascending: false })
      .limit(limit)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    // Map to the shape the workspace expects
    const rows = (data ?? []).map((r: any) => ({
      date:        r.date,
      check_in:    null,                        // not in attendance_daily; use attendance_logs if needed
      check_out:   null,
      total_hours: r.work_hours != null ? (r.work_hours / 60).toFixed(2) : null,
      status:      r.status ?? 'unknown',
      late_minutes:       r.late_minutes ?? 0,
      overtime_minutes:   r.overtime_minutes ?? 0,
      is_payable:  r.is_payable ?? null,
    }))

    return reply.send(rows)
  })

  // ==========================================================================
  // GET /employees/:id/overtime?limit=N
  // Returns the last N overtime requests for this employee.
  // Response: plain array.
  // ==========================================================================
  fastify.get('/employees/:id/overtime', auth, async (req: any, reply) => {
    if (!ALLOWED_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorised' })
    }

    const { id } = req.params as { id: string }
    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(90).default(30),
    }).safeParse(req.query)
    const limit = qs.data?.limit ?? 30

    const emp = await getEmployee(id, req.tenantId)
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('overtime_requests')
      .select('id, attendance_date, raw_ot_minutes, approved_minutes, status, created_at')
      .eq('employee_id', id)
      .eq('tenant_id', req.tenantId)
      .order('attendance_date', { ascending: false })
      .limit(limit)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const rows = (data ?? []).map((r: any) => {
      const minutes = r.approved_minutes ?? r.raw_ot_minutes ?? 0
      return {
        id:       r.id,
        date:     r.attendance_date,
        ot_hours: (minutes / 60).toFixed(2),
        status:   r.status ?? 'PENDING',
        flagged:  r.status === 'REJECTED',
        created_at: r.created_at,
      }
    })

    return reply.send(rows)
  })

  // ==========================================================================
  // GET /employees/:id/payroll-summary
  // Returns a lightweight payroll summary from the employee's most-recent payslip.
  // Response: plain object (not array).
  // ==========================================================================
  fastify.get('/employees/:id/payroll-summary', auth, async (req: any, reply) => {
    if (!ALLOWED_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not authorised' })
    }

    const { id } = req.params as { id: string }

    const emp = await getEmployee(id, req.tenantId)
    if (!emp) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // Fetch latest payslip
    const { data: slip, error: slipErr } = await fastify.supabase
      .from('payroll_slips')
      .select('month, ctc_monthly, gross_pay, net_pay, total_deductions, status')
      .eq('employee_id', id)
      .eq('tenant_id', req.tenantId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (slipErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: slipErr.message })

    if (!slip) {
      // No payslip yet — return summary from employee_compensations
      const { data: comp } = await fastify.supabase
        .from('employee_compensations')
        .select('ctc_monthly, ctc_annual')
        .eq('employee_id', id)
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      return reply.send({
        ctc_monthly:        comp ? String((comp as any).ctc_monthly ?? 0) : '—',
        last_payslip_month: '—',
        pending_deductions: '0',
        advances:           '0',
        period_status:      'no_payslip',
      })
    }

    return reply.send({
      ctc_monthly:        String((slip as any).ctc_monthly ?? 0),
      last_payslip_month: (slip as any).month ?? '—',
      pending_deductions: String((slip as any).total_deductions ?? 0),
      advances:           '0',
      period_status:      (slip as any).status ?? '—',
    })
  })

  // ==========================================================================
  // GET /employees/:id/activity-log?types=queue_action&limit=N
  // Stub — returns an empty array until a unified audit log is available.
  // The caller already guards with .catch(() => []), so returning [] is fine.
  // ==========================================================================
  fastify.get('/employees/:id/activity-log', auth, async (req: any, reply) => {
    return reply.send([])
  })
}
