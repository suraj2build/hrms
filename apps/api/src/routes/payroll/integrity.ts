/**
 * Payroll Run Integrity & Replay
 *
 * POST /payroll/runs/:id/verify-integrity — re-hash stored snapshot vs integrity_hash
 * POST /payroll/runs/:id/replay           — replay a run's computation deterministically
 * GET  /payroll/runs/:id/replay-sessions  — list replay session history
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'
import { replayPayrollRun, validateSnapshotIntegrity } from '../../lib/payroll-snapshot-engine.js'
import { logRunEvent } from '../../lib/payroll-run-events.js'

export default async function payrollIntegrityRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /payroll/runs/:id/verify-integrity ──────────────────────────────────
  // Re-hash the stored snapshot and compare against integrity_hash.
  fastify.post('/payroll/runs/:id/verify-integrity', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: manifest } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!manifest) return notFound(reply, 'NOT_FOUND', 'No snapshot found for this run')

    const result = await validateSnapshotIntegrity(fastify.supabase, (manifest as any).id, tenantId)

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: result.valid ? 'snapshot_verified' : 'snapshot_integrity_failed',
      payload: {
        snapshot_id:    (manifest as any).id,
        valid:          result.valid,
        stored_hash:    result.stored_hash,
        computed_hash:  result.computed_hash,
        employee_count: result.employee_count,
      },
    })

    return reply.send({ data: result })
  })

  // ── POST /payroll/runs/:id/replay ────────────────────────────────────────────
  // Replay a finalized payroll run using ONLY snapshot data.
  // Modes:
  //   dry_replay      — recompute silently, return result (no persistence change)
  //   variance_replay — compare historical vs current engine, surface diffs
  //   audit_replay    — full reconstruction for audit purposes
  fastify.post('/payroll/runs/:id/replay', hrAdminAuth, async (req: any, reply) => {
    const { id }       = req.params as { id: string }
    const tenantId     = req.tenantId as string

    const bodySchema = z.object({
      replay_type: z.enum(['dry_replay', 'variance_replay', 'audit_replay']).default('audit_replay'),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { replay_type } = parsed.data

    const result = await replayPayrollRun(fastify.supabase, id, tenantId, replay_type, req.userId)
    if ('error' in result) {
      return serverError(req, reply, new Error(result.error), 'REPLAY_FAILED', 'Failed to replay payroll run')
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: result.variance_detected ? 'replay_variance_found' : 'replay_completed',
      payload: {
        replay_type,
        total_employees:   result.total_employees,
        matched:           result.matched,
        diverged:          result.diverged,
        variance_detected: result.variance_detected,
      },
    })

    return reply.send({ data: result })
  })

  // ── GET /payroll/runs/:id/replay-sessions ────────────────────────────────────
  // List all replay sessions for a run.
  fastify.get('/payroll/runs/:id/replay-sessions', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data, error } = await fastify.supabase
      .from('payroll_replay_sessions')
      .select('id, replay_type, triggered_by, triggered_at, result_status, variance_detected, variance_summary, completed_at')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .order('triggered_at', { ascending: false })
      .limit(20)

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch replay sessions')
    return reply.send({ data: data ?? [] })
  })
}
