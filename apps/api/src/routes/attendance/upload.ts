/**
 * POST /attendance/upload
 *
 * Bulk-import attendance from a CSV string.  New single-datetime format:
 *   Each row is ONE punch event (employee_code + datetime).
 *   The server groups punches by (employee_id, calendar-date), sorts by time,
 *   and assigns direction automatically: 1st=IN, 2nd=OUT, 3rd=IN, 4th=OUT…
 *
 * For each resolved punch the route:
 *   1. Resolves employee_code → employee_id (batched, one query for all codes)
 *   2. Groups punches by (employee_id, date), sorts by time, assigns IN/OUT
 *   3. Upserts punches into attendance_punch_logs (source = "csv_upload")
 *   4. Recomputes attendance_daily for every (employee_id, date) affected
 *
 * Body (JSON):
 *   { csv_content: string }   — full text of the uploaded CSV file
 *
 * Required CSV columns: employee_code, datetime
 * Optional CSV column:  source  (defaults to "csv_upload")
 *
 * datetime format: YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS  (tenant local time)
 *                  Also accepts ISO separator: YYYY-MM-DDTHH:MM[:SS]
 *
 * Response 200: { total_rows, success_rows, failed_rows, recomputed_days, … }
 *
 * Auth: hr_admin / super_admin only.
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { createHash }             from 'crypto'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange, localToUtc }  from '../../lib/attendance-engine.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS = ['employee_code', 'datetime'] as const
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/
const MAX_ROWS = 5_000

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

/**
 * Extract date (YYYY-MM-DD) and normalised time (HH:MM:SS) from a datetime string.
 * Accepts: "YYYY-MM-DD HH:MM", "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DDTHH:MM[:SS]"
 */
function splitDatetime(dt: string): { date: string; time: string } {
  const sep = dt.indexOf('T') !== -1 ? 'T' : ' '
  const [datePart, timePart] = dt.split(sep)
  const time = timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8)
  return { date: datePart, time }
}

// ── Body schema ───────────────────────────────────────────────────────────────

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
        message: `Missing required columns: ${missingCols.join(', ')}. Required: employee_code, datetime`,
      })
    }

    const colIdx = {
      employee_code: headerCols.indexOf('employee_code'),
      datetime:      headerCols.indexOf('datetime'),
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

    // ── 3a. Duplicate-upload detection ─────────────────────────────────────
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
      req.log.warn({ err: checksumErr }, 'attendance upload: checksum duplicate check failed — skipped')
    }

    interface ParsedPunch {
      line:          number
      employee_code: string
      datetime:      string
      date:          string
      time:          string
      direction?:    'IN' | 'OUT'
      source:        string
    }

    const parsedPunches: ParsedPunch[]                                          = []
    const rowErrors:     Array<{ line: number; row: string; error: string }>    = []
    const seen           = new Set<string>()  // dedup by (employee_code, datetime)

    for (let i = 0; i < dataLines.length; i++) {
      const lineNumber = i + 2
      const rawLine    = dataLines[i]
      const fields     = parseCsvLine(rawLine)

      const employee_code = fields[colIdx.employee_code]?.trim() ?? ''
      const datetime      = fields[colIdx.datetime]?.trim()      ?? ''
      const source        = colIdx.source >= 0
        ? (fields[colIdx.source]?.trim() || 'csv_upload')
        : 'csv_upload'

      if (!employee_code) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'employee_code is empty' })
        continue
      }
      if (!datetime) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'datetime is empty' })
        continue
      }
      if (!DATETIME_RE.test(datetime)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Invalid datetime "${datetime}" — expected YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS in tenant local time` })
        continue
      }

      const dupKey = `${employee_code}::${datetime}`
      if (seen.has(dupKey)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: 'Duplicate row (same employee_code + datetime already appears earlier in the CSV)' })
        continue
      }
      seen.add(dupKey)

      const { date, time } = splitDatetime(datetime)
      parsedPunches.push({ line: lineNumber, employee_code, datetime, date, time, source })
    }

    if (parsedPunches.length === 0) {
      return reply.code(400).send({
        error:        'NO_VALID_ROWS',
        message:      'No valid data rows found after validation',
        total_rows:   dataLines.length,
        success_rows: 0,
        failed_rows:  rowErrors,
      })
    }

    // ── 4. Assign IN/OUT directions ─────────────────────────────────────────
    // Group by (employee_code, date), sort by time, assign alternately: 1st=IN, 2nd=OUT…
    const dayGroups = new Map<string, ParsedPunch[]>()
    for (const punch of parsedPunches) {
      const key = `${punch.employee_code}::${punch.date}`
      if (!dayGroups.has(key)) dayGroups.set(key, [])
      dayGroups.get(key)!.push(punch)
    }
    for (const [, punches] of dayGroups) {
      punches.sort((a, b) => a.time.localeCompare(b.time))
      punches.forEach((p, i) => { p.direction = i % 2 === 0 ? 'IN' : 'OUT' })
    }

    // ── 5. Batch resolve employee codes → IDs ───────────────────────────────
    const uniqueCodes = [...new Set(parsedPunches.map((r) => r.employee_code))]

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

    // ── 5a. Fetch tenant timezone ───────────────────────────────────────────
    const { data: tenantRow } = await fastify.supabase
      .from('tenants')
      .select('timezone')
      .eq('id', req.tenantId)
      .maybeSingle()
    const tenantTz: string = (tenantRow as { timezone?: string } | null)?.timezone ?? 'UTC'

    // ── 6. Build punch rows ─────────────────────────────────────────────────
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

    for (const punch of parsedPunches) {
      const employee_id = codeToId.get(punch.employee_code)
      if (!employee_id) {
        insertErrors.push({
          line:  punch.line,
          row:   `${punch.employee_code},${punch.datetime}`,
          error: `Employee code "${punch.employee_code}" not found in this organisation`,
        })
        continue
      }

      const punched_at = localToUtc(punch.date, punch.time, tenantTz).toISOString()

      punchRows.push({
        tenant_id:   req.tenantId,
        employee_id,
        punched_at,
        direction:   punch.direction!,
        source:      punch.source,
      })

      const rKey = `${employee_id}::${punch.date}`
      if (!recomputeSet.has(rKey)) {
        recomputeSet.set(rKey, { employee_id, date: punch.date })
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

    // ── 7. Bulk upsert punch rows ───────────────────────────────────────────
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

    const successRows = punchRows.length

    req.log.info(
      { tenant_id: req.tenantId, punch_rows: punchRows.length, recompute_targets: recomputeSet.size },
      'attendance upload: punches inserted',
    )

    // ── 8. Recompute attendance_daily ───────────────────────────────────────
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

    // ── 9. Audit upload session (fire-and-forget) ───────────────────────────
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
              total_rows:   dataLines.length,
              success_rows: successRows,
              failed_rows:  allFailedRows.length,
              is_replay:    duplicateWarning !== null,
            },
          })
      } catch (err) {
        fastify.log.warn({ err }, 'attendance upload: failed to write upload_sessions audit row — non-critical')
      }
    })

    // ── 10. Respond ─────────────────────────────────────────────────────────
    return reply.send({
      total_rows:        dataLines.length,
      success_rows:      successRows,
      failed_rows:       allFailedRows,
      duplicate_warning: duplicateWarning,
      recomputed_days:   recomputedDays,
      recompute_failed:  recomputeFailed,
      recompute_errors:  recomputeErrors,
    })
  })

  // ── GET /attendance/upload-sessions ────────────────────────────────────────
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
