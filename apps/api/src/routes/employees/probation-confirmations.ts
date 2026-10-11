/**
 * Probation Confirmation workflow — HR decision side.
 *
 * GET   /probation-confirmations[?status=]           — tenant-wide list
 * PATCH /probation-confirmations/:id/decide           — HR confirms or extends
 *
 * The manager side (recommend confirm/extend with feedback, which creates
 * the 'pending_hr' row this reads) lives in
 * routes/manager/team-lifecycle.ts — POST /manager/team/lifecycle/confirmation-recommend.
 * See migration 443_probation_confirmations.sql for the status lifecycle.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { serverError, notFound, conflictError, validationError, ErrorCode } from '../../lib/api-errors.js'

const statusSchema = z.enum(['pending_hr', 'extended', 'confirmed'])

export default async function probationConfirmationsRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /probation-confirmations ─────────────────────────────────────────────
  fastify.get('/probation-confirmations', hrAdminAuth, async (req: any, reply) => {
    const parsed = z.object({ status: statusSchema.optional() }).safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }

    let query = fastify.supabase
      .from('probation_confirmations')
      .select(`
        id, employee_id, job_history_id, due_date, status,
        manager_recommendation, manager_feedback, manager_recommended_at,
        hr_decision, hr_decision_notes, extended_to_date, decided_at, version, created_at,
        employees!probation_confirmations_employee_id_fkey(id, first_name, last_name, employee_code),
        manager:profiles!probation_confirmations_manager_recommended_by_fkey(id, full_name),
        decider:profiles!probation_confirmations_decided_by_fkey(id, full_name)
      `)
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })

    if (parsed.data.status) query = query.eq('status', parsed.data.status)

    const { data, error } = await query
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch probation confirmations')

    const rows = ((data ?? []) as any[]).map(r => {
      const emp = r.employees
      return {
        id: r.id,
        employee_id: r.employee_id,
        employee_name: emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : null,
        employee_code: emp?.employee_code ?? null,
        due_date: r.due_date,
        status: r.status,
        is_overdue: r.status === 'pending_hr' && r.due_date < new Date().toISOString().slice(0, 10),
        manager_recommendation: r.manager_recommendation,
        manager_feedback: r.manager_feedback,
        manager_recommended_at: r.manager_recommended_at,
        manager_name: r.manager?.full_name ?? null,
        hr_decision: r.hr_decision,
        hr_decision_notes: r.hr_decision_notes,
        extended_to_date: r.extended_to_date,
        decided_at: r.decided_at,
        decided_by_name: r.decider?.full_name ?? null,
        version: r.version,
      }
    })

    return reply.send({ data: rows })
  })

  // ── PATCH /probation-confirmations/:id/decide ────────────────────────────────
  fastify.patch('/probation-confirmations/:id/decide', hrAdminAuth, async (req: any, reply) => {
    const bodySchema = z.object({
      decision:         z.enum(['confirm', 'extend']),
      notes:            z.string().max(1000).optional(),
      extended_to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      expected_version: z.number().int().positive().optional(),
    }).refine(b => b.decision !== 'extend' || !!b.extended_to_date, {
      message: 'extended_to_date is required when extending probation',
    })
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Validation failed')
    }

    const { data: cycle, error: cycleErr } = await fastify.supabase
      .from('probation_confirmations')
      .select('id, employee_id, job_history_id, status')
      .eq('id', req.params.id).eq('tenant_id', req.tenantId).maybeSingle()
    if (cycleErr) return serverError(req, reply, cycleErr, ErrorCode.QUERY_FAILED, 'Failed to fetch probation confirmation')
    if (!cycle) return notFound(reply, 'NOT_FOUND', 'Probation confirmation not found')
    if ((cycle as any).status !== 'pending_hr') {
      return conflictError(reply, 'ALREADY_DECIDED', `This confirmation is already ${(cycle as any).status}`)
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      status:            parsed.data.decision === 'confirm' ? 'confirmed' : 'extended',
      hr_decision:        parsed.data.decision,
      hr_decision_notes:  parsed.data.notes?.trim() || null,
      extended_to_date:   parsed.data.decision === 'extend' ? parsed.data.extended_to_date : null,
      decided_by:         req.userId,
      decided_at:         now,
      updated_at:         now,
    }

    let updateQuery = fastify.supabase
      .from('probation_confirmations')
      .update(updatePayload)
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'pending_hr')
    if (parsed.data.expected_version !== undefined) updateQuery = updateQuery.eq('version', parsed.data.expected_version)

    const { data: updated, error: updErr } = await updateQuery.select().maybeSingle()
    if (updErr) return serverError(req, reply, updErr, ErrorCode.UPDATE_FAILED, 'Failed to record decision')
    if (!updated) {
      return conflictError(reply, ErrorCode.VERSION_CONFLICT,
        'This confirmation was changed by someone else. Reload and try again.')
    }

    // Confirming also sets job_history.confirmation_date on the current row —
    // this IS the structured confirmation the gap this workflow closes.
    // Re-check is_current + still-probation so a decision made after the
    // employee's job history moved on (promotion, role change) doesn't
    // silently stamp a confirmation date onto an unrelated, now-historical row.
    if (parsed.data.decision === 'confirm' && (cycle as any).job_history_id) {
      const { data: jhRow, error: jhCheckErr } = await fastify.supabase
        .from('job_history')
        .select('id, is_current, employment_type, confirmation_date')
        .eq('id', (cycle as any).job_history_id).eq('tenant_id', req.tenantId).maybeSingle()
      if (jhCheckErr) return serverError(req, reply, jhCheckErr, ErrorCode.QUERY_FAILED, 'Failed to verify job history before confirming')
      if (jhRow && (jhRow as any).is_current && (jhRow as any).employment_type === 'probation' && !(jhRow as any).confirmation_date) {
        const { error: jhErr } = await fastify.supabase
          .from('job_history')
          .update({ confirmation_date: now.slice(0, 10) })
          .eq('id', (cycle as any).job_history_id).eq('tenant_id', req.tenantId)
        if (jhErr) return serverError(req, reply, jhErr, ErrorCode.UPDATE_FAILED, 'Confirmed, but failed to set confirmation date on job history')
      }
    }

    await logAction(fastify.supabase, {
      tenantId: req.tenantId, tableName: 'probation_confirmations', recordId: req.params.id,
      action: 'UPDATE', performedBy: req.userId, onBehalfOf: (cycle as any).employee_id,
      newData: { decision: parsed.data.decision, extended_to_date: parsed.data.extended_to_date ?? null, notes: parsed.data.notes ?? null },
    })

    return reply.send({ data: updated })
  })
}
