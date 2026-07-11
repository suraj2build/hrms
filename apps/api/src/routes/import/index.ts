// ── Universal Master Import Framework — Routes ────────────────────────────────
// Prefix: /import  (register in index.ts as: fastify.register(importRoutes, { prefix: '/import' }))

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { generateCSV, generateSalaryComponentsXlsx, MASTER_TEMPLATES } from '../../lib/import-engine/templates.js'
import { validateImportRows }            from '../../lib/import-engine/validator.js'
import { runImport, createImportJob }    from '../../lib/import-engine/importer.js'
import {
  fetchActiveComponents,
  generateSalaryUploadXlsx,
  validateSalaryUploadRows,
  runSalaryUploadJob,
  type SalaryManifest,
} from '../../lib/import-engine/salary-upload.js'
import {
  MetadataValidationError,
  ReferenceIntegrityError,
} from '../../lib/enterprise-import/index.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

// ── Shared constants ──────────────────────────────────────────────────────────

const VALID_MASTER_TYPES = [...Object.keys(MASTER_TEMPLATES), 'employee_salary_upload']

// Master types that are pre-seeded per tenant and must not be overwritten via import.
const SEEDED_MASTER_TYPES: Record<string, string> = {
  states: 'States are pre-seeded for every tenant (all 36 Indian states/UTs). Edit PT/LWF flags and region labels from Settings → States instead of importing.',
}

const IMPORT_MODES = ['create_only', 'update_only', 'upsert', 'validate_only'] as const

// ── Zod schemas ───────────────────────────────────────────────────────────────

// Manifest sent back by the frontend on validate/run (all string values from CSV/XLSX).
// v1 fields kept for backward compat; v2 fields added in schema version 2.
const manifestSchema = z.object({
  // v1
  tenantId:            z.string().optional(),
  generatedBy:         z.string().optional(),
  importType:          z.string().optional(),
  schemaVersion:       z.string().optional(),
  expectedColumnCount: z.string().optional(),
  // v2
  workbookId:          z.string().optional(),
  componentHash:       z.string().optional(),
  componentCount:      z.string().optional(),
  manifestVersion:     z.string().optional(),
  workbookType:        z.string().optional(),
  generatorVersion:    z.string().optional(),
  generatedAt:         z.string().optional(),
  signature:           z.string().optional(),
  components:          z.string().optional(),
}).optional()

const validateBodySchema = z.object({
  masterType: z.string().refine(
    (v) => VALID_MASTER_TYPES.includes(v),
    (v) => ({ message: `Unknown masterType "${v}". Valid: ${VALID_MASTER_TYPES.join(', ')}` }),
  ),
  rows: z
    .array(z.record(z.string()))
    .min(1, 'At least one row is required')
    .max(5000, 'Maximum 5000 rows per request'),
  mode: z.enum(IMPORT_MODES).default('upsert'),
  templateVersion: z.string().optional(),
  manifest: manifestSchema,
})

