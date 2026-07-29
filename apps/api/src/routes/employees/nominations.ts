import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { optStr, optDate, optUuid } from '../../lib/zod-form.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'

const schema = z.object({
  scheme:               z.enum(['pf','gratuity','esi','superannuation']),
  nominee_name:         z.string().min(1, 'Nominee name is required'),
  relationship_type_id: optUuid,
  dob:                  optDate,
  share_percentage:     z.number().positive().max(100, 'Cannot exceed 100%'),
  address:              optStr,
  is_minor:             z.boolean().optional().default(false),
  guardian_name:        optStr,
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
  return !!data
}

// relationship_types is tenant-scoped (RLS-protected under a real client,
// but this route runs under the service-role client) — the FK on
// employee_nominations.relationship_type_id only checks existence, not
// tenant, so this must be verified explicitly before insert/update.
async function verifyRelationshipType(fastify: any, id: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('relationship_types').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

async function validateShareTotal(
  fastify: any,
  employeeId: string,
  tenantId: string,
  scheme: string,
  newShare: number,
  excludeId?: string
) {
  let query = fastify.supabase
    .from('employee_nominations')
    .select('share_percentage')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .eq('scheme', scheme)
  if (excludeId) query = query.neq('id', excludeId)
  const { data } = await query
  const existingTotal = (data ?? []).reduce((sum: number, r: any) => sum + Number(r.share_percentage), 0)
  return existingTotal + newShare <= 100
}

export default async function nominationsRoutes(fastify: FastifyInstance) {
  // Nominations are legal beneficiary data managed by HR in the employee master
  // (not consumed by ESS). All CRUD requires HR admin to prevent any authenticated
  // user from reading/writing another employee's nominations.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/employees/:id/nominations', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .select('*, relationship_types(id, name)')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('scheme')
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch nominations')
    return reply.send({ data })
  })

  fastify.post('/employees/:id/nominations', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_minor && !parsed.data.guardian_name)
      return reply.code(400).send({ error: 'VALIDATION', message: 'Guardian name required for minor nominees' })
    if (parsed.data.relationship_type_id && !await verifyRelationshipType(fastify, parsed.data.relationship_type_id, req.tenantId))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid relationship type' })
    const valid = await validateShareTotal(fastify, req.params.id, req.tenantId, parsed.data.scheme, parsed.data.share_percentage)
    if (!valid)
      return reply.code(400).send({ error: 'VALIDATION', message: `Total share for ${parsed.data.scheme} would exceed 100%` })
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select('*, relationship_types(id, name)').single()
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create nomination')
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/nominations/:nomId', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.relationship_type_id && !await verifyRelationshipType(fastify, parsed.data.relationship_type_id, req.tenantId))
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid relationship type' })
    if (parsed.data.share_percentage) {
      // Fetch current scheme for this nomination — scoped to employee_id too
      // (not just id + tenant_id), otherwise a nomId belonging to a
      // different employee in the same tenant would run validateShareTotal
      // against the wrong employee's scheme/totals.
      const { data: existing } = await fastify.supabase
        .from('employee_nominations').select('scheme')
        .eq('id', req.params.nomId).eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).single()
      const scheme = parsed.data.scheme ?? existing?.scheme
      const valid = await validateShareTotal(fastify, req.params.id, req.tenantId, scheme, parsed.data.share_percentage, req.params.nomId)
      if (!valid)
        return reply.code(400).send({ error: 'VALIDATION', message: `Total share for ${scheme} would exceed 100%` })
    }
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .update(parsed.data)
      .eq('id', req.params.nomId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('*, relationship_types(id, name)').maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update nomination')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Nomination not found')
    return reply.send(data)
  })

  fastify.delete('/employees/:id/nominations/:nomId', hrAdminAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .delete()
      .eq('id', req.params.nomId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete nomination')
    if (!data || data.length === 0) return notFound(reply, 'NOT_FOUND', 'Nomination not found')
    return reply.code(204).send()
  })
}
