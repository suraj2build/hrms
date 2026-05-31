import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB in bytes

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
])

const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png'])

const DOC_TYPES = new Set([
  'aadhaar', 'pan', 'offer_letter', 'contract',
  'certificate', 'relieving_letter', 'experience_letter', 'other',
])

const docSchema = z.object({
  employee_id: z.string().uuid('employee_id must be a valid UUID'),
  doc_type: z.string().refine((v) => DOC_TYPES.has(v), {
    message: `doc_type must be one of: ${[...DOC_TYPES].join(', ')}`,
  }),
  name: z.string().min(1, 'name is required'),
  storage_path: z.string().min(1, 'storage_path is required'),
  file_size: z.number().optional(),
  mime_type: z.string().optional(),
  expires_at: z.string().optional(),
})

export default async function documentRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/documents', auth, async (req, reply) => {
    const { doc_type } = req.query as { doc_type?: string }

    let query = fastify.supabase
      .from('documents')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (doc_type) query = query.eq('doc_type', doc_type)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  fastify.post('/documents', auth, async (req, reply) => {
    const parsed = docSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { employee_id, mime_type, file_size, name } = parsed.data

    // ── 1. Employee belongs to this tenant ───────────────────────────────────
    const { data: employee, error: empError } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', employee_id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (empError || !employee) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found in this tenant' })
    }

    // ── 2. MIME type whitelist ────────────────────────────────────────────────
    if (mime_type && !ALLOWED_MIME_TYPES.has(mime_type)) {
      return reply.code(415).send({
        error: 'UNSUPPORTED_FILE_TYPE',
        message: `File type "${mime_type}" is not allowed. Accepted: PDF, JPG, PNG`,
      })
    }

    // ── 3. Extension whitelist (derived from filename) ───────────────────────
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.code(415).send({
        error: 'UNSUPPORTED_FILE_TYPE',
        message: `File extension ".${ext}" is not allowed. Accepted: .pdf, .jpg, .jpeg, .png`,
      })
    }

    // ── 4. File size cap ─────────────────────────────────────────────────────
    if (file_size !== undefined && file_size > MAX_FILE_SIZE) {
      return reply.code(413).send({
        error: 'FILE_TOO_LARGE',
        message: `File size ${(file_size / 1024 / 1024).toFixed(2)} MB exceeds the 5 MB limit`,
      })
    }

    // ── 5. Persist metadata ──────────────────────────────────────────────────
    const { data, error } = await fastify.supabase
      .from('documents')
      .insert({ ...parsed.data, tenant_id: req.tenantId, uploaded_by: req.userId })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.code(201).send(data)
  })

  fastify.delete('/documents/:id', auth, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Get storage path first
    const { data: doc } = await fastify.supabase
      .from('documents').select('storage_path').eq('id', id).eq('tenant_id', req.tenantId).single()

    if (doc) {
      await fastify.supabase.storage.from('documents').remove([doc.storage_path])
    }

    const { error } = await fastify.supabase
      .from('documents').delete().eq('id', id).eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ message: 'Document deleted' })
  })
}
