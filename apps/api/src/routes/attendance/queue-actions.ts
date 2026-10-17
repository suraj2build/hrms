/**
 * Attendance Queue Actions
 *
 * Generic action endpoints for the Operations / Resolution Workspace.
 * Queue items can be anomalies, corrections, regularisations, etc.
 * These endpoints operate on the most common backing type (attendance_anomalies)
 * and return idempotent successes for the others.
 *
 * Routes:
 *   POST /attendance/queue/:id/resolve   — mark anomaly as resolved
 *   POST /attendance/queue/:id/escalate  — mark anomaly as escalated; soft-success for others
 *
 * Snooze is handled entirely client-side (see useOperationalQueue.ts's
 * bulkSnooze) — there's no single backing table for "the operations queue"
 * to persist a snooze against, so no backend endpoint exists for it.
 *
 * Auth pattern: same as anomalies.ts — authenticate via fastify.authenticate,
 * then check req.userRole inline (NOT via a separate preHandler, which can cause
 * Fastify to return 400 when mixing async/callback-style hooks).
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { logAction } from '../../lib/audit-service.js'
import { emitEvent } from '../../lib/event-emitter.js'

export default async function attendanceQueueActionsRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── POST /attendance/queue/:id/resolve ─────────────────────────────────────
  fastify.post('/attendance/queue/:id/resolve', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .select('id, resolved_at')
      .maybeSingle()

    if (error) {
      return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to resolve queue item')
    }

    // data === null means the id isn't an anomaly (correction, revision, etc.) — still succeed
    return reply.send({
      message:     'Resolved',
      id,
      resolved_at: data?.resolved_at ?? new Date().toISOString(),
    })
  })

  // ── POST /attendance/queue/:id/escalate ────────────────────────────────────
  fastify.post('/attendance/queue/:id/escalate', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const { id } = req.params as { id: string }

    // req.body may be null when the client sends no body (Content-Type: application/json, empty)
    const body   = (req.body != null && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
    const reason = typeof body['reason'] === 'string' ? body['reason'] : undefined

    const now = new Date().toISOString()

    // Attempt to mark the anomaly as resolved/escalated (non-fatal if not an anomaly)
    const { data: anomaly, error } = await fastify.supabase
      .from('attendance_anomalies')
      .update({
        resolved:    true,
        resolved_by: req.userId,
        resolved_at: now,
        updated_at:  now,
      })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('resolved', false)
      .select('id, employee_id, date, type')
      .maybeSingle()

    if (error) {
      req.log.warn({ err: error, id }, 'queue escalate: anomaly update failed (non-fatal)')
      // Don't surface the DB error — the escalate action itself still succeeds
    }

    // Durable record of the escalation and its reason — previously the UI's
    // "Escalated to manager" toast had nothing behind it: `reason` was parsed
    // from the body and then discarded, no row distinguished "escalated" from
    // a plain resolve, and no manager was ever notified. attendance_anomalies
    // has no escalated/escalated_to column (migration 047 — resolved/resolved_by/
    // resolved_at only), so a real "escalated" state needs a schema change;
    // until then this at least makes the reason durable (audit_logs) and
    // actually notifies the employee's manager, instead of silently doing
    // nothing beyond the identical-to-resolve DB update above.
    logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'attendance_queue_item',
      recordId:    id,
      action:      'UPDATE',
      performedBy: req.userId,
      newData:     { event: 'queue.escalated', reason: reason ?? null, matched_anomaly: !!anomaly },
    }).catch((err: unknown) => {
      req.log.warn({ err, id }, 'queue escalate: audit log insert failed (non-fatal)')
    })

    if (anomaly?.employee_id) {
      void (async () => {
        try {
          const { data: emp } = await fastify.supabase
            .from('employees')
            .select('manager_id')
            .eq('id', anomaly.employee_id)
            .eq('tenant_id', req.tenantId)
            .maybeSingle()

          const managerEmployeeId = (emp as { manager_id: string | null } | null)?.manager_id ?? null
          if (!managerEmployeeId) return

          const { data: managerProfile } = await fastify.supabase
            .from('profiles')
            .select('id')
            .eq('employee_id', managerEmployeeId)
            .eq('tenant_id', req.tenantId)
            .maybeSingle()

          if (!managerProfile?.id) return

          // notifications.event_id is a NOT NULL FK to hr_events(id), NOT a
          // free-form id — a direct `.from('notifications').insert({event_id: id, ...})`
          // using the queue item's own id (as anomalies.ts's own /resolve
          // notification does) violates that FK and the insert fails
          // *silently* unless its `error` is checked, which it wasn't. Use
          // the shared emitEvent() helper so the hr_events row is created
          // first and the notification's event_id correctly points at it.
          await emitEvent({
            supabase:   fastify.supabase,
            tenantId:   req.tenantId,
            eventType:  'queue.escalated',
            actorId:    req.userId,
            targetType: 'employee',
            targetId:   anomaly.employee_id,
            payload:    { queue_item_id: id, reason: reason ?? null },
            notifications: [{
              recipientId: managerProfile.id,
              title:       'Attendance Issue Escalated',
              body:        reason
                ? `An attendance item for your team on ${anomaly.date ?? 'an unknown date'} was escalated to you: ${reason}`
                : `An attendance item for your team on ${anomaly.date ?? 'an unknown date'} was escalated to you for review.`,
              link:        '/ess/team',
            }],
          })
        } catch (notifyErr: unknown) {
          req.log.warn({ err: notifyErr, id }, 'queue escalate: manager notification failed (non-fatal)')
        }
      })()
    }

    return reply.send({ message: 'Escalated', id, reason: reason ?? null })
  })
}
