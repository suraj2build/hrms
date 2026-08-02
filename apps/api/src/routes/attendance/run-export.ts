/**
 * GET /attendance/process/runs/:runId/export
 *
 * Returns a CSV file with the attendance records produced by a specific
 * processing run, plus a skipped-codes section.
 *
 * CSV layout (two sections separated by a blank line):
 *
 *   Section 1 — employee records
 *     employee_id,date,check_in,check_out,work_hours,status
 *     <one row per employee who has an attendance_daily row for that date>
 *     check_in / check_out come from the first log pair of that day
 *
 *   Section 2 — skipped codes (only if present)
 *     (blank line)
 *     skipped_code
 *     BADGE001
 *     BADGE002
 *
 * Protected — requires authenticated user (any role).
 * Tenant-scoped — 404 if the run belongs to a different tenant.
 *
 * Response headers:
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename=attendance-<date>-<runId_prefix>.csv
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

/** Escape a CSV cell value: wrap in quotes if it contains commas, quotes, or newlines */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function csvRow(...cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

export default async function runExportRoute(fastify: FastifyInstance) {
  fastify.get(
    '/attendance/process/runs/:runId/export',
    { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] },
    async (req, reply) => {
      const { runId } = req.params as { runId: string }
      const tenantId  = req.tenantId

      // ── 1. Fetch the run row ──────────────────────────────────────────────────
      const { data: run, error: runError } = await fastify.supabase
        .from('attendance_processing_runs')
        .select('id, date, skipped_codes')
        .eq('tenant_id', tenantId)
        .eq('id', runId)
        .maybeSingle()

      if (runError) {
        return serverError(req, reply, runError, ErrorCode.QUERY_FAILED, 'Could not fetch run')
      }
      if (!run) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Run not found' })
      }

      const date     = run.date as string
      const dayStart = `${date}T00:00:00.000Z`
      const dayEnd   = `${date}T23:59:59.999Z`

      // ── 2. Fetch attendance_daily for that date ───────────────────────────────
      // A single day's rows (one per employee) still exceeds PostgREST's
      // 1,000-row max-rows ceiling for a large tenant — paginate.
      let daily: Array<{ employee_id: string; date: string; work_hours: number; status: string }>
      try {
        daily = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_daily')
            .select('employee_id, date, work_hours, status')
            .eq('tenant_id', tenantId)
            .eq('date', date)
            .order('employee_id', { ascending: true })
            .range(from, to),
        )
      } catch (dailyError) {
        return serverError(req, reply, dailyError, ErrorCode.QUERY_FAILED, 'Could not fetch daily records')
      }

      // ── 3. Fetch attendance_logs for that date ────────────────────────────────
      // We want the first check_in and last check_out per employee for the day.
      // Multiple punches per employee per day can exceed 1,000 rows even faster
      // than attendance_daily — paginate this too.
      let logs: Array<{ employee_id: string; check_in: string | null; check_out: string | null }>
      try {
        logs = await fetchAllRows((from, to) =>
          fastify.supabase
            .from('attendance_logs')
            .select('employee_id, check_in, check_out')
            .eq('tenant_id', tenantId)
            .gte('check_in', dayStart)
            .lte('check_in', dayEnd)
            .order('check_in', { ascending: true })
            .range(from, to),
        )
      } catch (logsError) {
        return serverError(req, reply, logsError, ErrorCode.QUERY_FAILED, 'Could not fetch log entries')
      }

      // ── 4. Build per-employee log summary (first in, last out) ───────────────
      interface LogSummary { firstIn: string | null; lastOut: string | null }
      const logMap = new Map<string, LogSummary>()

      for (const log of (logs ?? []) as { employee_id: string; check_in: string | null; check_out: string | null }[]) {
        const existing = logMap.get(log.employee_id)
        if (!existing) {
          logMap.set(log.employee_id, { firstIn: log.check_in, lastOut: log.check_out ?? null })
        } else {
          // first check_in already correct (logs are ASC)
          // update lastOut to the latest non-null check_out
          if (log.check_out) existing.lastOut = log.check_out
        }
      }

      // ── 5. Build CSV ──────────────────────────────────────────────────────────
      const lines: string[] = []

      // Section 1 header
      lines.push(csvRow('employee_id', 'date', 'check_in', 'check_out', 'work_hours', 'status'))

      // Section 1 rows
      for (const row of (daily ?? []) as { employee_id: string; date: string; work_hours: number; status: string }[]) {
        const logSummary = logMap.get(row.employee_id)
        lines.push(csvRow(
          row.employee_id,
          row.date,
          logSummary?.firstIn ?? null,
          logSummary?.lastOut ?? null,
          row.work_hours,
          row.status,
        ))
      }

      // Section 2 — skipped codes (only if any)
      const skippedCodes: string[] = (run.skipped_codes as string[] | null) ?? []
      if (skippedCodes.length > 0) {
        lines.push('')   // blank separator line
        lines.push('skipped_code')
        for (const code of skippedCodes) {
          lines.push(csvCell(code))
        }
      }

      const csv      = lines.join('\r\n')
      const filename = `attendance-${date}-${runId.slice(0, 8)}.csv`

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv)
    },
  )
}
