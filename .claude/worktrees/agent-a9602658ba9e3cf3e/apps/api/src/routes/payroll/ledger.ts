/**
 * Payroll Explainability Ledger Routes — Phase 3
 *
 * GET  /payroll/ledger/:employeeId?month=YYYY-MM  — list entries (HR + ESS own)
 * POST /payroll/ledger                             — manual entry (HR admin only)
 *
 * Automatic entries are written by leave/correction approval handlers
 * via the shared lib/ledger-writer.ts utility.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const monthRe = /^\d{4}-\d{2}$/

const VALID_EVENT_TYPES = [
  'attendance_recomputed', 'correction_approved', 'leave_deducted',
  'ot_added', 'policy_changed', 'retro_adjustment', 'payable_days_changed',
  'lop_applied', 'payroll_computed', 'payroll_finalized', 'anomaly_resolved',
  'manual_note',
] as const

const createEntrySchema = z.object({
  employee_id:        z.string().uuid(),
  month:              z.string().regex(monthRe, 'month must be YYYY-MM'),
  event_type:         z.enum(VALID_EVENT_TYPES),
  event_description:  z.string().min(1).max(1000),
  impact_type:        z.string().optional(),
  impact_amount:      z.number().optional(),
  before_value:       z.string().max(200).optional(),
  after_value:        z.string().max(200).optional(),
  source_entity_type: z.string().optional(),
  source_entity_id:   z.string().uuid().optional(),
})

export default async function payrollLedgerRoute(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /payroll/ledger/:employeeId ───────────────────────────────────────
  //    HR: any employee in their tenant
  //    Employees (ESS): only their own entries
  fastify.get('/payroll/ledger/:employeeId', auth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }
    const isAdmin = ['super_admin', 'hr_admin'].includes(req.userRole)

    // Non-admins can only view their own ledger
    if (!isAdmin) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .single()

      if (profile?.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'You can only view your own ledger' })
      }
    }

    const qs = z.object({
      month:  z.string().regex(monthRe).optional(),
      limit:  z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).safeParse(req.query)

    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message })
    }

    const { month, limit, offset } = qs.data

    let q = fastify.supabase
      .from('payroll_explainability_ledger')
      .select('id, event_type, event_description, impact_type, impact_amount, before_value, after_value, source_entity_type, source_entity_id, created_at, profiles(full_name)', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (month) q = (q as any).eq('month', month)

    const { data, error, count } = await q

    if (error) {
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch ledger' })
    }

    const rows = ((data ?? []) as any[]).map(e => ({
      id:                e.id,
      event_type:        e.event_type,
      event_description: e.event_description,
      impact_type:       e.impact_type,
      impact_amount:     e.impact_amount,
      before_value:      e.before_value,
      after_value:       e.after_value,
      source_entity_type: e.source_entity_type,
      source_entity_id:  e.source_entity_id,
      created_at:        e.created_at,
      created_by_name:   (Array.isArray(e.profiles) ? e.profiles[0] : e.profiles)?.full_name ?? null,
    }))

    return reply.send({ data: rows, total: count ?? 0, limit, offset })
  })

  // ── POST /payroll/ledger — manual ledger entry (HR admin only) ────────────
  fastify.post('/payroll/ledger', auth, async (req: any, reply) => {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = createEntrySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Verify employee belongs to tenant
    const { data: emp } = await fastify.supabase
      .from('employees')
      .select('id')
      .eq('id', parsed.data.employee_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const { data, error } = await fastify.supabase
      .from('payroll_explainability_ledger')
      .insert({
        tenant_id:  req.tenantId,
        created_by: req.userId,
        ...parsed.data,
      })
      .select('id, event_type, event_description, impact_type, impact_amount, created_at')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create ledger entry' })
    }

    return reply.code(201).send({ data })
  })
}
