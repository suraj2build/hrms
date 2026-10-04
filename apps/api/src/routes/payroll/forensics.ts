/**
 * Payroll Forensics & Freeze Management
 *
 * GET  /payroll/forensics       — cross-run forensic event timeline
 * GET  /payroll/readiness-score — pre-run readiness composite score
 * GET  /payroll/freeze-log      — freeze/unfreeze audit history
 * POST /payroll/freeze-month    — freeze a month against further payroll writes
 * POST /payroll/unfreeze-month  — lift a freeze
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, forbidden, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { buildCompensationCoverageAudit } from '../../lib/payroll-compensation-coverage.js'
import { checkFreezeGuard } from '../../lib/payroll-run-events.js'

export default async function payrollForensicsRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/forensics ────────────────────────────────────────────────────
  // Cross-run forensic timeline — all payroll_run_events for the tenant, ordered
  // by recency, with run context joined.
  fastify.get('/payroll/forensics', hrAdminAuth, async (req: any, reply) => {
    try {
      const tenantId = req.tenantId as string
      const { run_id, month, event_type, limit = '100', offset = '0' } =
        (req.query ?? {}) as Record<string, string>

      // employees has two FKs to profiles (created_by + profile_id from migration 351),
      // so embedding profiles inside employees is ambiguous. Select first_name/last_name directly.
      let q = fastify.supabase
        .from('payroll_run_events')
        .select(`
          id, run_id, event_type, employee_id, month, payload, error_details, created_at,
          payroll_runs ( month, status ),
          employees ( employee_code, first_name, last_name )
        `, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1)

      if (run_id)     q = q.eq('run_id', run_id)
      if (month)      q = q.eq('month', month)
      if (event_type) q = q.eq('event_type', event_type)

      const { data, error, count } = await q
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch forensic events')

      return reply.send({ data: data ?? [], total: count ?? 0 })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch forensic events')
    }
  })

  // ── GET /payroll/readiness-score ─────────────────────────────────────────────
  // Composite readiness score (0-100) for the current payroll month.
  // Aggregates: coverage, blockers, validations, attendance, statutory configs.
  fastify.get('/payroll/readiness-score', hrAdminAuth, async (req: any, reply) => {
    try {
    const tenantId = req.tenantId as string

    // Latest run
    const { data: latestRun } = await fastify.supabase
      .from('payroll_runs')
      .select('id, month, status, employee_count, failure_summary')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const month = latestRun?.month ?? new Date().toISOString().slice(0, 7)

    // Compensation coverage
    const coverage = await buildCompensationCoverageAudit(fastify.supabase, tenantId)

    // Open blockers for latest run
    const { count: openBlockers } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .eq('run_id', latestRun?.id ?? '00000000-0000-0000-0000-000000000000')

    // Pending validations
    const { count: pendingValidations } = await fastify.supabase
      .from('payroll_run_blockers')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')

    // Freeze status
    const freezeCheck = await checkFreezeGuard(fastify.supabase, tenantId, month)

    // Active employees vs covered
    const { count: totalActive } = await fastify.supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    // Scoring logic (each dimension 0-25 points, total 100)
    const compensationScore = totalActive && totalActive > 0
      ? Math.round(((coverage.employees_with_active_compensation ?? 0) / totalActive) * 25)
      : 0

    const blockerScore = Math.max(0, 25 - ((openBlockers ?? 0) * 5))
    const runScore     = latestRun?.status === 'finalized' ? 25
      : latestRun?.status === 'draft' ? 15
      : latestRun?.status === 'partial_failed' ? 10
      : 5
    const configScore  = coverage.ready_for_payroll ? 25 : 15

    const total = compensationScore + blockerScore + runScore + configScore

    const checks = [
      { key: 'compensation_coverage', label: 'Compensation Coverage', score: compensationScore, max: 25,
        detail: `${coverage.employees_with_active_compensation ?? 0}/${totalActive ?? 0} employees covered`,
        pass: compensationScore >= 20 },
      { key: 'open_blockers', label: 'No Open Blockers', score: blockerScore, max: 25,
        detail: `${openBlockers ?? 0} open blockers`, pass: (openBlockers ?? 0) === 0 },
      { key: 'run_status', label: 'Payroll Run Status', score: runScore, max: 25,
        detail: latestRun?.status ?? 'No run', pass: runScore >= 20 },
      { key: 'config_valid', label: 'Configuration Valid', score: configScore, max: 25,
        detail: coverage.ready_for_payroll ? 'All configs valid' : 'Config issues found',
        pass: coverage.ready_for_payroll },
    ]

    return reply.send({
      data: {
        score: total,
        max: 100,
        grade: total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D',
        ready: total >= 80 && !freezeCheck.frozen,
        month,
        checks,
        frozen: freezeCheck.frozen,
        run: latestRun ? { id: latestRun.id, status: latestRun.status, month: latestRun.month } : null,
      },
    })
    } catch (err: any) {
      return serverError(req, reply, err, 'READINESS_SCORE_FAILED', 'Failed to compute readiness score')
    }
  })

  // ── GET /payroll/freeze-log ───────────────────────────────────────────────────
  // Audit trail for all freeze/unfreeze events.
  fastify.get('/payroll/freeze-log', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const { data, error } = await fastify.supabase
      .from('payroll_freeze_log')
      .select('id, freeze_month, action, reason, frozen_at, frozen_by, unfrozen_at, payroll_run_id')
      .eq('tenant_id', tenantId)
      .order('frozen_at', { ascending: false })
      .limit(100)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch freeze log')

    // Resolve actor names with a plain id→name lookup rather than a PostgREST
    // embed. payroll_freeze_log has TWO foreign keys to profiles (frozen_by and
    // unfrozen_by); the named-FK embed (profiles!payroll_freeze_log_frozen_by_fkey)
    // 500s the entire endpoint if the relationship cache is stale or the
    // constraint name differs from what is expected. A separate lookup never does.
    const rows = (data ?? []) as Array<Record<string, any>>
    const actorIds = [...new Set(rows.map(r => r.frozen_by).filter(Boolean))]
    let nameById = new Map<string, string | null>()
    if (actorIds.length > 0) {
      const { data: profs } = await fastify.supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', actorIds)
        .eq('tenant_id', tenantId)
      nameById = new Map((profs ?? []).map((p: any) => [p.id as string, p.full_name as string | null]))
    }

    return reply.send({
      data: rows.map(r => ({ ...r, profiles: { full_name: nameById.get(r.frozen_by) ?? null } })),
    })
  })

  // ── POST /payroll/freeze-month ────────────────────────────────────────────────
  // Explicitly freeze a payroll month (outside of a run).
  fastify.post('/payroll/freeze-month', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { month, reason } = parsed.data

    const already = await checkFreezeGuard(fastify.supabase, tenantId, month)
    if (already.checkFailed) {
      return reply.code(503).send({ error: 'FREEZE_CHECK_FAILED', message: already.reason })
    }
    if (already.frozen) return conflictError(reply, 'ALREADY_FROZEN', `${month} is already frozen`)

    const { error } = await fastify.supabase.from('payroll_freeze_log').insert({
      tenant_id: tenantId, freeze_month: month, action: 'freeze',
      reason, frozen_by: req.userId, frozen_at: new Date().toISOString(),
    })
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to freeze payroll month')
    return reply.send({ message: `${month} frozen`, month })
  })

  // ── POST /payroll/unfreeze-month ──────────────────────────────────────────────
  // Unfreeze a previously frozen payroll month. Requires super_admin.
  fastify.post('/payroll/unfreeze-month', hrAdminAuth, async (req: any, reply) => {
    const tenantId = req.tenantId as string
    if (req.userRole !== 'super_admin') {
      return forbidden(reply, 'FORBIDDEN', 'Only super_admin may unfreeze a payroll month')
    }
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), reason: z.string().min(1) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { month, reason } = parsed.data

    const already = await checkFreezeGuard(fastify.supabase, tenantId, month)
    // Explicit checkFailed check (ISSUE-147): this guard runs in the OPPOSITE
    // direction from every other call site — it must block when the month IS
    // frozen check FAILS to verify NOT-frozen, so `already.frozen` defaulting to
    // true on error would incorrectly satisfy `!already.frozen === false` and let
    // an unfreeze proceed against a freeze state we never actually confirmed.
    if (already.checkFailed) {
      return reply.code(503).send({ error: 'FREEZE_CHECK_FAILED', message: already.reason })
    }
    if (!already.frozen) return conflictError(reply, 'NOT_FROZEN', `${month} is not frozen`)

    // Mark the freeze record as unfrozen
    const { error } = await fastify.supabase
      .from('payroll_freeze_log')
      .update({ action: 'unfreeze', unfrozen_by: req.userId, unfrozen_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('freeze_month', month)
      .eq('action', 'freeze')

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to unfreeze payroll month')

    // Revert the run status from 'frozen' back to 'finalized' so views are
    // consistent (mirrors the freeze action that sets status='frozen').
    await fastify.supabase
      .from('payroll_runs')
      .update({ status: 'finalized' })
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .eq('status', 'frozen')

    return reply.send({ message: `${month} unfrozen`, month })
  })
}
