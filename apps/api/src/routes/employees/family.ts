import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr, optDate, optEnum } from '../../lib/zod-form.js'
import { serverError, notFound, conflictError, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  relationship_type_id: z.string().uuid('Invalid relationship type'),
  name:                 z.string().min(1, 'Name is required'),
  dob:                  optDate,
  gender:               optEnum(['male','female','other']),
  is_dependent:         z.boolean().optional().default(false),
  is_nominee:           z.boolean().optional().default(false),
  occupation:           optStr,
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

// relationship_types is tenant-scoped (RLS-protected under a real client,
// but this route runs under the service-role client) — the FK on
// employee_family.relationship_type_id only checks existence, not tenant,
// so this must be verified explicitly before insert/update.
async function verifyRelationshipType(fastify: any, id: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('relationship_types').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

export default async function familyRoutes(fastify: FastifyInstance) {
  // Family data is HR-managed in the employee master and not consumed by ESS —
  // gate read + write to HR admin (previously GET allowed any authenticated user
  // to read another employee's family records).
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/family', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_family')
      .select('*, relationship_types(id, name, code)')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch family records')
    return reply.send({ data })
  })

  fastify.post('/employees/:id/family', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (!await verifyRelationshipType(fastify, parsed.data.relationship_type_id, req.tenantId))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid relationship type' })
    const { data, error } = await fastify.supabase
      .from('employee_family')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select('*, relationship_types(id, name)').single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create family record')
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/family/:memberId', hrAdminAuth, async (req: any, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.relationship_type_id && !await verifyRelationshipType(fastify, parsed.data.relationship_type_id, req.tenantId))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid relationship type' })
    const { expected_version, ...fields } = parsed.data
    // .maybeSingle() (not .single()) — a wrong/foreign memberId must fall
    // through to the 404 below, not surface as a PGRST116 500.
    let query = fastify.supabase
      .from('employee_family')
      .update(fields)
      .eq('id', req.params.memberId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    // PEND-105: optimistic-concurrency check — only applied when the caller
    // sends expected_version (see updateSchema comment above).
    if (expected_version !== undefined) query = query.eq('version', expected_version)
    const { data, error } = await query.select('*, relationship_types(id, name)').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update family record')
    if (!data) {
      // 0 rows matched — either the record doesn't exist, or it does but
      // `version` moved on since expected_version was read. Disambiguate
      // with a plain existence check so a genuinely-deleted record still
      // reports 404, not a confusing 409.
      if (expected_version !== undefined) {
        const { data: exists } = await fastify.supabase
          .from('employee_family')
          .select('id')
          .eq('id', req.params.memberId)
          .eq('employee_id', req.params.id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()
        if (exists) {
          return conflictError(reply, ErrorCode.VERSION_CONFLICT,
            'Family record was changed by someone else. Reload and try again.')
        }
      }
      return notFound(reply, 'NOT_FOUND', 'Family member not found')
    }
    return reply.send(data)
  })

  fastify.delete('/employees/:id/family/:memberId', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('employee_family')
      .delete()
      .eq('id', req.params.memberId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete family record')
    if (!data || data.length === 0) return notFound(reply, 'NOT_FOUND', 'Family member not found')
    return reply.code(204).send()
  })
}
