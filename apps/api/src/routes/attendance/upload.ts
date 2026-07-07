/**
 * POST /attendance/upload
 *
 * Async attendance import backed by Supabase Storage.
 *
 * Why storage?  Sending a 500 k-row CSV (~25 MB) as a JSON request body
 * causes ERR_HTTP2_PING_FAILED on Railway before the server can respond,
 * because the proxy drops connections whose body upload exceeds its timeout.
 *
 * Flow:
 *   1. Browser uploads the CSV file directly to the 'attendance-uploads'
 *      Supabase Storage bucket (bypasses Railway entirely).
 *   2. Browser POSTs { storage_path, filename, total_rows } — a tiny body.
 *   3. Server creates a job record, returns 202 { job_id } immediately.
 *   4. Background job downloads from storage, validates, upserts punches,
 *      recomputes attendance_daily, deletes the temp file.
 *   5. Browser polls GET /attendance/upload/jobs/:jobId for live progress.
 *
 * Required CSV columns: employee_code, datetime
 * Optional CSV column:  source  (defaults to "csv_upload")
 *
 * Auth: hr_admin / super_admin only.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { createHash }                        from 'crypto'
import { requireRole, HR_ADMIN_ROLES }       from '../../lib/rbac.js'
import { recomputeRange, localToUtc }        from '../../lib/attendance-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS   = ['employee_code', 'datetime'] as const
const DATETIME_RE        = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})[T ]\d{2}:\d{2}(:\d{2})?$/
const UPSERT_CHUNK       = 1_000
const UPSERT_CONCURRENCY = 10
const ROW_ERRORS_CAP     = 500
const ALLOWED_SOURCES    = new Set(['device','manual','mobile','web','kiosk','regularisation','csv_upload'])
const STORAGE_BUCKET     = 'attendance-uploads'

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
  storage_path: z.string().min(1, 'storage_path is required'),
  filename:     z.string().max(255).optional(),
  total_rows:   z.number().int().positive().optional(),
})

// ── Background job processor ─────────────────────────────────────────────────

interface ProcessJobParams {
  jobId:       string
  tenantId:    string
  userId:      string
  storagePath: string
  filename:    string
}

async function processUploadJob(fastify: FastifyInstance, params: ProcessJobParams) {
  const { jobId, tenantId, userId, storagePath, filename } = params
  const log = fastify.log.child({ upload_job_id: jobId, tenant_id: tenantId })

  const updateJob = async (fields: Record<string, unknown>) => {
    try {
      await fastify.supabase
        .from('attendance_upload_jobs')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', jobId)
    } catch (err) {
      log.warn({ err }, 'upload job: progress update failed — non-critical')
    }
  }

  try {
    await updateJob({ status: 'processing', started_at: new Date().toISOString() })

    // ── 1. Download CSV from Supabase Storage ──────────────────────────────────
    const { data: fileBlob, error: downloadErr } = await fastify.supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath)

    if (downloadErr || !fileBlob) {
      log.error({ err: downloadErr, storage_path: storagePath }, 'upload job: storage download failed')
      await updateJob({ status: 'failed', error: `Failed to read uploaded file from storage: ${downloadErr?.message ?? 'file not found'}`, completed_at: new Date().toISOString() })
      return
    }

    const csvContent = await (fileBlob as Blob).text()
    const checksum   = createHash('sha256').update(csvContent, 'utf8').digest('hex')

    // ── 2. Parse lines + validate header ─────────────────────────────────────
    const allLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (allLines.length < 2) {
      await updateJob({ status: 'failed', error: 'CSV must contain a header row and at least one data row', completed_at: new Date().toISOString() })
      return
    }

    const headerCols  = parseCsvLine(allLines[0]).map((h) => h.toLowerCase().trim())
    const missingCols = REQUIRED_HEADERS.filter((c) => !headerCols.includes(c))
    if (missingCols.length > 0) {
      await updateJob({ status: 'failed', error: `Missing required columns: ${missingCols.join(', ')}`, completed_at: new Date().toISOString() })
      return
    }

    const colIdx = {
      employee_code: headerCols.indexOf('employee_code'),
      datetime:      headerCols.indexOf('datetime'),
      source:        headerCols.indexOf('source'),
    }

    const dataLines = allLines.slice(1)
    const totalRows = dataLines.length

    // Update actual total_rows now that we've parsed the file
    await updateJob({ total_rows: totalRows })

    // ── 3. Parse data rows ─────────────────────────────────────────────────────
    interface ParsedPunch {
      line:          number
      employee_code: string
      datetime:      string
      date:          string
      time:          string
      direction?:    'IN' | 'OUT'
      source:        string
    }

    const parsedPunches: ParsedPunch[]                                    = []
    const rowErrors: Array<{ line: number; row: string; error: string }>  = []
    const seen = new Set<string>()
    let skippedDupeCount = 0

    for (let i = 0; i < dataLines.length; i++) {
      const lineNumber = i + 2
      const rawLine    = dataLines[i]
      const fields     = parseCsvLine(rawLine)

      const employee_code = fields[colIdx.employee_code]?.trim() ?? ''
      const datetime      = fields[colIdx.datetime]?.trim()      ?? ''
      const rawSource = colIdx.source >= 0 ? (fields[colIdx.source]?.trim().toLowerCase() || 'csv_upload') : 'csv_upload'
      const source    = ALLOWED_SOURCES.has(rawSource) ? rawSource : 'csv_upload'

      if (!employee_code) {
        if (rowErrors.length < ROW_ERRORS_CAP) rowErrors.push({ line: lineNumber, row: rawLine, error: 'employee_code is empty' })
        continue
      }
      if (!datetime) {
        if (rowErrors.length < ROW_ERRORS_CAP) rowErrors.push({ line: lineNumber, row: rawLine, error: 'datetime is empty' })
        continue
      }
      if (!DATETIME_RE.test(datetime)) {
        if (rowErrors.length < ROW_ERRORS_CAP) rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid datetime "${datetime}" — expected YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS in tenant local time` })
        continue
      }

      const dupKey = `${employee_code}::${datetime}`
      if (seen.has(dupKey)) {
        skippedDupeCount++
        continue
      }
      seen.add(dupKey)

      const { date, time } = splitDatetime(datetime)
      parsedPunches.push({ line: lineNumber, employee_code, datetime, date, time, source })
    }

    // ── 4. Assign IN/OUT directions ────────────────────────────────────────────
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

    // ── 5. Pre-filter punches in PAYROLL_FINALIZED months ──────────────────────
    {
      const { data: finalizedPeriods, error: lockQueryErr } = await fastify.supabase
        .from('attendance_period_locks')
        .select('period_month')
        .eq('tenant_id', tenantId)
        .eq('state', 'PAYROLL_FINALIZED')

      if (!lockQueryErr) {
        const finalizedMonths = new Set((finalizedPeriods ?? []).map((p: { period_month: string }) => p.period_month))
        if (finalizedMonths.size > 0) {
          const allowed: ParsedPunch[] = []
          for (const punch of parsedPunches) {
            const month = punch.date.slice(0, 7)
            if (finalizedMonths.has(month)) {
              if (rowErrors.length < ROW_ERRORS_CAP)
                rowErrors.push({ line: punch.line, row: `${punch.employee_code},${punch.datetime}`, error: `Skipped — period ${month} is sealed (payroll finalized). Use Period Manager → Reverse Finalization to unlock it first.` })
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
      await updateJob({ status: 'completed', processed_rows: totalRows, success_rows: 0, failed_rows: rowErrors.length, skipped_rows: 0, row_errors: rowErrors, completed_at: new Date().toISOString() })
      return
    }

    // ── 6. Batch resolve employee codes → IDs ──────────────────────────────────
    // Batch in chunks of 400 to stay well under PostgREST URL length limits.
    const uniqueCodes = [...new Set(parsedPunches.map((r) => r.employee_code))]
    const CODE_BATCH  = 400
    const codeToId    = new Map<string, string>()

    for (let ci = 0; ci < uniqueCodes.length; ci += CODE_BATCH) {
      const batch = uniqueCodes.slice(ci, ci + CODE_BATCH)
      const { data: employees, error: empErr } = await fastify.supabase
        .from('employees').select('id, employee_code').eq('tenant_id', tenantId).in('employee_code', batch)

      if (empErr) {
        await updateJob({ status: 'failed', error: `Failed to resolve employee codes: ${empErr.message}`, completed_at: new Date().toISOString() })
        return
      }
      for (const e of (employees ?? []) as { id: string; employee_code: string }[]) {
        codeToId.set(e.employee_code, e.id)
      }
    }

    // ── 7. Fetch tenant timezone ───────────────────────────────────────────────
    const { data: tenantRow } = await fastify.supabase
      .from('tenants').select('timezone').eq('id', tenantId).maybeSingle()
    const tenantTz: string = (tenantRow as { timezone?: string } | null)?.timezone ?? 'UTC'

    // ── 8. Build punch rows ────────────────────────────────────────────────────
    interface PunchRow { tenant_id: string; employee_id: string; punched_at: string; direction: 'IN' | 'OUT'; source: string }

    const punchRows:    PunchRow[] = []
    const recomputeSet = new Map<string, { employee_id: string; date: string }>()

    for (const punch of parsedPunches) {
      const employee_id = codeToId.get(punch.employee_code)
      if (!employee_id) {
        if (rowErrors.length < ROW_ERRORS_CAP)
          rowErrors.push({ line: punch.line, row: `${punch.employee_code},${punch.datetime}`, error: `Employee code "${punch.employee_code}" not found in this organisation` })
        continue
      }
      const punched_at = localToUtc(punch.date, punch.time, tenantTz).toISOString()
      punchRows.push({ tenant_id: tenantId, employee_id, punched_at, direction: punch.direction!, source: punch.source })
      const rKey = `${employee_id}::${punch.date}`
      if (!recomputeSet.has(rKey)) recomputeSet.set(rKey, { employee_id, date: punch.date })
    }

    if (punchRows.length === 0) {
      // If parsedPunches had valid rows but none resolved, the error cap may have been
      // exhausted by earlier validation errors — force a diagnostic so the root cause is visible.
      if (parsedPunches.length > 0) {
        const unmatchedCodes = [...new Set(
          parsedPunches.filter(p => !codeToId.has(p.employee_code)).map(p => p.employee_code)
        )].slice(0, 5)
        if (unmatchedCodes.length > 0) {
          const diagErr =
            `All ${parsedPunches.length.toLocaleString()} valid row(s) failed — employee codes not found in this organisation. ` +
            `First unmatched code(s): ${unmatchedCodes.map(c => `"${c}"`).join(', ')}. ` +
            `Verify codes match exactly in Settings → Employees.`
          rowErrors.push({ line: 0, row: '', error: diagErr })
        }
      }
      await updateJob({ status: 'completed', processed_rows: totalRows, success_rows: 0, failed_rows: rowErrors.length, skipped_rows: skippedDupeCount, row_errors: rowErrors, completed_at: new Date().toISOString() })
      return
    }

    // ── 9. Bulk upsert punch rows (chunked + parallel) ─────────────────────────
    const chunks: typeof punchRows[] = []
    for (let i = 0; i < punchRows.length; i += UPSERT_CHUNK)
      chunks.push(punchRows.slice(i, i + UPSERT_CHUNK))

    let insertedSoFar  = 0
    let lastProgressAt = 0
    const PROGRESS_INTERVAL = 50_000

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
          await updateJob({ status: 'failed', error: `Attendance for ${month} is sealed — payroll has been finalized. Reverse the payroll finalization before uploading punches for that period.`, completed_at: new Date().toISOString() })
          return
        }
        await updateJob({ status: 'failed', error: `Database error while inserting punch records: ${firstErr.message}`, completed_at: new Date().toISOString() })
        return
      }
      for (const chunk of batch) insertedSoFar += chunk.length
      if (insertedSoFar - lastProgressAt >= PROGRESS_INTERVAL || i + UPSERT_CONCURRENCY >= chunks.length) {
        lastProgressAt = insertedSoFar
        await updateJob({ processed_rows: Math.min(insertedSoFar, totalRows) })
      }
    }

    const successRows  = punchRows.length
    const failedCount  = rowErrors.length
    const skippedCount = skippedDupeCount

    log.info({ punch_rows: successRows, recompute_targets: recomputeSet.size }, 'upload job: upserts done — recomputing')

    // ── 10. Recompute attendance_daily ─────────────────────────────────────────
    const recomputeTargets = [...recomputeSet.values()]
    const RECOMPUTE_CONCURRENCY = 8
    for (let i = 0; i < recomputeTargets.length; i += RECOMPUTE_CONCURRENCY) {
      const batch = recomputeTargets.slice(i, i + RECOMPUTE_CONCURRENCY)
      await Promise.all(batch.map(async ({ employee_id, date }) => {
        try {
          await recomputeRange(fastify.supabase, { tenant_id: tenantId, employee_id, from_date: date, to_date: date, changed_by: userId })
        } catch (err: any) {
          log.warn({ err, employee_id, date }, 'upload job: recompute failed for one target')
        }
      }))
    }

    // ── 11. Write upload_sessions audit row ────────────────────────────────────
    try {
      await fastify.supabase.from('upload_sessions').insert({
        tenant_id: tenantId, upload_type: 'attendance_csv', status: 'completed',
        file_name: filename, file_size: Buffer.byteLength(csvContent, 'utf8'),
        mime_type: 'text/csv', bucket: STORAGE_BUCKET, created_by: userId,
        content_checksum: checksum,
        upload_started_at: new Date().toISOString(), upload_completed_at: new Date().toISOString(), processing_ended_at: new Date().toISOString(),
        result_summary: { total_rows: totalRows, success_rows: successRows, failed_rows: failedCount },
      })
    } catch (err) {
      log.warn({ err }, 'upload job: upload_sessions audit failed — non-critical')
    }

    // ── 12. Mark job completed ─────────────────────────────────────────────────
    await updateJob({ status: 'completed', processed_rows: totalRows, success_rows: successRows, failed_rows: failedCount, skipped_rows: skippedCount, row_errors: rowErrors, completed_at: new Date().toISOString() })

    log.info({ success_rows: successRows, failed_rows: failedCount, recompute_targets: recomputeTargets.length }, 'upload job: completed')

    // ── 13. Delete temp file from storage (fire-and-forget) ───────────────────
    fastify.supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => { /* best effort */ })

  } catch (err: any) {
    log.error({ err }, 'upload job: unhandled exception')
    try {
      await fastify.supabase.from('attendance_upload_jobs').update({ status: 'failed', error: err?.message ?? 'Unexpected server error', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', jobId)
    } catch { /* best effort */ }
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function attendanceUploadRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /attendance/upload ──────────────────────────────────────────────────
  // Body is tiny: just a storage path — the large file was already uploaded
  // directly to Supabase Storage by the browser (bypasses Railway).
  fastify.post('/attendance/upload', adminAuth, async (req: any, reply) => {
    try {
      const parsed = UploadBodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
      }

      const { storage_path, filename, total_rows } = parsed.data
      const safeFilename = filename ?? 'attendance_upload.csv'

      // Basic path sanity check — must start with tenant ID to prevent traversal.
      if (!storage_path.startsWith(`${req.tenantId}/`)) {
        return reply.code(400).send({ error: 'INVALID_PATH', message: 'storage_path must be within your tenant folder' })
      }

      // ── Create job record ────────────────────────────────────────────────────
      const { data: jobRow, error: jobErr } = await fastify.supabase
        .from('attendance_upload_jobs')
        .insert({
          tenant_id:    req.tenantId,
          created_by:   req.userId,
          filename:     safeFilename,
          storage_path: storage_path,
          status:       'queued',
          total_rows:   total_rows ?? 0,
        })
        .select('id')
        .single()

      if (jobErr || !jobRow) {
        req.log.error({ err: jobErr }, 'attendance upload: failed to create job record')
        return reply.code(500).send({ error: 'JOB_CREATE_FAILED', message: 'Failed to create upload job' })
      }

      const jobId = (jobRow as { id: string }).id

      // ── Return 202 immediately ────────────────────────────────────────────────
      reply.code(202).send({ job_id: jobId, total_rows: total_rows ?? 0, filename: safeFilename })

      // ── Process in background ─────────────────────────────────────────────────
      setImmediate(() => {
        processUploadJob(fastify, {
          jobId,
          tenantId:    req.tenantId,
          userId:      req.userId,
          storagePath: storage_path,
          filename:    safeFilename,
        }).catch((err) => {
          fastify.log.error({ err, jobId }, 'upload job: processUploadJob threw unexpectedly')
        })
      })
    } catch (err: any) {
      req.log.error({ err }, 'attendance upload: unhandled exception')
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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data)  return reply.code(404).send({ error: 'NOT_FOUND', message: 'Upload job not found' })
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

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? [] })
  })
}
