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
 *   All write operations — hr_admin / super_admin only
 *   GET (list + url refresh) — any authenticated user (tenant-scoped)
 *
 * GET    /uploads/sessions               — list sessions (hr_admin+, with filters)
 * POST   /uploads/sessions               — create a new upload session (hr_admin+)
 * PATCH  /uploads/sessions/:id/complete  — mark session completed (hr_admin+)
 * PATCH  /uploads/sessions/:id/fail      — mark session failed (hr_admin+)
 * GET    /uploads/sessions/:id/url       — get fresh signed download URL (any auth)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

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
  file_size:      z.number().int().positive().optional(),
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
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

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

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })

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
      .select('id, upload_type, status, storage_path, file_size, result_summary, updated_at')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })

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

    const { data, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .update({
        status:             'failed',
        error_message:      parsed.data.error_message,
        processing_ended_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, upload_type, status, error_message, updated_at')
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /uploads/sessions/:id/url ─────────────────────────────────────────────
  // Any authenticated user (tenant-scoped). Returns a fresh signed download URL
  // for the storage file associated with this session. Useful when the 1-hour
  // signed URL from the POST response has expired.
  fastify.get('/uploads/sessions/:id/url', auth, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { data: session, error } = await (fastify as any).supabase
      .from('upload_sessions')
      .select('id, status, storage_path, bucket')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !session) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload session not found' })
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
