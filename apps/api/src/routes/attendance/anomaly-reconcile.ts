/**
 * POST /attendance/anomalies/reconcile
 *
 * Attendance-daily–driven anomaly reconciliation pass.
 *
 * Scans all UNRESOLVED anomalies for a period (defaults to last 90 days) and
 * auto-resolves any that are CONTRADICTED by the current attendance_daily truth.
 *
 * Contradiction rules:
 *   no_punch   → contradicted when attendance_daily.status is one of:
 *                present, late, half_day, holiday, weekly_off, leave, overtime
 *   missing_out → contradicted when attendance_daily.status is one of the same
 *                  and work_hours > 0 (punch session was eventually completed)
 *   late        → never auto-resolved (may still be factually true)
 *   excessive_hours → never auto-resolved
 *
 * Body (optional):
 *   { from_date: 'YYYY-MM-DD', to_date: 'YYYY-MM-DD' }
 *   Defaults to last 90 days if omitted.
 *
 * Response:
 *   { scanned: N, auto_resolved: N, skipped: N, details: [...] }
 *
 * Protected — hr_admin / super_admin only.
 *
 * ── Design intent ──────────────────────────────────────────────────────────────
 * This endpoint exists because the CSV upload pipeline (recomputeRange) had a
 * silent bug in syncAnomalies: when newAnomalies = [], the delete query used an
 * empty IN clause `.not('type', 'in', '()')` which is a PostgREST no-op.
 * That bug is now fixed in syncAnomalies, but historical anomalies created before
 * the fix still need to be cleaned up.
 *
 * Running this endpoint once after deploying the syncAnomalies fix will clear
 * all stale no_punch anomalies for CSV-sourced employees.
 *
 * Future recomputes will keep anomalies clean automatically via the fixed engine.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { normalizeAttendanceStatus } from '../../lib/attendance-utils.js'

// Statuses that definitively prove attendance happened — no "no punch" is possible
const ATTENDED_STATUSES = new Set<string>([
  'present', 'late', 'half_day', 'holiday', 'weekly_off', 'leave', 'overtime', 'weekend',
])

const bodySchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Dry run — scan and classify without writing. Default false. */
  dry_run:   z.boolean().optional().default(false),
})

