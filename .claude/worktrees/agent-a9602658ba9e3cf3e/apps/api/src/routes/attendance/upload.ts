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
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { recomputeRange }              from '../../lib/attendance-engine.js'

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

/** Build a UTC ISO-8601 timestamp from a YYYY-MM-DD date and a HH:MM[:SS] time. */
function buildTimestamp(date: string, time: string): string {
  return `${date}T${normaliseTime(time)}.000Z`
}

// ── Route ─────────────────────────────────────────────────────────────────────

export default async function attendanceUploadRoute(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.post('/attendance/upload', adminAuth, async (req: any, reply) => {
    const body = req.body as Record<string, unknown>
    const csvContent = body?.csv_content

    if (typeof csvContent !== 'string' || !csvContent.trim()) {
      return reply.code(400).send({
        error:   'MISSING_BODY',
        message: 'csv_content is required and must be a non-empty string',
      })
    }

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

    interface ParsedRow {
      line:          number
      employee_code: string
      date:          string
      in_time:       string
      out_time:      string
      source:        string
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

      // in_time must be before out_time
      if (normaliseTime(in_time) >= normaliseTime(out_time)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `in_time (${in_time}) must be earlier than out_time (${out_time})` })
        continue
      }

      // Duplicate within this CSV
      const dupKey = `${employee_code}::${date}::${in_time}::${out_time}`
      if (seen.has(dupKey)) {
        rowErrors.push({ line: lineNumber, row: rawLine, error: `Duplicate row (same employee_code, date, in_time, out_time already appears earlier in the CSV)` })
        continue
      }
      seen.add(dupKey)

      parsedRows.push({ line: lineNumber, employee_code, date, in_time, out_time, source })
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

      const inAt  = buildTimestamp(row.date, row.in_time)
      const outAt = buildTimestamp(row.date, row.out_time)

      punchRows.push({ tenant_id: req.tenantId, employee_id, punched_at: inAt,  direction: 'IN',  source: row.source })
      punchRows.push({ tenant_id: req.tenantId, employee_id, punched_at: outAt, direction: 'OUT', source: row.source })

      const rKey = `${employee_id}::${row.date}`
      if (!recomputeSet.has(rKey)) {
        recomputeSet.set(rKey, { employee_id, date: row.date })
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

    // ── 7. Fire recomputes (fire-and-forget) ────────────────────────────────
    setImmediate(async () => {
      for (const { employee_id, date } of recomputeSet.values()) {
        try {
          await recomputeRange(fastify.supabase, {
            tenant_id:   req.tenantId,
            employee_id,
            from_date:   date,
            to_date:     date,
            changed_by:  req.userId,
          })
        } catch (err) {
          fastify.log.warn(
            { err, employee_id, date },
            'attendance upload: recompute failed (fire-and-forget)',
          )
        }
      }
    })

    // ── 8. Respond ──────────────────────────────────────────────────────────
    return reply.send({
      total_rows:   dataLines.length,
      success_rows: successRows,
      failed_rows:  allFailedRows,
    })
  })
}
