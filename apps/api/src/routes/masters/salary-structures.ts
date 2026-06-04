/**
 * Salary Structures master routes — /masters/salary-structures
 *
 * Thin HTTP layer over lib/salary-config-store.ts (single source of truth shared
 * with /payroll/compensation/structures). Includes the structure-component
 * sub-routes (incl. PUT) that the payroll surface also exposes.
 *
 * Auth: reads = authenticated; writes = hr_admin / super_admin.
 * Response shapes preserved.
 */
import type { FastifyInstance } from 'fastify'
import {
  listStructures, getStructure, createStructure, updateStructure, deleteStructure,
  listStructureComponents, addStructureComponent, updateStructureComponent, removeStructureComponent,
} from '../../lib/salary-config-store.js'

export default async function salaryStructuresRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }
  const writeAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ── STRUCTURES ──────────────────────────────────────────

  fastify.get('/', auth, async (req: any, reply) => {
    const r = await listStructures(fastify.supabase, req.tenantId, 'full')
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  fastify.get('/:id', auth, async (req: any, reply) => {
    const r = await getStructure(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send(r.data)
  })

  fastify.post('/', writeAuth, async (req: any, reply) => {
    const r = await createStructure(fastify.supabase, req.tenantId, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send(r.data)
  })

  fastify.put('/:id', writeAuth, async (req: any, reply) => {
    const r = await updateStructure(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send(r.data)
  })

  fastify.delete('/:id', writeAuth, async (req: any, reply) => {
    const r = await deleteStructure(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(204).send()
  })

  // ── STRUCTURE COMPONENTS ────────────────────────────────

  fastify.get('/:id/components', auth, async (req: any, reply) => {
    const r = await listStructureComponents(fastify.supabase, req.tenantId, req.params.id)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send({ data: r.data })
  })

  fastify.post('/:id/components', writeAuth, async (req: any, reply) => {
    const r = await addStructureComponent(fastify.supabase, req.tenantId, req.params.id, req.body)
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(201).send(r.data)
  })

  fastify.put('/:id/components/:componentId', writeAuth, async (req: any, reply) => {
    const r = await updateStructureComponent(
      fastify.supabase, req.tenantId, req.params.id, req.params.componentId, req.body,
    )
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.send(r.data)
  })

  fastify.delete('/:id/components/:componentId', writeAuth, async (req: any, reply) => {
    const r = await removeStructureComponent(
      fastify.supabase, req.tenantId, req.params.id, req.params.componentId,
    )
    if (r.error) return reply.code(r.status).send(r.error)
    return reply.code(204).send()
  })
}
