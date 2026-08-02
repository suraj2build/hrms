/**
 * Leave Reconciliation API
 *
 * POST /leave/reconciliation/run
 *   Trigger a leave balance reconciliation for a given year.
 *
 * GET  /leave/reconciliation/runs
 *   List runs (newest first, paginated).
 *
 * GET  /leave/reconciliation/runs/:id
 *   Single run with summary.
 *
 * GET  /leave/reconciliation/runs/:id/issues
 *   Paginated issue list (filterable by type, severity, resolved).
 *
 * PATCH /leave/reconciliation/issues/:id/resolve
 *   Mark an issue as resolved.
 *
 * GET  /leave/reconciliation/open
 *   All unresolved issues across tenant (operational dashboard feed).
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { runLeaveReconciliation } from '../../lib/leave-reconciliation.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function leaveReconciliationRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function assertAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'hr_admin or super_admin required' })
      return false
    }
    return true
  }

  // ── POST /leave/reconciliation/run ─────────────────────────────────────────
  fastify.post('/leave/reconciliation/run', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const schema = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    try {
      const result = await runLeaveReconciliation(
        fastify.supabase,
        req.tenantId,
        parsed.data.year,
        req.userId,
        'api',
      )
      return reply.code(201).send({ data: result })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to run leave reconciliation')
    }
  })

  // ── GET /leave/reconciliation/runs ─────────────────────────────────────────
  fastify.get('/leave/reconciliation/runs', auth, async (req: any, reply) => {
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
      .from('leave_reconciliation_runs')
      .select(
        'id, status, reconcile_year, started_at, completed_at, duration_ms, ' +
        'total_employees, drifted_employees, total_issues, issue_breakdown, trigger_source',
        { count: 'exact' }
      )
      .eq('tenant_id', req.tenantId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation runs')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── GET /leave/reconciliation/runs/:id ─────────────────────────────────────
  fastify.get('/leave/reconciliation/runs/:id', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('leave_reconciliation_runs')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Reconciliation run not found' })
    }
    return reply.send({ data })
  })

  // ── GET /leave/reconciliation/runs/:id/issues ──────────────────────────────
  fastify.get('/leave/reconciliation/runs/:id/issues', auth, async (req: any, reply) => {
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
    const { data: run } = await fastify.supabase
      .from('leave_reconciliation_runs')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (!run) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Reconciliation run not found' })
    }

    let q = fastify.supabase
      .from('leave_reconciliation_issues')
      .select(
        'id, issue_type, severity, employee_id, leave_type_id, year, ' +
        'ledger_sum, balance_value, drift_days, detail, suggestion, ' +
        'resolved, resolved_at, resolution_note, created_at',
        { count: 'exact' }
      )
      .eq('run_id', id)
      .eq('tenant_id', req.tenantId)
      .order('severity', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (issue_type) q = q.eq('issue_type', issue_type)
    if (severity)   q = q.eq('severity', severity)
    if (resolved !== undefined) q = q.eq('resolved', resolved === 'true')

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation issues')
    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── PATCH /leave/reconciliation/issues/:id/resolve ─────────────────────────
  fastify.patch('/leave/reconciliation/issues/:id/resolve', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const { id } = req.params as { id: string }
    const schema = z.object({ resolution_note: z.string().max(500).optional() })
    const parsed = schema.safeParse(req.body ?? {})
    const resolution_note = parsed.success ? parsed.data.resolution_note : undefined

    const { data, error } = await fastify.supabase
      .from('leave_reconciliation_issues')
      .update({
        resolved:        true,
        resolved_at:     new Date().toISOString(),
        resolved_by:     req.userId,
        resolution_note: resolution_note ?? null,
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

  // ── GET /leave/reconciliation/open ─────────────────────────────────────────
  fastify.get('/leave/reconciliation/open', auth, async (req: any, reply) => {
    if (!assertAdmin(req, reply)) return

    const querySchema = z.object({
      limit:    z.coerce.number().int().min(1).max(200).default(50),
      severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
      year:     z.coerce.number().int().optional(),
    })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }
    const { limit, severity, year } = parsed.data

    let q = fastify.supabase
      .from('leave_reconciliation_issues')
      .select(
        'id, run_id, issue_type, severity, employee_id, leave_type_id, year, ' +
        'ledger_sum, balance_value, drift_days, detail, suggestion, created_at',
        { count: 'exact' }
      )
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .order('severity', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (severity) q = q.eq('severity', severity)
    if (year)     q = q.eq('year', year)

    const { data, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch reconciliation summary')

    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const iss of (data ?? []) as any[]) {
      byType[iss.issue_type] = (byType[iss.issue_type] ?? 0) + 1
      bySeverity[iss.severity] = (bySeverity[iss.severity] ?? 0) + 1
    }

    return reply.send({
      data,
      total:       count ?? 0,
      by_type:     byType,
      by_severity: bySeverity,
    })
  })
}
