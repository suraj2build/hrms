import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { optStr } from '../../lib/zod-form.js'

const schema = z.object({
  name:            z.string().min(1, 'Name is required'),
  relationship:    optStr,
  phone:           z.string().min(1, 'Phone is required'),
  alternate_phone: optStr,
  email:           z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().email().optional()),
  address:         optStr,
  is_primary:      z.boolean().optional().default(false),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function emergencyContactsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/emergency-contacts', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('is_primary', { ascending: false })
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/employees/:id/emergency-contacts', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    // If new contact is primary, demote existing primary
    if (parsed.data.is_primary) {
      await fastify.supabase
        .from('emergency_contacts')
        .update({ is_primary: false })
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
    }
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/emergency-contacts/:contactId', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_primary) {
      await fastify.supabase
        .from('emergency_contacts')
        .update({ is_primary: false })
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .neq('id', req.params.contactId)
    }
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .update(parsed.data)
      .eq('id', req.params.contactId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select().single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Contact not found' })
    return reply.send(data)
  })

  fastify.delete('/employees/:id/emergency-contacts/:contactId', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', req.params.contactId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
