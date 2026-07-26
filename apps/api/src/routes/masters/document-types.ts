import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { z } from 'zod'

const schema = z.object({
  name:           z.string().min(1, 'Name is required'),
  code:           z.string().min(1, 'Code is required'),
  description:    z.string().optional(),
  is_mandatory:   z.boolean().optional().default(false),
  applicable_for: z.array(z.string()).optional().default([]),
  is_active:      z.boolean().optional().default(true),
})

export default async function documentTypesRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('document_types')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name')
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('document_types')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.put('/:id', hrAdminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('document_types')
      .update(parsed.data)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Document type not found' })
    return reply.send(data)
  })

  // Always soft-deactivates — documents.document_type_id references this
  // table with ON DELETE SET NULL, so a hard delete would silently strip the
  // classification off every document of this type tenant-wide with no
  // warning. Deactivating (like every sibling master) preserves that link.
  fastify.delete('/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { count } = await fastify.supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('document_type_id', id)
      .eq('tenant_id', req.tenantId)
    const inUse = (count ?? 0) > 0

    const { error } = await fastify.supabase
      .from('document_types')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({
      deactivated: true,
      message: inUse
        ? 'Document type deactivated — in use by existing documents'
        : 'Document type deactivated',
    })
  })
}
