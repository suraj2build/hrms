/**
 * it-statement.ts — Full IT (Income Tax) Statement Routes
 *
 * Generates a comprehensive Form 16-style IT statement for an employee for a FY,
 * combining actual payroll slip data, approved declarations, and TDS projection.
 *
 * Routes (prefix: /payroll/statutory/tds):
 *   GET /it-statement/my?financial_year=2025-26   — ESS: own statement
 *   GET /it-statement/:employeeId                  — Admin: any employee's statement
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { computeTaxWithDB } from '../../../lib/statutory/tax-computation-engine.js'

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentFinancialYear(): string {
  const now = new Date()
  const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
}

function remainingMonthsInFY(financialYear: string): number {
  const fyStart = parseInt(financialYear.split('-')[0], 10)
  const fromPeriod = `${fyStart}-04`
  const toPeriod   = `${fyStart + 1}-03`
  const fyMonths: string[] = []
  for (let m = 4; m <= 12; m++) fyMonths.push(`${fyStart}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 3;  m++) fyMonths.push(`${fyStart + 1}-${String(m).padStart(2, '0')}`)
  const now = new Date()
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  // The "current month" must be interpreted relative to the REQUESTED FY, not
  // raw today. For a future FY all months remain; for a past/closed FY spread the
  // balance across the whole FY rather than dumping it into a single month (the
  // old `|| 1` collapsed every closed-FY recovery into one absurd month).
  if (currentMonthStr < fromPeriod) return fyMonths.length
  if (currentMonthStr > toPeriod)   return fyMonths.length
  return fyMonths.filter(m => m >= currentMonthStr).length || 1
}

async function resolveCallerEmployeeId(fastify: FastifyInstance, req: any): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', req.userId)
    .eq('tenant_id', req.tenantId)
    .single()
  return (data as any)?.employee_id ?? null
}

// ── Core statement builder ────────────────────────────────────────────────────

async function buildITStatement(
  fastify: FastifyInstance,
  tenantId: string,
  employeeId: string,
  financialYear: string,
  finalizedOnly: boolean = true,
): Promise<any> {
  const fyStart  = parseInt(financialYear.split('-')[0], 10)
  const fyEnd    = fyStart + 1
  const fromPeriod = `${fyStart}-04`
  const toPeriod   = `${fyEnd}-03`

  // An IT statement reflects *finalized* pay/TDS only. Without this filter, slips
  // from an in-progress re-run (recomputed but not re-finalized) leak into the
  // employee-facing tax statement. Always true for ESS; admins may opt out.
  let slipsQuery = fastify.supabase
    .from('payroll_slips')
    .select('month, gross_pay, tds_deducted, net_pay, component_breakdown')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('month', fromPeriod)
    .lte('month', toPeriod)
    .order('month', { ascending: true })
  if (finalizedOnly) slipsQuery = slipsQuery.eq('status', 'finalized')

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    empResult,
    slipsResult,
    declResult,
    regimeResult,
    panResult,
    tenantResult,
    regResult,
  ] = await Promise.all([
    // Employee profile
    fastify.supabase
      .from('employees')
      .select('id, employee_code, joining_date, profiles(full_name)')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    // Payroll slips for the FY (finalized-only unless an admin opts in).
    // payroll_slips columns are month / gross_pay / tds_deducted (NOT
    // period_month / gross_earnings — those never existed). HRA is derived from
    // the stored component_breakdown.
    slipsQuery,

    // Approved tax declarations
    fastify.supabase
      .from('tax_declarations')
      .select('declaration_category, section, declared_amount, approved_amount, status')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('financial_year', financialYear)
      .in('status', ['approved', 'payroll_applied']),

    // Tax regime election
    fastify.supabase
      .from('tax_regime_elections')
      .select('regime')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('financial_year', financialYear)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Form 16 header: employee PAN
    fastify.supabase
      .from('employee_bank_statutory')
      .select('pan:pan_number')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .maybeSingle(),

    // Form 16 header: employer (deductor) name
    fastify.supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle(),

    // Form 16 header: employer TAN (statutory registration)
    fastify.supabase
      .from('statutory_registrations')
      .select('statutory_type, registration_number')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('statutory_type', ['tds', 'tan']),
  ])

  const employee = empResult.data as any
  const slips    = (slipsResult.data as any[]) ?? []
  const decls    = (declResult.data as any[]) ?? []
  const regime   = ((regimeResult.data as any)?.regime ?? 'new') as 'old' | 'new'

  if (!employee) throw new Error('Employee not found')

  // ── Aggregate from payroll slips ───────────────────────────────────────────
  // Derive HRA paid from the slip's component breakdown (HRA-coded earnings).
  const hraOf = (slip: any): number =>
    ((slip?.component_breakdown ?? []) as any[])
      .filter((c: any) => c?.component_type === 'earning' && /hra|house\s*rent/i.test(`${c?.code ?? ''} ${c?.name ?? ''}`))
      .reduce((s: number, c: any) => s + (Number(c?.monthly_amount) || 0), 0)

  const grossFromSlips = slips.reduce((s, r) => s + (r.gross_pay ?? 0), 0)
  const hraFromSlips   = slips.reduce((s, r) => s + hraOf(r), 0)
  const tdsYTD         = slips.reduce((s, r) => s + (r.tds_deducted ?? 0), 0)

  // Use last slip for monthly gross projection (or average)
  const lastSlip     = slips[slips.length - 1]
  const monthlyGross = lastSlip?.gross_pay ?? (grossFromSlips / Math.max(slips.length, 1))

  // ── Build gross annual projection ─────────────────────────────────────────
  // For months with no payroll slip yet, project using last known monthly gross
  const fyMonths: string[] = []
  for (let m = 4; m <= 12; m++) fyMonths.push(`${fyStart}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 3;  m++) fyMonths.push(`${fyEnd}-${String(m).padStart(2, '0')}`)

  const slipMap: Record<string, any> = {}
  for (const s of slips) slipMap[s.month] = s

  let projectedAnnualGross = 0
  for (const month of fyMonths) {
    const slip = slipMap[month]
    projectedAnnualGross += slip ? (slip.gross_pay ?? 0) : monthlyGross
  }

  // ── Map declarations to deduction categories ───────────────────────────────
  const approvedBySection: Record<string, number> = {}
  for (const decl of decls) {
    const key = decl.section ?? decl.declaration_category
    approvedBySection[key] = (approvedBySection[key] ?? 0) + (decl.approved_amount ?? decl.declared_amount ?? 0)
  }

  const get = (key: string) => approvedBySection[key] ?? 0

  const remaining = remainingMonthsInFY(financialYear)

  // ── Run tax computation ────────────────────────────────────────────────────
  const taxResult = await computeTaxWithDB(fastify.supabase, {
    grossAnnualIncome: projectedAnnualGross,
    regime,
    financialYear,
    deductions: {
      section80C:             get('80C'),
      section80CCD1B:         get('NPS'),
      section80D:             get('80D'),
      section80E:             get('80E'),
      section80G:             get('80G'),
      section80TTA:           get('80TTA'),
      hraExemption:           get('HRA'),
      homeLoanInterest:       get('home_loan_interest'),
      otherDeductions:        get('other'),
      professionalTax:        get('professional_tax'),
      previousEmployerTDS:    get('previous_employer_tds'),
      tdsOthers:              0,
      otherIncome:            0,
      previousEmployerSalary: 0,
    },
    alreadyDeducted: tdsYTD,
    remainingMonths: remaining,
  })

  // ── Monthly breakup (actual slips + projected future months) ──────────────
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const FY_MONTH_ORDER = [4,5,6,7,8,9,10,11,12,1,2,3]

  let cumulativeTds = 0
  const monthlyBreakup = FY_MONTH_ORDER.map((monthNum) => {
    const year = monthNum >= 4 ? fyStart : fyEnd
    const key  = `${year}-${String(monthNum).padStart(2, '0')}`
    const slip = slipMap[key]
    const gross = slip?.gross_pay ?? 0
    const tds   = slip?.tds_deducted   ?? 0
    cumulativeTds += tds
    return {
      month:          `${MONTH_NAMES[monthNum - 1]} ${year}`,
      month_num:       monthNum,
      year,
      gross,
      tds,
      cumulative_tds: cumulativeTds,
    }
  })

  // ── Slab details for display ───────────────────────────────────────────────
  // Load slabs from DB or fall back
  const { data: slabRows } = await fastify.supabase
    .from('it_tax_slabs')
    .select('income_from, income_to, tax_rate, base_tax, slab_order')
    .eq('financial_year', financialYear)
    .eq('regime', regime)
    .order('slab_order', { ascending: true })

  const slabDetails = ((slabRows as any[]) ?? []).map((row: any) => {
    const from   = Number(row.income_from)
    const to     = row.income_to !== null ? Number(row.income_to) : null
    const rate   = Number(row.tax_rate)
    const taxable = Math.max(0, Math.min(taxResult.taxableIncome, to ?? Infinity) - from)
    return {
      income_range: `${from.toLocaleString('en-IN')} - ${to ? to.toLocaleString('en-IN') : 'Above'}`,
      rate:         `${(rate * 100).toFixed(0)}%`,
      tax:          Math.round(taxable * rate),
    }
  })

  const profile = (employee.profiles as any) ?? {}
  const balance  = Math.max(0, taxResult.netTaxPayable - tdsYTD)

  // ── Form 16 certificate header (employee + deductor identity) ─────────────
  const tanRow = ((regResult.data as any[]) ?? [])[0]
  const assessmentYear = `${parseInt(financialYear.split('-')[0], 10) + 1}-${(parseInt(financialYear.split('-')[0], 10) + 2).toString().slice(-2)}`
  const header = {
    employee_name:    profile.full_name ?? employee.employee_code ?? '—',
    employee_code:    employee.employee_code ?? null,
    joining_date:     (employee as any).joining_date ?? null,
    pan:              (panResult.data as any)?.pan ?? null,
    employer_name:    (tenantResult.data as any)?.name ?? '—',
    employer_tan:     tanRow?.registration_number ?? null,
    assessment_year:  assessmentYear,
  }

  // ── Flat structure matching frontend ITStatementData interface ────────────
  return {
    header,
    financial_year:             financialYear,
    regime,
    // A. Income
    salary_from_employer:       grossFromSlips,
    hra_received:               hraFromSlips,
    other_allowances:           0,
    previous_employer_salary:   0,
    gross_salary:               projectedAnnualGross,
    // B. Pre-Chapter VI-A deductions
    standard_deduction:         taxResult.standardDeduction,
    professional_tax:           taxResult.professionalTax,
    home_loan_interest_24b:     taxResult.homeLoanInterest,
    gross_total_income:         taxResult.grossTotalIncome,
    // C. Chapter VI-A
    deduction_80c:              taxResult.deduction80C,
    deduction_80d:              taxResult.deduction80D,
    deduction_80ccd1b:          taxResult.deduction80CCD1B,
    total_chapter_via:          taxResult.totalChapterVIADeductions,
    other_deductions: {
      '80E':    taxResult.deduction80E,
      '80G':    taxResult.deduction80G,
      '80TTA':  taxResult.deduction80TTA,
      'HRA':    taxResult.hraExemption,
    },
    // D. Tax computation
    taxable_income:             taxResult.taxableIncome,
    slab_details:               slabDetails.map((s: any) => ({
      income_range: s.income_range,
      rate:         parseFloat(String(s.rate)) || 0,
      tax:          s.tax,
    })),
    tax_before_rebate:          taxResult.taxOnIncome,
    rebate_87a:                 taxResult.rebate87A,
    surcharge:                  taxResult.surcharge,
    cess:                       taxResult.cess,
    total_tax_payable:          taxResult.annualTaxLiability,
    // E. TDS
    tds_by_employer_ytd:        tdsYTD,
    tds_by_others:              taxResult.tdsCredits,
    balance_tax_payable:        balance,
    remaining_months:           remaining,
    monthly_recovery:           taxResult.monthlyTDS,
    // F. Monthly schedule
    monthly_schedule:           monthlyBreakup,
  }
}

// =============================================================================
export default async function itStatementRoute(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ===========================================================================
  // GET /it-statement/my?financial_year=2025-26
  // ===========================================================================
  fastify.get('/it-statement/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    try {
      const statement = await buildITStatement(fastify, req.tenantId, employeeId, fy)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee record not found' })
      }
      fastify.log.error(err, 'IT statement build failed')
      return reply.code(500).send({ error: 'COMPUTATION_FAILED', message: err.message })
    }
  })

  // ===========================================================================
  // GET /it-statement/:employeeId — admin view of any employee
  // ===========================================================================
  fastify.get('/it-statement/:employeeId', adminAuth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const qs = z.object({
      financial_year:      z.string().optional(),
      // Admins may opt into draft slips to preview before finalization. Default
      // false → finalized-only, matching what the employee sees.
      include_unfinalized: z.coerce.boolean().optional(),
    }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()
    const finalizedOnly = !(qs.data?.include_unfinalized ?? false)

    try {
      const statement = await buildITStatement(fastify, req.tenantId, employeeId, fy, finalizedOnly)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }
      fastify.log.error(err, 'IT statement build failed (admin)')
      return reply.code(500).send({ error: 'COMPUTATION_FAILED', message: err.message })
    }
  })
}
