/**
 * Employee document metadata management.
 * The binary file is uploaded client-side to Supabase Storage;
 * this route handles the metadata row in the `documents` table.
 *
 * GET    /employees/:id/documents         — list docs (with signed URLs)
 * POST   /employees/:id/documents         — insert metadata row (hr_admin+)
 * DELETE /employees/:id/documents/:docId  — delete metadata + storage file (hr_admin+)
 *
 * RBAC:
 *   GET  — any authenticated user (tenant-scoped, employee must exist)
 *   POST — hr_admin / super_admin only
 *   DELETE — hr_admin / super_admin only
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'

const STORAGE_BUCKET  = 'employee-files'
const SIGNED_URL_TTL  = 3600    // 1 hour
const MAX_FILE_SIZE   = 5 * 1024 * 1024  // 5 MB

// documents.doc_type CHECK constraint (migration 005) — the ground truth for
// valid document types. Matches the frontend's DocType union (types/index.ts).
const DOC_TYPES = ['aadhaar', 'pan', 'offer_letter', 'contract', 'certificate',
                    'relieving_letter', 'experience_letter', 'other'] as const

const createSchema = z.object({
  name:         z.string().min(1).max(200),
  doc_type:     z.enum(DOC_TYPES),
  storage_path: z.string().min(1).max(500),
  file_size:    z.number().int().positive().max(MAX_FILE_SIZE, 'File exceeds 5 MB limit').optional().nullable(),
  mime_type:    z.string().max(100).optional().nullable(),
})

/** Verify employee exists in this tenant. Returns false (not throws) if not found. */
async function verifyEmployee(fastify: FastifyInstance, employeeId: string, tenantId: string): Promise<boolean> {
  const { data } = await (fastify as any).supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return !!data
}

/** Generate a signed URL for a storage path. Returns null on failure. */
async function createSignedUrl(fastify: FastifyInstance, storagePath: string): Promise<string | null> {
  const { data, error } = await (fastify as any).supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL)

  if (error || !data?.signedUrl) {
    fastify.log.warn(
      { storagePath, error: error?.message },
      'employee-documents: failed to generate signed URL',
    )
    return null
  }
  return data.signedUrl
}

export default async function employeeDocumentsRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /employees/:id/documents ─────────────────────────────────────────────
  // Any authenticated user (tenant-scoped). Returns signed URLs for all files
  // so the client can display documents without additional API calls.
  fastify.get('/employees/:id/documents', auth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'NOT_FOUND', 'Employee not found')

    const { data, error } = await (fastify as any).supabase
      .from('documents')
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, created_at')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee documents')

    // Attach signed URLs in parallel (best-effort)
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

  // ── POST /employees/:id/documents ────────────────────────────────────────────
  // HR admin+ only. Validates and persists metadata row.
  fastify.post('/employees/:id/documents', adminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'NOT_FOUND', 'Employee not found')

    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success)
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)

    const { data, error } = await (fastify as any).supabase
      .from('documents')
      .insert({
        ...parsed.data,
        employee_id: req.params.id,
        tenant_id:   req.tenantId,
        uploaded_by: req.userId,
      })
      .select('id, name, doc_type, storage_path, file_size, mime_type, expires_at, created_at')
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to save document metadata')

    // Return with signed URL so the client can immediately display the file
    const signed_url = data.storage_path
      ? await createSignedUrl(fastify, data.storage_path)
      : null

    return reply.code(201).send({ data: { ...data, signed_url, signed_url_expires_in: SIGNED_URL_TTL } })
  })

  // ── DELETE /employees/:id/documents/:docId ───────────────────────────────────
  // HR admin+ only. Removes storage file first, then metadata row.
  // Ordering prevents orphan storage files on DB failure.
  fastify.delete('/employees/:id/documents/:docId', adminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'NOT_FOUND', 'Employee not found')

    // Fetch storage_path before deleting metadata row
    const { data: doc, error: fetchErr } = await (fastify as any).supabase
      .from('documents')
      .select('id, storage_path')
      .eq('id', req.params.docId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !doc) {
      return notFound(reply, 'NOT_FOUND', 'Document not found')
    }

    // ── 1. Remove storage file (prevents orphan on DB failure) ───────────────
    if (doc.storage_path) {
      const { error: storageErr } = await (fastify as any).supabase.storage
        .from(STORAGE_BUCKET)
        .remove([doc.storage_path])

      if (storageErr) {
        // Log but do not block — storage file may already be absent
        fastify.log.warn(
          { docId: req.params.docId, storagePath: doc.storage_path, error: storageErr.message },
          'employee-documents: storage file removal failed — continuing with metadata delete',
        )
      }
    }

    // ── 2. Delete metadata row ───────────────────────────────────────────────
    const { error } = await (fastify as any).supabase
      .from('documents')
      .delete()
      .eq('id', req.params.docId)
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete document')
    return reply.code(204).send()
  })
}
