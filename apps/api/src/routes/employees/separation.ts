import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'

const schema = z.object({
  separation_type:      z.enum(['resignation','termination','retirement','end_of_contract','absconding','deceased','mutual_separation']),
  initiated_by:         z.enum(['employee','employer']),
  notice_date:          z.string().optional(),
  last_working_date:    z.string().optional(),
  exit_reason:          z.string().optional(),
  exit_interview_done:  z.boolean().optional().default(false),
  exit_interview_date:  z.string().optional(),
  clearance_done:       z.boolean().optional().default(false),
  remarks:              z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id, status').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return data
}

export default async function separationRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/separation', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // POST: initiate separation (also updates employee.status) — HR admin only
  fastify.post('/employees/:id/separation', hrAdminAuth, async (req: any, reply) => {
    const employee = await verifyEmployee(fastify, req.params.id, req.tenantId)
    if (!employee) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    if (employee.status === 'separated')
      return reply.code(409).send({ error: 'ALREADY_SEPARATED', message: 'Employee is already separated' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Insert separation record
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        created_by:  req.userId,
      })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Update employee status based on last_working_date
    const lwd = parsed.data.last_working_date
    const newStatus = lwd && new Date(lwd) <= new Date() ? 'separated' : 'on_notice'
    await fastify.supabase
      .from('employees')
      .update({ status: newStatus })
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_separation',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     { ...parsed.data, employee_status: newStatus },
    })

    return reply.code(201).send(data)
  })

  // PUT: update separation details (e.g. clearance, exit interview) — HR admin only
  fastify.put('/employees/:id/separation', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_separation')
      .update(parsed.data)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Separation record not found' })

    // If last_working_date updated and now in past, mark as separated
    if (parsed.data.last_working_date && new Date(parsed.data.last_working_date) <= new Date()) {
      await fastify.supabase
        .from('employees')
        .update({ status: 'separated' })
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'employee_separation',
      recordId:    (data as any).id,
      action:      'UPDATE',
      performedBy: req.userId,
      onBehalfOf:  req.params.id,
      newData:     parsed.data as Record<string, unknown>,
    })

    return reply.send(data)
  })
}
