/**
 * POST /attendance/upload
 *
 * Bulk-import attendance from a CSV string.  Async job model:
 *   1. Validate CSV header + create a job record → return 202 { job_id }
 *   2. Background job: parse rows, resolve employees, upsert punches,
 *      recompute attendance_daily, write upload_sessions audit row.
 *   3. Callers poll GET /attendance/upload/jobs/:jobId for progress.
 *
 * CSV format (one row = one punch event):
 *   Required columns: employee_code, datetime
 *   Optional column:  source  (defaults to "csv_upload")
 *
 *   datetime: YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS  (tenant local time)
 *             Also accepts ISO separator and DD-MM-YYYY (biometric export).
 *
 * Body (JSON):
 *   { csv_content: string, filename?: string }
 *
 * Response 202: { job_id, total_rows, filename }
 *
 * Auth: hr_admin / super_admin only.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { createHash }             from 'crypto'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange, localToUtc }  from '../../lib/attendance-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS   = ['employee_code', 'datetime'] as const
const DATETIME_RE        = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})[T ]\d{2}:\d{2}(:\d{2})?$/
const UPSERT_CHUNK       = 1_000
const UPSERT_CONCURRENCY = 10
const ROW_ERRORS_CAP     = 500   // max error entries stored in JSONB
const ALLOWED_SOURCES    = new Set(['device','manual','mobile','web','kiosk','regularisation','csv_upload'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function splitDatetime(dt: string): { date: string; time: string } {
  const sep = dt.indexOf('T') !== -1 ? 'T' : ' '
  const [datePart, timePart] = dt.split(sep)
  const time = timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)
  const date = /^\d{2}-\d{2}-\d{4}$/.test(datePart)
    ? datePart.split('-').reverse().join('-')
    : datePart
  return { date, time }
}

// ── Body schema ───────────────────────────────────────────────────────────────

const UploadBodySchema = z.object({
  csv_content: z.string().min(1, 'csv_content is required and must be a non-empty string'),
  filename:    z.string().max(255).optional(),
})

// ── Background job processor ─────────────────────────────────────────────────

interface ProcessJobParams {
  jobId:       string
  tenantId:    string
  userId:      string
  csvContent:  string
  dataLines:   string[]
  colIdx:      { employee_code: number; datetime: number; source: number }
  filename:    string
  checksum:    string
}

async function processUploadJob(fastify: FastifyInstance, params: ProcessJobParams) {
  const { jobId, tenantId, userId, csvContent, dataLines, colIdx, filename, checksum } = params
  const log = fastify.log.child({ upload_job_id: jobId, tenant_id: tenantId })

  const updateJob = async (fields: Record<string, unknown>) => {
    try {
      await fastify.supabase
        .from('attendance_upload_jobs')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', jobId)
    } catch (err) {
      log.warn({ err }, 'upload job: failed to update progress — non-critical')
    }
  }

  try {
    await updateJob({ status: 'processing', started_at: new Date().toISOString() })

    // ── 1. Parse data rows ────────────────────────────────────────────────────
    interface ParsedPunch {
      line:          number
      employee_code: string
      datetime:      string
      date:          string
      time:          string
      direction?:    'IN' | 'OUT'
      source:        string
    }

    const parsedPunches: ParsedPunch[]                                       = []
    const rowErrors: Array<{ line: number; row: string; error: string }>     = []
    const seen       = new Set<string>()

    for (let i = 0; i < dataLines.length; i++) {
      const lineNumber = i + 2
      const rawLine    = dataLines[i]
      const fields     = parseCsvLine(rawLine)

      const employee_code = fields[colIdx.employee_code]?.trim() ?? ''
      const datetime      = fields[colIdx.datetime]?.trim()      ?? ''
      const rawSource = colIdx.source >= 0 ? (fields[colIdx.source]?.trim().toLowerCase() || 'csv_upload') : 'csv_upload'
      const source    = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'csv_upload'

      if (!employee_code) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({ line: lineNumber, row: rawLine, error: 'employee_code is empty' })
        continue
      }
      if (!datetime) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({ line: lineNumber, row: rawLine, error: 'datetime is empty' })
        continue
      }
      if (!DATETIME_RE.test(datetime)) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid datetime "${datetime}" — expected YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS in tenant local time` })
        continue
      }

      const dupKey = `${employee_code}::${datetime}`
      if (seen.has(dupKey)) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({ line: lineNumber, row: rawLine, error: 'Duplicate row (same employee_code + datetime already appears earlier in the CSV)' })
        continue
      }
      seen.add(dupKey)

      const { date, time } = splitDatetime(datetime)
      parsedPunches.push({ line: lineNumber, employee_code, datetime, date, time, source })
    }

    // ── 2. Assign IN/OUT directions ───────────────────────────────────────────
    const dayGroups = new Map<string, ParsedPunch[]>()
    for (const punch of parsedPunches) {
      const key = `${punch.employee_code}::${punch.date}`
      if (!dayGroups.has(key)) dayGroups.set(key, [])
      dayGroups.get(key)!.push(punch)
    }
    for (const [, punches] of dayGroups) {
      punches.sort((a, b) => a.time.localeCompare(b.time))
      const n = punches.length
      punches.forEach((p, i) => {
        if (i === 0)          p.direction = 'IN'
        else if (i === n - 1) p.direction = 'OUT'
        else                  p.direction = i % 2 === 0 ? 'IN' : 'OUT'
      })
    }

    // ── 3. Pre-filter punches in PAYROLL_FINALIZED months ────────────────────
    {
      const { data: finalizedPeriods, error: lockQueryErr } = await fastify.supabase
        .from('attendance_period_locks')
        .select('period_month')
        .eq('tenant_id', tenantId)
        .eq('state', 'PAYROLL_FINALIZED')

      if (!lockQueryErr) {
        const finalizedMonths = new Set(
          (finalizedPeriods ?? []).map((p: { period_month: string }) => p.period_month)
        )
        if (finalizedMonths.size > 0) {
          const allowed: ParsedPunch[] = []
          for (const punch of parsedPunches) {
            const month = punch.date.slice(0, 7)
            if (finalizedMonths.has(month)) {
              if (rowErrors.length < ROW_ERRORS_CAP)
                rowErrors.push({
                  line:  punch.line,
                  row:   `${punch.employee_code},${punch.datetime}`,
                  error: `Skipped — period ${month} is sealed (payroll finalized). Use Period Manager → Reverse Finalization to unlock it first.`,
                })
            } else {
              allowed.push(punch)
            }
          }
          parsedPunches.length = 0
          parsedPunches.push(...allowed)
        }
      }
    }

    if (parsedPunches.length === 0) {
      await updateJob({
        status:        'completed',
        processed_rows: dataLines.length,
        success_rows:   0,
        failed_rows:    rowErrors.length,
        skipped_rows:   0,
        row_errors:     rowErrors,
        completed_at:   new Date().toISOString(),
      })
      return
    }

    // ── 4. Batch resolve employee codes → IDs ─────────────────────────────────
    const uniqueCodes = [...new Set(parsedPunches.map((r) => r.employee_code))]
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', tenantId)
      .in('employee_code', uniqueCodes)

    if (empErr) {
      log.error({ err: empErr }, 'upload job: employee lookup failed')
      await updateJob({ status: 'failed', error: 'Failed to resolve employee codes', completed_at: new Date().toISOString() })
      return
    }

    const codeToId = new Map<string, string>(
      (employees ?? []).map((e: { id: string; employee_code: string }) => [e.employee_code, e.id])
    )

    // ── 5. Fetch tenant timezone ───────────────────────────────────────────────
    const { data: tenantRow } = await fastify.supabase
      .from('tenants').select('timezone').eq('id', tenantId).maybeSingle()
    const tenantTz: string = (tenantRow as { timezone?: string } | null)?.timezone ?? 'UTC'

    // ── 6. Build punch rows ───────────────────────────────────────────────────
    interface PunchRow { tenant_id: string; employee_id: string; punched_at: string; direction: 'IN' | 'OUT'; source: string }

    const punchRows:    PunchRow[] = []
    const recomputeSet = new Map<string, { employee_id: string; date: string }>()

    for (const punch of parsedPunches) {
      const employee_id = codeToId.get(punch.employee_code)
      if (!employee_id) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({
            line:  punch.line,
            row:   `${punch.employee_code},${punch.datetime}`,
            error: `Employee code "${punch.employee_code}" not found in this organisation`,
          })
        continue
      }
      const punched_at = localToUtc(punch.date, punch.time, tenantTz).toISOString()
      punchRows.push({ tenant_id: tenantId, employee_id, punched_at, direction: punch.direction!, source: punch.source })
      const rKey = `${employee_id}::${punch.date}`
      if (!recomputeSet.has(rKey)) recomputeSet.set(rKey, { employee_id, date: punch.date })
    }

    if (punchRows.length === 0) {
      await updateJob({
        status:         'completed',
        processed_rows: dataLines.length,
        success_rows:   0,
        failed_rows:    rowErrors.length,
        skipped_rows:   0,
        row_errors:     rowErrors,
        completed_at:   new Date().toISOString(),
      })
      return
    }

    // ── 7. Bulk upsert punch rows (chunked + parallel) ────────────────────────
    const chunks: typeof punchRows[] = []
    for (let i = 0; i < punchRows.length; i += UPSERT_CHUNK)
      chunks.push(punchRows.slice(i, i + UPSERT_CHUNK))

    let insertedSoFar  = 0
    let lastProgressAt = 0
    const PROGRESS_INTERVAL = 50_000  // update DB every ~50k rows inserted

    for (let i = 0; i < chunks.length; i += UPSERT_CONCURRENCY) {
      const batch = chunks.slice(i, i + UPSERT_CONCURRENCY)
      const results = await Promise.all(
        batch.map((chunk) =>
          fastify.supabase
            .from('attendance_punch_logs')
            .upsert(chunk, { onConflict: 'tenant_id,employee_id,punched_at,direction', ignoreDuplicates: true })
        )
      )
      const firstErr = results.find((r) => r.error)?.error
      if (firstErr) {
        log.error({ err: firstErr, chunk_offset: i }, 'upload job: punch upsert failed')
        if ((firstErr.message ?? '').includes('PERIOD_FINALIZED')) {
          const monthMatch = (firstErr.message ?? '').match(/PERIOD_FINALIZED:\s*attendance for (\S+)/)
          const month = monthMatch?.[1] ?? 'this period'
          await updateJob({
            status:       'failed',
            error:        `Attendance for ${month} is sealed — payroll has been finalized. Reverse the payroll finalization before uploading punches for that period.`,
            completed_at: new Date().toISOString(),
          })
          return
        }
        await updateJob({
          status:       'failed',
          error:        `Database error while inserting punch records: ${firstErr.message}`,
          completed_at: new Date().toISOString(),
        })
        return
      }

      for (const chunk of batch) insertedSoFar += chunk.length

      if (insertedSoFar - lastProgressAt >= PROGRESS_INTERVAL || i + UPSERT_CONCURRENCY >= chunks.length) {
        lastProgressAt = insertedSoFar
        await updateJob({ processed_rows: Math.min(insertedSoFar, dataLines.length) })
      }
    }

    const successRows  = punchRows.length
    const failedCount  = rowErrors.length
    const skippedCount = dataLines.length - successRows - failedCount

    log.info({ punch_rows: successRows, recompute_targets: recomputeSet.size }, 'upload job: upserts done — recomputing')

    // ── 8. Recompute attendance_daily ─────────────────────────────────────────
    const recomputeTargets = [...recomputeSet.values()]
    const RECOMPUTE_CONCURRENCY = 8
    for (let i = 0; i < recomputeTargets.length; i += RECOMPUTE_CONCURRENCY) {
      const batch = recomputeTargets.slice(i, i + RECOMPUTE_CONCURRENCY)
      await Promise.all(batch.map(async ({ employee_id, date }) => {
        try {
          await recomputeRange(fastify.supabase, {
            tenant_id:   tenantId,
            employee_id,
            from_date:   date,
            to_date:     date,
            changed_by:  userId,
          })
        } catch (err: any) {
          log.warn({ err, employee_id, date }, 'upload job: recompute failed for one target')
        }
      }))
    }

    // ── 9. Write upload_sessions audit row ────────────────────────────────────
    try {
      await fastify.supabase.from('upload_sessions').insert({
        tenant_id:            tenantId,
        upload_type:          'attendance_csv',
        status:               'completed',
        file_name:            filename,
        file_size:            Buffer.byteLength(csvContent, 'utf8'),
        mime_type:            'text/csv',
        bucket:               'employee-files',
        created_by:           userId,
        content_checksum:     checksum,
        upload_started_at:    new Date().toISOString(),
        upload_completed_at:  new Date().toISOString(),
        processing_ended_at:  new Date().toISOString(),
        result_summary: {
          total_rows:   dataLines.length,
          success_rows: successRows,
          failed_rows:  failedCount,
        },
      })
    } catch (err) {
      log.warn({ err }, 'upload job: failed to write upload_sessions audit row — non-critical')
    }

    // ── 10. Mark job as completed ─────────────────────────────────────────────
    await updateJob({
      status:         'completed',
      processed_rows: dataLines.length,
      success_rows:   successRows,
      failed_rows:    failedCount,
      skipped_rows:   Math.max(0, skippedCount),
      row_errors:     rowErrors,
      completed_at:   new Date().toISOString(),
    })

    log.info({ success_rows: successRows, failed_rows: failedCount, recompute_targets: recomputeTargets.length }, 'upload job: completed')
  } catch (err: any) {
    log.error({ err }, 'upload job: unhandled exception')
    try {
      await fastify.supabase
        .from('attendance_upload_jobs')
        .update({
          status:       'failed',
          error:        err?.message ?? 'Unexpected server error',
          completed_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        .eq('id', jobId)
    } catch { /* best effort */ }
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function attendanceUploadRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /attendance/upload ──────────────────────────────────────────────────
  fastify.post('/attendance/upload', { ...adminAuth, bodyLimit: 50 * 1024 * 1024 }, async (req: any, reply) => {
    try {
      const parsed = UploadBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
      }
      const csvContent = parsed.data.csv_content
      const filename   = parsed.data.filename ?? 'attendance_upload.csv'

      // ── 1. Split lines ───────────────────────────────────────────────────────
      const allLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (allLines.length < 2) {
        return reply.code(400).send({
          error:   'EMPTY_CSV',
          message: 'CSV must contain a header row and at least one data row',
        })
      }

      // ── 2. Validate header ───────────────────────────────────────────────────
      const headerCols = parseCsvLine(allLines[0]).map((h) => h.toLowerCase().trim())
      const missingCols = REQUIRED_HEADERS.filter((c) => !headerCols.includes(c))
      if (missingCols.length > 0) {
        return reply.code(400).send({
          error:   'MISSING_COLUMNS',
          message: `Missing required columns: ${missingCols.join(', ')}. Required: employee_code, datetime`,
        })
      }

      const colIdx = {
        employee_code: headerCols.indexOf('employee_code'),
        datetime:      headerCols.indexOf('datetime'),
        source:        headerCols.indexOf('source'),
      }

      const dataLines  = allLines.slice(1)
      const totalRows  = dataLines.length
      const checksum   = createHash('sha256').update(csvContent, 'utf8').digest('hex')

      // ── 3. Create job record ─────────────────────────────────────────────────
      const { data: jobRow, error: jobErr } = await fastify.supabase
        .from('attendance_upload_jobs')
        .insert({
          tenant_id:  req.tenantId,
          created_by: req.userId,
          filename,
          status:     'queued',
          total_rows: totalRows,
        })
        .select('id')
        .single()

      if (jobErr || !jobRow) {
        req.log.error({ err: jobErr }, 'attendance upload: failed to create job record')
        return reply.code(500).send({ error: 'JOB_CREATE_FAILED', message: 'Failed to create upload job' })
      }

      const jobId = (jobRow as { id: string }).id

      // ── 4. Reply 202 immediately ─────────────────────────────────────────────
      reply.code(202).send({ job_id: jobId, total_rows: totalRows, filename })

      // ── 5. Process in background ─────────────────────────────────────────────
      setImmediate(() => {
        processUploadJob(fastify, {
          jobId,
          tenantId:   req.tenantId,
          userId:     req.userId,
          csvContent,
          dataLines,
          colIdx,
          filename,
          checksum,
        }).catch((err) => {
          fastify.log.error({ err, jobId }, 'upload job: processUploadJob threw unexpectedly')
        })
      })
    } catch (err: any) {
      req.log.error({ err }, 'attendance upload: unhandled exception in handler')
      return reply.code(500).send({ error: 'UPLOAD_ERROR', message: 'Upload failed due to an unexpected error. Please try again.' })
    }
  })

  // ── GET /attendance/upload/jobs/:jobId ───────────────────────────────────────
  fastify.get('/attendance/upload/jobs/:jobId', adminAuth, async (req: any, reply) => {
    const { jobId } = req.params as { jobId: string }

    const { data, error } = await fastify.supabase
      .from('attendance_upload_jobs')
      .select('id, status, total_rows, processed_rows, success_rows, failed_rows, skipped_rows, row_errors, error, created_at, started_at, completed_at')
      .eq('id', jobId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) {
      req.log.error({ err: error }, 'upload job: query failed')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload job not found' })
    }
    return reply.send(data)
  })

  // ── GET /attendance/upload-sessions ─────────────────────────────────────────
  fastify.get('/attendance/upload-sessions', adminAuth, async (req: any, reply) => {
    const rawLimit  = Number((req.query as Record<string, string>)?.limit ?? 30)
    const pageLimit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 30), 100)

    const { data, error } = await fastify.supabase
      .from('upload_sessions')
      .select('id, status, file_name, file_size, created_at, updated_at, result_summary, content_checksum')
      .eq('tenant_id', req.tenantId)
      .eq('upload_type', 'attendance_csv')
      .order('created_at', { ascending: false })
      .limit(pageLimit)

    if (error) {
      fastify.log.error({ err: error }, 'attendance upload-sessions: query failed')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.send({ data: data ?? [] })
  })
}
