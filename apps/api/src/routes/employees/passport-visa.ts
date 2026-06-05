/**
 * Passport & Visa management for employees.
 *
 * GET    /employees/:id/passport-visa           — list all records
 * POST   /employees/:id/passport-visa           — create new record
 * PUT    /employees/:id/passport-visa/:pvId     — partial update
 * DELETE /employees/:id/passport-visa/:pvId     — hard delete
 *
 * Write operations require hr_admin or super_admin.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createSchema = z.object({
  record_type:    z.enum(['passport', 'visa']),
  doc_number:     z.string().min(1).max(100),
  country:        z.string().min(1).max(100),
  issue_date:     z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  expiry_date:    z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  place_of_issue: z.string().max(200).optional().nullable(),
  visa_type:      z.string().max(100).optional().nullable(),
  storage_path:   z.string().max(500).optional().nullable(),
  notes:          z.string().max(1000).optional().nullable(),
})

const updateSchema = createSchema.partial()

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

export default async function passportVisaRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // GET /employees/:id/passport-visa
  fastify.get('/employees/:id/passport-visa', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('employee_passport_visa')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('record_type', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /employees/:id/passport-visa
  fastify.post('/employees/:id/passport-visa', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('employee_passport_visa')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
      })
      .select('*')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // PUT /employees/:id/passport-visa/:pvId
  fastify.put('/employees/:id/passport-visa/:pvId', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('employee_passport_visa')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.pvId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('*')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Record not found' })
    return reply.send({ data })
  })

  // DELETE /employees/:id/passport-visa/:pvId
  fastify.delete('/employees/:id/passport-visa/:pvId', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { error } = await fastify.supabase
      .from('employee_passport_visa')
      .delete()
      .eq('id', req.params.pvId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })
}
