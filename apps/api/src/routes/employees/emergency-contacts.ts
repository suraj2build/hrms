import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { optStr } from '../../lib/zod-form.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  name:            z.string().min(1, 'Name is required'),
  relationship:    optStr,
  phone:           z.string().min(1, 'Phone is required'),
  alternate_phone: optStr,
  email:           z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().email().optional()),
  address:         optStr,
  is_primary:      z.boolean().optional().default(false),
})

// expected_version is optional so this stays backward-compatible with a
// frontend that hasn't been updated to send it yet (PEND-105 Phase C) — the
// CAS check below only runs when a caller actually provides it.
const updateSchema = schema.partial().extend({
  expected_version: z.number().int().positive().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

export default async function emergencyContactsRoutes(fastify: FastifyInstance) {
  // This is the HR/admin management surface for another employee's
  // emergency contacts — self-service access is a separate, correctly
  // self-scoped route (/ess/me/emergency-contacts in ess/self-service.ts).
  // Previously gated to any authenticated user, letting any employee
  // read/create/overwrite/delete a colleague's emergency contacts.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/emergency-contacts', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('is_primary', { ascending: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch emergency contacts')
    return reply.send({ data })
  })

  fastify.post('/employees/:id/emergency-contacts', hrAdminAuth, async (req: any, reply) => {
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
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create emergency contact')
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/emergency-contacts/:contactId', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { expected_version, ...fields } = parsed.data
    if (fields.is_primary) {
      await fastify.supabase
        .from('emergency_contacts')
        .update({ is_primary: false })
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .neq('id', req.params.contactId)
    }
    let query = fastify.supabase
      .from('emergency_contacts')
      .update(fields)
      .eq('id', req.params.contactId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query.select().maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update emergency contact')
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('emergency_contacts')
          .select('id')
          .eq('id', req.params.contactId)
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'Emergency contact was changed by someone else. Reload and try again.')
        }
      }
      return notFound(reply, 'NOT_FOUND', 'Contact not found')
    }
    return reply.send(data)
  })

  fastify.delete('/employees/:id/emergency-contacts/:contactId', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', req.params.contactId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete emergency contact')
    if (!data || data.length === 0) return notFound(reply, 'NOT_FOUND', 'Contact not found')
    return reply.code(204).send()
  })
}
