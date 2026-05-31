/**
 * TDS Monthly Recovery Routes
 * Tracks per-employee per-period TDS recovery schedules.
 * Compute route derives the monthly recovery amount from projected tax,
 * prior payroll deductions, and previous employment TDS.
 *
 * Route groups (all under prefix '/payroll/statutory/tds'):
 *   ESS   (/my)            — employee views their own recovery timeline
 *   Admin (/:employeeId)   — HR admin views any employee's timeline
 *   Admin (/compute)       — HR admin / system triggers computation for a period
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// ── FY helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the list of YYYY-MM strings for an Indian financial year
 * (April of fyStartYear → March of fyStartYear+1) in calendar order.
 *
 * Example: fyFromLabel('2025-26') →
 *   ['2025-04','2025-05',...,'2025-12','2026-01','2026-02','2026-03']
 */
function fyMonths(financialYear: string): string[] {
  // financialYear is "YYYY-YY", e.g. "2025-26"
  const startYear = parseInt(financialYear.slice(0, 4), 10)
  const months: string[] = []
  for (let m = 4; m <= 12; m++) {
    months.push(`${startYear}-${String(m).padStart(2, '0')}`)
  }
  for (let m = 1; m <= 3; m++) {
    months.push(`${startYear + 1}-${String(m).padStart(2, '0')}`)
  }
  return months
}

/**
 * Returns the number of payroll periods remaining in the FY
 * including the given payrollPeriod (YYYY-MM).
 *
 * A "remaining" period is any FY month >= payrollPeriod.
 */
function remainingPayrollCycles(financialYear: string, payrollPeriod: string): number {
  const months = fyMonths(financialYear)
  return months.filter((m) => m >= payrollPeriod).length
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
}

/**
 * Shape raw tds_monthly_recovery rows into the TDSRecoveryData format
 * expected by the ESS frontend.
 *
 * DB columns  →  frontend fields
 *   tax_already_deducted   → already_deducted
 *   payroll_cycles_remaining → cycles_left
 *   payroll_period (YYYY-MM) → month_key + month ("Apr 2025")
 */
function shapeRecoveryResponse(rows: any[], financialYear: string) {
  const months = rows.map((r: any) => {
    const [year, mm] = (r.payroll_period as string).split('-')
    const label = `${MONTH_LABELS[mm] ?? mm} ${year}`
    return {
      month:                label,
      month_key:            r.payroll_period,
      projected_annual_tax: Number(r.projected_annual_tax ?? 0),
      already_deducted:     Number(r.tax_already_deducted ?? 0),
      external_tds:         Number(r.external_tds ?? 0),
      remaining_tax:        Number(r.remaining_tax ?? 0),
      cycles_left:          Number(r.payroll_cycles_remaining ?? 1),
      monthly_recovery:     Number(r.monthly_recovery ?? 0),
      regime:               (r.regime ?? 'new') as 'old' | 'new',
    }
  })

  // Top-level summary from the current/latest row
  const now   = new Date()
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const cur   = months.find(m => m.month_key === curKey) ?? months[months.length - 1]
  const next  = months.find(m => m.month_key > curKey) ?? cur

  return {
    financial_year:        financialYear,
    projected_annual_tax:  cur?.projected_annual_tax  ?? 0,
    already_deducted:      cur?.already_deducted       ?? 0,
    remaining_tax:         cur?.remaining_tax          ?? 0,
    next_month_recovery:   next?.monthly_recovery      ?? 0,
    months,
  }
}

