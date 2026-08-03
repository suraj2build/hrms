/**
 * Payroll Run Snapshots (Phase 15 — Immutable Snapshot Engine)
 *
 * POST /payroll/runs/:id/snapshot            — manually trigger snapshot creation
 * GET  /payroll/runs/:id/snapshot            — fetch a run's snapshot
 * GET  /payroll/runs/:id/snapshot/employees  — paginated per-employee snapshot rows
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, conflictError, ErrorCode } from '../../lib/api-errors.js'
import { buildPayrollRunSnapshot } from '../../lib/payroll-snapshot-engine.js'
import { logRunEvent } from '../../lib/payroll-run-events.js'

export default async function payrollSnapshotsRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT & REPLAY ENDPOINTS  (Phase 15 — Immutable Snapshot Engine)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POST /payroll/runs/:id/snapshot ─────────────────────────────────────────
  // Manually trigger snapshot creation for a finalized run.
  // Normally called automatically by finalize; this endpoint enables re-creation
  // if the auto-snapshot failed (e.g., transient DB error during finalization).
  fastify.post('/payroll/runs/:id/snapshot', hrAdminAuth, async (req: any, reply) => {
    const { id }       = req.params as { id: string }
    const tenantId     = req.tenantId as string

    // Verify run exists and is finalized
    const { data: run, error: runErr } = await fastify.supabase
      .from('payroll_runs')
      .select('id, status, snapshot_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (runErr || !run) return notFound(reply, 'NOT_FOUND', 'Run not found')
    if ((run as any).status !== 'finalized') {
      return conflictError(reply, 'NOT_FINALIZED', 'Snapshot can only be created for finalized runs')
    }
    if ((run as any).snapshot_id) {
      return conflictError(reply, 'SNAPSHOT_EXISTS', 'Snapshot already exists for this run')
    }

    const result = await buildPayrollRunSnapshot(fastify.supabase, id, tenantId, req.userId)
    if ('error' in result) {
      return serverError(req, reply, new Error(result.error), 'SNAPSHOT_FAILED', 'Failed to create payroll run snapshot')
    }

    await logRunEvent(fastify.supabase, req.log, {
      tenant_id:  tenantId,
      run_id:     id,
      event_type: 'snapshot_created',
      payload:    { snapshot_id: result.snapshot_id, integrity_hash: result.integrity_hash, triggered_manually: true },
    })

    return reply.send({
      message:        'Snapshot created successfully',
      snapshot_id:    result.snapshot_id,
      integrity_hash: result.integrity_hash,
    })
  })

  // ── GET /payroll/runs/:id/snapshot ──────────────────────────────────────────
  // Fetch the snapshot manifest + summary for a run.
  fastify.get('/payroll/runs/:id/snapshot', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string

    const { data: snapshot, error } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id, run_id, month, snapshot_version, integrity_hash, replayable, formula_engine_version, validation_engine_version, created_at, created_by')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error)     return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch run snapshot')
    if (!snapshot) return notFound(reply, 'NOT_FOUND', 'No snapshot found for this run')

    // Count employee snapshots
    const { count } = await fastify.supabase
      .from('payroll_employee_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('snapshot_id', (snapshot as any).id)
      .eq('tenant_id', tenantId)

    return reply.send({ data: { ...snapshot, employee_count: count ?? 0 } })
  })

  // ── GET /payroll/runs/:id/snapshot/employees ────────────────────────────────
  // Paginated employee-level snapshot data (for explainability panel).
  fastify.get('/payroll/runs/:id/snapshot/employees', hrAdminAuth, async (req: any, reply) => {
    const { id }   = req.params as { id: string }
    const tenantId = req.tenantId as string
    const qSchema  = z.object({
      employee_id: z.string().uuid().optional(),
      limit:       z.coerce.number().int().min(1).max(100).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const parsed = qSchema.safeParse(req.query)
    if (!parsed.success) return validationError(reply, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed')
    const { employee_id, limit, offset } = parsed.data

    // Find snapshot for this run
    const { data: manifest } = await fastify.supabase
      .from('payroll_run_snapshots')
      .select('id')
      .eq('run_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!manifest) return notFound(reply, 'NOT_FOUND', 'No snapshot found for this run')

    let q = fastify.supabase
      .from('payroll_employee_snapshots')
      .select(
        'id, employee_id, employee_code, employee_name, gross_pay, deductions, net_pay, payable_days, lop_days, overtime_hours, computed_at, attendance_snapshot, compensation_snapshot, component_snapshot, statutory_snapshot, formula_snapshot, validation_snapshot',
        { count: 'exact' },
      )
      .eq('snapshot_id', (manifest as any).id)
      .eq('tenant_id', tenantId)
      .range(offset, offset + limit - 1)

    if (employee_id) q = (q as any).eq('employee_id', employee_id)

    const { data: rows, error, count } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employee snapshots')

    return reply.send({ data: rows ?? [], total: count ?? 0 })
  })
}
