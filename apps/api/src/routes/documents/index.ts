/**
 * Document metadata management routes.
 *
 * The binary file is uploaded client-side to Supabase Storage;
 * these routes handle:
 *   - metadata persistence in the `documents` table
 *   - signed URL generation for file serving (1-hour TTL)
 *   - storage cleanup on deletion (prevents orphan files)
 *
 * RBAC: read is open to all authenticated users (tenant-scoped);
 *       write (insert/delete) requires hr_admin or super_admin.
 *
 * GET    /documents           — list docs (tenant-scoped, with signed URLs)
 * POST   /documents           — insert metadata row (hr_admin+)
 * DELETE /documents/:id       — delete metadata + storage file (hr_admin+)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

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

const STORAGE_BUCKET = 'employee-files'
const SIGNED_URL_TTL = 3600 // 1 hour

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

/**
 * Generate a signed URL for a storage path.
 * Returns null if signed URL generation fails (file may not exist).
 */
async function createSignedUrl(
  fastify: FastifyInstance,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await (fastify as any).supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL)

  if (error || !data?.signedUrl) {
    fastify.log.warn(
      { storagePath, error: error?.message },
      'documents: failed to generate signed URL',
    )
    return null
  }
  return data.signedUrl
}

export default async function documentRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /documents ───────────────────────────────────────────────────────────
  // Open to all authenticated users (tenant-scoped). Returns signed URLs so
  // the client can display files without additional API calls.
  fastify.get('/documents', auth, async (req: any, reply) => {
    const { doc_type } = req.query as { doc_type?: string }

    let query = (fastify as any).supabase
      .from('documents')
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, created_at, employee_id')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (doc_type) query = query.eq('doc_type', doc_type)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Attach signed URLs in parallel (best-effort — null if storage path invalid)
    const docs = await Promise.all(
      (data ?? []).map(async (doc: any) => ({
        ...doc,
        signed_url: doc.storage_path
          ? await createSignedUrl(fastify, doc.storage_path)
          : null,
        signed_url_expires_in: SIGNED_URL_TTL,
      })),
    )

    return reply.send({ data: docs })
  })

  // ── POST /documents ──────────────────────────────────────────────────────────
  // HR admin+ only. Validates MIME type, extension, and file size before
  // persisting the metadata row.
  fastify.post('/documents', adminAuth, async (req: any, reply) => {
    const parsed = docSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.errors[0]?.message })
    }

    const { employee_id, mime_type, file_size, name } = parsed.data

    // ── 1. Employee belongs to this tenant ───────────────────────────────────
    const { data: employee, error: empError } = await (fastify as any).supabase
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
        error:   'UNSUPPORTED_FILE_TYPE',
        message: `File type "${mime_type}" is not allowed. Accepted: PDF, JPG, PNG`,
      })
    }

    // ── 3. Extension whitelist ────────────────────────────────────────────────
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.code(415).send({
        error:   'UNSUPPORTED_FILE_TYPE',
        message: `File extension ".${ext}" is not allowed. Accepted: .pdf, .jpg, .jpeg, .png`,
      })
    }

    // ── 4. File size cap ─────────────────────────────────────────────────────
    if (file_size !== undefined && file_size > MAX_FILE_SIZE) {
      return reply.code(413).send({
        error:   'FILE_TOO_LARGE',
        message: `File size ${(file_size / 1024 / 1024).toFixed(2)} MB exceeds the 5 MB limit`,
      })
    }

    // ── 5. Persist metadata ──────────────────────────────────────────────────
    const { data, error } = await (fastify as any).supabase
      .from('documents')
      .insert({ ...parsed.data, tenant_id: req.tenantId, uploaded_by: req.userId })
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, created_at, employee_id')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Return with signed URL so the client can immediately display the file
    const signed_url = data.storage_path
      ? await createSignedUrl(fastify, data.storage_path)
      : null

    return reply.code(201).send({ ...data, signed_url, signed_url_expires_in: SIGNED_URL_TTL })
  })

  // ── DELETE /documents/:id ────────────────────────────────────────────────────
  // HR admin+ only. Deletes storage file first, then metadata row.
  // Ordering ensures we don't leave orphan storage files if DB delete fails.
  fastify.delete('/documents/:id', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    // Fetch storage_path before deleting metadata
    const { data: doc, error: fetchErr } = await (fastify as any).supabase
      .from('documents')
      .select('id, storage_path')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !doc) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Document not found' })
    }

    // ── 1. Remove storage file first (prevents orphan on DB failure) ─────────
    if (doc.storage_path) {
      const { error: storageErr } = await (fastify as any).supabase.storage
        .from(STORAGE_BUCKET)       // ← was 'documents' (wrong bucket) — now 'employee-files'
        .remove([doc.storage_path])

      if (storageErr) {
        // Log but do not block — storage may already be gone (idempotent delete)
        fastify.log.warn(
          { docId: id, storagePath: doc.storage_path, error: storageErr.message },
          'documents: storage file removal failed — continuing with metadata delete',
        )
      }
    }

    // ── 2. Delete metadata row ───────────────────────────────────────────────
    const { error: deleteErr } = await (fastify as any).supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (deleteErr) return reply.code(500).send({ error: 'DB_ERROR', message: deleteErr.message })
    return reply.code(204).send()
  })
}
