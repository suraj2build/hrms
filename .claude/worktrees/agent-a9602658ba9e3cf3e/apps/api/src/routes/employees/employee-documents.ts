/**
 * Employee document metadata management.
 * The binary file is uploaded client-side to Supabase Storage;
 * this route only handles the metadata row in the `documents` table.
 *
 * GET    /employees/:id/documents           — list docs for employee
 * POST   /employees/:id/documents           — insert metadata row
 * DELETE /employees/:id/documents/:docId   — delete metadata row
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const createSchema = z.object({
  name:         z.string().min(1).max(200),
  doc_type:     z.string().min(1).max(100),
  storage_path: z.string().min(1).max(500),
  file_size:    z.number().int().positive().optional().nullable(),
  mime_type:    z.string().max(100).optional().nullable(),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
  return !!data
}

export default async function employeeDocumentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // GET /employees/:id/documents
  fastify.get('/employees/:id/documents', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { data, error } = await fastify.supabase
      .from('documents')
      .select('id, name, doc_type, storage_path, file_size, mime_type, created_at')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // POST /employees/:id/documents
  fastify.post('/employees/:id/documents', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })

    const { data, error } = await fastify.supabase
      .from('documents')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        uploaded_by: req.userId,
      })
      .select('id, name, doc_type, storage_path, file_size, mime_type, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // DELETE /employees/:id/documents/:docId
  fastify.delete('/employees/:id/documents/:docId', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })

    const { error } = await fastify.supabase
      .from('documents')
      .delete()
      .eq('id', req.params.docId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DELETE_FAILED', message: error.message })
    return reply.code(204).send()
  })
}
