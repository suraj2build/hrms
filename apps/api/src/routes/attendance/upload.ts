/**
 * POST /attendance/upload
 *
 * Bulk-import attendance from a CSV string.  For each valid row the route:
 *   1. Resolves employee_code → employee_id (batched, one query for all codes)
 *   2. Builds an IN punch and an OUT punch timestamp from date + time columns
 *   3. Upserts both punches into attendance_punch_logs (source = "csv_upload")
 *   4. After all inserts, fires an AttendanceEngine recompute for every
 *      unique (employee_id, date) pair that had at least one punch inserted
 *
 * Body (JSON):
 *   { csv_content: string }   — full text of the uploaded CSV file
 *
 * Required CSV columns: employee_code, date, in_time, out_time
 * Optional CSV column:  source  (defaults to "csv_upload")
 *
 * Response 200:
 *   {
 *     total_rows:   number,
 *     success_rows: number,
 *     failed_rows:  Array<{ line: number; row: string; error: string }>
 *   }
 *
 * Auth: hr_admin / super_admin only.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { createHash }             from 'crypto'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange, localToUtc }  from '../../lib/attendance-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS = ['employee_code', 'date', 'in_time', 'out_time'] as const
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE  = /^\d{2}:\d{2}(:\d{2})?$/
const MAX_ROWS = 2_000

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a CSV line respecting simple double-quote escaping. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

/** Normalise HH:MM or HH:MM:SS → HH:MM:SS. */
function normaliseTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t.slice(0, 8)
}

