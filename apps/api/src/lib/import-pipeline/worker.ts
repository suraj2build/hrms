/**
 * worker.ts — DurableJobQueue handler for the import pipeline.
 *
 * Registers a single job type 'import_job' that:
 *   1. Loads the ImportJob record from DB.
 *   2. Guards against terminal / already-processing states.
 *   3. Dispatches to the registered module handler.
 *   4. On unrecoverable error, marks job as failed with a clear message.
 *
 * Module registry:
 *   Pass 1 ships with an empty registry.
 *   Pass 2 registers modules via registerImportModule() before durableQueue.start().
 *
 * Timeout:
 *   Import jobs must be enqueued with timeoutMs: 4 * 3600_000 (4 h).
 *   The queue's default 120 s timeout would kill long-running imports.
 */

import type { FastifyInstance }  from 'fastify'
import type { JobHandlerFn }     from '../durable-queue.js'
import type { ImportModuleHandler, ImportJob } from './types.js'
import { getImportJob, updateJobProgress } from './service.js'

// ── Module registry ────────────────────────────────────────────────────────────

const moduleRegistry = new Map<string, ImportModuleHandler>()

/**
 * Register an import module handler.
 * Call this at startup BEFORE durableQueue.start().
 *
 * @param moduleName  Must match the `module` column on import_jobs rows
 *                    that should be dispatched here.
 * @param handler     The module's implementation of ImportModuleHandler.
 */
export function registerImportModule(moduleName: string, handler: ImportModuleHandler): void {
  moduleRegistry.set(moduleName, handler)
}

// ── Terminal state guard ───────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'partial_failed', 'failed', 'cancelled'])

// ── Handler factory ────────────────────────────────────────────────────────────

/**
 * Create the DurableJobQueue handler for 'import_job'.
 *
 * @param fastify  Fastify instance — used to access the Supabase client and logger.
 */
export function createImportJobHandler(fastify: FastifyInstance): JobHandlerFn {
  return async function importJobHandler(payload) {
    const { supabase } = fastify
    const log = fastify.log

    const jobId    = payload['import_job_id']
    const tenantId = payload['tenant_id']

    if (typeof jobId !== 'string' || typeof tenantId !== 'string') {
      throw new Error('[import-worker] payload missing import_job_id or tenant_id')
    }

    // ── Load job ──────────────────────────────────────────────────────────────

    let job: ImportJob | null
    try {
      job = await getImportJob(supabase, jobId, tenantId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ jobId, err: msg }, '[import-worker] failed to load import job')
      throw err
    }

    if (!job) {
      log.warn({ jobId }, '[import-worker] import job not found — skipping')
      return
    }

    // ── Terminal-state guard ──────────────────────────────────────────────────

    if (TERMINAL_STATUSES.has(job.status)) {
      log.info({ jobId, status: job.status }, '[import-worker] job already in terminal state — skipping')
      return
    }

    // ── Module dispatch ───────────────────────────────────────────────────────

    const moduleName = job.module ?? ''
    const handler    = moduleRegistry.get(moduleName)

    if (!handler) {
      const msg = moduleName
        ? `No import module registered for '${moduleName}'`
        : 'Import job has no module set'

      log.error({ jobId, module: moduleName }, `[import-worker] ${msg}`)

      await updateJobProgress(supabase, jobId, {
        status:        'failed',
        error_summary: msg,
        completed_at:  new Date().toISOString(),
      })
      return
    }

    log.info({ jobId, module: moduleName }, '[import-worker] dispatching to module handler')

    try {
      await handler.handle(job, supabase, log as any)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error({ jobId, module: moduleName, err: msg }, '[import-worker] module handler threw')

      await updateJobProgress(supabase, jobId, {
        status:        'failed',
        error_summary: msg,
        completed_at:  new Date().toISOString(),
      }).catch(e => {
        log.error({ jobId, err: String(e) }, '[import-worker] failed to mark job as failed after handler error')
      })

      throw err
    }
  }
}