// =============================================================================
export default async function tdsRecoveryRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireHrAdmin(req: any, reply: any, done: () => void) {
    if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return
    }
    done()
  }

  // ── GET /recovery/my ─────────────────────────────────────────────────────────
  fastify.get('/recovery/my', auth, async (req: any, reply) => {
    const querySchema = z.object({
      financial_year: z.string().optional(),
    })

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(404).send({ error: 'EMPLOYEE_NOT_FOUND', message: 'No employee record linked to this account' })
    }

    let q = fastify.supabase
      .from('tds_monthly_recovery')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('payroll_period', { ascending: true })

    if (parsed.data.financial_year) {
      q = q.eq('financial_year', parsed.data.financial_year)
    }

    const { data, error } = await q
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

    const fy = parsed.data.financial_year ?? `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`
    return reply.send(shapeRecoveryResponse(data ?? [], fy))
  })

  // ── GET /recovery/:employeeId (admin only) ───────────────────────────────────
  fastify.get(
    '/recovery/:employeeId',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const { employeeId } = req.params as { employeeId: string }

      const querySchema = z.object({
        financial_year: z.string().optional(),
      })

      const parsed = querySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      let q = fastify.supabase
        .from('tds_monthly_recovery')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .order('payroll_period', { ascending: true })

      if (parsed.data.financial_year) {
        q = q.eq('financial_year', parsed.data.financial_year)
      }

      const { data, error } = await q
      if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })

      const fy = parsed.data.financial_year ?? `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`
      return reply.send(shapeRecoveryResponse(data ?? [], fy))
    },
  )

  // ── POST /recovery/compute (admin or system) ─────────────────────────────────
  fastify.post(
    '/recovery/compute',
    { preHandler: [fastify.authenticate, requireHrAdmin] },
    async (req: any, reply) => {
      const bodySchema = z.object({
        employee_id:    z.string().uuid(),
        financial_year: z.string().regex(/^\d{4}-\d{2}$/, 'financial_year must be YYYY-YY'),
        payroll_period: z.string().regex(/^\d{4}-\d{2}$/, 'payroll_period must be YYYY-MM'),
      })

      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
      }

      const { employee_id, financial_year, payroll_period } = parsed.data

      // ── Step 1: Active tax declaration ────────────────────────────────────────
      const { data: declarationRow, error: declErr } = await fastify.supabase
        .from('tax_declarations')
        .select('id, projected_tax')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employee_id)
        .eq('financial_year', financial_year)
        .in('status', ['submitted', 'locked'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (declErr) {
        req.log.error({ err: declErr }, 'tds-recovery: failed to fetch tax_declaration')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: declErr.message })
      }

      const declaration   = declarationRow as any
      const projectedAnnualTax: number = declaration?.projected_tax
        ? Number(declaration.projected_tax)
        : 0

      // ── Step 2: TDS already deducted via payroll slips ────────────────────────
      // Sum tds_deducted from all payroll_slips for this employee in this FY.
      // FY months: Apr (YYYY-04) through Mar ((YYYY+1)-03).
      const months = fyMonths(financial_year)
      const fyStart = months[0]   // e.g. "2025-04"
      const fyEnd   = months[11]  // e.g. "2026-03"

      const { data: slipRows, error: slipErr } = await fastify.supabase
        .from('payroll_slips')
        .select('tds_deducted')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employee_id)
        .gte('period_month', fyStart)
        .lte('period_month', fyEnd)
        // Only include processed slips for accurate TDS figures
        .in('status', ['processed', 'finalized', 'paid'])

      if (slipErr) {
        req.log.error({ err: slipErr }, 'tds-recovery: failed to fetch payroll_slips')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: slipErr.message })
      }

      const taxAlreadyDeducted: number = (slipRows ?? []).reduce(
        (sum: number, row: any) => sum + Number(row.tds_deducted ?? 0),
        0,
      )

      // ── Step 3: External TDS from verified previous employment records ─────────
      const { data: prevEmpRows, error: prevErr } = await fastify.supabase
        .from('previous_employment_tax_details')
        .select('tds_deducted')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employee_id)
        .eq('financial_year', financial_year)
        .eq('verification_status', 'verified')

      if (prevErr) {
        req.log.error({ err: prevErr }, 'tds-recovery: failed to fetch previous_employment_tax_details')
        return reply.code(500).send({ error: 'QUERY_FAILED', message: prevErr.message })
      }

      const externalTds: number = (prevEmpRows ?? []).reduce(
        (sum: number, row: any) => sum + Number(row.tds_deducted ?? 0),
        0,
      )

      // ── Step 4: Remaining payroll cycles ──────────────────────────────────────
      const payrollCyclesRemaining = remainingPayrollCycles(financial_year, payroll_period)

      // ── Step 5 – 7: Compute monthly recovery ─────────────────────────────────
      const remainingTax    = Math.max(0, projectedAnnualTax - taxAlreadyDeducted - externalTds)
      const monthlyRecovery = Math.round((remainingTax / Math.max(1, payrollCyclesRemaining)) * 100) / 100

      const now = new Date().toISOString()

      // ── Step 8: Upsert into tds_monthly_recovery ──────────────────────────────
      // Unique constraint: (tenant_id, employee_id, financial_year, payroll_period)
      const upsertPayload = {
        tenant_id:                 req.tenantId,
        employee_id,
        financial_year,
        payroll_period,
        tax_declaration_id:        declaration?.id ?? null,
        projected_annual_tax:      projectedAnnualTax,
        tax_deducted_prior:        taxAlreadyDeducted,
        external_tds:              externalTds,
        remaining_tax:             remainingTax,
        payroll_cycles_remaining:  payrollCyclesRemaining,
        monthly_recovery_amount:   monthlyRecovery,
        computed_by:               req.userId,
        computed_at:               now,
        updated_at:                now,
      }

      const { data: upsertedRow, error: upsertErr } = await fastify.supabase
        .from('tds_monthly_recovery')
        .upsert(upsertPayload, {
          onConflict:        'tenant_id,employee_id,financial_year,payroll_period',
          ignoreDuplicates:  false,
        })
        .select()
        .single()

      if (upsertErr) {
        req.log.error({ err: upsertErr }, 'tds-recovery: upsert failed')
        return reply.code(500).send({ error: 'UPSERT_FAILED', message: upsertErr.message })
      }

      return reply.code(201).send({ data: upsertedRow })
    },
  )
}