export default async function anomalyReconcileRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  fastify.post('/attendance/anomalies/reconcile', auth, async (req: any, reply) => {
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { dry_run } = parsed.data
    const toDate   = parsed.data.to_date   ?? new Date().toISOString().slice(0, 10)
    const fromDate = parsed.data.from_date ?? (() => {
      const d = new Date(`${toDate}T12:00:00.000Z`)
      d.setUTCDate(d.getUTCDate() - 90)
      return d.toISOString().slice(0, 10)
    })()

    req.log.info({ event: 'anomaly_reconcile_start', from_date: fromDate, to_date: toDate, dry_run }, 'anomaly reconciliation pass started')

    // ── Step 1: Fetch all unresolved no_punch / missing_out anomalies ──────────
    const { data: anomalies, error: aErr } = await fastify.supabase
      .from('attendance_anomalies')
      .select('id, employee_id, date, type, tenant_id')
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .in('type', ['no_punch', 'missing_out'])
      .gte('date', fromDate)
      .lte('date', toDate)

    if (aErr) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: aErr.message })
    }

    if (!anomalies || anomalies.length === 0) {
      return reply.send({
        scanned:      0,
        auto_resolved: 0,
        skipped:      0,
        details:      [],
        dry_run,
      })
    }

    // ── Step 2: Batch-fetch attendance_daily for all affected (employee, date) ─
    // Build a set of unique employee_id+date pairs
    type AnomalyRow = { id: string; employee_id: string; date: string; type: string; tenant_id: string }
    const rows = anomalies as AnomalyRow[]

    const employeeIds = [...new Set(rows.map(r => r.employee_id))]
    const { data: dailyRows, error: dErr } = await fastify.supabase
      .from('attendance_daily')
      .select('employee_id, date, status, work_hours')
      .eq('tenant_id', req.tenantId)
      .in('employee_id', employeeIds)
      .gte('date', fromDate)
      .lte('date', toDate)

    if (dErr) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: dErr.message })
    }

    // Build lookup: `${employee_id}:${date}` → daily row
    const dailyMap = new Map<string, { status: string | null; work_hours: number }>()
    for (const d of (dailyRows ?? []) as Array<{ employee_id: string; date: string; status: string; work_hours: number }>) {
      const key = `${d.employee_id}:${d.date}`
      dailyMap.set(key, {
        status:     normalizeAttendanceStatus(d.status),
        work_hours: Number(d.work_hours ?? 0),
      })
    }

    // ── Step 3: Classify each anomaly ─────────────────────────────────────────
    const toResolve: string[] = []
    const details: Array<{
      anomaly_id:  string
      employee_id: string
      date:        string
      type:        string
      daily_status: string | null
      action:      'auto_resolve' | 'keep'
      reason:      string
    }> = []

    for (const anomaly of rows) {
      const key    = `${anomaly.employee_id}:${anomaly.date}`
      const daily  = dailyMap.get(key)
      const status = daily?.status ?? null

      let action:  'auto_resolve' | 'keep' = 'keep'
      let reason = 'no attendance_daily row found'

      if (anomaly.type === 'no_punch') {
        if (status && ATTENDED_STATUSES.has(status)) {
          action = 'auto_resolve'
          reason = `attendance_daily.status = '${status}' — attendance was recorded (CSV or engine)`
        } else if (status) {
          reason = `attendance_daily.status = '${status}' — not an attended status`
        }
      } else if (anomaly.type === 'missing_out') {
        // Auto-resolve missing_out when attendance is present AND work_hours > 0
        // (session was completed retroactively via CSV or correction)
        if (status && ATTENDED_STATUSES.has(status) && (daily?.work_hours ?? 0) > 0) {
          action = 'auto_resolve'
          reason = `attendance_daily.status = '${status}', work_hours = ${daily?.work_hours} — punch session completed`
        } else if (status) {
          reason = `attendance_daily.status = '${status}', work_hours = ${daily?.work_hours} — session may still be open`
        }
      }

      if (action === 'auto_resolve') toResolve.push(anomaly.id)

      details.push({
        anomaly_id:   anomaly.id,
        employee_id:  anomaly.employee_id,
        date:         anomaly.date,
        type:         anomaly.type,
        daily_status: status,
        action,
        reason,
      })
    }

    // ── Step 4: Apply resolution (unless dry_run) ─────────────────────────────
    let actualResolved = 0

    if (!dry_run && toResolve.length > 0) {
      const now = new Date().toISOString()
      const chunkSize = 100  // Supabase IN clause limit
      for (let i = 0; i < toResolve.length; i += chunkSize) {
        const chunk = toResolve.slice(i, i + chunkSize)
        const { error: resolveErr } = await fastify.supabase
          .from('attendance_anomalies')
          .update({
            resolved:    true,
            resolved_by: req.userId,
            resolved_at: now,
            updated_at:  now,
          })
          .in('id', chunk)
          .eq('tenant_id', req.tenantId)
          .eq('resolved', false)

        if (resolveErr) {
          req.log.error({ err: resolveErr, chunk_size: chunk.length }, 'anomaly reconcile bulk-resolve chunk failed')
        } else {
          actualResolved += chunk.length
        }
      }
    }

    req.log.info({
      event:           'anomaly_reconcile_complete',
      from_date:       fromDate,
      to_date:         toDate,
      scanned:         rows.length,
      auto_resolved:   dry_run ? 0 : actualResolved,
      would_resolve:   toResolve.length,
      skipped:         rows.length - toResolve.length,
      dry_run,
    }, 'anomaly reconciliation pass complete')

    return reply.send({
      from_date:     fromDate,
      to_date:       toDate,
      scanned:       rows.length,
      auto_resolved: dry_run ? 0 : actualResolved,
      would_resolve: toResolve.length,
      skipped:       rows.length - toResolve.length,
      dry_run,
      details,
    })
  })
}
