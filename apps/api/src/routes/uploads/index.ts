/**
 * Upload session lifecycle management.
 *
 * The client uploads binary files directly to Supabase Storage (client-side
 * SDK). These routes manage the server-side session record in `upload_sessions`,
 * providing:
 *   - Audit trail for every upload attempt
 *   - Orphan/stale detection (sessions that never completed)
 *   - Signed URL issuance and refresh
 *   - Observability (list + filter by status / upload_type)
 *
 * Flow:
 *   1. Client calls POST /uploads/sessions     → gets session id + upload metadata
 *   2. Client uploads file directly to Supabase Storage using its own SDK
 *   3. Client calls PATCH /uploads/sessions/:id/complete → marks session completed
 *   4. Client can call GET /uploads/sessions/:id/url     → get fresh signed URL
 *
 * RBAC:
 *   All write operations and the list endpoint — hr_admin / super_admin only
 *   GET .../url — any authenticated user, but scoped: hr_admin+ may fetch any
 *     session in the tenant; anyone else only a session referencing their own
 *     employee record
 *
 * GET    /uploads/sessions               — list sessions (hr_admin+, with filters)
 * POST   /uploads/sessions               — create a new upload session (hr_admin+)
 * PATCH  /uploads/sessions/:id/complete  — mark session completed (hr_admin+)
 * PATCH  /uploads/sessions/:id/fail      — mark session failed (hr_admin+)
 * GET    /uploads/sessions/:id/url       — get fresh signed download URL (self or hr_admin+)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const STORAGE_BUCKET  = 'employee-files'
const SIGNED_URL_TTL  = 3600   // 1 hour
const UPLOAD_URL_TTL  = 900    // 15 min for upload (pre-signed upload URLs)
const MAX_FILE_SIZE   = 50 * 1024 * 1024  // 50 MB (upload sessions support larger files than doc metadata)

const UPLOAD_TYPES = [
  'attendance_csv',
  'employee_document',
  'onboarding_document',
  'import_file',
  'profile_photo',
] as const

const REFERENCE_TYPES = [
  'employee',
  'onboarding_session',
  'import_job',
  'attendance_batch',
  'tenant',
] as const

// Matches routes/documents/index.ts's whitelist — document/photo-style
// upload types had no MIME/extension gate at all, so a client could
// register (and later have a viewer open) an .html/.svg/executable as an
// "employee_document" via this general-purpose session tracker. Left
// unrestricted for the CSV/import types, which legitimately need
// non-image/PDF formats.
const DOC_LIKE_UPLOAD_TYPES = new Set(['employee_document', 'onboarding_document', 'profile_photo'])
const ALLOWED_DOC_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
])
const ALLOWED_DOC_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png'])

const createSessionSchema = z.object({
  upload_type:    z.enum(UPLOAD_TYPES),
  file_name:      z.string().min(1).max(500),
  file_size:      z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  mime_type:      z.string().max(100).optional(),
  storage_path:   z.string().min(1).max(1000).optional(),   // client may supply intended path
  reference_id:   z.string().uuid().optional(),
  reference_type: z.enum(REFERENCE_TYPES).optional(),
  metadata:       z.record(z.unknown()).optional(),
})

const completeSessionSchema = z.object({
  storage_path:   z.string().min(1).max(1000),
  file_size:      z.number().int().positive().max(MAX_FILE_SIZE).optional(),
  result_summary: z.record(z.unknown()).optional(),
})

const failSessionSchema = z.object({
  error_message: z.string().max(1000),
})

/** Generate a signed download URL for a storage path. Returns null on failure. */
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
      'uploads: failed to generate signed URL',
    )
    return null
  }
  return data.signedUrl
}

