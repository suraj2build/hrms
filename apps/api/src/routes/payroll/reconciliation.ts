/**
 * Payroll Reconciliation Action Routes
 *
 * GET  /payroll/reconciliation           — computed reconciliation items for a month.
 *                                          Implemented in routes/workspace/stats.ts
 *                                          (co-located with other workspace aggregation queries).
 *
 * POST /payroll/reconciliation/:id/acknowledge
 *   Mark a reconciliation item as reviewed / acknowledged by the operator.
 *   The item ID is a computed string (e.g. "lop-<empId>-0") produced by the
 *   GET endpoint.  Action is persisted to `payroll_reconciliation_actions`
 *   so that status survives page reloads and cross-session.
 *
 * POST /payroll/reconciliation/:id/escalate
 *   Flag a reconciliation item for escalation (e.g. to a senior payroll officer).
 *   Same persistence strategy.
 *
 * POST /payroll/reconciliation/:id/resolve
 *   Mark a reconciliation item as fully resolved (root cause corrected).
 *   Terminal state — persisted.
 *
 * All three endpoints are idempotent-safe: repeating an action for the same
 * (tenant, item_id, month) appends a new row but the GET endpoint always uses
 * the latest row, so the result is stable.
 *
 * The `month` query param must be supplied so the action can be scoped to the
 * correct payroll period.  Defaults to the current calendar month when absent.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

/** Derive the target month from a computed item_id.
 *
 *  Item IDs are produced by the GET endpoint as:  "<category>-<empId>-<idx>"
 *  The month comes from the ?month query param (not embedded in the ID), so
 *  callers must always supply it.  We fall back to the current month if absent.
 */
function resolveMonth(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw
  return new Date().toISOString().slice(0, 7)
}

export default async function payrollReconciliationRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── POST /payroll/reconciliation/:id/acknowledge ─────────────────────────────
  fastify.post('/payroll/reconciliation/:id/acknowledge', hrAdminAuth, async (req: any, reply) => {
    const { id }     = req.params as { id: string }
    const tenantId   = req.tenantId as string
    const month      = resolveMonth((req.query as any).month)

    const bodySchema = z.object({
      notes: z.string().max(500).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    const notes  = parsed.success ? parsed.data.notes : undefined

    // Persist action — append-only; latest row wins for status resolution.
    const { error: insertErr } = await (fastify as any).supabase
      .from('payroll_reconciliation_actions')
      .insert({
        tenant_id:   tenantId,
        item_id:     id,
        month,
        action_type: 'acknowledge',
        notes:       notes ?? null,
        actor_id:    req.userId ?? null,
      })

    if (insertErr) {
      return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to persist acknowledge action')
    }

    req.log.info(
      { item_id: id, tenant_id: tenantId, month, acknowledged_by: req.userId, notes },
      'payroll reconciliation: item acknowledged',
    )

    return reply.send({
      success:          true,
      id,
      month,
      status:           'acknowledged',
      acknowledged_by:  req.userId,
      acknowledged_at:  new Date().toISOString(),
      notes:            notes ?? null,
    })
  })

  // ── POST /payroll/reconciliation/:id/escalate ────────────────────────────────
  fastify.post('/payroll/reconciliation/:id/escalate', hrAdminAuth, async (req: any, reply) => {
    const { id }    = req.params as { id: string }
    const tenantId  = req.tenantId as string
    const month     = resolveMonth((req.query as any).month)

    const bodySchema = z.object({
      reason: z.string().max(500).optional(),
    })
    const parsed = bodySchema.safeParse(req.body ?? {})
    const reason = parsed.success ? parsed.data.reason : undefined

    const { error: insertErr } = await (fastify as any).supabase
      .from('payroll_reconciliation_actions')
      .insert({
        tenant_id:   tenantId,
        item_id:     id,
        month,
        action_type: 'escalate',
        notes:       reason ?? null,
        actor_id:    req.userId ?? null,
      })

    if (insertErr) {
      return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to persist escalate action')
    }

    req.log.info(
      { item_id: id, tenant_id: tenantId, month, escalated_by: req.userId, reason },
      'payroll reconciliation: item escalated',
    )

    return reply.send({
      success:      true,
      id,
      month,
      status:       'escalated',
      escalated_by: req.userId,
      escalated_at: new Date().toISOString(),
      reason:       reason ?? null,
    })
  })

  // ── POST /payroll/reconciliation/:id/resolve ──────────────────────────────────
  fastify.post('/payroll/reconciliation/:id/resolve', hrAdminAuth, async (req: any, reply) => {
    const { id }    = req.params as { id: string }
    const tenantId  = req.tenantId as string
    const month     = resolveMonth((req.query as any).month)

    const bodySchema = z.object({
      resolution_notes: z.string().max(1000).optional(),
    })
    const parsed           = bodySchema.safeParse(req.body ?? {})
    const resolution_notes = parsed.success ? parsed.data.resolution_notes : undefined

    const { error: insertErr } = await (fastify as any).supabase
      .from('payroll_reconciliation_actions')
      .insert({
        tenant_id:   tenantId,
        item_id:     id,
        month,
        action_type: 'resolve',
        notes:       resolution_notes ?? null,
        actor_id:    req.userId ?? null,
      })

    if (insertErr) {
      return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to persist resolve action')
    }

    req.log.info(
      { item_id: id, tenant_id: tenantId, month, resolved_by: req.userId, resolution_notes },
      'payroll reconciliation: item resolved',
    )

    return reply.send({
      success:          true,
      id,
      month,
      status:           'resolved',
      resolved_by:      req.userId,
      resolved_at:      new Date().toISOString(),
      resolution_notes: resolution_notes ?? null,
    })
  })
}
