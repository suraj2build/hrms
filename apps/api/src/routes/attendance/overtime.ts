/**
 * Overtime Routes — Phase 4
 *
 * GET    /overtime/requests                 — list OT requests (admin: all; employee: own)
 * GET    /overtime/requests/:id             — single request
 * POST   /overtime/requests                 — create (usually system-generated after processing)
 * POST   /overtime/requests/:id/approve     — approve (manager / HR)
 * POST   /overtime/requests/:id/reject      — reject (manager / HR)
 *
 * GET    /overtime/policies                 — list OT policies (admin)
 * POST   /overtime/policies                 — create policy (admin)
 * PUT    /overtime/policies/:id             — update policy (admin)
 * DELETE /overtime/policies/:id             — delete policy (admin)
 * POST   /overtime/policies/:id/set-default — set as tenant default (admin)
 *
 * GET    /overtime/assignments              — list employee→policy assignments (admin)
 * POST   /overtime/assignments              — assign employee to policy (admin)
 * DELETE /overtime/assignments/:id         — remove assignment (admin)
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  resolveOtPolicy,
  createOtRequest,
  approveOtRequest,
  rejectOtRequest,
}                               from '../../lib/ot-engine.js'
import {
  isHrAdmin, resolveCallerEmployeeId, getDirectReportIds, isDirectReport,
}                               from '../../lib/manager-scope.js'
import { isMonthLocked, monthOf } from '../../lib/period-lock.js'
import { isSelfApproval } from '../../lib/approval-guards.js'
import { logAction } from '../../lib/audit-service.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function overtimeRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  function requireManagerOrAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin', 'manager'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
      return false
    }
    return true
  }

  /**
   * P6.0b — ownership guard. HR admins may action any OT request; a manager may
   * only action requests belonging to their own direct reports. Returns true when
   * the caller is authorised, otherwise sends the response and returns false.
   */
  async function authorizeOtTarget(req: any, reply: any, otRequestId: string): Promise<boolean> {
    if (isHrAdmin(req.userRole)) return true
    const { data: ot } = await fastify.supabase
      .from('overtime_requests')
      .select('employee_id')
      .eq('id', otRequestId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!ot) {
      reply.code(404).send({ error: 'NOT_FOUND', message: 'OT request not found' })
      return false
    }
    const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
    if (!myEmpId || !(await isDirectReport(fastify.supabase, req.tenantId, myEmpId, (ot as any).employee_id))) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only action overtime for your direct reports' })
      return false
    }
    return true
  }

  // Period protection — block OT actions whose attendance day sits in a locked
  // month. Returns false (and sends 409) when locked.
  async function assertOtPeriodOpen(req: any, reply: any, otRequestId: string): Promise<boolean> {
    const { data: ot } = await fastify.supabase
      .from('overtime_requests')
      .select('attendance_date, employee_id')
      .eq('id', otRequestId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    // Segregation of duties — a user may not approve/reject their own OT (F3).
    if (await isSelfApproval(fastify.supabase, req.tenantId, req.userId, (ot as any)?.employee_id)) {
      reply.code(403).send({
        error:   'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot action your own overtime request.',
      })
      return false
    }

    const date = (ot as any)?.attendance_date as string | undefined
    if (date && await isMonthLocked(fastify.supabase, req.tenantId, monthOf(date))) {
      reply.code(409).send({
        error:   'PERIOD_LOCKED',
        message: `Attendance period ${monthOf(date)} is locked for payroll — no changes allowed.`,
      })
      return false
    }
    return true
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // OT POLICIES CRUD
  // ══════════════════════════════════════════════════════════════════════════════

  const policyBody = z.object({
    name:                       z.string().min(1).max(80),
    description:                z.string().max(500).optional(),
    calculation_mode:           z.enum(['threshold', 'shift_end', 'fixed_rate']).default('threshold'),
    ot_start_after_minutes:     z.number().int().min(0).max(240).default(0),
    max_ot_minutes_per_day:     z.number().int().positive().max(720).nullable().optional(),
    max_ot_minutes_per_week:    z.number().int().positive().max(3600).nullable().optional(),
    max_ot_minutes_per_month:   z.number().int().positive().max(14400).nullable().optional(),
    requires_approval:          z.boolean().default(true),
    auto_approve_below_min:     z.number().int().positive().nullable().optional(),
    rate_type:                  z.enum(['flat', 'multiplier']).default('multiplier'),
    extra_rate:                 z.number().positive().default(1.5),
    weekend_rate:               z.number().positive().nullable().optional(),
    holiday_rate:               z.number().positive().nullable().optional(),
    rounding_minutes:           z.number().int().min(0).max(60).default(0),
    is_active:                  z.boolean().default(true),
  })

  // GET /overtime/policies
  fastify.get('/overtime/policies', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { data, error } = await fastify.supabase
      .from('overtime_policies')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch OT policies' })
    return reply.send({ data: data ?? [] })
  })

  // POST /overtime/policies
  fastify.post('/overtime/policies', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const parsed = policyBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { data, error } = await fastify.supabase
      .from('overtime_policies')
      .insert({ tenant_id: req.tenantId, ...parsed.data })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE', message: `Policy "${parsed.data.name}" already exists` })
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create OT policy' })
    }
    return reply.code(201).send({ data })
  })

  // PUT /overtime/policies/:id
  fastify.put('/overtime/policies/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const parsed = policyBody.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { data, error } = await fastify.supabase
      .from('overtime_policies')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()
    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'OT policy not found' })
    return reply.send({ data })
  })

  // DELETE /overtime/policies/:id
  fastify.delete('/overtime/policies/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    // Check if it's the default
    const { data: pol } = await fastify.supabase
      .from('overtime_policies')
      .select('is_default')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!pol) return reply.code(404).send({ error: 'NOT_FOUND', message: 'OT policy not found' })
    if (pol.is_default) return reply.code(409).send({ error: 'CONFLICT', message: 'Cannot delete the default policy — set another as default first' })
    const { error } = await fastify.supabase
      .from('overtime_policies')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to delete OT policy' })
    return reply.code(204).send()
  })

  // POST /overtime/policies/:id/set-default
  fastify.post('/overtime/policies/:id/set-default', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    // Clear existing default
    await fastify.supabase
      .from('overtime_policies')
      .update({ is_default: false })
      .eq('tenant_id', req.tenantId)
      .eq('is_default', true)
    // Set new default
    const { data, error } = await fastify.supabase
      .from('overtime_policies')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, is_default')
      .single()
    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'OT policy not found' })
    return reply.send({ data })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // EMPLOYEE ASSIGNMENTS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /overtime/assignments
  fastify.get('/overtime/assignments', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { data, error } = await fastify.supabase
      .from('employee_overtime_policies')
      .select(`
        id, effective_from, created_at,
        employees!inner(id, first_name, last_name, employee_code),
        overtime_policies(id, name)
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch assignments' })
    return reply.send({ data: data ?? [] })
  })

  // POST /overtime/assignments
  fastify.post('/overtime/assignments', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const schema = z.object({
      employee_id:    z.string().uuid(),
      ot_policy_id:   z.string().uuid(),
      effective_from: z.string().regex(dateRe).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { data, error } = await fastify.supabase
      .from('employee_overtime_policies')
      .upsert(
        { tenant_id: req.tenantId, ...parsed.data },
        { onConflict: 'tenant_id,employee_id' },
      )
      .select('id, employee_id, ot_policy_id, effective_from')
      .single()
    if (error) return reply.code(500).send({ error: 'UPSERT_FAILED', message: 'Failed to assign policy' })
    return reply.code(201).send({ data })
  })

  // DELETE /overtime/assignments/:id
  fastify.delete('/overtime/assignments/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('employee_overtime_policies')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: 'Failed to remove assignment' })
    return reply.code(204).send()
  })

  // GET /overtime/summary — per-employee OT totals for a month (YYYY-MM)
  fastify.get('/overtime/summary', auth, async (req: any, reply) => {
    const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'month must be YYYY-MM' })
    }
    const { month } = parsed.data

    const { data: daily, error } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, overtime_minutes, ot_approved_minutes')
      .eq('tenant_id', req.tenantId)
      .gte('date', `${month}-01`)
      .lte('date', `${month}-31`)
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const agg = new Map<string, { ot: number; approved: number }>()
    for (const r of (daily ?? []) as any[]) {
      const cur = agg.get(r.employee_id) ?? { ot: 0, approved: 0 }
      cur.ot       += r.overtime_minutes ?? 0
      cur.approved += r.ot_approved_minutes ?? 0
      agg.set(r.employee_id, cur)
    }
    const empIds = [...agg.entries()].filter(([, v]) => v.ot > 0 || v.approved > 0).map(([id]) => id)
    if (empIds.length === 0) return reply.send({ data: [] })

    const { data: emps } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', req.tenantId)
      .in('id', empIds)
    const empMap = new Map((emps ?? []).map((e: any) => [e.id, e]))

    const rows = empIds.map((id) => {
      const a = agg.get(id)!
      const e: any = empMap.get(id)
      const status = a.approved >= a.ot ? 'approved' : a.approved > 0 ? 'partial' : 'pending'
      return {
        employee_id:      id,
        employee_name:    e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() : '—',
        employee_code:    e?.employee_code ?? '',
        ot_minutes:       a.ot,
        approved_minutes: a.approved,
        status,
      }
    }).sort((x, y) => y.ot_minutes - x.ot_minutes)

    return reply.send({ data: rows })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // OT REQUESTS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /overtime/requests
  fastify.get('/overtime/requests', auth, async (req: any, reply) => {
    const querySchema = z.object({
      status:      z.enum(['PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED']).optional(),
      employee_id: z.string().uuid().optional(),
      from_date:   z.string().regex(dateRe).optional(),
      to_date:     z.string().regex(dateRe).optional(),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('overtime_requests')
      .select(`
        id, attendance_date, raw_ot_minutes, approved_minutes, status,
        rate_type, extra_rate, is_weekend_day, is_holiday_day,
        requested_by, approved_by, approved_at, rejection_reason,
        created_at,
        employees!inner(id, first_name, last_name, employee_code),
        overtime_policies(id, name)
      `)
      .eq('tenant_id', req.tenantId)
      .order('attendance_date', { ascending: false })

    if (isHrAdmin(req.userRole)) {
      // HR admin sees everything; optional employee filter
      if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    } else if (req.userRole === 'manager') {
      // P6.0b — managers are scoped to their direct reports
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId) return reply.send({ data: [] })
      const reportIds = await getDirectReportIds(fastify.supabase, req.tenantId, myEmpId)
      if (!reportIds.length) return reply.send({ data: [] })
      if (parsed.data.employee_id && !reportIds.includes(parsed.data.employee_id)) {
        return reply.send({ data: [] })
      }
      q = q.in('employee_id', parsed.data.employee_id ? [parsed.data.employee_id] : reportIds)
    } else {
      // Employees see only their own requests
      const empId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!empId) return reply.send({ data: [] })
      q = q.eq('employee_id', empId)
    }

    if (parsed.data.status)    q = q.eq('status', parsed.data.status)
    if (parsed.data.from_date) q = q.gte('attendance_date', parsed.data.from_date)
    if (parsed.data.to_date)   q = q.lte('attendance_date', parsed.data.to_date)
    q = q.range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch OT requests' })
    return reply.send({ data: data ?? [] })
  })

  // GET /overtime/requests/:id
  fastify.get('/overtime/requests/:id', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { data, error } = await fastify.supabase
      .from('overtime_requests')
      .select(`
        id, attendance_date, raw_ot_minutes, approved_minutes, status,
        rate_type, extra_rate, is_weekend_day, is_holiday_day, notes,
        requested_by, approved_by, approved_at, rejection_reason, created_at,
        employees!inner(id, first_name, last_name, employee_code),
        overtime_policies(id, name, extra_rate, rate_type)
      `)
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (error || !data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'OT request not found' })
    return reply.send({ data })
  })

  // POST /overtime/requests — manually create (admin can generate for any employee)
  fastify.post('/overtime/requests', auth, async (req: any, reply) => {
    // Raising an OT request (for any employee_id) is a manager/admin action,
    // matching the approve/reject siblings below. Prevents an employee seeding
    // pay claims for themselves or colleagues.
    if (!requireManagerOrAdmin(req, reply)) return
    const schema = z.object({
      employee_id:     z.string().uuid(),
      attendance_date: z.string().regex(dateRe),
      notes:           z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Fetch actual overtime_minutes from attendance_daily
    const { data: daily } = await fastify.supabase
      .from('attendance_daily')
      .select('overtime_minutes, status')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', parsed.data.employee_id)
      .eq('date', parsed.data.attendance_date)
      .maybeSingle()

    if (!daily) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No attendance record for this date' })
    }
    const rawOt = daily.overtime_minutes ?? 0
    if (rawOt <= 0) {
      return reply.code(400).send({ error: 'NO_OT', message: 'No overtime minutes recorded for this date' })
    }

    const isWeekendDay = ['weekly_off', 'weekend'].includes(daily.status ?? '')
    const isHolidayDay = daily.status === 'holiday'

    const result = await createOtRequest(fastify.supabase, {
      tenantId:       req.tenantId,
      employeeId:     parsed.data.employee_id,
      attendanceDate: parsed.data.attendance_date,
      rawOtMinutes:   rawOt,
      requestedBy:    req.userId,
      isWeekendDay,
      isHolidayDay,
    })

    if (!result.ok) {
      return reply.code(400).send({ error: 'OT_ENGINE_ERROR', message: result.error })
    }

    return reply.code(201).send({ data: result.data })
  })

  // POST /overtime/requests/:id/approve
  fastify.post('/overtime/requests/:id/approve', auth, async (req: any, reply) => {
    if (!requireManagerOrAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!await authorizeOtTarget(req, reply, id)) return
    if (!await assertOtPeriodOpen(req, reply, id)) return
    const schema = z.object({
      approved_minutes: z.number().int().min(0).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await approveOtRequest(
      fastify.supabase,
      req.tenantId,
      id,
      req.userId,
      parsed.data.approved_minutes,
    )

    if (!result.ok) {
      return reply.code(400).send({ error: 'APPROVAL_FAILED', message: result.error })
    }

    // Audit (F5) — OT approvals affect pay and were previously unlogged.
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'overtime_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'approved', approved_minutes: parsed.data.approved_minutes ?? null },
    })

    return reply.send({ data: result.data })
  })

  // POST /overtime/requests/:id/reject
  fastify.post('/overtime/requests/:id/reject', auth, async (req: any, reply) => {
    if (!requireManagerOrAdmin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!await authorizeOtTarget(req, reply, id)) return
    if (!await assertOtPeriodOpen(req, reply, id)) return
    const schema = z.object({
      rejection_reason: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const result = await rejectOtRequest(
      fastify.supabase,
      req.tenantId,
      id,
      req.userId,
      parsed.data.rejection_reason,
    )

    if (!result.ok) {
      return reply.code(400).send({ error: 'REJECTION_FAILED', message: result.error })
    }

    // Audit (F5).
    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'overtime_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { status: 'rejected', rejection_reason: parsed.data.rejection_reason ?? null },
    })

    return reply.send({ data: result.data })
  })

  // ── Utility: resolve policy for an employee (for UI preview) ─────────────────
  // GET /overtime/resolve-policy?employee_id=UUID
  fastify.get('/overtime/resolve-policy', auth, async (req: any, reply) => {
    const schema = z.object({ employee_id: z.string().uuid() })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const policy = await resolveOtPolicy(fastify.supabase, req.tenantId, parsed.data.employee_id)
    return reply.send({ data: policy })
  })
}
