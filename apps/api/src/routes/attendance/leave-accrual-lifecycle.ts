/**
 * Leave Accrual Lifecycle Routes
 *
 * Freeze management, tier management, lifecycle status per employee.
 *
 * GET  /leave/lifecycle/status/:employeeId/:leaveTypeId  — lifecycle summary
 *
 * POST /leave/lifecycle/freeze                           — create a freeze
 * GET  /leave/lifecycle/freeze/:employeeId               — list freezes
 * POST /leave/lifecycle/freeze/:freezeId/lift            — lift a freeze
 *
 * GET  /leave/lifecycle/tiers/:policyRuleId              — list tiers for a rule
 * POST /leave/lifecycle/tiers/:policyRuleId              — create tier
 * PUT  /leave/lifecycle/tiers/:tierId                    — update tier
 * DELETE /leave/lifecycle/tiers/:tierId                  — delete tier
 *
 * GET  /leave/lifecycle/held-credits/:employeeId         — credits held (not yet consumable)
 * POST /leave/lifecycle/release                          — manually release held credits
 *
 * Auth: all routes require JWT.
 *       Freeze/tier write routes require hr_admin or super_admin.
 *       Status and held-credits routes: hr_admin sees all; employee sees own.
 */
import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import {
  computeLifecycleStatus,
  type LifecyclePolicy,
  type AccrualTierRow,
  type ActiveFreeze,
} from '../../lib/leave-accrual-lifecycle-engine.js'

const dateRe = /^\d{4}-\d{2}-\d{2}$/

function isAdmin(role: string): boolean {
  return ['super_admin', 'hr_admin'].includes(role)
}

export default async function leaveAccrualLifecycleRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [(fastify as any).authenticate] }

  // ── GET /leave/lifecycle/status/:employeeId/:leaveTypeId ──────────────────────
  //
  // Returns a lifecycle status summary for an employee + leave type.
  // HR sees any employee; employee can only see their own.
  ;(fastify as any).get(
    '/leave/lifecycle/status/:employeeId/:leaveTypeId',
    auth,
    async (req: any, reply: any) => {
      const { employeeId, leaveTypeId } = req.params as { employeeId: string; leaveTypeId: string }

      // Resolve caller's own employee_id for access check
      if (!isAdmin(req.userRole)) {
        const { data: profile } = await fastify.supabase
          .from('profiles')
          .select('employee_id')
          .eq('id', req.userId)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        const myEmpId = (profile as any)?.employee_id
        if (myEmpId !== employeeId) {
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
        }
      }

      const asOf = new Date().toISOString().slice(0, 10)

      // Fetch employee
      const { data: emp } = await fastify.supabase
        .from('employees')
        .select('id, joining_date, employee_separation!employee_separation_employee_id_fkey(last_working_date)')
        .eq('id', employeeId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if (emp) (emp as any).separation_date = ((emp as any).employee_separation ?? [])[0]?.last_working_date ?? null

      if (!emp) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }

      // Resolve lifecycle policy (priority chain: assignment → legacy → default)
      const policy = await resolveLifecyclePolicyForEmployee(
        fastify.supabase,
        req.tenantId,
        employeeId,
        leaveTypeId,
        asOf,
      )

      if (!policy) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'No leave policy configured for this leave type' })
      }

      // Fetch tiers
      const tiers = await fetchTiersForPolicy(fastify.supabase, req.tenantId, policy.id)

      // Fetch active freezes
      const freezes = await fetchActiveFreezesForEmployee(
        fastify.supabase, req.tenantId, employeeId, leaveTypeId, asOf,
      )

      // Fetch held credits (consumption_eligible_from > today)
      const heldCredits = await fetchHeldCreditTotal(
        fastify.supabase, req.tenantId, employeeId, leaveTypeId, asOf,
      )

      const status = computeLifecycleStatus(
        employeeId,
        leaveTypeId,
        (emp as any).joining_date,
        asOf,
        policy,
        tiers,
        freezes,
        heldCredits,
      )

      return reply.send({ data: status })
    },
  )

  // ── POST /leave/lifecycle/freeze ───────────────────────────────────────────────
  ;(fastify as any).post('/leave/lifecycle/freeze', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const schema = z.object({
      employee_id:   z.string().uuid(),
      leave_type_id: z.string().uuid().optional(),
      freeze_from:   z.string().regex(dateRe),
      freeze_to:     z.string().regex(dateRe).optional().nullable(),
      reason:        z.string().min(3).max(500),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: freeze, error } = await fastify.supabase
      .from('leave_accrual_freezes')
      .insert({
        tenant_id:     req.tenantId,
        employee_id:   parsed.data.employee_id,
        leave_type_id: parsed.data.leave_type_id ?? null,
        freeze_from:   parsed.data.freeze_from,
        freeze_to:     parsed.data.freeze_to ?? null,
        reason:        parsed.data.reason,
        status:        'active',
        created_by:    req.userId,
      })
      .select()
      .single()

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: 'Failed to create freeze' })
    }

    return reply.code(201).send({ data: freeze })
  })

  // ── GET /leave/lifecycle/freeze/:employeeId ─────────────────────────────────
  ;(fastify as any).get('/leave/lifecycle/freeze/:employeeId', auth, async (req: any, reply: any) => {
    const { employeeId } = req.params as { employeeId: string }

    if (!isAdmin(req.userRole)) {
      // Employees can view their own freeze state
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if ((profile as any)?.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
      }
    }

    const { data: freezes } = await fastify.supabase
      .from('leave_accrual_freezes')
      .select('*, leave_types(id, name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('freeze_from', { ascending: false })

    return reply.send({ data: freezes ?? [] })
  })

  // ── POST /leave/lifecycle/freeze/:freezeId/lift ────────────────────────────
  ;(fastify as any).post('/leave/lifecycle/freeze/:freezeId/lift', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { freezeId } = req.params as { freezeId: string }

    const { data: freeze } = await fastify.supabase
      .from('leave_accrual_freezes')
      .select('id, status')
      .eq('id', freezeId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!freeze) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Freeze not found' })
    }
    if ((freeze as any).status !== 'active') {
      return reply.code(409).send({ error: 'CONFLICT', message: 'Freeze is not active' })
    }

    const { data: updated } = await fastify.supabase
      .from('leave_accrual_freezes')
      .update({
        status:    'lifted',
        lifted_by: req.userId,
        lifted_at: new Date().toISOString(),
        freeze_to: new Date().toISOString().slice(0, 10),  // close the range
      })
      .eq('id', freezeId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    return reply.send({ data: updated })
  })

  // ── GET /leave/lifecycle/tiers/:policyRuleId ────────────────────────────────
  ;(fastify as any).get('/leave/lifecycle/tiers/:policyRuleId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { policyRuleId } = req.params as { policyRuleId: string }

    const { data: tiers } = await fastify.supabase
      .from('leave_accrual_tiers')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('rule_id', policyRuleId)
      .order('service_years_from', { ascending: true })

    return reply.send({ data: tiers ?? [] })
  })

  // ── POST /leave/lifecycle/tiers/:policyRuleId ───────────────────────────────
  ;(fastify as any).post('/leave/lifecycle/tiers/:policyRuleId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { policyRuleId } = req.params as { policyRuleId: string }

    const schema = z.object({
      service_years_from:    z.number().min(0),
      service_years_to:      z.number().positive().nullable().optional(),
      accrual_days_per_year: z.number().positive(),
      description:           z.string().max(255).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Verify the rule belongs to this tenant
    const { data: rule } = await fastify.supabase
      .from('leave_policy_rules')
      .select('id')
      .eq('id', policyRuleId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!rule) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Policy rule not found' })
    }

    const { data: tier, error } = await fastify.supabase
      .from('leave_accrual_tiers')
      .insert({
        tenant_id:             req.tenantId,
        rule_id:               policyRuleId,
        service_years_from:    parsed.data.service_years_from,
        service_years_to:      parsed.data.service_years_to ?? null,
        accrual_days_per_year: parsed.data.accrual_days_per_year,
        description:           parsed.data.description ?? null,
      })
      .select()
      .single()

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: 'Failed to create tier' })
    }

    return reply.code(201).send({ data: tier })
  })

  // ── PUT /leave/lifecycle/tiers/:tierId ──────────────────────────────────────
  ;(fastify as any).put('/leave/lifecycle/tiers/:tierId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { tierId } = req.params as { tierId: string }

    const schema = z.object({
      service_years_from:    z.number().min(0).optional(),
      service_years_to:      z.number().positive().nullable().optional(),
      accrual_days_per_year: z.number().positive().optional(),
      description:           z.string().max(255).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: updated, error } = await fastify.supabase
      .from('leave_accrual_tiers')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', tierId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error || !updated) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tier not found' })
    }

    return reply.send({ data: updated })
  })

  // ── DELETE /leave/lifecycle/tiers/:tierId ───────────────────────────────────
  ;(fastify as any).delete('/leave/lifecycle/tiers/:tierId', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { tierId } = req.params as { tierId: string }

    const { error } = await fastify.supabase
      .from('leave_accrual_tiers')
      .delete()
      .eq('id', tierId)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: 'Failed to delete tier' })
    }

    return reply.code(204).send()
  })

  // ── GET /leave/lifecycle/all-freezes ────────────────────────────────────────
  //
  // Returns ALL active freezes across tenant (admin-only) for governance dashboard.
  ;(fastify as any).get('/leave/lifecycle/all-freezes', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { data: freezes } = await fastify.supabase
      .from('leave_accrual_freezes')
      .select(`
        id, employee_id, leave_type_id, freeze_from, freeze_to, reason, status,
        employees!inner(first_name, last_name, employee_code),
        leave_types(id, name)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')
      .order('freeze_from', { ascending: false })

    return reply.send({ data: freezes ?? [] })
  })

  // ── GET /leave/lifecycle/held-credits-summary ────────────────────────────────
  //
  // Returns tenant-wide aggregated held credits per employee+leave-type (admin-only).
  ;(fastify as any).get('/leave/lifecycle/held-credits-summary', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const today = new Date().toISOString().slice(0, 10)

    const { data: held } = await fastify.supabase
      .from('leave_accrual_ledger')
      .select(`
        employee_id, leave_type_id, days,
        consumption_eligible_from, release_trigger,
        employees!inner(first_name, last_name, employee_code),
        leave_types(id, name)
      `)
      .eq('tenant_id', req.tenantId)
      .eq('is_expired', false)
      .gt('consumption_eligible_from', today)
      .not('consumption_eligible_from', 'is', null)
      .order('consumption_eligible_from', { ascending: true })

    // Aggregate by employee + leave type
    const summaryMap = new Map<string, any>()
    for (const r of (held ?? []) as any[]) {
      const key = `${r.employee_id}:${r.leave_type_id}`
      const existing = summaryMap.get(key)
      if (existing) {
        existing.total_held_days += Number(r.days)
        if (r.consumption_eligible_from && (!existing.earliest_release || r.consumption_eligible_from < existing.earliest_release)) {
          existing.earliest_release = r.consumption_eligible_from
        }
      } else {
        summaryMap.set(key, {
          employee_id:      r.employee_id,
          leave_type_id:    r.leave_type_id,
          total_held_days:  Number(r.days),
          earliest_release: r.consumption_eligible_from,
          release_trigger:  r.release_trigger,
          employees:        r.employees,
          leave_types:      r.leave_types,
        })
      }
    }

    return reply.send({ data: Array.from(summaryMap.values()) })
  })

  // ── GET /leave/lifecycle/held-credits/:employeeId ───────────────────────────
  //
  // Returns all ledger entries with consumption_eligible_from > today
  // for the given employee (credits that are posted but not yet consumable).
  ;(fastify as any).get('/leave/lifecycle/held-credits/:employeeId', auth, async (req: any, reply: any) => {
    const { employeeId } = req.params as { employeeId: string }

    if (!isAdmin(req.userRole)) {
      const { data: profile } = await fastify.supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', req.userId)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()

      if ((profile as any)?.employee_id !== employeeId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
      }
    }

    const today = new Date().toISOString().slice(0, 10)

    const { data: held } = await fastify.supabase
      .from('leave_accrual_ledger')
      .select('id, leave_type_id, days, cycle_period, release_trigger, consumption_eligible_from, accrued_on, leave_types(id, name)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .eq('is_expired', false)
      .gt('consumption_eligible_from', today)
      .not('consumption_eligible_from', 'is', null)
      .order('consumption_eligible_from', { ascending: true })

    return reply.send({ data: held ?? [] })
  })

  // ── POST /leave/lifecycle/release ───────────────────────────────────────────
  //
  // Manual release of held credits (admin-initiated, e.g. after payroll lock).
  ;(fastify as any).post('/leave/lifecycle/release', auth, async (req: any, reply: any) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const schema = z.object({
      ledger_entry_ids: z.array(z.string().uuid()).min(1).max(100),
      trigger_reference: z.string().max(255).optional(),
      notes:            z.string().max(500).optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: entries } = await fastify.supabase
      .from('leave_accrual_ledger')
      .select('id, employee_id, leave_type_id, days, year, cycle_period, consumption_eligible_from')
      .eq('tenant_id', req.tenantId)
      .in('id', parsed.data.ledger_entry_ids)
      .eq('is_expired', false)
      .not('consumption_eligible_from', 'is', null)

    if (!entries?.length) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No held credit entries found' })
    }

    const released = []
    const errors   = []

    for (const entry of entries as any[]) {
      try {
        // Insert release event
        await fastify.supabase.from('leave_entitlement_releases').insert({
          tenant_id:         req.tenantId,
          employee_id:       entry.employee_id,
          leave_type_id:     entry.leave_type_id,
          ledger_entry_id:   entry.id,
          cycle_period:      entry.cycle_period ?? `${entry.year}`,
          days_released:     entry.days,
          release_trigger:   'manual_release',
          trigger_reference: parsed.data.trigger_reference ?? null,
          released_at:       new Date().toISOString(),
          released_by:       req.userId,
          notes:             parsed.data.notes ?? null,
        })

        // Clear the hold date
        await fastify.supabase
          .from('leave_accrual_ledger')
          .update({ consumption_eligible_from: null })
          .eq('id', entry.id)

        released.push(entry.id)
      } catch (err: any) {
        errors.push(`Entry ${entry.id}: ${err?.message ?? 'unknown'}`)
      }
    }

    return reply.send({
      data: {
        released_count: released.length,
        released_ids:   released,
        errors,
      },
    })
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve a LifecyclePolicy for an employee + leave type.
 *
 * Priority chain (mirrors resolveEffectiveDurationPolicy in leave-duration.ts):
 *   1. employee-scope assignment
 *   2. department-scope assignment (employee's current department)
 *   3. work_location-scope assignment (employee's current work location)
 *   4. default-scope assignment
 *   5. legacy leave_policies table
 *   → null when nothing is configured
 */
async function resolveLifecyclePolicyForEmployee(
  supabase:    any,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  asOf:        string,
): Promise<LifecyclePolicy | null> {
  // Fetch employee's department + work_location to support scope resolution
  const { data: emp } = await supabase
    .from('employees')
    .select('work_location_id, job_history!job_history_employee_id_fkey(department_id, is_current)')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (emp) {
    const jh = ((emp as any).job_history ?? []).find((j: any) => j.is_current) ?? ((emp as any).job_history ?? [])[0] ?? null
    ;(emp as any).department_id = jh?.department_id ?? null
  }
  const empData = emp as { department_id: string | null; work_location_id: string | null } | null

  // Build scope candidates in priority order
  const scopeCandidates: Array<{ scope_type: string; scope_id: string | null }> = [
    { scope_type: 'employee',      scope_id: employeeId },
    { scope_type: 'department',    scope_id: empData?.department_id    ?? null },
    { scope_type: 'work_location', scope_id: empData?.work_location_id ?? null },
    { scope_type: 'default',       scope_id: null },
  ]

  // Helper: fetch the policy rule for a given assignment
  const findRuleForAssignment = async (policyId: string): Promise<LifecyclePolicy | null> => {
    const { data: masterAndRule } = await supabase
      .from('leave_policy_rules')
      .select(`
        id, policy_id, leave_type_id,
        accrual_type, accrual_days_per_year,
        eligibility_days,
        minimum_service_days, minimum_paid_days, minimum_attendance_pct,
        accrual_earning_basis, accrual_credit_timing, accrual_consumption_timing,
        future_accrual_consumable, advance_accrual_recovery_mode,
        joining_cycle_handling, separation_cycle_handling,
        payroll_cutoff_behavior, accrual_freeze_mode,
        tiered_accrual_enabled, service_anniversary_cycle,
        leave_policy_masters!inner(id, year_type)
      `)
      .eq('policy_id',     policyId)
      .eq('leave_type_id', leaveTypeId)
      .eq('tenant_id',     tenantId)
      .maybeSingle()

    if (!masterAndRule) return null
    const rule     = masterAndRule as any
    const yearType = rule.leave_policy_masters?.year_type ?? 'calendar'
    return buildLifecyclePolicyFromRule(rule, yearType)
  }

  // Walk scope chain
  for (const candidate of scopeCandidates) {
    if (candidate.scope_type !== 'default' && !candidate.scope_id) continue

    let assignmentQuery = supabase
      .from('leave_policy_assignments')
      .select('policy_id')
      .eq('tenant_id',  tenantId)
      .eq('scope_type', candidate.scope_type)
      .or(`effective_from.is.null,effective_from.lte.${asOf}`)
      .or(`effective_to.is.null,effective_to.gte.${asOf}`)

    if (candidate.scope_id) {
      assignmentQuery = assignmentQuery.eq('scope_id', candidate.scope_id)
    }

    const { data: assignments } = await assignmentQuery.limit(5)
    if (!assignments || (assignments as any[]).length === 0) continue

    for (const assignment of assignments as any[]) {
      const policy = await findRuleForAssignment(assignment.policy_id)
      if (policy) return policy
    }
  }

  // Fall back to legacy leave_policies
  const { data: legacy } = await supabase
    .from('leave_policies')
    .select('*')
    .eq('tenant_id',     tenantId)
    .eq('leave_type_id', leaveTypeId)
    .maybeSingle()

  if (legacy) {
    return buildLifecyclePolicyFromLegacy(legacy as any)
  }

  return null
}

function buildLifecyclePolicyFromRule(rule: any, yearType: string): LifecyclePolicy {
  return {
    id:                         rule.id,
    leave_type_id:              rule.leave_type_id,
    accrual_type:               rule.accrual_type,
    accrual_days_per_year:      Number(rule.accrual_days_per_year),
    year_type:                  (yearType as 'calendar' | 'financial') ?? 'calendar',
    eligibility_days:           rule.eligibility_days ?? 0,
    minimum_service_days:       rule.minimum_service_days ?? 0,
    minimum_paid_days:          rule.minimum_paid_days ?? 0,
    minimum_attendance_pct:     Number(rule.minimum_attendance_pct ?? 0),
    accrual_earning_basis:      rule.accrual_earning_basis ?? 'earned',
    accrual_credit_timing:      rule.accrual_credit_timing ?? 'cycle_start',
    accrual_consumption_timing: rule.accrual_consumption_timing ?? 'immediate',
    future_accrual_consumable:  rule.future_accrual_consumable ?? true,
    advance_accrual_recovery_mode: rule.advance_accrual_recovery_mode ?? 'none',
    joining_cycle_handling:     rule.joining_cycle_handling ?? 'prorate',
    separation_cycle_handling:  rule.separation_cycle_handling ?? 'prorate',
    payroll_cutoff_behavior:    rule.payroll_cutoff_behavior ?? 'hold',
    accrual_freeze_mode:        rule.accrual_freeze_mode ?? 'skip',
    tiered_accrual_enabled:     rule.tiered_accrual_enabled ?? false,
    service_anniversary_cycle:  rule.service_anniversary_cycle ?? false,
  }
}

function buildLifecyclePolicyFromLegacy(row: any): LifecyclePolicy {
  return {
    id:                         row.id,
    leave_type_id:              row.leave_type_id,
    accrual_type:               row.accrual_type ?? 'monthly',
    accrual_days_per_year:      Number(row.accrual_days_per_year),
    year_type:                  row.year_type ?? 'calendar',
    eligibility_days:           row.eligibility_days ?? 0,
    minimum_service_days:       row.minimum_service_days ?? 0,
    minimum_paid_days:          row.minimum_paid_days ?? 0,
    minimum_attendance_pct:     Number(row.minimum_attendance_pct ?? 0),
    accrual_earning_basis:      row.accrual_earning_basis ?? 'earned',
    accrual_credit_timing:      row.accrual_credit_timing ?? 'cycle_start',
    accrual_consumption_timing: row.accrual_consumption_timing ?? 'immediate',
    future_accrual_consumable:  row.future_accrual_consumable ?? true,
    advance_accrual_recovery_mode: row.advance_accrual_recovery_mode ?? 'none',
    joining_cycle_handling:     row.joining_cycle_handling ?? 'prorate',
    separation_cycle_handling:  row.separation_cycle_handling ?? 'prorate',
    payroll_cutoff_behavior:    row.payroll_cutoff_behavior ?? 'hold',
    accrual_freeze_mode:        row.accrual_freeze_mode ?? 'skip',
    tiered_accrual_enabled:     row.tiered_accrual_enabled ?? false,
    service_anniversary_cycle:  row.service_anniversary_cycle ?? false,
  }
}

async function fetchTiersForPolicy(
  supabase:    any,
  tenantId:    string,
  ruleId:      string,
): Promise<AccrualTierRow[]> {
  const { data: tiers } = await supabase
    .from('leave_accrual_tiers')
    .select('id, service_years_from, service_years_to, accrual_days_per_year, description')
    .eq('tenant_id', tenantId)
    .eq('rule_id', ruleId)
    .order('service_years_from', { ascending: true })

  return ((tiers ?? []) as any[]).map(t => ({
    id:                    t.id,
    service_years_from:    Number(t.service_years_from),
    service_years_to:      t.service_years_to != null ? Number(t.service_years_to) : null,
    accrual_days_per_year: Number(t.accrual_days_per_year),
    description:           t.description ?? null,
  }))
}

async function fetchActiveFreezesForEmployee(
  supabase:    any,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  asOf:        string,
): Promise<ActiveFreeze[]> {
  const { data: freezes } = await supabase
    .from('leave_accrual_freezes')
    .select('id, freeze_from, freeze_to, reason')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .or(`leave_type_id.eq.${leaveTypeId},leave_type_id.is.null`)
    .lte('freeze_from', asOf)
    .or(`freeze_to.is.null,freeze_to.gte.${asOf}`)

  return ((freezes ?? []) as any[]).map(f => ({
    id:                  f.id,
    freeze_from:         f.freeze_from,
    freeze_to:           f.freeze_to ?? null,
    accrual_freeze_mode: 'skip' as const,
    reason:              f.reason,
  }))
}

async function fetchHeldCreditTotal(
  supabase:    any,
  tenantId:    string,
  employeeId:  string,
  leaveTypeId: string,
  asOf:        string,
): Promise<number> {
  const { data: held } = await supabase
    .from('leave_accrual_ledger')
    .select('days')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('leave_type_id', leaveTypeId)
    .eq('is_expired', false)
    .gt('consumption_eligible_from', asOf)
    .not('consumption_eligible_from', 'is', null)

  return ((held ?? []) as any[]).reduce((sum, r) => sum + Number(r.days), 0)
}
