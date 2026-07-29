import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr, optDate } from '../../lib/zod-form.js'
import { serverError, notFound, conflictError, validationError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  card_number:   z.string().min(1, 'Card number is required'),
  issued_date:   optDate,
  returned_date: optDate,
  status:        z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['active','returned','lost','deactivated']).optional().default('active')),
  notes:         optStr,
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function accessCardsRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/access-cards', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('issued_date', { ascending: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch access cards')
    return reply.send({ data })
  })

  fastify.post('/employees/:id/access-cards', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) {
      if (error.code === '23505')
        return conflictError(reply, 'DUPLICATE', 'Card number already in use')
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create access card')
    }
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/access-cards/:cardId', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0].message)
    const { data, error } = await fastify.supabase
      .from('employee_access_cards')
      .update(parsed.data)
      .eq('id', req.params.cardId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().maybeSingle()
    if (error) {
      if (error.code === '23505')
        return conflictError(reply, 'DUPLICATE', 'Card number already in use')
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update access card')
    }
    if (!data) return notFound(reply, 'NOT_FOUND', 'Access card not found')
    return reply.send(data)
  })
}
