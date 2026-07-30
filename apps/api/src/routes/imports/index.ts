/**
 * Enterprise Import Pipeline — REST routes
 * Prefix: /imports  (register in index.ts as: fastify.register(importsRoutes, { prefix: '/imports' }))
 *
 * POST   /imports                        Create an import job (Phase A)
 * GET    /imports                        List import jobs for the tenant
 * GET    /imports/:jobId                 Get a single import job (live-poll)
 * GET    /imports/:jobId/errors          Get row-level errors (paginated)
 * GET    /imports/:jobId/errors/export   Download all errors as CSV
 * POST   /imports/:jobId/retry           Re-queue a failed/partial job
 * POST   /imports/:jobId/cancel          Cancel a queued/processing job
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { durableQueue }         from '../../lib/durable-queue.js'
import { HR_ADMIN_ROLES }       from '../../lib/rbac.js'
import { conflictError, serverError, ErrorCode } from '../../lib/api-errors.js'
import { checkIdempotency, storeIdempotency, claimIdempotency, releaseIdempotencyClaim } from '../../lib/idempotency.js'
import {
  createImportJob,
  getImportJob,
  listImportJobs,
  listJobErrors,
  streamAllJobErrors,
  updateJobProgress,
  resetJobForRetry,
} from '../../lib/import-pipeline/service.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const IMPORT_JOB_TIMEOUT_MS = 4 * 60 * 60_000 // 4 hours

// ── Schemas ────────────────────────────────────────────────────────────────────

const createJobSchema = z.object({
  module:             z.string().min(1),
  import_type:        z.string().min(1),
  file_name:          z.string().min(1),
  file_storage_path:  z.string().min(1),
  file_size_bytes:    z.number().int().positive().optional(),
  mime_type:          z.string().optional(),
  metadata:           z.record(z.unknown()).optional(),
})

const listQuerySchema = z.object({
  module:  z.string().optional(),
  status:  z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  offset:  z.coerce.number().int().min(0).default(0),
})

const errorsQuerySchema = z.object({
  stage:   z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(500).default(100),
  offset:  z.coerce.number().int().min(0).default(0),
})

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function importsRoutes(fastify: FastifyInstance) {
  const auth     = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({
        error:   'FORBIDDEN',
        message: 'Only hr_admin or super_admin can access import endpoints',
      })
      return false
    }
    return true
  }

  // ── POST /imports ─────────────────────────────────────────────────────────
  // Phase A: create the job record and enqueue the background worker.
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = createJobSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues.map(i => i.message).join('; '),
      })
    }

    const { module, import_type, file_name, file_storage_path, file_size_bytes, mime_type, metadata } = parsed.data
    const tenantId = req.tenantId as string
    const userId   = req.userId   as string

    // Guard: storage path must be scoped to this tenant
    if (!file_storage_path.startsWith(`${tenantId}/`)) {
      return reply.code(400).send({
        error:   'INVALID_STORAGE_PATH',
        message: 'file_storage_path must be scoped to your tenant',
      })
    }

    const iKey  = (req.headers['idempotency-key'] as string | undefined)?.trim()
    const scope = 'import-create-job'
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, tenantId, iKey, scope)
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
      // Claim before creating the job row — the plain check-then-work-then-
      // store pattern above has a race window wide enough for a fast
      // double-submit (double-click, client retry) to see no cached hit
      // twice and create two separate import_jobs rows for the same file,
      // each enqueuing its own worker and importing the data twice.
      const claimed = await claimIdempotency(fastify.supabase, tenantId, iKey, scope)
      if (!claimed) {
        return reply.code(409).send({ error: 'DUPLICATE_REQUEST', message: 'An identical request is already being processed' })
      }
    }

    try {
      const job = await createImportJob(fastify.supabase, {
        tenant_id:         tenantId,
        created_by:        userId,
        module,
        import_type,
        file_name,
        file_storage_path,
        file_size_bytes,
        mime_type,
        metadata: metadata as Record<string, unknown> | undefined,
      })

      await updateJobProgress(fastify.supabase, job.id, {
        status: 'queued',
      })

      await durableQueue.enqueue(
        'import_job',
        { import_job_id: job.id, tenant_id: tenantId },
        {
          idempotencyKey: `import_job:${job.id}`,
          tenantId,
          createdBy:      userId,
          timeoutMs:      IMPORT_JOB_TIMEOUT_MS,
          maxRetries:     1,
        },
      )

      const responseBody = { job }
      if (iKey) await storeIdempotency(fastify.supabase, tenantId, iKey, scope, 201, responseBody)
      return reply.code(201).send(responseBody)
    } catch (err: unknown) {
      if (iKey) await releaseIdempotencyClaim(fastify.supabase, tenantId, iKey, scope)
      return serverError(req, reply, err, ErrorCode.INSERT_FAILED, 'Failed to create import job')
    }
  })

  // ── GET /imports ──────────────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { module, status, limit, offset } = parsed.data
    const { jobs, total } = await listImportJobs(fastify.supabase, req.tenantId, {
      module,
      status: status as any,
      limit,
      offset,
    })

    return reply.send({ jobs, total, limit, offset })
  })

  // ── GET /imports/:jobId ───────────────────────────────────────────────────
  fastify.get('/:jobId', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { jobId } = req.params as { jobId: string }
    const job = await getImportJob(fastify.supabase, jobId, req.tenantId)

    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    return reply.send({ job })
  })

  // ── GET /imports/:jobId/errors ────────────────────────────────────────────
  fastify.get('/:jobId/errors', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { jobId } = req.params as { jobId: string }

    const job = await getImportJob(fastify.supabase, jobId, req.tenantId)
    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const parsed = errorsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { stage, limit, offset } = parsed.data
    const { errors, total } = await listJobErrors(fastify.supabase, jobId, req.tenantId, {
      stage,
      limit,
      offset,
    })

    return reply.send({ errors, total, limit, offset })
  })

  // ── GET /imports/:jobId/errors/export ─────────────────────────────────────
  // Returns a downloadable CSV of all row errors for the given import job.
  fastify.get('/:jobId/errors/export', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { jobId } = req.params as { jobId: string }

    const job = await getImportJob(fastify.supabase, jobId, req.tenantId)
    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const errors = await streamAllJobErrors(fastify.supabase, jobId, req.tenantId)

    const headers = ['row_number', 'row_key', 'error_stage', 'error_code', 'error_message']
    const csvRows = [
      headers.join(','),
      ...errors.map(e =>
        [
          e.row_number,
          e.row_key   ?? '',
          e.error_stage,
          e.error_code ?? '',
          `"${(e.error_message ?? '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ]

    const slug = job.file_name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_')

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${slug}_errors.csv"`)
      .send(csvRows.join('\n'))
  })

  // ── POST /imports/:jobId/retry ────────────────────────────────────────────
  fastify.post('/:jobId/retry', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { jobId } = req.params as { jobId: string }
    const tenantId  = req.tenantId as string
    const userId    = req.userId   as string

    const job = await getImportJob(fastify.supabase, jobId, tenantId)
    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const RETRYABLE = ['failed', 'partial_failed']
    if (!RETRYABLE.includes(job.status)) {
      return reply.code(409).send({
        error:   'NOT_RETRYABLE',
        message: `Job with status '${job.status}' cannot be retried. Only failed or partial_failed jobs are retryable.`,
      })
    }

    // Atomically claim the job before touching its chunks/errors — the check
    // above is advisory only. Without this, two concurrent retry clicks both
    // read a retryable status, and resetJobForRetry's chunk reset
    // (`.neq('status','completed')`) would then run twice: the second call
    // resets chunks the first retry's worker has already moved to
    // 'processing' back to 'pending', letting two workers process the same
    // chunk concurrently and double-write the imported rows.
    const { data: claimed, error: claimErr } = await fastify.supabase
      .from('import_jobs')
      .update({ status: 'queued' })
      .eq('id', jobId)
      .eq('tenant_id', tenantId)
      .in('status', RETRYABLE)
      .select('id')
      .maybeSingle()

    if (claimErr) {
      return serverError(req, reply, claimErr, ErrorCode.UPDATE_FAILED, 'Failed to retry import job')
    }
    if (!claimed) {
      return conflictError(reply, 'NOT_RETRYABLE', 'This job was already retried or its status changed — refresh and try again')
    }

    await resetJobForRetry(fastify.supabase, job)

    // Re-enqueue — idempotencyKey uses a suffix so this is a fresh enqueue
    await durableQueue.enqueue(
      'import_job',
      { import_job_id: jobId, tenant_id: tenantId },
      {
        idempotencyKey: `import_job:${jobId}:retry:${Date.now()}`,
        tenantId,
        createdBy:      userId,
        timeoutMs:      IMPORT_JOB_TIMEOUT_MS,
        maxRetries:     1,
      },
    )

    const updated = await getImportJob(fastify.supabase, jobId, tenantId)
    return reply.send({ job: updated })
  })

  // ── POST /imports/:jobId/cancel ───────────────────────────────────────────
  fastify.post('/:jobId/cancel', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { jobId } = req.params as { jobId: string }

    const job = await getImportJob(fastify.supabase, jobId, req.tenantId)
    if (!job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const CANCELLABLE = ['uploaded', 'queued', 'parsing', 'validating', 'processing']
    if (!CANCELLABLE.includes(job.status)) {
      return reply.code(409).send({
        error:   'NOT_CANCELLABLE',
        message: `Job with status '${job.status}' cannot be cancelled.`,
      })
    }

    // Fold the cancellable-status precondition into the update itself —
    // same race as retry (e.g. a concurrent cancel racing the worker moving
    // the job to 'completed').
    const { data: cancelled, error: cancelErr } = await fastify.supabase
      .from('import_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .in('status', CANCELLABLE)
      .select('id')
      .maybeSingle()

    if (cancelErr) {
      return serverError(req, reply, cancelErr, ErrorCode.UPDATE_FAILED, 'Failed to cancel import job')
    }
    if (!cancelled) {
      return conflictError(reply, 'NOT_CANCELLABLE', 'This job already finished or its status changed — refresh and try again')
    }

    const updated = await getImportJob(fastify.supabase, jobId, req.tenantId)
    return reply.send({ job: updated })
  })
}
