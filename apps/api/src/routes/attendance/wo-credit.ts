/**
 * Weekly-Off Credit Routes — Phase 1
 *
 * GET    /attendance/wo-credit/structures            — list structures (+ ladder)
 * POST   /attendance/wo-credit/structures            — create structure (+ ladder)   [HR]
 * PUT    /attendance/wo-credit/structures/:id        — update structure (+ ladder)   [HR]
 * DELETE /attendance/wo-credit/structures/:id        — delete structure              [HR]
 * GET    /attendance/wo-credit/review?year&month     — monthly review grid
 * POST   /attendance/wo-credit/reconcile             — run reconciliation now        [HR]
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { reconcileTenantMonth, finalizeTenantMonth } from '../../lib/wo-credit-reconciler.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

const ladderRowSchema = z.object({
  present_days: z.number().int().min(1).max(31),
  wo_credit:    z.number().int().min(0).max(31),
})

const structureSchema = z.object({
  name:                 z.string().min(1).max(120),
  is_active:            z.boolean().optional(),
  monthly_cap:          z.enum(['sundays', 'none']).optional(),
  rollover_expiry_days: z.number().int().min(1).max(365).optional(),
  holiday_work_reward:  z.enum(['wo_credit', 'extra_pay']).optional(),
  holiday_pay_multiplier: z.number().min(0.1).max(10).optional(),
  wo_leave_type_id:     z.string().uuid().optional().nullable(),
  ladder:               z.array(ladderRowSchema).max(31).optional(),
})

export default async function woCreditRoutes(fastify: FastifyInstance) {
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // Load ladders for a set of structure ids → map
  async function loadLadders(structureIds: string[]) {
    if (!structureIds.length) return new Map<string, any[]>()
    const { data } = await fastify.supabase
      .from('wo_credit_ladder')
      .select('structure_id, present_days, wo_credit')
      .in('structure_id', structureIds)
      .order('present_days', { ascending: true })
    const map = new Map<string, any[]>()
    for (const r of (data ?? []) as any[]) {
      const arr = map.get(r.structure_id) ?? []
      arr.push({ present_days: r.present_days, wo_credit: r.wo_credit })
      map.set(r.structure_id, arr)
    }
    return map
  }

  // Returns the raw Supabase error (from either step) so callers can react —
  // instead of silently leaving the structure's ladder empty or half-replaced.
  // The caller is responsible for converting this to a safe response via
  // serverError(); this helper never sends a reply itself.
  async function replaceLadder(
    structureId: string,
    ladder: { present_days: number; wo_credit: number }[],
  ): Promise<{ code: typeof ErrorCode.DELETE_FAILED | typeof ErrorCode.INSERT_FAILED; error: unknown } | null> {
    const { error: delError } = await fastify.supabase.from('wo_credit_ladder').delete().eq('structure_id', structureId)
    if (delError) return { code: ErrorCode.DELETE_FAILED, error: delError }
    if (ladder.length) {
      const { error: insError } = await fastify.supabase.from('wo_credit_ladder').insert(
        ladder.map(l => ({ structure_id: structureId, present_days: l.present_days, wo_credit: l.wo_credit })),
      )
      if (insError) return { code: ErrorCode.INSERT_FAILED, error: insError }
    }
    return null
  }

  // ── GET /structures ─────────────────────────────────────────────────────────
  fastify.get('/attendance/wo-credit/structures', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('wo_credit_structure')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('name', { ascending: true })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch WO credit structures')

    const structs = (data ?? []) as any[]
    const ladders = await loadLadders(structs.map(s => s.id))
    return reply.send({ data: structs.map(s => ({ ...s, ladder: ladders.get(s.id) ?? [] })) })
  })

  // Ensure a paid "Weekly Off Credit" leave type exists for the tenant so carried
  // credit can be redeemed via the normal leave-request flow. Returns its id.
  async function ensureWoLeaveType(tenantId: string): Promise<string | null> {
    const { data: existing } = await fastify.supabase
      .from('leave_types')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', 'Weekly Off Credit')
      .maybeSingle()
    if ((existing as any)?.id) return (existing as any).id
    const { data: created, error } = await fastify.supabase
      .from('leave_types')
      .insert({ tenant_id: tenantId, name: 'Weekly Off Credit', is_paid: true, is_active: true })
      .select('id')
      .single()
    if (error) return null
    return (created as any).id
  }

  // ── POST /structures ──────────────────────────────────────────────────────
  fastify.post('/attendance/wo-credit/structures', hrAdminAuth, async (req: any, reply) => {
    const parsed = structureSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { ladder, ...fields } = parsed.data

    // Auto-provision the redemption leave type if the caller didn't pick one.
    const woLeaveTypeId = fields.wo_leave_type_id ?? await ensureWoLeaveType(req.tenantId)

    const { data, error } = await fastify.supabase
      .from('wo_credit_structure')
      .insert({ ...fields, wo_leave_type_id: woLeaveTypeId, tenant_id: req.tenantId })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'DUPLICATE_NAME', message: 'A structure with this name already exists' })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create WO credit structure')
    }
    if (ladder) {
      const ladderErr = await replaceLadder((data as any).id, ladder)
      if (ladderErr) return serverError(req, reply, ladderErr.error, ladderErr.code, 'Failed to save WO credit ladder')
    }
    return reply.code(201).send({ data: { ...data, ladder: ladder ?? [] } })
  })

  // ── PUT /structures/:id ────────────────────────────────────────────────────
  fastify.put('/attendance/wo-credit/structures/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = structureSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    const { ladder, ...fields } = parsed.data

    // Tenant isolation: wo_credit_ladder is a child table keyed by structure_id
    // with no tenant_id column, so replaceLadder() can't self-scope. Verify the
    // parent structure belongs to the caller's tenant before any mutation —
    // otherwise a body carrying only `ladder` would skip the tenant-scoped
    // metadata update and let replaceLadder() wipe another tenant's ladder.
    const { data: owned, error: ownedError } = await fastify.supabase
      .from('wo_credit_structure')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (ownedError) return serverError(req, reply, ownedError, ErrorCode.QUERY_FAILED, 'Failed to verify WO credit structure')
    if (!owned) return notFound(reply, 'NOT_FOUND', 'Structure not found')

    if (Object.keys(fields).length) {
      const { error } = await fastify.supabase
        .from('wo_credit_structure')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', req.tenantId)
      if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update WO credit structure')
    }
    if (ladder) {
      const ladderErr = await replaceLadder(id, ladder)
      if (ladderErr) return serverError(req, reply, ladderErr.error, ladderErr.code, 'Failed to save WO credit ladder')
    }

    const { data, error: refetchError } = await fastify.supabase
      .from('wo_credit_structure').select('*').eq('id', id).eq('tenant_id', req.tenantId).maybeSingle()
    if (refetchError) return serverError(req, reply, refetchError, ErrorCode.QUERY_FAILED, 'Failed to reload WO credit structure')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Structure not found')
    const ladders = await loadLadders([id])
    return reply.send({ data: { ...data, ladder: ladders.get(id) ?? [] } })
  })

  // ── DELETE /structures/:id ─────────────────────────────────────────────────
  fastify.delete('/attendance/wo-credit/structures/:id', hrAdminAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await fastify.supabase
      .from('wo_credit_structure').delete().eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete WO credit structure')
    return reply.code(204).send()
  })

  // ── GET /review?year&month ─────────────────────────────────────────────────
  fastify.get('/attendance/wo-credit/review', hrAdminAuth, async (req: any, reply) => {
    // Default "this month" from the tenant's local calendar, not server UTC —
    // this is a month-close/payroll-adjacent operation, so a UTC default can
    // resolve to the wrong month near the UTC/local-midnight boundary.
    const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
    const today = getLocalDate(new Date().toISOString(), tz)
    const [todayYear, todayMonth] = today.split('-').map(Number)
    const year  = parseInt((req.query as any).year  ?? String(todayYear), 10)
    const month = parseInt((req.query as any).month ?? String(todayMonth), 10)

    const { data, error } = await fastify.supabase
      .from('wo_credit_monthly')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('year', year)
      .eq('month', month)
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch WO credit review data')

    // Enrich with employee names
    const rows = (data ?? []) as any[]
    const empIds = [...new Set(rows.map(r => r.employee_id))]
    const nameMap = new Map<string, string>()
    if (empIds.length) {
      const { data: emps } = await fastify.supabase
        .from('employees').select('id, first_name, last_name, employee_code')
        .eq('tenant_id', req.tenantId).in('id', empIds)
      for (const e of (emps ?? []) as any[]) {
        nameMap.set(e.id, `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.employee_code)
      }
    }
    return reply.send({
      data: rows.map(r => ({ ...r, employee_name: nameMap.get(r.employee_id) ?? r.employee_id })),
      year, month,
    })
  })

  // ── POST /reconcile ────────────────────────────────────────────────────────
  fastify.post('/attendance/wo-credit/reconcile', hrAdminAuth, async (req: any, reply) => {
    const body = (req.body ?? {}) as { year?: number; month?: number }
    let year = body.year
    let month = body.month
    if (year === undefined || month === undefined) {
      const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
      const today = getLocalDate(new Date().toISOString(), tz)
      const [todayYear, todayMonth] = today.split('-').map(Number)
      year  ??= todayYear
      month ??= todayMonth
    }
    try {
      const results = await reconcileTenantMonth(fastify.supabase, req.tenantId, year, month)
      const summary = {
        employees: results.length,
        applied:   results.reduce((s, r) => s + r.auto_applied, 0),
        pending:   results.reduce((s, r) => s + r.pending_absent_days, 0),
        carried:   results.reduce((s, r) => s + r.carried_out, 0),
      }
      return reply.send({ data: summary })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to reconcile WO credit for the month')
    }
  })

  // ── POST /finalize ─────────────────────────────────────────────────────────
  // Month-close: credit leftover credit into the WO leave type (carry-over with
  // expiry), record LOP for uncovered absences, and lock the month. Idempotent.
  fastify.post('/attendance/wo-credit/finalize', hrAdminAuth, async (req: any, reply) => {
    const body = (req.body ?? {}) as { year?: number; month?: number }
    let year = body.year
    let month = body.month
    if (year === undefined || month === undefined) {
      const tz = await fetchTenantTz(fastify.supabase, req.tenantId)
      const today = getLocalDate(new Date().toISOString(), tz)
      const [todayYear, todayMonth] = today.split('-').map(Number)
      year  ??= todayYear
      month ??= todayMonth
    }
    try {
      const results = await finalizeTenantMonth(fastify.supabase, req.tenantId, year, month)
      const summary = {
        employees: results.length,
        carried:   results.reduce((s, r) => s + r.carried_out, 0),
        lop:       results.reduce((s, r) => s + r.lop_days, 0),
        credited:  results.filter(r => r.credited).length,
      }
      return reply.send({ data: summary })
    } catch (err: unknown) {
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to finalize WO credit for the month')
    }
  })
}
