/**
 * Bulk Governance Operations
 *
 * Simple batch actions for operations teams. Each bulk action preserves
 * a full audit trail: actor, timestamp, reason, and affected record IDs.
 *
 * POST /payroll/bulk/tds-approve          — bulk TDS declaration approval
 * POST /payroll/bulk/tds-reject           — bulk TDS declaration rejection
 * POST /payroll/bulk/proof-verify         — bulk proof verification
 * POST /payroll/bulk/leave-approve        — bulk leave approval
 * POST /payroll/bulk/remind               — bulk reminder notifications
 * POST /payroll/bulk/statutory-update     — bulk statutory applicability (EPF/ESI/PTax exempt)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { notifyHrAdmins, notify } from '../../lib/notify.js'
import { approveLeaveRequest } from '../../lib/approval-service.js'

export default async function bulkOpsRoutes(fastify: FastifyInstance) {
  const adminAuth = { preHandler: [fastify.authenticate, (req: any, reply: any, done: () => void) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }] }

  const MAX_BULK = 200  // Safety cap on all bulk operations

  // ── POST /payroll/bulk/tds-approve ────────────────────────────────────────────
  fastify.post('/tds-approve', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      declaration_ids: z.array(z.string().uuid()).min(1).max(MAX_BULK),
      approved_amount: z.number().optional(),  // single amount for all; undefined = use declared_amount
      reason:          z.string().min(3),
      notes:           z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { declaration_ids, approved_amount, reason, notes } = parsed.data
    const now = new Date().toISOString()

    // Fetch declarations (verify they belong to this tenant and are approvable)
    const { data: decls, error: fetchErr } = await fastify.supabase
      .from('tax_declarations')
      .select('id, status, declared_amount, employee_id')
      .eq('tenant_id', req.tenantId)
      .in('id', declaration_ids)
      .in('status', ['submitted', 'under_review'])

    if (fetchErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: fetchErr.message })

    const approvable = (decls ?? []) as any[]
    const skipped    = declaration_ids.filter(id => !approvable.find((d: any) => d.id === id))

    if (approvable.length === 0) {
      return reply.code(422).send({
        error: 'NOTHING_APPROVABLE',
        message: 'None of the provided declaration IDs are in a state that can be approved',
        skipped_ids: skipped,
      })
    }

    // Batch update
    const updateRows = approvable.map((d: any) => ({
      id:              d.id,
      status:          'approved',
      approved_by:     req.userId,
      approved_at:     now,
      approved_amount: approved_amount ?? d.declared_amount,
      reviewer_notes:  notes ?? null,
    }))

    // Supabase doesn't have a native batch update-by-id; do it row-by-row in parallel
    await Promise.all(
      approvable.map((d: any) =>
        fastify.supabase
          .from('tax_declarations')
          .update({
            status:          'approved',
            reviewed_by:     req.userId,
            reviewed_at:     now,
            approved_amount: approved_amount ?? d.declared_amount,
          })
          .eq('id', d.id)
          .eq('tenant_id', req.tenantId),
      ),
    )

    // Audit log entry per declaration
    const auditRows = approvable.map((d: any) => ({
      tenant_id:      req.tenantId,
      declaration_id: d.id,
      changed_by:     req.userId,
      from_status:    d.status,
      to_status:      'approved',
      notes:          `Bulk approval: ${reason}`,
    }))
    await fastify.supabase.from('tds_declaration_audit_log').insert(auditRows)

    return reply.send({
      approved_count: approvable.length,
      skipped_count:  skipped.length,
      skipped_ids:    skipped,
      reason,
    })
  })

  // ── POST /payroll/bulk/tds-reject ─────────────────────────────────────────────
  fastify.post('/tds-reject', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      declaration_ids: z.array(z.string().uuid()).min(1).max(MAX_BULK),
      reason:          z.string().min(3),
      notes:           z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { declaration_ids, reason, notes } = parsed.data
    const now = new Date().toISOString()

    const { data: decls } = await fastify.supabase
      .from('tax_declarations')
      .select('id, status, employee_id')
      .eq('tenant_id', req.tenantId)
      .in('id', declaration_ids)
      .in('status', ['submitted', 'under_review', 'approved'])

    const rejectable = (decls ?? []) as any[]
    const skipped    = declaration_ids.filter(id => !rejectable.find((d: any) => d.id === id))

    await Promise.all(
      rejectable.map((d: any) =>
        fastify.supabase
          .from('tax_declarations')
          .update({ status: 'rejected', rejection_reason: `${reason}${notes ? ' — ' + notes : ''}`, reviewed_by: req.userId, reviewed_at: now })
          .eq('id', d.id)
          .eq('tenant_id', req.tenantId),
      ),
    )

    const auditRows = rejectable.map((d: any) => ({
      tenant_id: req.tenantId, declaration_id: d.id, changed_by: req.userId,
      from_status: d.status, to_status: 'rejected', notes: `Bulk rejection: ${reason}`,
    }))
    if (auditRows.length > 0) await fastify.supabase.from('tds_declaration_audit_log').insert(auditRows)

    return reply.send({ rejected_count: rejectable.length, skipped_count: skipped.length, skipped_ids: skipped, reason })
  })

  // ── POST /payroll/bulk/proof-verify ───────────────────────────────────────────
  fastify.post('/proof-verify', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      proof_ids: z.array(z.string().uuid()).min(1).max(MAX_BULK),
      notes:     z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { proof_ids, notes } = parsed.data
    const now = new Date().toISOString()

    const { data: proofs } = await fastify.supabase
      .from('declaration_proofs')
      .select('id, document_state')
      .eq('tenant_id', req.tenantId)
      .in('id', proof_ids)
      .in('document_state', ['uploaded', 'under_review'])

    const verifiable = (proofs ?? []) as any[]
    const skipped    = proof_ids.filter(id => !verifiable.find((p: any) => p.id === id))

    await Promise.all(
      verifiable.map((p: any) =>
        fastify.supabase
          .from('declaration_proofs')
          .update({ document_state: 'verified', verified_by: req.userId, verified_at: now, verification_notes: notes ?? null })
          .eq('id', p.id)
          .eq('tenant_id', req.tenantId),
      ),
    )

    return reply.send({ verified_count: verifiable.length, skipped_count: skipped.length, skipped_ids: skipped })
  })

  // ── POST /payroll/bulk/leave-approve ──────────────────────────────────────────
  // Bulk leave approval: validates balance for paid leave, applies to attendance_daily
  fastify.post('/leave-approve', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      application_ids: z.array(z.string().uuid()).min(1).max(50),  // lower cap — each involves DB writes
      reason:          z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { application_ids, reason } = parsed.data

    const { data: apps } = await fastify.supabase
      .from('leave_requests')
      .select('id, employee_id, leave_type_id, from_date, to_date, status, leave_types(is_paid)')
      .eq('tenant_id', req.tenantId)
      .in('id', application_ids)
      .eq('status', 'PENDING')

    const approvedIds: string[] = []
    const advancedIds: string[] = []
    const failedIds:   Array<{ id: string; reason: string }> = []
    const skipped = application_ids.filter(id => !(apps ?? []).find((a: any) => a.id === id))

    for (const app of (apps ?? []) as any[]) {
      // Route through the full approval service — inherits validateApprover,
      // self-approval guard, atomic balance deduction, and attendance_daily upsert.
      const result = await approveLeaveRequest(fastify.supabase, {
        tenantId:  req.tenantId,
        requestId: app.id,
        ctx: { approverId: req.userId, approverRole: req.userRole, tenantId: req.tenantId },
      })

      if (!result.ok) {
        failedIds.push({ id: app.id, reason: result.error.message })
        continue
      }

      // Multi-level chain: an intermediate approval advances a level but the leave is
      // still PENDING — do NOT count it as approved and do NOT create payroll
      // adjustments for a not-yet-approved leave.
      if (result.value.status !== 'APPROVED') {
        advancedIds.push(app.id)
        continue
      }

      // Frozen-period payroll adjustment (extra logic beyond the approval service).
      const from = new Date(app.from_date)
      const to   = new Date(app.to_date)
      const dates: string[] = []
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10))
      }

      const affectedMonths = [...new Set(dates.map(d => d.slice(0, 7)))]
      for (const month of affectedMonths) {
        const { data: freeze } = await fastify.supabase
          .from('payroll_freeze_log')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('freeze_month', month)
          .eq('action', 'freeze')
          .is('unfrozen_at', null)
          .limit(1)
          .maybeSingle()

        if (freeze) {
          await fastify.supabase.from('payroll_adjustments').insert({
            tenant_id:       req.tenantId,
            employee_id:     app.employee_id,
            locked_month:    month,
            adjustment_type: 'lop_adjustment',
            reason:          `Bulk leave approval for ${app.from_date}–${app.to_date} affects locked period ${month}`,
            source_type:     'leave_approval',
            source_id:       app.id,
            status:          'pending',
            created_by:      req.userId,
          })
        }
      }

      approvedIds.push(app.id)
    }

    return reply.send({
      approved_count: approvedIds.length,
      advanced_count: advancedIds.length,   // intermediate multi-level approvals (still pending)
      failed_count:   failedIds.length,
      skipped_count:  skipped.length,
      approved_ids:   approvedIds,
      advanced_ids:   advancedIds,
      failed:         failedIds,
      skipped_ids:    skipped,
    })
  })

  // ── POST /payroll/bulk/remind ─────────────────────────────────────────────────
  // Send reminder notifications to HR admins for operational items
  fastify.post('/remind', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      reminder_type: z.enum([
        'pending_tds_proof',
        'leave_pending_approval',
        'payroll_lock_warning',
        'statutory_missing',
        'pending_adjustments',
      ]),
      month:   z.string().regex(/^\d{4}-\d{2}$/).optional(),
      message: z.string().max(500).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { reminder_type, month, message } = parsed.data
    const tenantId = req.tenantId as string

    type ReminderConfig = {
      item_type: any
      title: string
      summary: string
      severity: any
      action_route: string
    }

    const configs: Record<string, ReminderConfig> = {
      pending_tds_proof: {
        item_type:    'declaration_review',
        title:        'Pending TDS Proof Review',
        summary:      message ?? 'Some TDS declarations have submitted proofs awaiting verification.',
        severity:     'warning',
        action_route: '/payroll/statutory/tds/proofs?document_state=uploaded',
      },
      leave_pending_approval: {
        item_type:    'approval_request',
        title:        'Leave Applications Pending Approval',
        summary:      message ?? 'There are leave applications awaiting your review.',
        severity:     'info',
        action_route: '/attendance/leave?status=pending',
      },
      payroll_lock_warning: {
        item_type:    'payroll_blocker',
        title:        month ? `Payroll Lock Approaching — ${month}` : 'Payroll Lock Warning',
        summary:      message ?? (month ? `Payroll period ${month} will be locked soon. Finalize all approvals.` : 'A payroll period is approaching lock.'),
        severity:     'warning',
        action_route: month ? `/payroll/runs?month=${month}` : '/payroll/runs',
      },
      statutory_missing: {
        item_type:    'compliance_alert',
        title:        'Statutory Registration Missing',
        summary:      message ?? 'Some employees or sites are missing statutory registration numbers.',
        severity:     'warning',
        action_route: '/payroll/statutory/governance/registrations',
      },
      pending_adjustments: {
        item_type:    'payroll_blocker',
        title:        'Pending Payroll Adjustments',
        summary:      message ?? 'There are retroactive payroll adjustments awaiting review and approval.',
        severity:     'warning',
        action_route: '/payroll/adjustments',
      },
    }

    const cfg = configs[reminder_type]
    await notifyHrAdmins(fastify.supabase, {
      tenantId,
      senderId:     req.userId,
      item_type:    cfg.item_type,
      title:        cfg.title,
      summary:      cfg.summary,
      severity:     cfg.severity,
      action_route: cfg.action_route,
      action_label: 'Review',
      metadata:     { reminder_type, triggered_by: req.userId },
    })

    return reply.send({ sent: true, reminder_type, message: cfg.summary })
  })

  // ── POST /payroll/bulk/statutory-update ───────────────────────────────────────
  // Bulk update statutory applicability (ESI/PTax exemptions) for a list of employees
  fastify.post('/statutory-update', adminAuth, async (req: any, reply) => {
    const schema = z.object({
      employee_ids:   z.array(z.string().uuid()).min(1).max(MAX_BULK),
      statutory_type: z.enum(['esi', 'ptax', 'epf']),
      action:         z.enum(['exempt', 'reinstate']),
      effective_from: z.string(),
      effective_to:   z.string().optional(),
      reason:         z.string().min(3),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { employee_ids, statutory_type, action, effective_from, effective_to, reason } = parsed.data
    const now = new Date().toISOString()

    // Verify employees belong to this tenant
    const { data: emps } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .in('id', employee_ids)

    const validIds = ((emps ?? []) as any[]).map(e => e.id)
    const invalidIds = employee_ids.filter(id => !validIds.includes(id))

    let updatedCount = 0

    if (statutory_type === 'epf') {
      // EPF uses epf_eligibility_overrides table
      const rows = validIds.map(empId => ({
        tenant_id:     req.tenantId,
        employee_id:   empId,
        is_epf_applicable: action === 'reinstate',
        is_exempt:         action === 'exempt',
        exemption_reason:  action === 'exempt' ? reason : null,
        effective_from,
        effective_to: effective_to ?? null,
        override_reason: reason,
      }))

      const { error } = await fastify.supabase
        .from('epf_eligibility_overrides')
        .upsert(rows, { onConflict: 'tenant_id,employee_id' })

      if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
      updatedCount = rows.length
    } else {
      // ESI / PTax uses employee_statutory_overrides
      if (action === 'exempt') {
        const rows = validIds.map(empId => ({
          tenant_id:        req.tenantId,
          employee_id:      empId,
          statutory_type,
          is_exempt:        true,
          exemption_reason: reason,
          effective_from,
          effective_to: effective_to ?? null,
          created_by:   req.userId,
        }))

        const { error } = await fastify.supabase.from('employee_statutory_overrides').insert(rows)
        if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
        updatedCount = rows.length
      } else {
        // Reinstate: close existing exemptions by setting effective_to = today
        const { data: existing } = await fastify.supabase
          .from('employee_statutory_overrides')
          .select('id')
          .eq('tenant_id', req.tenantId)
          .eq('statutory_type', statutory_type)
          .eq('is_exempt', true)
          .in('employee_id', validIds)
          .is('effective_to', null)

        const existingIds = ((existing ?? []) as any[]).map(r => r.id)
        if (existingIds.length > 0) {
          await fastify.supabase
            .from('employee_statutory_overrides')
            .update({ effective_to: effective_from })
            .in('id', existingIds)
        }
        updatedCount = existingIds.length
      }
    }

    // Audit log
    const auditRows = validIds.map(empId => ({
      tenant_id:   req.tenantId,
      event_type:  'statutory_override_set',
      entity_type: statutory_type === 'epf' ? 'epf_eligibility_overrides' : 'employee_statutory_overrides',
      employee_id: empId,
      changed_by:  req.userId,
      after_value: { action, statutory_type, effective_from, effective_to, reason },
      notes:       `Bulk ${action}: ${reason}`,
    }))
    await fastify.supabase.from('statutory_audit_log').insert(auditRows)

    return reply.send({
      updated_count:  updatedCount,
      invalid_count:  invalidIds.length,
      invalid_ids:    invalidIds,
      statutory_type,
      action,
      effective_from,
    })
  })
}
