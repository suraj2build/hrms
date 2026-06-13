import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { eventBus } from '../../lib/event-bus.js'
import { computeFnfSettlement } from '../../lib/fnf-settlement-engine.js'
import { isHrAdmin, resolveCallerEmployeeId, isDirectReport } from '../../lib/manager-scope.js'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const clearanceStatusSchema = z.object({
  status:  z.enum(['cleared', 'rejected']),
  remarks: z.string().optional(),
})

const ffBodySchema = z.object({
  last_payroll_amount:      z.number(),
  leave_encashment_amount:  z.number(),
  gratuity_amount:          z.number(),
  notice_period_deduction:  z.number(),
  other_deductions:         z.number().optional().default(0),
  other_additions:          z.number().optional().default(0),
  notes:                    z.string().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CLEARANCE_DEPARTMENTS = ['it', 'finance', 'manager', 'admin', 'hr'] as const

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id, status')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

async function getSeparationRecord(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employee_separation')
    .select('id, clearance_done')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

// Full separation row — for lifecycle transitions.
async function getSeparation(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employee_separation')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data
}

// Gated forward sequence for the lifecycle pointer.
const STAGE_SEQUENCE = ['notice_period', 'clearance', 'fnf', 'relieving'] as const

const approveSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  remarks:  z.string().optional(),
})

const advanceSchema = z.object({
  to: z.enum(['notice_period', 'clearance', 'fnf', 'relieving']).optional(),
})

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export default async function separationWorkflowRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }

  // ── GET /separations — list all separations with clearances + F&F for tenant ──
  fastify.get('/separations', auth, async (req: any, reply) => {
    const { data: seps, error } = await fastify.supabase
      .from('employee_separation')
      .select(`
        id, separation_type, initiated_by, notice_date,
        last_working_date, exit_reason, clearance_done,
        exit_interview_done, remarks, created_at,
        lifecycle_stage, approval_status, relieved_at, archived_at,
        employees!inner (
          id, first_name, last_name, employee_code,
          departments ( name )
        )
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Attach clearances + F&F for each separation
    const result = await Promise.all((seps ?? []).map(async (sep: any) => {
      const { data: clearances } = await fastify.supabase
        .from('separation_clearances')
        .select('id, department, status, cleared_by, cleared_at, remarks')
        .eq('separation_id', sep.id)
        .eq('tenant_id', req.tenantId)
        .order('created_at')

      const { data: ff } = await fastify.supabase
        .from('separation_ff_summary')
        .select('*')
        .eq('separation_id', sep.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      return {
        id:               sep.id,
        employee_id:      sep.employees?.id,
        employee_name:    `${sep.employees?.first_name} ${sep.employees?.last_name}`,
        employee_code:    sep.employees?.employee_code,
        department:       sep.employees?.departments?.name ?? null,
        separation_type:  sep.separation_type,
        last_working_date: sep.last_working_date,
        clearance_done:   sep.clearance_done,
        status:           sep.clearance_done ? 'completed' : 'in_progress',
        lifecycle_stage:  sep.lifecycle_stage ?? 'initiated',
        approval_status:  sep.approval_status ?? 'pending',
        relieved_at:      sep.relieved_at ?? null,
        archived_at:      sep.archived_at ?? null,
        clearances:       clearances ?? [],
        fnf:              ff ?? null,
      }
    }))

    return reply.send({ data: result })
  })
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /employees/:id/separation-clearances ──────────────────────────────

  fastify.get('/employees/:id/separation-clearances', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('separation_clearances')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('department', { ascending: true })

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: data ?? [] })
  })

  // ── POST /employees/:id/separation-clearances ─────────────────────────────

  fastify.post('/employees/:id/separation-clearances', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    // Check if clearances already exist
    const { data: existing } = await fastify.supabase
      .from('separation_clearances')
      .select('id')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .limit(1)

    if (existing && existing.length > 0)
      return reply.code(409).send({ error: 'ALREADY_INITIALIZED', message: 'Clearances already initialized for this employee.' })

    const rows = CLEARANCE_DEPARTMENTS.map(dept => ({
      employee_id:    req.params.id,
      tenant_id:      req.tenantId,
      separation_id:  separation.id,
      department:     dept,
      status:         'pending',
      created_by:     req.userId,
    }))

    const { data, error } = await fastify.supabase
      .from('separation_clearances')
      .insert(rows)
      .select()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_clearances',
      recordId:    separation.id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { departments: CLEARANCE_DEPARTMENTS },
    })

    return reply.code(201).send({ data })
  })

  // ── PATCH /employees/:id/separation-clearances/:clearanceId ──────────────

  fastify.patch('/employees/:id/separation-clearances/:clearanceId', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    // P6.0d — ownership guard. HR admins may action any department's clearance.
    // A manager may only action the 'manager' clearance of a direct report; every
    // other caller is rejected. This both opens the manager clearance action and
    // closes the prior gap where ownership was never validated.
    if (!isHrAdmin(req.userRole)) {
      if (req.userRole !== 'manager') {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Manager or HR admin access required' })
      }
      const { data: clearance } = await fastify.supabase
        .from('separation_clearances')
        .select('department')
        .eq('id', req.params.clearanceId)
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      if (!clearance)
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Clearance record not found' })
      if ((clearance as any).department !== 'manager')
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Managers may only action the manager clearance' })
      const myEmpId = await resolveCallerEmployeeId(fastify.supabase, req.userId, req.tenantId)
      if (!myEmpId || !(await isDirectReport(fastify.supabase, req.tenantId, myEmpId, req.params.id)))
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'This employee is not one of your direct reports' })
    }

    const parsed = clearanceStatusSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // ── Asset Management integration ────────────────────────────────────────
    // The IT clearance cannot be marked 'cleared' while the employee still holds
    // assigned company assets. Other departments are unaffected.
    if (parsed.data.status === 'cleared') {
      const { data: clearanceRow } = await fastify.supabase
        .from('separation_clearances')
        .select('department')
        .eq('id', req.params.clearanceId)
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (clearanceRow?.department === 'it') {
        const { count } = await fastify.supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', req.tenantId)
          .eq('assigned_to', req.params.id)
          .eq('status', 'assigned')

        const outstanding = count ?? 0
        if (outstanding > 0) {
          return reply.code(409).send({
            error:   'ASSETS_OUTSTANDING',
            message: `Employee has ${outstanding} asset(s) not yet returned. Recover assets before IT clearance.`,
            count:   outstanding,
          })
        }
      }
    }

    const { data: updated, error } = await fastify.supabase
      .from('separation_clearances')
      .update({
        status:       parsed.data.status,
        remarks:      parsed.data.remarks ?? null,
        updated_by:   req.userId,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', req.params.clearanceId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!updated)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Clearance record not found' })

    // Check if all 5 clearances are now 'cleared'
    const { data: allClearances, error: fetchErr } = await fastify.supabase
      .from('separation_clearances')
      .select('status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (!fetchErr && allClearances) {
      const allCleared =
        allClearances.length === CLEARANCE_DEPARTMENTS.length &&
        allClearances.every((c: any) => c.status === 'cleared')

      if (allCleared) {
        await fastify.supabase
          .from('employee_separation')
          .update({ clearance_done: true })
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
      }
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_clearances',
      recordId:    req.params.clearanceId,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send({ data: updated })
  })

  // ── GET /employees/:id/separation-ff ─────────────────────────────────────

  fastify.get('/employees/:id/separation-ff', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: data ?? null })
  })

  // ── POST /employees/:id/separation-ff ────────────────────────────────────

  fastify.post('/employees/:id/separation-ff', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    const parsed = ffBodySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // net_payable is a GENERATED column — never written by the app.
    const { data: existing } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    let result: any
    let statusCode = 201

    if (existing) {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .update({
          ...parsed.data,
          updated_by: req.userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('tenant_id', req.tenantId)
        .select()
        .single()
      if (error)
        return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      result = data
      statusCode = 200
    } else {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .insert({
          ...parsed.data,
          employee_id:   req.params.id,
          tenant_id:     req.tenantId,
          separation_id: separation.id,
          status:        'draft',
          created_by:    req.userId,
        })
        .select()
        .single()
      if (error)
        return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      result = data
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    result.id,
      action:      existing ? 'UPDATE' : 'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.code(statusCode).send({ data: result })
  })

  // ── POST /employees/:id/separation-ff/compute ────────────────────────────
  // Auto-calculate the formula-driven settlement components (gratuity, leave
  // encashment, notice shortfall) and upsert them onto the F&F draft. HR can
  // still override any value via POST /separation-ff afterwards.
  fastify.post('/employees/:id/separation-ff/compute', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const separation = await getSeparationRecord(fastify, req.params.id, req.tenantId)
    if (!separation)
      return reply.code(409).send({ error: 'NO_SEPARATION', message: 'No separation record found. Initiate separation first.' })

    const breakdown = await computeFnfSettlement(fastify.supabase, req.tenantId, req.params.id)
    if ('error' in breakdown)
      return reply.code(409).send({ error: 'COMPUTE_FAILED', message: breakdown.error })

    // Preserve any manual last_payroll_amount / other +/- already entered.
    const { data: existing } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, last_payroll_amount, other_additions, other_deductions')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const payload = {
      last_payroll_amount:     existing?.last_payroll_amount ?? 0,
      leave_encashment_amount: breakdown.leave_encashment_amount,
      gratuity_amount:         breakdown.gratuity_amount,
      notice_period_deduction: breakdown.notice_period_deduction,
      other_additions:         existing?.other_additions ?? 0,
      other_deductions:        existing?.other_deductions ?? 0,
      // computed metadata
      gratuity_eligible:       breakdown.gratuity_eligible,
      gratuity_years:          breakdown.gratuity_years,
      leave_encashment_days:   breakdown.leave_encashment_days,
      leave_encashment_rate:   breakdown.leave_encashment_rate,
      notice_shortfall_days:   breakdown.notice_shortfall_days,
      salary_basis_basic:      breakdown.salary_basis_basic,
      salary_basis_gross:      breakdown.salary_basis_gross,
      computed_at:             new Date().toISOString(),
      computed_by:             req.userId,
      updated_by:              req.userId,
      updated_at:              new Date().toISOString(),
    }

    let result: any
    if (existing) {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .update(payload).eq('id', existing.id).eq('tenant_id', req.tenantId).select().single()
      if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      result = data
    } else {
      const { data, error } = await fastify.supabase
        .from('separation_ff_summary')
        .insert({ ...payload, employee_id: req.params.id, tenant_id: req.tenantId, separation_id: separation.id, status: 'draft', created_by: req.userId })
        .select().single()
      if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
      result = data
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'separation_ff_summary', recordId: result.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { computed: true, ...breakdown } as Record<string, unknown>,
    })

    return reply.send({ data: result, breakdown })
  })

  // ── PATCH /employees/:id/separation-ff/approve ────────────────────────────

  fastify.patch('/employees/:id/separation-ff/approve', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data: ff, error: fetchErr } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr)
      return reply.code(500).send({ error: 'DB_ERROR', message: fetchErr.message })
    if (!ff)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'F&F record not found' })
    if (ff.status === 'approved' || ff.status === 'paid')
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Cannot approve: current status is '${ff.status}'` })

    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .update({
        status:      'approved',
        approved_by: req.userId,
        approved_at: new Date().toISOString(),
        updated_by:  req.userId,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', ff.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    ff.id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { status: 'approved' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation-ff/mark-paid ─────────────────────────

  fastify.patch('/employees/:id/separation-ff/mark-paid', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data: ff, error: fetchErr } = await fastify.supabase
      .from('separation_ff_summary')
      .select('id, status')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (fetchErr)
      return reply.code(500).send({ error: 'DB_ERROR', message: fetchErr.message })
    if (!ff)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'F&F record not found' })
    if (ff.status !== 'approved')
      return reply.code(409).send({ error: 'INVALID_STATE', message: `Cannot mark as paid: F&F must be approved first (current: '${ff.status}')` })

    const { data, error } = await fastify.supabase
      .from('separation_ff_summary')
      .update({
        status:     'paid',
        paid_by:    req.userId,
        paid_at:    new Date().toISOString(),
        updated_by: req.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ff.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'separation_ff_summary',
      recordId:    ff.id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { status: 'paid' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/approve ───────────────────────────────

  fastify.patch('/employees/:id/separation/approve', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    const parsed = approveSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const now = new Date().toISOString()

    if (parsed.data.decision === 'rejected') {
      const { data, error } = await fastify.supabase
        .from('employee_separation')
        .update({ approval_status: 'rejected', remarks: parsed.data.remarks ?? sep.remarks ?? null, updated_at: now })
        .eq('id', sep.id)
        .eq('tenant_id', req.tenantId)
        .select()
        .single()
      if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

      await logAction(fastify.supabase, {
        tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
        action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
        newData: { approval_status: 'rejected' },
      })
      return reply.send({ data })
    }

    // approved
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({
        approval_status: 'approved',
        approved_by:     req.userId,
        approved_at:     now,
        lifecycle_stage: 'notice_period',
        updated_at:      now,
      })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await fastify.supabase
      .from('employees')
      .update({ status: 'on_notice' })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { approval_status: 'approved', lifecycle_stage: 'notice_period' },
    })

    eventBus.emit({
      type: 'separation.approved', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, approvedBy: req.userId },
    })
    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage: 'initiated', toStage: 'notice_period' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/advance ───────────────────────────────

  fastify.patch('/employees/:id/separation/advance', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    const parsed = advanceSchema.safeParse(req.body ?? {})
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const fromStage = sep.lifecycle_stage as string
    const idx = STAGE_SEQUENCE.indexOf(fromStage as any)
    if (idx === -1 || idx >= STAGE_SEQUENCE.length - 1)
      return reply.code(409).send({ error: 'INVALID_STAGE', message: `Cannot advance from stage '${fromStage}'` })

    const nextStage = STAGE_SEQUENCE[idx + 1]
    if (parsed.data.to && parsed.data.to !== nextStage)
      return reply.code(409).send({ error: 'INVALID_TARGET', message: `Next valid stage is '${nextStage}', not '${parsed.data.to}'` })

    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({ lifecycle_stage: nextStage, updated_at: new Date().toISOString() })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: nextStage },
    })

    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage, toStage: nextStage },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/relieve ───────────────────────────────

  fastify.patch('/employees/:id/separation/relieve', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    if (!sep.clearance_done)
      return reply.code(409).send({ error: 'CLEARANCE_PENDING', message: 'Cannot relieve: clearance is not complete' })

    const { data: ff } = await fastify.supabase
      .from('separation_ff_summary')
      .select('status')
      .eq('separation_id', sep.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!ff || ff.status !== 'paid')
      return reply.code(409).send({ error: 'FNF_NOT_PAID', message: 'Cannot relieve: F&F settlement must be marked as paid' })

    const fromStage = sep.lifecycle_stage as string
    const now = new Date().toISOString()
    const lastWorkingDate = sep.last_working_date ?? now.slice(0, 10)

    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({
        lifecycle_stage:   'relieved',
        relieved_at:       now,
        last_working_date: lastWorkingDate,
        updated_at:        now,
      })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await fastify.supabase
      .from('employees')
      .update({ status: 'separated' })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: 'relieved', relieved_at: now },
    })

    eventBus.emit({
      type: 'separation.relieved', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, lastWorkingDate },
    })
    eventBus.emit({
      type: 'separation.stage.changed', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id, fromStage, toStage: 'relieved' },
    })

    return reply.send({ data })
  })

  // ── PATCH /employees/:id/separation/archive ───────────────────────────────

  fastify.patch('/employees/:id/separation/archive', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee)
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const sep = await getSeparation(fastify, req.params.id, req.tenantId)
    if (!sep)
      return reply.code(404).send({ error: 'NO_SEPARATION', message: 'No separation record found' })

    if (sep.lifecycle_stage !== 'relieved')
      return reply.code(409).send({ error: 'NOT_RELIEVED', message: 'Cannot archive: employee must be relieved first' })

    const now = new Date().toISOString()

    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update({ lifecycle_stage: 'archived', archived_at: now, archived_by: req.userId, updated_at: now })
      .eq('id', sep.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'employee_separation', recordId: sep.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: req.params.id,
      newData: { lifecycle_stage: 'archived', archived_at: now },
    })

    eventBus.emit({
      type: 'separation.archived', tenantId: req.tenantId, correlationId: req.correlationId,
      payload: { tenantId: req.tenantId, employeeId: req.params.id, separationId: sep.id },
    })

    return reply.send({ data })
  })

  // ── Gratuity configuration (per tenant) ───────────────────────────────────

  const GRATUITY_DEFAULTS = { enabled: true, rate_numerator: 15, rate_denominator: 26, min_years: 5, max_amount: 2000000, basis: 'basic' as const }

  // GET /settlement/gratuity-config — current config (defaults if unconfigured)
  fastify.get('/settlement/gratuity-config', hrAdminAuth, async (req: any, reply) => {
    const { data } = await fastify.supabase
      .from('gratuity_config')
      .select('enabled, rate_numerator, rate_denominator, min_years, max_amount, basis, updated_at')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return reply.send({ data: data ?? { ...GRATUITY_DEFAULTS, is_default: true } })
  })

  // PUT /settlement/gratuity-config — upsert config
  fastify.put('/settlement/gratuity-config', hrAdminAuth, async (req: any, reply) => {
    const schema = z.object({
      enabled:          z.boolean().default(true),
      rate_numerator:   z.number().int().min(1).max(60),
      rate_denominator: z.number().int().min(1).max(31),
      min_years:        z.number().min(0).max(20),
      max_amount:       z.number().min(0).max(100000000),
      basis:            z.enum(['basic', 'gross']),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data, error } = await fastify.supabase
      .from('gratuity_config')
      .upsert({ tenant_id: req.tenantId, ...parsed.data, updated_at: new Date().toISOString(), updated_by: req.userId }, { onConflict: 'tenant_id' })
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'gratuity_config', recordId: (data as any).id,
      action: 'UPDATE', performedBy: req.userId, newData: parsed.data as Record<string, unknown>,
    })

    return reply.send({ data })
  })
}