const runBodySchema = z.object({
  masterType: z.string().refine(
    (v) => VALID_MASTER_TYPES.includes(v),
    (v) => ({ message: `Unknown masterType "${v}". Valid: ${VALID_MASTER_TYPES.join(', ')}` }),
  ),
  rows: z
    .array(z.record(z.string()))
    .min(1, 'At least one row is required')
    .max(5000, 'Maximum 5000 rows per request'),
  fileName: z.string().min(1, 'fileName is required'),
  mode: z.enum(IMPORT_MODES).default('upsert'),
  templateVersion: z.string().optional(),
  manifest: manifestSchema,
})

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function importRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── Helper: HR admin gate ─────────────────────────────────────────────────
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

  // ── GET /import/templates/:masterType ─────────────────────────────────────
  // Returns a CSV download of the import template for the given master type.
  fastify.get('/templates/:masterType', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { masterType } = req.params as { masterType: string }

    if (!VALID_MASTER_TYPES.includes(masterType)) {
      return reply.code(400).send({
        error:   'INVALID_MASTER_TYPE',
        message: `Unknown masterType "${masterType}". Valid: ${VALID_MASTER_TYPES.join(', ')}`,
      })
    }

    if (masterType === 'salary_components') {
      const today = new Date().toISOString().split('T')[0]
      const xlsx  = await generateSalaryComponentsXlsx(today)
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', 'attachment; filename="salary_components_upload.xlsx"')
      return reply.send(xlsx)
    }

    if (masterType === 'employee_salary_upload') {
      const components = await fetchActiveComponents(fastify.supabase, req.tenantId)
      if (components.length === 0) {
        return reply.code(400).send({
          error:   'NO_COMPONENTS',
          message: 'No salary components found. Go to Payroll → Salary Components and create at least one component before downloading the salary upload template.',
        })
      }
      const today = new Date().toISOString().split('T')[0]
      const xlsx  = await generateSalaryUploadXlsx(components, today, req.tenantId, req.userId)
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', 'attachment; filename="employee_salary_upload.xlsx"')
      return reply.send(xlsx)
    }

    const csv = generateCSV(masterType)

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="template-${masterType}.csv"`)
    return reply.send(csv)
  })

  // ── POST /import/validate ─────────────────────────────────────────────────
  // Validate rows without writing to DB. Returns full ValidationResult.
  fastify.post('/validate', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = validateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0].message,
        issues:  parsed.error.issues,
      })
    }

    const { masterType, rows, templateVersion, manifest } = parsed.data

    if (SEEDED_MASTER_TYPES[masterType]) {
      return reply.code(400).send({
        error:   'SEEDED_MASTER',
        message: SEEDED_MASTER_TYPES[masterType],
      })
    }

    if (masterType === 'employee_salary_upload') {
      try {
        const result = await validateSalaryUploadRows(
          fastify.supabase, req.tenantId, rows, templateVersion,
          manifest as SalaryManifest | undefined, req.userId,
        )
        return reply.send({ data: result })
      } catch (err) {
        fastify.log.error(err)
        const msg = err instanceof Error ? err.message : 'Unexpected error during validation'
        if (err instanceof MetadataValidationError) {
          return reply.code(400).send({ error: 'MANIFEST_ERROR', message: msg, code: err.code })
        }
        if (err instanceof ReferenceIntegrityError) {
          return reply.code(400).send({
            error:      'INTEGRITY_ERROR',
            message:    msg,
            code:       err.code,
            violations: err.violations,
          })
        }
        // Plain Error = user-actionable pre-flight failure (e.g. missing salary structure).
        // Non-Error throwables (DB driver crash, OOM) stay as 500.
        if (err instanceof Error) {
          return reply.code(400).send({ error: 'VALIDATION_ERROR', message: msg })
        }
        return reply.code(500).send({ error: 'VALIDATION_ERROR', message: msg })
      }
    }

    try {
      const result = await validateImportRows(
        fastify.supabase,
        req.tenantId,
        masterType,
        rows,
      )
      return reply.send({ data: result })
    } catch (err) {
      fastify.log.error(err)
      return reply.code(500).send({
        error:   'VALIDATION_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected error during validation',
      })
    }
  })

  // ── POST /import/run ──────────────────────────────────────────────────────
  // Run a full import job (validate + write). Returns ImportResult.
  fastify.post('/run', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const parsed = runBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0].message,
        issues:  parsed.error.issues,
      })
    }

    const { masterType, rows, fileName, mode, templateVersion, manifest } = parsed.data

    if (SEEDED_MASTER_TYPES[masterType]) {
      return reply.code(400).send({
        error:   'SEEDED_MASTER',
        message: SEEDED_MASTER_TYPES[masterType],
      })
    }

    // ── Concurrency guard ─────────────────────────────────────────────────
    // Only one active write import per master type per tenant at a time.
    // validate_only jobs are exempt — they make no DB changes.
    // Jobs stuck in an active status for > 30 min are treated as stale/dead
    // and auto-failed so they no longer block new runs.
    if (mode !== 'validate_only') {
      const { data: activeJob } = await fastify.supabase
        .from('import_jobs')
        .select('id, status, created_at')
        .eq('tenant_id', req.tenantId)
        .eq('master_type', masterType)
        .in('status', ['validating', 'importing', 'processing'])
        .maybeSingle()

      if (activeJob) {
        const ageMs = Date.now() - new Date((activeJob as any).created_at).getTime()
        const STUCK_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes
        if (ageMs > STUCK_TIMEOUT_MS) {
          // Mark stale job as failed so it no longer blocks new imports
          await fastify.supabase
            .from('import_jobs')
            .update({ status: 'failed', completed_at: new Date().toISOString() })
            .eq('id', (activeJob as any).id)
          fastify.log.warn({ jobId: (activeJob as any).id }, 'Auto-failed stale import job (stuck > 30 min)')
        } else {
          return reply.code(409).send({
            error:       'IMPORT_ALREADY_RUNNING',
            message:     `A ${masterType} import is already in progress (job ${(activeJob as any).id}). Wait for it to complete or cancel it before starting a new one.`,
            activeJobId: (activeJob as any).id,
          })
        }
      }
    }

    if (masterType === 'employee_salary_upload') {
      let jobId: string
      try {
        jobId = await createImportJob(
          fastify.supabase,
          req.tenantId,
          req.userId,
          masterType,
          mode,
          fileName,
          rows.length,
        )
      } catch (err) {
        fastify.log.error(err)
        return reply.code(500).send({
          error:   'IMPORT_ERROR',
          message: err instanceof Error ? err.message : 'Failed to create import job',
        })
      }
      reply.code(202).send({ data: { importJobId: jobId, status: 'processing' } })
      runSalaryUploadJob(
        fastify.supabase, req.tenantId, req.userId, mode, rows, fileName, jobId,
        templateVersion, manifest as SalaryManifest | undefined,
      ).catch(err => fastify.log.error({ err, jobId }, 'Background salary upload import failed'))
      return
    }

    // Create the job record synchronously so we can return 202 immediately.
    // The actual import runs in the background — Railway's HTTP timeout won't
    // kill large imports because we've already replied.
    let jobId: string
    try {
      jobId = await createImportJob(
        fastify.supabase,
        req.tenantId,
        req.userId,
        masterType,
        mode,
        fileName,
        rows.length,
      )
    } catch (err) {
      fastify.log.error(err)
      return reply.code(500).send({
        error:   'IMPORT_ERROR',
        message: err instanceof Error ? err.message : 'Failed to create import job',
      })
    }

    // Return 202 immediately — client can poll Import History for progress.
    reply.code(202).send({ data: { importJobId: jobId, status: 'processing' } })

    // Process in background (unawaited — response is already sent).
    runImport(
      fastify.supabase,
      req.tenantId,
      req.userId,
      masterType,
      mode,
      rows,
      fileName,
      jobId,
    ).catch(err => fastify.log.error({ err, jobId }, 'Background import failed'))
  })

  // ── GET /import/jobs ──────────────────────────────────────────────────────
  // List import jobs (paginated). Query: ?master_type=&status=&page=&limit=
  fastify.get('/jobs', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const {
      master_type,
      status,
      page  = '1',
      limit = '20',
    } = req.query as Record<string, string>

    const pageNum  = Math.max(1, parseInt(page)  || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20))
    const offset   = (pageNum - 1) * limitNum

    let query = fastify.supabase
      .from('import_jobs')
      .select(
        'id, master_type, mode, file_name, status, total_rows, valid_rows, invalid_rows, created_rows, updated_rows, failed_rows, skipped_rows, duration_ms, created_by, created_at, completed_at',
        { count: 'exact' },
      )
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1)

    if (master_type) query = query.eq('master_type', master_type)
    if (status)      query = query.eq('status', status)

    const { data, error, count } = await query

    if (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({
      data,
      total:  count ?? 0,
      page:   pageNum,
      limit:  limitNum,
    })
  })

  // ── GET /import/jobs/:id ──────────────────────────────────────────────────
  // Job detail + summary statistics.
  fastify.get('/jobs/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data: job, error } = await fastify.supabase
      .from('import_jobs')
      .select('id, master_type, mode, file_name, status, total_rows, valid_rows, invalid_rows, created_rows, updated_rows, failed_rows, skipped_rows, duration_ms, error_summary, warnings, import_options, created_by, created_at, completed_at, started_at')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    // Aggregate error category counts from row-level data
    const { data: rowSummary } = await fastify.supabase
      .from('import_job_rows')
      .select('status')
      .eq('import_job_id', id)

    const statusCounts: Record<string, number> = {}
    for (const r of rowSummary ?? []) {
      const s = r.status as string
      statusCounts[s] = (statusCounts[s] ?? 0) + 1
    }

    return reply.send({
      data: {
        ...job,
        row_status_summary: statusCounts,
      },
    })
  })

  // ── GET /import/jobs/:id/rows ─────────────────────────────────────────────
  // Row-level results, paginated. Query: ?status=failed|created|updated|skipped&page=&limit=
  fastify.get('/jobs/:id/rows', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const {
      status,
      page  = '1',
      limit = '50',
    } = req.query as Record<string, string>

    // Verify job belongs to this tenant
    const { data: job, error: jobErr } = await fastify.supabase
      .from('import_jobs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (jobErr || !job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const pageNum  = Math.max(1, parseInt(page)  || 1)
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 50))
    const offset   = (pageNum - 1) * limitNum

    let query = fastify.supabase
      .from('import_job_rows')
      .select(
        'id, row_number, status, errors, warnings, row_data, normalized_data, record_id',
        { count: 'exact' },
      )
      .eq('import_job_id', id)
      .order('row_number', { ascending: true })
      .range(offset, offset + limitNum - 1)

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query

    if (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({
      data,
      total: count ?? 0,
      page:  pageNum,
      limit: limitNum,
    })
  })

  // ── GET /import/jobs/:id/errors ──────────────────────────────────────────
  // Paginated error list from import_job_errors (enterprise chunked imports).
  // Table may not exist in older DB schemas — returns empty list gracefully.
  // Query: ?stage=validation|write&page=&limit=
  fastify.get('/jobs/:id/errors', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const {
      stage,
      page  = '1',
      limit = '50',
    } = req.query as Record<string, string>

    // Verify job belongs to this tenant
    const { data: job, error: jobErr } = await fastify.supabase
      .from('import_jobs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (jobErr || !job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const pageNum  = Math.max(1, parseInt(page)  || 1)
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 50))
    const offset   = (pageNum - 1) * limitNum

    let query = fastify.supabase
      .from('import_job_errors')
      .select(
        'id, row_number, row_key, error_stage, error_code, error_category, error_message, raw_payload, created_at',
        { count: 'exact' },
      )
      .eq('import_job_id', id)
      .order('row_number', { ascending: true })
      .range(offset, offset + limitNum - 1)

    if (stage) query = query.eq('error_stage', stage)

    const { data, error, count } = await query

    // Table may not exist in older DB schemas — return empty list rather than 500
    if (error) {
      fastify.log.warn({ err: error }, 'import_job_errors query failed — table may not exist yet')
      return reply.send({ data: [], total: 0, page: pageNum, limit: limitNum })
    }

    return reply.send({
      data,
      total: count ?? 0,
      page:  pageNum,
      limit: limitNum,
    })
  })

  // ── GET /import/jobs/:id/metrics ─────────────────────────────────────────
  // Per-chunk timing metrics from import_job_metrics.
  // Table may not exist in older DB schemas — returns empty list gracefully.
  fastify.get('/jobs/:id/metrics', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    // Verify job belongs to this tenant
    const { data: job, error: jobErr } = await fastify.supabase
      .from('import_jobs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (jobErr || !job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    const { data, error } = await fastify.supabase
      .from('import_job_metrics')
      .select('chunk_no, chunk_duration_ms, db_write_ms, rows_per_second, success_count, failure_count, retry_count, recorded_at')
      .eq('import_job_id', id)
      .order('chunk_no', { ascending: true })

    // Table may not exist in older DB schemas — return empty list rather than 500
    if (error) {
      fastify.log.warn({ err: error }, 'import_job_metrics query failed — table may not exist yet')
      return reply.send({ data: [] })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── DELETE /import/jobs/:id ───────────────────────────────────────────────
  // Cancel a pending or validating job.
  fastify.delete('/jobs/:id', auth, async (req: any, reply) => {
    if (!requireHrAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data: job, error: fetchErr } = await fastify.supabase
      .from('import_jobs')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !job) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Import job not found' })
    }

    if (!['pending', 'validating', 'validated', 'importing'].includes(job.status as string)) {
      return reply.code(409).send({
        error:   'CONFLICT',
        message: `Cannot cancel a job with status "${job.status}". Only pending/validating/validated/importing jobs can be cancelled.`,
      })
    }

    const { error: updateErr } = await fastify.supabase
      .from('import_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (updateErr) {
      fastify.log.error(updateErr)
      return reply.code(500).send({ error: 'DB_ERROR', message: updateErr.message })
    }

    return reply.send({ success: true, message: 'Import job cancelled' })
  })
}
