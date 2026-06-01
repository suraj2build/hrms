import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'

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
      .from('employee_separation_clearances')
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
      .from('employee_separation_clearances')
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
      .from('employee_separation_clearances')
      .insert(rows)
      .select()

    if (error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_separation_clearances',
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

    const parsed = clearanceStatusSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    const { data: updated, error } = await fastify.supabase
      .from('employee_separation_clearances')
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
      .from('employee_separation_clearances')
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
      tableName:   'employee_separation_clearances',
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
      .from('employee_separation_ff')
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

    const net_payable =
      (parsed.data.last_payroll_amount ?? 0) +
      (parsed.data.leave_encashment_amount ?? 0) +
      (parsed.data.gratuity_amount ?? 0) +
      (parsed.data.other_additions ?? 0) -
      (parsed.data.notice_period_deduction ?? 0) -
      (parsed.data.other_deductions ?? 0)

    // Upsert: create or replace existing F&F
    const { data: existing } = await fastify.supabase
      .from('employee_separation_ff')
      .select('id')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    let result: any
    let statusCode = 201

    if (existing) {
      const { data, error } = await fastify.supabase
        .from('employee_separation_ff')
        .update({
          ...parsed.data,
          net_payable,
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
        .from('employee_separation_ff')
        .insert({
          ...parsed.data,
          net_payable,
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
      tableName:   'employee_separation_ff',
      recordId:    result.id,
      action:      existing ? 'UPDATE' : 'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { ...parsed.data, net_payable } as Record<string, unknown>,
    })

    return reply.code(statusCode).send({ data: result })
  })

  // ── PATCH /employees/:id/separation-ff/approve ────────────────────────────

  fastify.patch('/employees/:id/separation-ff/approve', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data: ff, error: fetchErr } = await fastify.supabase
      .from('employee_separation_ff')
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
      .from('employee_separation_ff')
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
      tableName:   'employee_separation_ff',
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
      .from('employee_separation_ff')
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
      .from('employee_separation_ff')
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
      tableName:   'employee_separation_ff',
      recordId:    ff.id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { status: 'paid' },
    })

    return reply.send({ data })
  })
}
