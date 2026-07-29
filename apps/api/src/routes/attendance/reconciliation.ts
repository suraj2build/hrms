/**
 * Attendance Reconciliation API
 *
 * POST /attendance/reconciliation/run
 *   Trigger a reconciliation scan for a date range.
 *   Returns run metadata immediately; issues are queryable via the runs/:id endpoint.
 *
 * GET  /attendance/reconciliation/runs
 *   List reconciliation runs for the tenant (paginated, newest first).
 *
 * GET  /attendance/reconciliation/runs/:id
 *   Get a single run with its full issue list.
 *
 * GET  /attendance/reconciliation/runs/:id/issues
 *   Paginated issue list for a run (filterable by type, severity, resolved).
 *
 * PATCH /attendance/reconciliation/issues/:id/resolve
 *   Mark an issue as resolved (operator acknowledgement).
 *
 * GET  /attendance/reconciliation/open
 *   All unresolved issues across the tenant (latest run per type).
 *   Used by the operational dashboard.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { runAttendanceReconciliation } from '../../lib/attendance-reconciliation.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

export default async function attendanceReconciliationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // Only hr_admin / super_admin can trigger or view reconciliation
  function assertAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
      return false
    }
    return true
  }

  // ── POST /attendance/reconciliation/run ────────────────────────────────────
  fastify.post('/attendance/reconciliation/run', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const schema = z.object({
      scan_from: z.string().regex(dateRe, 'scan_from must be YYYY-MM-DD'),
      scan_to:   z.string().regex(dateRe, 'scan_to must be YYYY-MM-DD'),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { scan_from, scan_to } = parsed.data
    if (scan_from > scan_to) {
      return reply.code(400).send({ error: 'INVALID_RANGE', message: 'scan_from must be ≤ scan_to' })
    }

    // Cap range to 90 days to prevent runaway scans
    const fromD = new Date(scan_from)
    const toD   = new Date(scan_to)
    const dayDiff = Math.ceil((toD.getTime() - fromD.getTime()) / 86_400_000)
    if (dayDiff > 90) {
      return reply.code(400).send({ error: 'RANGE_TOO_LARGE', message: 'Maximum reconciliation range is 90 days' })
    }

    try {
      const result = await runAttendanceReconciliation(
        fastify.supabase,
        req.tenantId,
        scan_from,
        scan_to,
        req.userId,
        'api',
      )
      return reply.code(201).send({ data: result })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Reconciliation run failed')
    }
  })

  // ── GET /attendance/reconciliation/runs ────────────────────────────────────
  fastify.get('/attendance/reconciliation/runs', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const querySchema = z.object({
      limit:  z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset } = parsed.data

    const { data, error, count } = await fastify.supabase
      .from('attendance_reconciliation_runs')
      .select(
        'id, status, scan_from, scan_to, started_at, completed_at, duration_ms, ' +
        'total_issues, critical_count, error_count, warning_count, issue_breakdown, trigger_source',
        { count: 'exact' }
      )
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation runs')
    }
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /attendance/reconciliation/runs/:id ────────────────────────────────
  fastify.get('/attendance/reconciliation/runs/:id', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data: run, error } = await fastify.supabase
      .from('attendance_reconciliation_runs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !run) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Reconciliation run not found' })
    }
    return reply.send({ data: run })
  })

  // ── GET /attendance/reconciliation/runs/:id/issues ─────────────────────────
  fastify.get('/attendance/reconciliation/runs/:id/issues', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const querySchema = z.object({
      limit:      z.coerce.number().int().min(1).max(500).default(100),
      offset:     z.coerce.number().int().min(0).default(0),
      issue_type: z.string().optional(),
      severity:   z.enum(['info', 'warning', 'error', 'critical']).optional(),
      resolved:   z.enum(['true', 'false']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, offset, issue_type, severity, resolved } = parsed.data

    // Verify run belongs to tenant
    const { data: run, error: runError } = await fastify.supabase
      .from('attendance_reconciliation_runs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (runError || !run) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Reconciliation run not found' })
    }

    let q = fastify.supabase
      .from('attendance_reconciliation_issues')
      .select(
        'id, issue_type, severity, employee_id, date, detail, suggestion, resolved, resolved_at, resolution_note, created_at',
        { count: 'exact' }
      )
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .order('severity', { ascending: true })  // critical first
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (issue_type) q = q.eq('issue_type', issue_type)
    if (severity)   q = q.eq('severity', severity)
    if (resolved !== undefined) q = q.eq('resolved', resolved === 'true')

    const { data, error, count } = await q
    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation issues')
    }
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── PATCH /attendance/reconciliation/issues/:id/resolve ────────────────────
  fastify.patch('/attendance/reconciliation/issues/:id/resolve', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const schema = z.object({
      resolution_note: z.string().max(500).optional(),
    })
    const parsed = schema.safeParse(req.body ?? {})
    const resolution_note = parsed.success ? parsed.data.resolution_note : undefined

    const { data, error } = await fastify.supabase
      .from('attendance_reconciliation_issues')
      .update({
        resolved:         true,
        resolved_at:      new Date().toISOString(),
        resolved_by:      req.userId,
        resolution_note:  resolution_note ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, issue_type, resolved_at')
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Issue not found' })
    }
    return reply.send({ data, message: 'Issue marked as resolved' })
  })

  // ── GET /attendance/reconciliation/open ────────────────────────────────────
  // Unresolved issues across all runs — used by operational dashboard.
  fastify.get('/attendance/reconciliation/open', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const querySchema = z.object({
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, severity } = parsed.data

    let q = fastify.supabase
      .from('attendance_reconciliation_issues')
      .select(
        'id, run_id, issue_type, severity, employee_id, date, detail, suggestion, created_at',
        { count: 'exact' }
      )
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .order('severity', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (severity) q = q.eq('severity', severity)

    const { data, error, count } = await q
    if (error) {
      // Table may not exist yet (migration pending) — return empty rather than crashing the dashboard
      const isMissing = error.message?.includes('does not exist') || (error as any).code === 'PGRST116'
      if (isMissing) {
        req.log.warn({ err: error }, 'attendance_reconciliation_issues table missing — run migration 182')
        return reply.send({ data: [], total: 0, by_type: {}, by_severity: {} })
      }
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch open reconciliation issues')
    }

    // Summary by type
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const iss of (data ?? []) as any[]) {
      byType[iss.issue_type] = (byType[iss.issue_type] ?? 0) + 1
      bySeverity[iss.severity] = (bySeverity[iss.severity] ?? 0) + 1
    }

    return reply.send({
      data:        data ?? [],
      total:       count ?? 0,
      by_type:     byType,
      by_severity: bySeverity,
    })
  })
}
