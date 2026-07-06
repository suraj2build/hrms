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

    return reply.code(201).send({ job })
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

    const RETRYABLE = new Set(['failed', 'partial_failed'])
    if (!RETRYABLE.has(job.status)) {
      return reply.code(409).send({
        error:   'NOT_RETRYABLE',
        message: `Job with status '${job.status}' cannot be retried. Only failed or partial_failed jobs are retryable.`,
      })
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

    const CANCELLABLE = new Set(['uploaded', 'queued', 'parsing', 'validating', 'processing'])
    if (!CANCELLABLE.has(job.status)) {
      return reply.code(409).send({
        error:   'NOT_CANCELLABLE',
        message: `Job with status '${job.status}' cannot be cancelled.`,
      })
    }

    await updateJobProgress(fastify.supabase, jobId, {
      status:       'cancelled',
      completed_at: new Date().toISOString(),
    })

    const updated = await getImportJob(fastify.supabase, jobId, req.tenantId)
    return reply.send({ job: updated })
  })
}
