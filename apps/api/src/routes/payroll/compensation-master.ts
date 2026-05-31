/**
 * Compensation Master Routes
 * Salary components, structures, and employee compensation assignments.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

export default async function compensationMasterRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/compensation/components ──────────────────────────────────────
  fastify.get('/components', hrAdminAuth, async (req: any, reply) => {
    const querySchema = z.object({
      is_active: z.enum(['true', 'false']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('salary_components')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('display_order', { ascending: true })

    if (parsed.data.is_active !== undefined) {
      q = q.eq('is_active', parsed.data.is_active === 'true')
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/compensation/components ─────────────────────────────────────
  fastify.post('/components', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(50),
      component_type: z.enum(['earning', 'deduction', 'employer_contribution']),
      is_taxable: z.boolean(),
      is_pf_applicable: z.boolean(),
      is_esi_applicable: z.boolean(),
      is_pt_applicable: z.boolean(),
      is_lwf_applicable: z.boolean(),
      display_order: z.number().int().optional(),
      is_variable: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('salary_components')
      .insert({ ...parsed.data, tenant_id: req.tenantId, is_active: true })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_CODE', message: 'A component with this code already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/compensation/components/:id ──────────────────────────────────
  fastify.put('/components/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      code: z.string().min(1).max(50).optional(),
      component_type: z.enum(['earning', 'deduction', 'employer_contribution']).optional(),
      is_taxable: z.boolean().optional(),
      is_pf_applicable: z.boolean().optional(),
      is_esi_applicable: z.boolean().optional(),
      is_pt_applicable: z.boolean().optional(),
      is_lwf_applicable: z.boolean().optional(),
      display_order: z.number().int().optional(),
      is_variable: z.boolean().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('salary_components')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Component not found' })

    return reply.send({ data })
  })

  // ── DELETE /payroll/compensation/components/:id ───────────────────────────────
  fastify.delete('/components/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Check if referenced in salary_structure_components
    const { count } = await fastify.supabase
      .from('salary_structure_components')
      .select('id', { count: 'exact', head: true })
      .eq('salary_component_id', id)
      .eq('tenant_id', req.tenantId)

    if ((count ?? 0) > 0) {
      // Soft delete
      const { error } = await fastify.supabase
        .from('salary_components')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', req.tenantId)

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
      return reply.send({ message: 'Component deactivated (referenced in salary structures)' })
    } else {
      // Hard delete
      const { error } = await fastify.supabase
        .from('salary_components')
        .delete()
        .eq('id', id)
        .eq('tenant_id', req.tenantId)

      if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
      return reply.code(204).send()
    }
  })

  // ── GET /payroll/compensation/structures ──────────────────────────────────────
  fastify.get('/structures', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .select('*, salary_structure_components(count)')
      .eq('tenant_id', req.tenantId)
      .order('name', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/compensation/structures ─────────────────────────────────────
  fastify.post('/structures', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1).max(50),
      description: z.string().optional(),
      is_active: z.boolean().default(true),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_CODE', message: 'A structure with this code already exists' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/compensation/structures/:id ──────────────────────────────────
  fastify.put('/structures/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      code: z.string().min(1).max(50).optional(),
      description: z.string().optional(),
      is_active: z.boolean().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('salary_structures')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Structure not found' })

    return reply.send({ data })
  })

  // ── GET /payroll/compensation/structures/:id/components ───────────────────────
  fastify.get('/structures/:id/components', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('salary_structure_components')
      .select('*, salary_components(id, name, code, component_type)')
      .eq('salary_structure_id', id)
      .eq('tenant_id', req.tenantId)
      .order('sequence', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/compensation/structures/:id/components ──────────────────────
  fastify.post('/structures/:id/components', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      salary_component_id: z.string().uuid(),
      calculation_type: z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']),
      default_value: z.number(),
      sequence: z.number().int().default(0),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('salary_structure_components')
      .insert({
        ...parsed.data,
        salary_structure_id: id,
        tenant_id: req.tenantId,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_COMPONENT', message: 'Component already exists in this structure' })
      }
      return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── DELETE /payroll/compensation/structures/:id/components/:compId ────────────
  fastify.delete('/structures/:id/components/:compId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id, compId } = req.params as { id: string; compId: string }

    const { error } = await fastify.supabase
      .from('salary_structure_components')
      .delete()
      .eq('id', compId)
      .eq('salary_structure_id', id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })

  // ── GET /payroll/compensation/employee/:employeeId ────────────────────────────
  // HR admins see any employee; regular employees see only their own compensation.
  fastify.get('/employee/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const isHrAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)
    if (!isHrAdmin) {
      const { data: callerProfile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()
      if (!callerProfile?.employee_id || callerProfile.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own compensation' })
      }
    }

    const { data, error } = await fastify.supabase
      .from('employee_compensations')
      .select(`
        *,
        salary_structures(id, name, code),
        employee_compensation_components(*, salary_components(id, name, code, component_type))
      `)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/compensation/employee/:employeeId ───────────────────────────
  fastify.post('/employee/:employeeId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const componentSchema = z.object({
      salary_component_id: z.string().uuid(),
      calculation_type: z.string(),
      value: z.number(),
      computed_monthly: z.number(),
      computed_annual: z.number(),
      sequence: z.number().int(),
    })

    const schema = z.object({
      salary_structure_id: z.string().uuid(),
      effective_from: z.string(),
      ctc_annual: z.number().positive(),
      notes: z.string().optional(),
      approved_by: z.string().uuid().optional(),
      components: z.array(componentSchema),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { components, ...compensationData } = parsed.data

    // ── Safe activation order ──────────────────────────────────────────────────
    // IMPORTANT: Insert the new compensation FIRST, then deactivate the old one.
    // Reversing this order (deactivate-then-insert) leaves the employee with zero
    // active compensation if the insert fails, which would cause phantom LOP on
    // the next payroll run.

    // Step 1: Insert new compensation (employee has two active records briefly)
    const { data: newComp, error: compError } = await fastify.supabase
      .from('employee_compensations')
      .insert({
        ...compensationData,
        employee_id: employeeId,
        tenant_id: req.tenantId,
        is_active: true,
        created_by: req.userId,
      })
      .select()
      .single()

    if (compError || !newComp) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: compError?.message ?? 'Failed to insert compensation' })
    }

    // Step 2: Insert components (while new comp exists but old is still active)
    if (components.length > 0) {
      const componentRows = components.map(c => ({
        ...c,
        // Must match the column name used in payroll-engine.ts and employees/compensation.ts
        compensation_id: (newComp as any).id,
        employee_id: employeeId,
        tenant_id: req.tenantId,
      }))

      const { error: cmpErr } = await fastify.supabase
        .from('employee_compensation_components')
        .insert(componentRows)

      if (cmpErr) {
        // Roll back the new comp so we don't leave an orphaned active record.
        // If the rollback itself fails, log it — the employee ends up with an
        // incomplete compensation record that fetchActiveCompensation will pick
        // up as the "latest" with zero components → payroll will show warning.
        const { error: rollbackErr } = await fastify.supabase
          .from('employee_compensations')
          .delete()
          .eq('id', (newComp as any).id)

        if (rollbackErr) {
          req.log.error(
            { rollbackErr, newCompId: (newComp as any).id, employeeId },
            'compensation-master: component insert failed AND rollback failed — orphaned active comp record',
          )
        }
        return reply.code(500).send({ error: 'COMPONENT_INSERT_FAILED', message: cmpErr.message })
      }
    }

    // Step 3: Only now deactivate the previous compensation (new record is safely persisted)
    await fastify.supabase
      .from('employee_compensations')
      .update({
        is_active: false,
        effective_to: compensationData.effective_from,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      // Exclude the newly inserted record so we don't immediately deactivate it
      .neq('id', (newComp as any).id)

    return reply.code(201).send({ data: newComp })
  })
}
