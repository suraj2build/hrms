/**
 * Compensation Master Routes
 * Salary components, structures, and employee compensation assignments.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  computeCompensation,
  DEFAULT_COMPENSATION_POLICY,
  type ComponentInput,
  type CompensationPolicy,
} from '../../lib/compensation-engine.js'
import {
  listComponents, createComponent, updateComponent, deleteComponent,
  listStructures, createStructure, updateStructure,
  listStructureComponents, addStructureComponent, removeStructureComponent,
  cloneStructure, seedStandardComponents,
} from '../../lib/salary-config-store.js'

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
    const querySchema = z.object({ is_active: z.enum(['true', 'false']).optional() })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const r = await listComponents(fastify.supabase, req.tenantId, {
      is_active: parsed.data.is_active === undefined ? undefined : parsed.data.is_active === 'true',
    })
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  // ── POST /payroll/compensation/components ─────────────────────────────────────
  fastify.post('/components', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await createComponent(fastify.supabase, req.tenantId, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send({ data: r.data })
  })

  // ── PUT /payroll/compensation/components/:id ──────────────────────────────────
  fastify.put('/components/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await updateComponent(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  // ── DELETE /payroll/compensation/components/:id ───────────────────────────────
  fastify.delete('/components/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await deleteComponent(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    if (r.status === 204) return reply.code(204).send()
    return reply.send(r.data)   // soft-delete → { message }
  })

  // ── POST /payroll/compensation/components/seed-standard ───────────────────────
  // Load the best-practice standard component library for this tenant.
  // Idempotent — existing codes are preserved.
  fastify.post('/components/seed-standard', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await seedStandardComponents(fastify.supabase, req.tenantId)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send({ data: r.data })
  })

  // ── GET /payroll/compensation/structures ──────────────────────────────────────
  fastify.get('/structures', hrAdminAuth, async (req: any, reply) => {
    const r = await listStructures(fastify.supabase, req.tenantId, 'count')
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  // ── POST /payroll/compensation/structures ─────────────────────────────────────
  fastify.post('/structures', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await createStructure(fastify.supabase, req.tenantId, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send({ data: r.data })
  })

  // ── PUT /payroll/compensation/structures/:id ──────────────────────────────────
  fastify.put('/structures/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await updateStructure(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  // ── POST /payroll/compensation/structures/:id/clone ───────────────────────────
  // Create a new salary group from an existing one, copying every component +
  // its per-structure rule. Body: { name, code }.
  fastify.post('/structures/:id/clone', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await cloneStructure(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send({ data: r.data })
  })

  // ── GET /payroll/compensation/structures/:id/components ───────────────────────
  fastify.get('/structures/:id/components', hrAdminAuth, async (req: any, reply) => {
    const r = await listStructureComponents(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  // ── POST /payroll/compensation/structures/:id/preview ────────────────────────
  // Dry-run CTC breakup for a structure at a sample annual CTC. Reuses the SAME
  // pure computeCompensation engine the assignment flow uses — read-only, persists
  // nothing. Powers the live preview / sum-to-CTC validator in the builder.
  fastify.post('/structures/:id/preview', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      ctc_annual: z.number().positive('CTC must be positive'),
      pf_enabled: z.boolean().optional(),
      pf_capped:  z.boolean().optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    // Structure components + the statutory flags the engine needs.
    const { data: rows, error } = await fastify.supabase
      .from('salary_structure_components')
      .select(`
        calculation_type, default_value, sequence,
        salary_components(id, name, code, component_type, is_basic, affects_pf, affects_nlc)
      `)
      .eq('salary_structure_id', id)
      .eq('tenant_id', req.tenantId)
      .order('sequence', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    if (!rows || rows.length === 0)
      return reply.code(400).send({ error: 'NO_COMPONENTS', message: 'Structure has no components to preview' })

    const components: ComponentInput[] = rows.map((r: any) => ({
      salary_component_id: r.salary_components?.id ?? '',
      name:                r.salary_components?.name ?? '',
      code:                r.salary_components?.code ?? '',
      component_type:      r.salary_components?.component_type ?? 'earning',
      calc_type:           r.calculation_type,
      value:               Number(r.default_value),
      sequence:            r.sequence ?? 0,
      is_basic:            !!r.salary_components?.is_basic,
      affects_pf:          !!r.salary_components?.affects_pf,
      affects_nlc:         !!r.salary_components?.affects_nlc,
    }))

    // Tenant statutory policy (same fallback as the engine helper).
    const { data: pol } = await fastify.supabase
      .from('compensation_policies')
      .select('nlc_enabled, pf_enabled, pf_employee_rate, pf_employer_rate, pf_cap_amount')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    const policy: CompensationPolicy = pol
      ? {
          nlc_enabled:      pol.nlc_enabled,
          pf_enabled:       pol.pf_enabled,
          pf_employee_rate: Number(pol.pf_employee_rate),
          pf_employer_rate: Number(pol.pf_employer_rate),
          pf_cap_amount:    Number(pol.pf_cap_amount),
        }
      : { ...DEFAULT_COMPENSATION_POLICY }

    try {
      const result = computeCompensation({
        ctcAnnual:  parsed.data.ctc_annual,
        components,
        employee:   {
          pf_enabled: parsed.data.pf_enabled ?? policy.pf_enabled,
          pf_capped:  parsed.data.pf_capped ?? true,
        },
        policy,
      })
      // The engine now reconciles to CTC inclusively (gross + employer
      // contributions). residual_annual / ctc_reconciled come straight from it.
      return reply.send({ data: { ...result, ctc_annual: parsed.data.ctc_annual } })
    } catch (e: any) {
      return reply.code(400).send({ error: e?.code ?? 'COMPUTE_ERROR', message: e?.message ?? 'Failed to compute preview' })
    }
  })

  // ── POST /payroll/compensation/structures/:id/components ──────────────────────
  fastify.post('/structures/:id/components', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const r = await addStructureComponent(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send({ data: r.data })
  })

  // ── DELETE /payroll/compensation/structures/:id/components/:compId ────────────
  fastify.delete('/structures/:id/components/:compId', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id, compId } = req.params as { id: string; compId: string }
    const r = await removeStructureComponent(fastify.supabase, req.tenantId, id, compId)
    if (r.error) return reply.code(r.status).send(r.error)
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
      })
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)
      .eq('is_active', true)
      // Exclude the newly inserted record so we don't immediately deactivate it
      .neq('id', (newComp as any).id)

    return reply.code(201).send({ data: newComp })
  })
}
