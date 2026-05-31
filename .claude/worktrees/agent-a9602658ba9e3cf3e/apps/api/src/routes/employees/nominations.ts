import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const schema = z.object({
  scheme:               z.enum(['pf','gratuity','esi','superannuation']),
  nominee_name:         z.string().min(1, 'Nominee name is required'),
  relationship_type_id: z.string().uuid().optional(),
  dob:                  z.string().optional(),
  share_percentage:     z.number().positive().max(100, 'Cannot exceed 100%'),
  address:              z.string().optional(),
  is_minor:             z.boolean().optional().default(false),
  guardian_name:        z.string().optional(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).single()
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
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/employees/:id/nominations', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .select('*, relationship_types(id, name)')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('scheme')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/employees/:id/nominations', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.is_minor && !parsed.data.guardian_name)
      return reply.code(400).send({ error: 'VALIDATION', message: 'Guardian name required for minor nominees' })
    const valid = await validateShareTotal(fastify, req.params.id, req.tenantId, parsed.data.scheme, parsed.data.share_percentage)
    if (!valid)
      return reply.code(400).send({ error: 'VALIDATION', message: `Total share for ${parsed.data.scheme} would exceed 100%` })
    const { data, error } = await fastify.supabase
      .from('employee_nominations')
      .insert({ ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId })
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/employees/:id/nominations/:nomId', auth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    if (parsed.data.share_percentage) {
      // Fetch current scheme for this nomination
      const { data: existing } = await fastify.supabase
        .from('employee_nominations').select('scheme').eq('id', req.params.nomId).single()
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
      .select('*, relationship_types(id, name)').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nomination not found' })
    return reply.send(data)
  })

  fastify.delete('/employees/:id/nominations/:nomId', auth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('employee_nominations')
      .delete()
      .eq('id', req.params.nomId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(204).send()
  })
}
