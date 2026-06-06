/**
 * ESI (Employees' State Insurance) Routes
 * Configuration, eligibility, and contributions.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeESI } from '../../../lib/statutory/esi-engine.js'
import type { ESIConfig } from '../../../lib/statutory/esi-engine.js'

export default async function esiRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /payroll/statutory/esi/config ─────────────────────────────────────────
  // Returns the most recent config row.  We avoid filtering on effective_to IS NULL
  // because that column was added in migration 166 and may not exist in all deployments.
  fastify.get('/config', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('esi_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // ── PUT /payroll/statutory/esi/config ─────────────────────────────────────────
  // Creates a new versioned ESI config row (same versioning pattern as EPF).
  // Closes the current open-ended row before inserting the new one.
  fastify.put('/config', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_contribution_pct: z.number().optional(),
      employer_contribution_pct: z.number().optional(),
      wage_ceiling:              z.number().optional(),
      effective_from:            z.string(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { effective_from, ...rest } = parsed.data

    // Close current open-ended config
    const prevDay = new Date(effective_from)
    prevDay.setDate(prevDay.getDate() - 1)
    await fastify.supabase
      .from('esi_config')
      .update({ effective_to: prevDay.toISOString().slice(0, 10) })
      .eq('tenant_id', req.tenantId)
      .is('effective_to', null)

    const { data, error } = await fastify.supabase
      .from('esi_config')
      .insert({
        ...rest,
        effective_from,
        tenant_id:  req.tenantId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── GET /payroll/statutory/esi/eligibility ────────────────────────────────────
  fastify.get('/eligibility', auth, async (req: any, reply) => {
    const querySchema = z.object({
      employee_id: z.string().uuid().optional(),
      active_only: z.enum(['true', 'false']).optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('esi_eligibility_timeline')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)
    if (parsed.data.active_only === 'true') q = q.is('effective_to', null)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/esi/eligibility ───────────────────────────────────
  fastify.post('/eligibility', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      employee_id: z.string().uuid(),
      is_esi_applicable: z.boolean(),
      gross_wages: z.number(),
      effective_from: z.string(),
      effective_to: z.string().optional(),
      reason: z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data, error } = await fastify.supabase
      .from('esi_eligibility_timeline')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── GET /payroll/statutory/esi/contributions ──────────────────────────────────
  fastify.get('/contributions', auth, async (req: any, reply) => {
    const querySchema = z.object({
      month: z.string().optional(),
      employee_id: z.string().uuid().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    let q = fastify.supabase
      .from('esi_contributions')
      .select('*')
      .eq('tenant_id', req.tenantId)

    if (parsed.data.month) q = q.eq('contribution_month', parsed.data.month)
    if (parsed.data.employee_id) q = q.eq('employee_id', parsed.data.employee_id)

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/esi/contributions/compute ────────────────────────
  fastify.post('/contributions/compute', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { month } = parsed.data
    const monthDate = `${month}-01`

    // Guard: statutory contributions must be computed from a FINALIZED payroll run.
    {
      const { data: runRow } = await fastify.supabase
        .from('payroll_runs').select('status').eq('tenant_id', req.tenantId).eq('month', month).maybeSingle()
      const st = (runRow as any)?.status
      if (st !== 'finalized' && st !== 'partial_failed' && st !== 'frozen') {
        return reply.code(409).send({
          error: 'RUN_NOT_FINALIZED',
          message: `Finalize the ${month} payroll run before computing ESI contributions (current: ${st ?? 'no run'}).`,
        })
      }
    }

    // ── ESI config (effective-date-guarded, most recent row) ─────────────────
    const { data: configRow, error: configErr } = await fastify.supabase
      .from('esi_config')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (configErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch ESI config' })

    const config: ESIConfig = configRow ? {
      employeeContributionPct: configRow.employee_contribution_pct ?? 0.75,
      employerContributionPct: configRow.employer_contribution_pct ?? 3.25,
      wageCeiling:             configRow.wage_ceiling              ?? 21000,
    } : {
      employeeContributionPct: 0.75,
      employerContributionPct: 3.25,
      wageCeiling:             21000,
    }

    // ── Active employees ──────────────────────────────────────────────────────
    const { data: employees, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, employee_code')
      .eq('tenant_id', req.tenantId)
      .eq('status', 'active')

    if (empErr) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch employees' })

    const empList = (employees ?? []) as Array<{ id: string; employee_code: string }>

    // ── ESI exemption overrides (employee_statutory_overrides) ───────────────
    // The old esi_eligibility_timeline.is_esi_applicable is supplemented by
    // the new employee_statutory_overrides table.  Check both.
    const { data: exemptRows } = await fastify.supabase
      .from('employee_statutory_overrides')
      .select('employee_id')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'esi')
      .eq('is_exempt', true)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)

    const exemptSet = new Set<string>(((exemptRows ?? []) as any[]).map(r => r.employee_id))

    // Legacy eligibility overrides from esi_eligibility_timeline
    // Also fetch continuation_until — when set, ESI contributions are forced through
    // the contribution period end even if wages cross the ₹21,000 ceiling mid-period.
    const { data: eligibilityRows } = await fastify.supabase
      .from('esi_eligibility_timeline')
      .select('employee_id, is_esi_applicable, continuation_until')
      .eq('tenant_id', req.tenantId)
      .lte('effective_from', monthDate)
      .or('effective_to.is.null,effective_to.gte.' + monthDate)
      .order('effective_from', { ascending: false })

    const eligibilityMap = new Map<string, boolean>()
    // continuation_until: last day of contribution period (Sep 30 or Mar 31).
    // Active when continuation_until >= last calendar day of the payroll month.
    const continuationMap = new Map<string, string>()   // employee_id → continuation_until (DATE string)

    for (const row of (eligibilityRows ?? []) as any[]) {
      if (!eligibilityMap.has(row.employee_id)) {
        eligibilityMap.set(row.employee_id, row.is_esi_applicable)
      }
      if (!continuationMap.has(row.employee_id) && row.continuation_until) {
        continuationMap.set(row.employee_id, row.continuation_until)
      }
    }

    // Last calendar day of the payroll month (YYYY-MM-DD) for continuation comparison
    const [mYr, mMo] = month.split('-').map(Number)
    const monthEnd = new Date(mYr, mMo, 0).toISOString().slice(0, 10)

    // ── Actual gross wages from finalized payroll slips ───────────────────────
    // ESI wages = gross_pay from the finalized payroll slip for this month.
    // This is the statutory-correct figure — NOT stale reference data from
    // esi_eligibility_timeline.gross_wages (which reflects salary at enrollment
    // time and becomes stale when the employee gets a salary revision).
    const { data: slipRows } = await fastify.supabase
      .from('payroll_slips')
      .select('employee_id, gross_pay')
      .eq('tenant_id', req.tenantId)
      .eq('month', month)
      .eq('status', 'finalized')

    const slipGrossMap = new Map<string, number>(
      ((slipRows ?? []) as any[]).map(r => [r.employee_id, r.gross_pay ?? 0]),
    )

    // ── Fallback gross for employees without a finalized slip ─────────────────
    // Sum all earning-type compensation components from the active compensation.
    const empsMissingSlip = empList.filter(e => !slipGrossMap.has(e.id)).map(e => e.id)
    const fallbackGrossMap = new Map<string, number>()

    if (empsMissingSlip.length > 0) {
      const { data: compRows } = await fastify.supabase
        .from('employee_compensations')
        .select('id, employee_id')
        .eq('tenant_id', req.tenantId)
        .eq('is_active', true)
        .in('employee_id', empsMissingSlip)

      const compIdToEmpId = new Map<string, string>(
        ((compRows ?? []) as any[]).map((c: any) => [c.id, c.employee_id]),
      )

      if (compRows && compRows.length > 0) {
        const { data: compCompRows } = await fastify.supabase
          .from('employee_compensation_components')
          .select('compensation_id, computed_monthly, salary_components!inner(component_type)')
          .in('compensation_id', (compRows as any[]).map((c: any) => c.id))
          .eq('salary_components.component_type', 'earning')

        for (const row of (compCompRows ?? []) as any[]) {
          const empId = compIdToEmpId.get(row.compensation_id)
          if (empId) {
            fallbackGrossMap.set(empId, (fallbackGrossMap.get(empId) ?? 0) + (row.computed_monthly ?? 0))
          }
        }
      }
    }

    const contributions: any[] = []
    let skippedExempt = 0
    let skippedIneligible = 0
    let wagesFromSlip = 0
    let wagesFallback = 0
    let continuationActiveCount = 0  // employees in contribution-period continuation

    for (const emp of empList) {
      // Skip employees exempted via statutory overrides OR legacy timeline
      if (exemptSet.has(emp.id)) { skippedExempt++; continue }
      if (eligibilityMap.get(emp.id) === false) { skippedIneligible++; continue }

      // Resolve gross wages: payroll slip > compensation fallback
      let grossWages: number
      if (slipGrossMap.has(emp.id)) {
        grossWages = slipGrossMap.get(emp.id)!
        wagesFromSlip++
      } else {
        grossWages = fallbackGrossMap.get(emp.id) ?? 0
        wagesFallback++
      }

      // Contribution period continuation: once enrolled in a contribution period
      // (Apr–Sep or Oct–Mar), ESI continues through period end even if wages
      // cross the ₹21,000 ceiling mid-period.
      // continuation_until is set to the last day of the contribution period.
      const continuationUntil = continuationMap.get(emp.id)
      const forceApplicable   = !!(continuationUntil && continuationUntil >= monthEnd)

      const result = computeESI(grossWages, config, forceApplicable)

      if (result.status === 'continuation') continuationActiveCount++

      if (result.isEligible) {
        contributions.push({
          tenant_id:             req.tenantId,
          employee_id:           emp.id,
          contribution_month:    month,
          esi_wages:             result.esiWages,
          is_eligible:           result.isEligible,
          employee_contribution: result.employeeContribution,
          employer_contribution: result.employerContribution,
          // total_contribution is GENERATED ALWAYS AS (employee_contribution + employer_contribution) STORED
          // in esi_contributions — cannot be inserted; the DB computes it automatically.
        })
      }
    }

    if (contributions.length > 0) {
      const { error: upsertErr } = await fastify.supabase
        .from('esi_contributions')
        .upsert(contributions, { onConflict: 'tenant_id,employee_id,contribution_month' })

      if (upsertErr) return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
    }

    return reply.send({
      computed_count:           contributions.length,
      skipped_exempt:           skippedExempt,
      skipped_ineligible:       skippedIneligible,
      continuation_active:      continuationActiveCount,  // employees in contribution-period continuation
      wages_from_slip:          wagesFromSlip,
      wages_fallback:           wagesFallback,
      month,
    })
  })

  // ── GET /payroll/statutory/esi/registrations ──────────────────────────────────
  fastify.get('/registrations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .select('id, registration_number, code_label, is_default, site_id, effective_from, is_active, notes')
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'esi')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('effective_from', { ascending: false })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── POST /payroll/statutory/esi/registrations ─────────────────────────────────
  fastify.post('/registrations', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const schema = z.object({
      registration_number: z.string().min(1),
      code_label:          z.string().optional(),
      is_default:          z.boolean().optional().default(false),
      site_id:             z.string().uuid().optional(),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    if (parsed.data.is_default) {
      await fastify.supabase
        .from('statutory_registrations')
        .update({ is_default: false })
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'esi')
        .eq('is_default', true)
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .insert({
        tenant_id:           req.tenantId,
        statutory_type:      'esi',
        registration_number: parsed.data.registration_number,
        code_label:          parsed.data.code_label ?? null,
        is_default:          parsed.data.is_default,
        is_active:           true,
        site_id:             parsed.data.site_id ?? null,
        notes:               parsed.data.notes ?? null,
        effective_from:      new Date().toISOString().slice(0, 10),
        created_by:          req.userId ?? null,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'INSERT_FAILED', message: error.message })
    return reply.code(201).send({ data })
  })

  // ── PUT /payroll/statutory/esi/registrations/:id ──────────────────────────────
  fastify.put('/registrations/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const schema = z.object({
      registration_number: z.string().min(1).optional(),
      code_label:          z.string().optional(),
      is_default:          z.boolean().optional(),
      notes:               z.string().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    if (parsed.data.is_default === true) {
      await fastify.supabase
        .from('statutory_registrations')
        .update({ is_default: false })
        .eq('tenant_id', req.tenantId)
        .eq('statutory_type', 'esi')
        .eq('is_default', true)
        .neq('id', id)
    }

    const { data, error } = await fastify.supabase
      .from('statutory_registrations')
      .update({ ...parsed.data })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'esi')
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.send({ data })
  })

  // ── DELETE /payroll/statutory/esi/registrations/:id ───────────────────────────
  fastify.delete('/registrations/:id', { preHandler: [fastify.authenticate, requireHrAdmin] }, async (req: any, reply) => {
    const { id } = req.params as { id: string }

    const { error } = await fastify.supabase
      .from('statutory_registrations')
      .update({ is_active: false, is_default: false })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .eq('statutory_type', 'esi')

    if (error) return reply.code(500).send({ error: 'UPDATE_FAILED', message: error.message })
    return reply.code(204).send()
  })
}
