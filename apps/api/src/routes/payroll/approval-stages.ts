/**
 * Payroll Approval Stages (maker-checker log)
 *
 * GET  /payroll/approval-stages            — list maker-checker log entries
 * POST /payroll/approval-stages/:id/approve
 * POST /payroll/approval-stages/:id/reject
 *
 * Split out of the former monolithic payroll/index.ts (PEND-104).
 */
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'

export default async function payrollApprovalStagesRoutes(fastify: FastifyInstance) {
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /payroll/approval-stages ──────────────────────────────────────────────
  // List maker-checker log entries for payroll governance.
  fastify.get('/payroll/approval-stages', hrAdminAuth, async (req: any, reply) => {
    try {
      const tenantId = req.tenantId as string
      const { status, entity_type } = (req.query ?? {}) as Record<string, string>

      let q = fastify.supabase
        .from('maker_checker_log')
        .select(`
          id, entity_type, entity_id, action, status, maker_data, checker_notes,
          submitted_at, reviewed_at, sla_hours, is_escalated,
          maker:profiles!maker_checker_log_maker_id_fkey(full_name),
          checker:profiles!maker_checker_log_checker_id_fkey(full_name)
        `)
        .eq('tenant_id', tenantId)
        .order('submitted_at', { ascending: false })
        .limit(100)

      if (status)      q = q.eq('status', status)
      if (entity_type) q = q.eq('entity_type', entity_type)

      const { data, error } = await q
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch approval stages')
      return reply.send({ data: data ?? [] })
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch approval stages')
    }
  })

  // ── POST /payroll/approval-stages/:id/approve ─────────────────────────────────
  fastify.post('/payroll/approval-stages/:id/approve', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string
    const { notes } = (req.body ?? {}) as { notes?: string }

    // payroll_run/finalize proposals can't be completed by flipping this log row
    // alone — see the identical guard in governance.ts's maker-checker/:id/approve.
    // Only a re-call of POST /payroll/runs/:id/finalize actually finalizes the run.
    const { data: entry } = await fastify.supabase
      .from('maker_checker_log')
      .select('entity_type, action')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if ((entry as any)?.entity_type === 'payroll_run' && (entry as any)?.action === 'finalize') {
      return reply.code(409).send({
        error:   'USE_FINALIZE_ENDPOINT',
        message: 'Payroll finalize proposals cannot be approved here. A different, authorised user must go to the Payroll Finalization Center and click Confirm Finalize again to approve and complete it.',
      })
    }

    const { error } = await fastify.supabase
      .from('maker_checker_log')
      .update({ status: 'approved', checker_id: req.userId, checker_notes: notes ?? null, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to approve stage')
    return reply.send({ message: 'Approved' })
  })

  // ── POST /payroll/approval-stages/:id/reject ──────────────────────────────────
  fastify.post('/payroll/approval-stages/:id/reject', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const tenantId = req.tenantId as string
    const { notes } = (req.body ?? {}) as { notes?: string }

    const { error } = await fastify.supabase
      .from('maker_checker_log')
      .update({ status: 'rejected', checker_id: req.userId, checker_notes: notes ?? null, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject stage')
    return reply.send({ message: 'Rejected' })
  })
}
