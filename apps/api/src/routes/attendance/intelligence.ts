/**
 * Workforce Intelligence Routes
 *
 * GET  /attendance/intelligence         — Return latest cached snapshot (instant)
 * POST /attendance/intelligence/compute — Trigger a fresh computation + persist
 * GET  /attendance/intelligence/flags   — List active (non-dismissed) risk flags
 * POST /attendance/intelligence/flags/:id/dismiss — HR dismisses a risk flag
 *
 * Auth: hr_admin / super_admin for all routes.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeIntelligence } from '../../lib/intelligence-engine.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function attendanceIntelligenceRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHR(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET /attendance/intelligence ───────────────────────────────────────────────
  // Returns the cached snapshot. If no snapshot exists, triggers computation
  // on-the-fly (first call only).
  fastify.get('/attendance/intelligence', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return

    const { data: snap, error } = await fastify.supabase
      .from('attendance_intelligence_snapshot')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch intelligence snapshot')
    }

    // No cached snapshot — compute on first call
    if (!snap) {
      try {
        const result = await computeIntelligence(fastify.supabase, req.tenantId)
        return reply.send({ data: result, cached: false })
      } catch (e: unknown) {
        return serverError(req, reply, e, ErrorCode.COMPUTE_FAILED, 'Failed to compute intelligence')
      }
    }

    return reply.send({
      data: {
        summary:  snap.summary,
        at_risk:  snap.at_risk,
        trends:   snap.trends,
        patterns: snap.patterns,
      },
      cached:      true,
      computed_at: snap.computed_at,
    })
  })

  // ── POST /attendance/intelligence/compute ──────────────────────────────────────
  // Force a fresh computation (replaces cached snapshot).
  fastify.post('/attendance/intelligence/compute', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return

    try {
      const result = await computeIntelligence(fastify.supabase, req.tenantId)
      return reply.send({ data: result, cached: false })
    } catch (e: unknown) {
      return serverError(req, reply, e, ErrorCode.COMPUTE_FAILED, 'Failed to compute intelligence')
    }
  })

  // ── GET /attendance/intelligence/flags ─────────────────────────────────────────
  // Active risk flags with optional filters.
  const flagQuerySchema = z.object({
    employee_id: z.string().uuid().optional(),
    flag_type:   z.enum(['chronic_late', 'frequent_no_punch', 'high_anomaly_rate', 'excessive_leave', 'absent_streak', 'low_attendance']).optional(),
    dismissed:   z.enum(['true', 'false']).default('false'),
    min_score:   z.coerce.number().int().min(0).max(100).default(0),
    limit:       z.coerce.number().int().min(1).max(200).default(100),
    offset:      z.coerce.number().int().min(0).default(0),
  })

  fastify.get('/attendance/intelligence/flags', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return

    const parsed = flagQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { employee_id, flag_type, dismissed, min_score, limit, offset } = parsed.data

    let q = fastify.supabase
      .from('employee_risk_flags')
      .select(`
        id, flag_type, risk_score, details, first_flagged, last_updated,
        dismissed, dismissed_at, dismiss_note,
        employees!employee_id!inner(id, first_name, last_name, employee_code),
        profiles!dismissed_by(id, full_name)
      `, { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('dismissed', dismissed === 'true')
      .gte('risk_score', min_score)
      .order('risk_score', { ascending: false })
      .order('last_updated', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employee_id) q = q.eq('employee_id', employee_id)
    if (flag_type)   q = q.eq('flag_type', flag_type)

    const { data, error, count } = await q

    if (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch risk flags')
    }

    const rows = ((data ?? []) as Array<{
      id:           string
      flag_type:    string
      risk_score:   number
      details:      Record<string, unknown> | null
      first_flagged:string
      last_updated: string
      dismissed:    boolean
      dismissed_at: string | null
      dismiss_note: string | null
      employees:    { id: string; first_name: string; last_name: string; employee_code: string } | Array<{ id: string; first_name: string; last_name: string; employee_code: string }> | null
      profiles:     { id: string; full_name: string } | Array<{ id: string; full_name: string }> | null
    }>).map((r) => {
      const emp  = Array.isArray(r.employees) ? r.employees[0] : r.employees
      const prof = Array.isArray(r.profiles)  ? r.profiles[0]  : r.profiles
      return {
        id:             r.id,
        flag_type:      r.flag_type,
        risk_score:     r.risk_score,
        details:        r.details,
        first_flagged:  r.first_flagged,
        last_updated:   r.last_updated,
        dismissed:      r.dismissed,
        dismissed_at:   r.dismissed_at,
        dismiss_note:   r.dismiss_note,
        employee_id:    emp?.id            ?? null,
        employee_name:  emp ? `${emp.first_name} ${emp.last_name}` : null,
        employee_code:  emp?.employee_code ?? null,
        dismissed_by_name: prof?.full_name ?? null,
      }
    })

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── POST /attendance/intelligence/flags/:id/dismiss ────────────────────────────
  // HR dismisses a risk flag (marks as acknowledged; next compute may re-raise it).
  const dismissSchema = z.object({
    note: z.string().max(500).optional(),
  })

  fastify.post('/attendance/intelligence/flags/:id/dismiss', auth, async (req: any, reply) => {
    if (!requireHR(req, reply)) return

    const { id } = req.params as { id: string }
    const parsed = dismissSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('employee_risk_flags')
      .update({
        dismissed:    true,
        dismissed_by: req.userId,
        dismissed_at: new Date().toISOString(),
        dismiss_note: parsed.data.note ?? null,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('dismissed', false)
      .select('id, dismissed, dismissed_at')
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to dismiss flag')
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Flag not found or already dismissed' })
    }

    return reply.send({ data })
  })
}