/** Advance a YYYY-MM-DD string by one calendar day (UTC-safe, same as engine). */
function addOneDay(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── Body schemas ─────────────────────────────────────────────────────────────

const UploadBodySchema = z.object({
  csv_content: z.string().min(1, 'csv_content is required and must be a non-empty string'),
})

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function attendanceUploadRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.post('/attendance/upload', adminAuth, async (req: any, reply) => {
    const parsed = UploadBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const csvContent = parsed.data.csv_content

    // ── 1. Split into lines ─────────────────────────────────────────────────
    const allLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    if (allLines.length < 2) {
      return reply.code(400).send({
        error:   'EMPTY_CSV',
        message: 'CSV must contain a header row and at least one data row',
      })
    }

    // ── 2. Parse + validate header ──────────────────────────────────────────
    const headerLine = allLines[0]
    const headerCols = parseCsvLine(headerLine).map((h) => h.toLowerCase().trim())

    const missingCols = REQUIRED_HEADERS.filter((c) => !headerCols.includes(c))
    if (missingCols.length > 0) {
      return reply.code(400).send({
        error:   'MISSING_COLUMNS',
        message: `Missing required columns: ${missingCols.join(', ')}`,
      })
    }

    const colIdx = {
      employee_code: headerCols.indexOf('employee_code'),
      date:          headerCols.indexOf('date'),
      in_time:       headerCols.indexOf('in_time'),
      out_time:      headerCols.indexOf('out_time'),
      source:        headerCols.indexOf('source'),
    }

    // ── 3. Parse data rows ──────────────────────────────────────────────────
    const dataLines = allLines.slice(1)

    if (dataLines.length > MAX_ROWS) {
      return reply.code(400).send({
        error:   'TOO_MANY_ROWS',
        message: `CSV must contain at most ${MAX_ROWS} data rows (found ${dataLines.length})`,
      })
    }

    // ── 3a. Duplicate-upload detection (B1) ────────────────────────────────
    // Compute SHA-256 of the raw CSV content and check if the same checksum
    // was already uploaded by this tenant in the last 24 hours.
    // This is a WARN-only check — the upload still proceeds; the caller
    // receives a `duplicate_warning` flag in the response so the frontend
    // can surface a confirmation dialog on replay.
    const contentChecksum = createHash('sha256').update(csvContent as string, 'utf8').digest('hex')
    let duplicateWarning: { upload_session_id: string; uploaded_at: string } | null = null

    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: existingUpload } = await fastify.supabase
        .from('upload_sessions')
        .select('id, created_at')
        .eq('tenant_id', req.tenantId)
        .eq('upload_type', 'attendance_csv')
        .eq('content_checksum', contentChecksum)
        .eq('status', 'completed')
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingUpload) {
        duplicateWarning = {
          upload_session_id: (existingUpload as any).id,
          uploaded_at:       (existingUpload as any).created_at,
        }
        req.log.warn(
          { tenant_id: req.tenantId, checksum: contentChecksum, prior_session: (existingUpload as any).id },
          'attendance upload: duplicate CSV detected (same checksum within 24h) — proceeding with replay',
        )
      }
    } catch (checksumErr) {
      // Checksum lookup failure is non-blocking — log and continue
      req.log.warn({ err: checksumErr }, 'attendance upload: checksum duplicate check failed — skipped')
    }

    interface ParsedRow {
      line:            number
      employee_code:   string
      date:            string
      in_time:         string
      out_time:        string
      isCrossMidnight: boolean   // true when out_time < in_time (out punch lands next calendar day)
      source:          string
    }

    const parsedRows: ParsedRow[]                                     = []
    const rowErrors:  Array<{ line: number; row: string; error: string }> = []
    const seen        = new Set<string>()  // deduplicate by (employee_code, date, in_time, out_time)

    for (let i = 0; i < dataLines.length; i++) {
      const lineNumber = i + 2  // 1-indexed; line 1 is the header
      const rawLine    = dataLines[i]
      const fields     = parseCsvLine(rawLine)

      const employee_code = fields[colIdx.employee_code]?.trim() ?? ''
      const date          = fields[colIdx.date]?.trim()          ?? ''
      const in_time       = fields[colIdx.in_time]?.trim()       ?? ''
      const out_time      = fields[colIdx.out_time]?.trim()      ?? ''
      const source        = colIdx.source >= 0
        ? (fields[colIdx.source]?.trim() || 'csv_upload')
        : 'csv_upload'

      // Column presence
      if (!employee_code) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'employee_code is empty' })
        continue
      }
      if (!date) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'date is empty' })
        continue
      }
      if (!in_time) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'in_time is empty' })
        continue
      }
      if (!out_time) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'out_time is empty' })
        continue
      }

      // Format validation
      if (!DATE_RE.test(date)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid date format "${date}" — expected YYYY-MM-DD` })
        continue
      }
      if (!TIME_RE.test(in_time)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid in_time format "${in_time}" — expected HH:MM or HH:MM:SS` })
        continue
      }
      if (!TIME_RE.test(out_time)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid out_time format "${out_time}" — expected HH:MM or HH:MM:SS` })
        continue
      }

      // in_time and out_time must differ.
      // out_time < in_time is valid (cross-midnight / night shift) — out punch lands on the next calendar day.
      if (normaliseTime(in_time) === normaliseTime(out_time)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `in_time and out_time are identical — zero-duration punch is invalid` })
        continue
      }

      // Duplicate within this CSV
      const dupKey = `${employee_code}::${date}::${in_time}::${out_time}`
      if (seen.has(dupKey)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Duplicate row (same employee_code, date, in_time, out_time already appears earlier in the CSV)` })
        continue
      }
      seen.add(dupKey)

      const isCrossMidnight = normaliseTime(out_time) < normaliseTime(in_time)
      parsedRows.push({ line: lineNumber, employee_code, date, in_time, out_time, isCrossMidnight, source })
    }

    if (parsedRows.length === 0) {
      return reply.code(400).send({
        error:       'NO_VALID_ROWS',
        message:     'No valid data rows found after validation',
        total_rows:  dataLines.length,
        success_rows: 0,
        failed_rows: rowErrors,
      })
    }

    // ── 4. Batch resolve employee codes → IDs ───────────────────────────────
    const uniqueCodes = [...new Set(parsedRows.map((r) => r.employee_code))]

    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', req.tenantId)
      .in('employee_code', uniqueCodes)

    if (empErr) {
      req.log.error({ err: empErr }, 'attendance upload: employee lookup failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to resolve employee codes' })
    }

    const codeToId = new Map<string, string>(
      (employees ?? []).map((e: { id: string; employee_code: string }) => [e.employee_code, e.id])
    )

    // ── 4a. Fetch tenant timezone ───────────────────────────────────────────
    // CSV times are in the tenant's LOCAL timezone (e.g. Asia/Kolkata).
    // We must convert them to UTC before storing in attendance_punch_logs
    // (a TIMESTAMPTZ column).  Appending ".000Z" directly — the previous
    // behaviour — treated local times as UTC, shifting every punch by the
    // UTC offset (5 h 30 m for IST) and causing wrong status / LOP outcomes.
    const { data: tenantRow } = await fastify.supabase
      .from('tenants')
      .select('timezone')
      .eq('id', req.tenantId)
      .maybeSingle()
    const tenantTz: string = (tenantRow as { timezone?: string } | null)?.timezone ?? 'UTC'

    // ── 5. Build punch rows, collecting per-row errors ──────────────────────
    interface PunchRow {
      tenant_id:   string
      employee_id: string
      punched_at:  string
      direction:   'IN' | 'OUT'
      source:      string
    }

    const punchRows:    PunchRow[]                                          = []
    const recomputeSet = new Map<string, { employee_id: string; date: string }>()
    const insertErrors: Array<{ line: number; row: string; error: string }> = []

    for (const row of parsedRows) {
      const employee_id = codeToId.get(row.employee_code)
      if (!employee_id) {
        insertErrors.push({
          line:  row.line,
          row:   `${row.employee_code},${row.date},${row.in_time},${row.out_time}`,
          error: `Employee code "${row.employee_code}" not found in this organisation`,
        })
        continue
      }

      // For cross-midnight shifts the OUT punch belongs to the next calendar day.
      const outDate = row.isCrossMidnight ? addOneDay(row.date) : row.date

      // localToUtc converts tenant-local date+time → UTC using the reflection
      // technique (same function the attendance engine uses for all shift math).
      const inAt  = localToUtc(row.date, row.in_time,  tenantTz).toISOString()
      const outAt = localToUtc(outDate,  row.out_time, tenantTz).toISOString()

      punchRows.push({ tenant_id: req.tenantId, employee_id, punched_at: inAt,  direction: 'IN',  source: row.source })
      punchRows.push({ tenant_id: req.tenantId, employee_id, punched_at: outAt, direction: 'OUT', source: row.source })

      // Always recompute the in-punch date.
      const rKey = `${employee_id}::${row.date}`
      if (!recomputeSet.has(rKey)) {
        recomputeSet.set(rKey, { employee_id, date: row.date })
      }
      // For cross-midnight rows also recompute the out-punch date (next day),
      // so the engine can correctly attribute the OUT punch on that date.
      if (row.isCrossMidnight) {
        const rKeyNext = `${employee_id}::${outDate}`
        if (!recomputeSet.has(rKeyNext)) {
          recomputeSet.set(rKeyNext, { employee_id, date: outDate })
        }
      }
    }

    const allFailedRows = [...rowErrors, ...insertErrors]

    if (punchRows.length === 0) {
      return reply.send({
        total_rows:   dataLines.length,
        success_rows: 0,
        failed_rows:  allFailedRows,
      })
    }

    // ── 6. Bulk upsert punch rows ───────────────────────────────────────────
    // UNIQUE constraint: (tenant_id, employee_id, punched_at, direction)
    // ignoreDuplicates = true → existing punches are left untouched; no error raised
    const { error: upsertErr } = await fastify.supabase
      .from('attendance_punch_logs')
      .upsert(punchRows, {
        onConflict:       'tenant_id,employee_id,punched_at,direction',
        ignoreDuplicates: true,
      })

    if (upsertErr) {
      req.log.error({ err: upsertErr, rows: punchRows.length }, 'attendance upload: punch upsert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to insert punch records' })
    }

    const successRows = punchRows.length / 2  // each data row produces 2 punch rows

    req.log.info(
      { tenant_id: req.tenantId, punch_rows: punchRows.length, recompute_targets: recomputeSet.size },
      'attendance upload: punches inserted',
    )

    // ── 7. Recompute attendance_daily — AWAITED + observable ─────────────────
    // Previously fire-and-forget (setImmediate), which meant "uploaded" did not
    // imply "computed": failures were silent and the grid stayed empty. We now
    // await the recompute (bounded parallelism) and surface the counts, so the
    // upload response reflects whether attendance actually materialised.
    const targets = [...recomputeSet.values()]
    let recomputedDays = 0
    let recomputeFailed = 0
    const recomputeErrors: Array<{ employee_id: string; date: string; error: string }> = []
    const CONCURRENCY = 6
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      await Promise.all(batch.map(async ({ employee_id, date }) => {
        try {
          await recomputeRange(fastify.supabase, {
            tenant_id:   req.tenantId,
            employee_id,
            from_date:   date,
            to_date:     date,
            changed_by:  req.userId,
          })
          recomputedDays++
        } catch (err: any) {
          recomputeFailed++
          if (recomputeErrors.length < 20) {
            recomputeErrors.push({ employee_id, date, error: err?.message ?? 'recompute failed' })
          }
          fastify.log.warn({ err, employee_id, date }, 'attendance upload: recompute failed')
        }
      }))
    }
    if (recomputeFailed > 0) {
      fastify.log.error(
        { tenant_id: req.tenantId, recomputed: recomputedDays, failed: recomputeFailed },
        'attendance upload: some recomputes failed — attendance may be incomplete',
      )
    }

    // ── 8. Record upload session audit row (fire-and-forget) ───────────────
    // Inserts a completed upload_sessions record so the observability console
    // and orphan scanner have a full audit trail of every CSV upload.
    // Non-blocking: failure here must never affect the attendance response.
    setImmediate(async () => {
      try {
        await (fastify as any).supabase
          .from('upload_sessions')
          .insert({
            tenant_id:            req.tenantId,
            upload_type:          'attendance_csv',
            status:               'completed',
            file_name:            'attendance_upload.csv',
            file_size:            Buffer.byteLength(csvContent as string, 'utf8'),
            mime_type:            'text/csv',
            bucket:               'employee-files',
            created_by:           req.userId,
            content_checksum:     contentChecksum,
            upload_started_at:    new Date().toISOString(),
            upload_completed_at:  new Date().toISOString(),
            processing_ended_at:  new Date().toISOString(),
            result_summary: {
              total_rows:      dataLines.length,
              success_rows:    successRows,
              failed_rows:     allFailedRows.length,
              is_replay:       duplicateWarning !== null,
            },
          })
      } catch (err) {
        fastify.log.warn(
          { err },
          'attendance upload: failed to write upload_sessions audit row — non-critical',
        )
      }
    })

    // ── 9. Respond ──────────────────────────────────────────────────────────
    return reply.send({
      total_rows:        dataLines.length,
      success_rows:      successRows,
      failed_rows:       allFailedRows,
      duplicate_warning: duplicateWarning,  // non-null = same CSV was uploaded within last 24h
      // Recompute outcome — attendance_daily now materialised synchronously.
      recomputed_days:   recomputedDays,
      recompute_failed:  recomputeFailed,
      recompute_errors:  recomputeErrors,
    })
  })

  // ── GET /attendance/upload-sessions ────────────────────────────────────────
  // Returns recent upload_sessions rows for upload_type = 'attendance_csv'.
  // Used by AttendanceUploadWorkspace to render the Recent Uploads table.
  // Polled every 30 s by the frontend.
  //
  // Query params:
  //   limit  — max rows to return (default 30, max 100)
  //
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
      req.log.error({ err: error }, 'GET /attendance/upload-sessions failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch upload sessions' })
    }

    return reply.send({ data: data ?? [] })
  })
}