export default async function uploadSessionRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /uploads/sessions ─────────────────────────────────────────────────────
  // HR admin+ only. Lists upload sessions for this tenant with optional filters.
  fastify.get('/uploads/sessions', adminAuth, async (req: any, reply) => {
    const { status, upload_type, reference_id, limit = '50', offset = '0' } =
      req.query as {
        status?: string
        upload_type?: string
        reference_id?: string
        limit?: string
        offset?: string
      }

    let query = (fastify as any).supabase
      .from('upload_sessions')
      .select(
        'id, upload_type, status, storage_path, bucket, file_name, file_size, mime_type, ' +
        'reference_id, reference_type, result_summary, error_message, metadata, ' +
        'upload_started_at, upload_completed_at, processing_started_at, processing_ended_at, ' +
        'expires_at, created_by, created_at, updated_at',
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(
        Math.max(0, parseInt(offset, 10) || 0),
        Math.max(0, parseInt(offset, 10) || 0) + Math.min(200, parseInt(limit, 10) || 50) - 1,
      )

    if (status)       query = query.eq('status', status)
    if (upload_type)  query = query.eq('upload_type', upload_type)
    if (reference_id) query = query.eq('reference_id', reference_id)

    const { data, error } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch upload sessions')

    return reply.send({ data: data ?? [] })
  })

  // ── POST /uploads/sessions ────────────────────────────────────────────────────
  // HR admin+ only. Creates a new upload session record.
  // If the client has already uploaded the file (storage_path supplied), status
  // is set to 'uploaded'. Otherwise it starts as 'pending'.
  fastify.post('/uploads/sessions', adminAuth, async (req: any, reply) => {
    const parsed = createSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { storage_path, ...rest } = parsed.data

    // The session's storage_path is signed on read — it must live under this
    // tenant's prefix so an admin can't register (and later sign) a path that
    // points at another tenant's object.
    if (storage_path && !storage_path.startsWith(`${req.tenantId}/`)) {
      return reply.code(400).send({
        error:   'INVALID_STORAGE_PATH',
        message: 'storage_path must be within your tenant namespace',
      })
    }

    if (DOC_LIKE_UPLOAD_TYPES.has(parsed.data.upload_type)) {
      const { mime_type, file_name } = parsed.data
      if (mime_type && !ALLOWED_DOC_MIME_TYPES.has(mime_type)) {
        return reply.code(415).send({
          error:   'UNSUPPORTED_FILE_TYPE',
          message: `File type "${mime_type}" is not allowed. Accepted: PDF, JPG, PNG`,
        })
      }
      const ext = file_name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        return reply.code(415).send({
          error:   'UNSUPPORTED_FILE_TYPE',
          message: `File extension ".${ext}" is not allowed. Accepted: .pdf, .jpg, .jpeg, .png`,
        })
      }
    }

    // Fresh audit finding: reference_id/reference_type had no tenant check
    // at all. upload_sessions.reference_id is a polymorphic bare UUID (no
    // DB-level FK), and GET /uploads/sessions/:id/url below actively uses
    // reference_type === 'employee' && reference_id === ownEmployeeId to
    // grant a non-admin caller access to their own upload — an unchecked
    // cross-tenant employee id here would corrupt that access-control
    // signal with a foreign employee id that can never legitimately match
    // anyone in this tenant.
    if (parsed.data.reference_type === 'employee' && parsed.data.reference_id) {
      const { data: refEmp, error: refErr } = await (fastify as any).supabase
        .from('employees').select('id').eq('id', parsed.data.reference_id).eq('tenant_id', req.tenantId).maybeSingle()
      if (refErr) return serverError(req, reply, refErr, ErrorCode.QUERY_FAILED, 'Failed to validate reference_id')
      if (!refEmp) return reply.code(400).send({ error: 'INVALID_REFERENCE', message: 'reference_id does not match an employee in your organisation' })
    }

    const initialStatus = storage_path ? 'uploaded' : 'pending'

    const { data, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .insert({
        ...rest,
        storage_path,
        tenant_id:  req.tenantId,
        created_by: req.userId,
        status:     initialStatus,
        metadata:   rest.metadata ?? {},
        // If already uploaded, record upload timestamps
        ...(storage_path
          ? { upload_started_at: new Date().toISOString(), upload_completed_at: new Date().toISOString() }
          : {}),
      })
      .select(
        'id, upload_type, status, storage_path, bucket, file_name, file_size, mime_type, ' +
        'reference_id, reference_type, metadata, expires_at, created_at',
      )
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create upload session')

    // If we already have a storage path, attach a signed download URL immediately
    const signed_url = data.storage_path
      ? await createSignedUrl(fastify, data.storage_path)
      : null

    return reply.code(201).send({
      data: {
        ...data,
        signed_url,
        signed_url_expires_in: signed_url ? SIGNED_URL_TTL : null,
      },
    })
  })

  // ── PATCH /uploads/sessions/:id/complete ─────────────────────────────────────
  // HR admin+ only. Called after the client has finished uploading to storage.
  // Updates status → 'completed' and records the storage path + file metadata.
  fastify.patch('/uploads/sessions/:id/complete', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const parsed = completeSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    // storage_path must live under this tenant's prefix, same check as
    // POST /uploads/sessions — otherwise an admin could register (and
    // immediately get a signed URL for) another tenant's object here,
    // since this handler never re-derives the path itself.
    if (!parsed.data.storage_path.startsWith(`${req.tenantId}/`)) {
      return reply.code(400).send({
        error:   'INVALID_STORAGE_PATH',
        message: 'storage_path must be within your tenant namespace',
      })
    }

    // Verify session belongs to this tenant and is in a completable state
    const { data: existing, error: fetchErr } = await (fastify as any).supabase
      .from('upload_sessions')
      .select('id, status, tenant_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload session not found' })
    }

    const COMPLETABLE = new Set(['pending', 'uploading', 'uploaded', 'processing'])
    if (!COMPLETABLE.has(existing.status)) {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: `Session is already in terminal state "${existing.status}"`,
      })
    }

    const now = new Date().toISOString()

    // Guard is re-asserted in the UPDATE's own WHERE clause (not just the SELECT
    // above) so a concurrent /complete or /fail on the same session can't both
    // pass their read-time check and clobber each other's write.
    const { data, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .update({
        status:               'completed',
        storage_path:         parsed.data.storage_path,
        ...(parsed.data.file_size !== undefined ? { file_size: parsed.data.file_size } : {}),
        ...(parsed.data.result_summary !== undefined ? { result_summary: parsed.data.result_summary } : {}),
        upload_completed_at:  now,
        processing_ended_at:  now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .in('status', Array.from(COMPLETABLE))
      .select('id, upload_type, status, storage_path, file_size, result_summary, updated_at')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to complete upload session')
    if (!data) {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: 'Session state changed concurrently — it is no longer completable',
      })
    }

    const signed_url = data.storage_path
      ? await createSignedUrl(fastify, data.storage_path)
      : null

    return reply.send({
      data: {
        ...data,
        signed_url,
        signed_url_expires_in: signed_url ? SIGNED_URL_TTL : null,
      },
    })
  })

  // ── PATCH /uploads/sessions/:id/fail ─────────────────────────────────────────
  // HR admin+ only. Marks a session as failed with an error message.
  fastify.patch('/uploads/sessions/:id/fail', adminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const parsed = failSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data: existing, error: fetchErr } = await (fastify as any).supabase
      .from('upload_sessions')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload session not found' })
    }

    const TERMINAL = new Set(['completed', 'failed', 'expired', 'orphaned'])
    if (TERMINAL.has(existing.status)) {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: `Session is already in terminal state "${existing.status}"`,
      })
    }

    // Guard is re-asserted in the UPDATE's own WHERE clause (not just the SELECT
    // above) so a concurrent /complete or /fail on the same session can't both
    // pass their read-time check and clobber each other's write.
    const { data, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .update({
        status:             'failed',
        error_message:      parsed.data.error_message,
        processing_ended_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .not('status', 'in', `(${Array.from(TERMINAL).map(s => `"${s}"`).join(',')})`)
      .select('id, upload_type, status, error_message, updated_at')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to mark upload session as failed')
    if (!data) {
      return reply.code(409).send({
        error:   'INVALID_STATE',
        message: 'Session state changed concurrently — it is already in a terminal state',
      })
    }
    return reply.send({ data })
  })

  // ── GET /uploads/sessions/:id/url ─────────────────────────────────────────────
  // hr_admin+ may fetch any session in their tenant. A non-admin caller may only
  // fetch a session that references their own employee record — otherwise any
  // employee could pull a signed download URL for another employee's documents
  // (upload_type 'employee_document'/'onboarding_document') just by knowing/
  // guessing an upload_sessions id, since fastify.supabase runs with the
  // service-role key and bypasses RLS.
  fastify.get('/uploads/sessions/:id/url', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: session, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .select('id, status, storage_path, bucket, reference_id, reference_type')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload session not found' })
    }

    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      const { data: prof, error: profError } = await (fastify as any).supabase
        .from('profiles').select('employee_id')
        .eq('id', req.userId).eq('tenant_id', req.tenantId).maybeSingle()
      if (profError) return serverError(req, reply, profError, ErrorCode.QUERY_FAILED, 'Failed to resolve caller identity')
      const ownEmployeeId = prof?.employee_id ?? null
      const isOwnSession = session.reference_type === 'employee' && session.reference_id === ownEmployeeId
      if (!ownEmployeeId || !isOwnSession) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You may only access your own upload sessions' })
      }
    }

    if (!session.storage_path) {
      return reply.code(422).send({
        error:   'NO_STORAGE_PATH',
        message: 'Session has no storage path — upload may not have completed yet',
      })
    }

    const signed_url = await createSignedUrl(fastify, session.storage_path)
    if (!signed_url) {
      return reply.code(502).send({
        error:   'SIGNED_URL_FAILED',
        message: 'Failed to generate signed URL — storage file may not exist',
      })
    }

    return reply.send({
      data: {
        session_id:            id,
        storage_path:          session.storage_path,
        signed_url,
        signed_url_expires_in: SIGNED_URL_TTL,
      },
    })
  })
}
