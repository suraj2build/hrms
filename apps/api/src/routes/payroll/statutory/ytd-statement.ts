/**
 * ytd-statement.ts — Year-to-Date Payroll Statement Routes
 *
 * Month-by-month payroll summary for a financial year, showing earnings,
 * deductions, employer contributions, and running totals.
 *
 * Routes (prefix: /payroll/statutory/tds):
 *   GET /ytd/my?financial_year=2025-26   — ESS: own YTD statement
 *   GET /ytd/:employeeId                  — Admin: any employee's YTD
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { HR_ADMIN_ROLES } from '../../../lib/rbac.js'
import { serverError, ErrorCode } from '../../../lib/api-errors.js'
import { fetchTenantTz } from '../../../lib/attendance-engine.js'
import { getLocalDate } from '../../../lib/org-context.js'

// ── Admin guard ───────────────────────────────────────────────────────────────

function requireHrAdmin(req: any, reply: any, done: () => void) {
  if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
    reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    return
  }
  done()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve "today" in the tenant's own timezone, not the server's (UTC) clock —
// matches the same fix applied to it-statement.ts (ISSUE-154 class).
async function tenantTodayStr(fastify: FastifyInstance, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

function currentFinancialYear(todayStr: string): string {
  const [y, m] = todayStr.split('-').map(Number)
  const fyYear = m >= 4 ? y : y - 1
  return `${fyYear}-${String(fyYear + 1).slice(2)}`
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

// ── Month metadata map ────────────────────────────────────────────────────────

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const FY_MONTH_ORDER = [4,5,6,7,8,9,10,11,12,1,2,3]

// ── Core builder ─────────────────────────────────────────────────────────────

async function buildYTDStatement(
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

  // A YTD statement reflects *finalized* pay. payroll_slips carries its own
  // status ('draft' | 'finalized' | 'held'); the finalize step stamps slips
  // 'finalized'. Without this filter, slips from an in-progress re-run (run
  // rolled back to draft, recomputed but not yet re-finalized) leak into the
  // employee-facing statement — showing numbers that were never finalized.
  // finalizedOnly is always true for ESS; admins may opt out to preview drafts.
  let slipsQuery = fastify.supabase
    .from('payroll_slips')
    // payroll_slips stores month / gross_pay / net_pay / tds_deducted +
    // component_breakdown (JSON). The per-component figures (basic, hra, pf,
    // esi, ptax, employer shares) are derived from the breakdown below — the
    // old flat columns (period_month, gross_earnings, provident_fund, …) never
    // existed, so this query used to error and YTD never populated.
    .select('month, gross_pay, net_pay, tds_deducted, total_working_days, payable_days, component_breakdown')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('month', fromPeriod)
    .lte('month', toPeriod)
    .order('month', { ascending: true })
  if (finalizedOnly) slipsQuery = slipsQuery.eq('status', 'finalized')

  // ── Parallel fetch ─────────────────────────────────────────────────────────
  const [empResult, slipsResult] = await Promise.all([
    fastify.supabase
      .from('employees')
      .select('id, employee_code, profiles!profile_id (full_name)')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    slipsQuery,
  ])

  if (slipsResult.error) throw new Error(`Failed to fetch payroll slips: ${slipsResult.error.message}`)

  const employee = empResult.data as any
  const slips    = (slipsResult.data as any[]) ?? []

  if (!employee) throw new Error('Employee not found')

  // Sum component_breakdown lines whose code/name matches a pattern.
  const sumComp = (slip: any, re: RegExp): number =>
    ((slip?.component_breakdown ?? []) as any[])
      .filter((c: any) => re.test(`${c?.code ?? ''} ${c?.name ?? ''}`))
      .reduce((s: number, c: any) => s + (Number(c?.monthly_amount) || 0), 0)
  const sumBasic = (slip: any): number =>
    ((slip?.component_breakdown ?? []) as any[])
      .filter((c: any) => c?.is_basic || /^basic\b/i.test(`${c?.code ?? ''} ${c?.name ?? ''}`))
      .reduce((s: number, c: any) => s + (Number(c?.monthly_amount) || 0), 0)

  // Index slips by month
  const slipMap: Record<string, any> = {}
  for (const s of slips) slipMap[s.month] = s

  // ── Build ordered months ───────────────────────────────────────────────────
  const months = FY_MONTH_ORDER.map((monthNum) => {
    const year = monthNum >= 4 ? fyStart : fyEnd
    const periodKey = `${year}-${String(monthNum).padStart(2, '0')}`
    const slip = slipMap[periodKey] ?? null

    if (!slip) return null  // no payroll run yet for this month

    const basic             = sumBasic(slip)
    const hra               = sumComp(slip, /hra|house\s*rent/i)
    const specialAllowance  = sumComp(slip, /special/i)
    const gross             = Number(slip.gross_pay ?? 0)
    const reimbursements    = Math.max(0, gross - basic - hra - specialAllowance)

    const pfEmployee        = sumComp(slip, /^PF_EMPLOYEE$|provident fund \(employee\)/i)
    const esiEmployee       = sumComp(slip, /^ESI_EMPLOYEE$|esi \(employee\)/i)
    const profTax           = sumComp(slip, /^PTAX$|professional tax/i)
    const tds               = Number(slip.tds_deducted ?? 0)
    const totalDeductions   = pfEmployee + esiEmployee + profTax + tds

    const pfEmployer        = sumComp(slip, /^PF_EMPLOYER$|provident fund \(employer\)/i)
    const esiEmployer       = sumComp(slip, /^ESI_EMPLOYER$|esi \(employer\)/i)

    const netPay            = Number(slip.net_pay ?? 0)
    const workDays          = Number(slip.total_working_days ?? 0)
    const payableDays       = Number(slip.payable_days ?? 0)

    return {
      month:      `${MONTH_NAMES[monthNum]} ${year}`,
      month_num:   monthNum,
      year,
      period_month: periodKey,
      earnings: {
        basic,
        hra,
        special_allowance: specialAllowance,
        reimbursements,
        gross,
      },
      deductions: {
        pf_employee:      pfEmployee,
        esi_employee:     esiEmployee,
        professional_tax: profTax,
        tds,
        total:            totalDeductions,
      },
      employer_contributions: {
        pf_employer:  pfEmployer,
        esi_employer: esiEmployer,
      },
      net_pay:      netPay,
      work_days:    workDays,
      payable_days: payableDays,
    }
  }).filter(Boolean) as any[]

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totals = months.reduce(
    (acc, m) => ({
      gross:       acc.gross       + m.earnings.gross,
      tds:         acc.tds         + m.deductions.tds,
      net_pay:     acc.net_pay     + m.net_pay,
      pf_employee: acc.pf_employee + m.deductions.pf_employee,
      pf_employer: acc.pf_employer + m.employer_contributions.pf_employer,
      esi_employee: acc.esi_employee + m.deductions.esi_employee,
      esi_employer: acc.esi_employer + m.employer_contributions.esi_employer,
      professional_tax: acc.professional_tax + m.deductions.professional_tax,
      total_deductions: acc.total_deductions + m.deductions.total,
    }),
    {
      gross: 0, tds: 0, net_pay: 0,
      pf_employee: 0, pf_employer: 0,
      esi_employee: 0, esi_employer: 0,
      professional_tax: 0, total_deductions: 0,
    },
  )

  const profile = (employee.profiles as any) ?? {}

  // ── Reshape to flat frontend-expected structure ───────────────────────────
  const monthly_rows = months.map((m: any) => ({
    month:            m.month,
    basic:            m.earnings.basic,
    hra:              m.earnings.hra,
    special:          m.earnings.special_allowance,
    other_earnings:   m.earnings.reimbursements,
    gross:            m.earnings.gross,
    pf_employee:      m.deductions.pf_employee,
    pt:               m.deductions.professional_tax,
    tds:              m.deductions.tds,
    other_deductions: m.deductions.esi_employee,
    net_pay:          m.net_pay,
    work_days:        m.work_days,
  }))

  const employer_rows = months.map((m: any) => ({
    month:        m.month,
    pf_employer:  m.employer_contributions.pf_employer,
    esi_employer: m.employer_contributions.esi_employer,
    total_ctc:    m.earnings.gross
                  + m.employer_contributions.pf_employer
                  + m.employer_contributions.esi_employer,
  }))

  return {
    financial_year:     financialYear,
    employee_name:      profile.full_name      ?? null,
    employee_code:      employee.employee_code ?? null,
    total_gross:        totals.gross,
    total_tds:          totals.tds,
    total_pf_employee:  totals.pf_employee,
    total_net_pay:      totals.net_pay,
    monthly_rows,
    employer_rows,
  }
}

// =============================================================================
export default async function ytdStatementRoute(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireHrAdmin] }

  // ===========================================================================
  // GET /ytd/my?financial_year=2025-26
  // ===========================================================================
  fastify.get('/ytd/my', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req)
    if (!employeeId) {
      return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })
    }

    const todayStr = await tenantTodayStr(fastify, req.tenantId)
    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear(todayStr)

    try {
      const statement = await buildYTDStatement(fastify, req.tenantId, employeeId, fy)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee record not found' })
      }
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to build YTD statement')
    }
  })

  // ===========================================================================
  // GET /ytd/:employeeId — admin view
  // ===========================================================================
  fastify.get('/ytd/:employeeId', adminAuth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const qs = z.object({
      financial_year:      z.string().optional(),
      // Admins may opt into in-progress (draft) slips to preview a run before
      // finalization. Default false → the statement shows finalized pay only,
      // matching exactly what the employee sees.
      include_unfinalized: z.coerce.boolean().optional(),
    }).safeParse(req.query)
    const todayStr = await tenantTodayStr(fastify, req.tenantId)
    const fy = qs.data?.financial_year ?? currentFinancialYear(todayStr)
    const finalizedOnly = !(qs.data?.include_unfinalized ?? false)

    try {
      const statement = await buildYTDStatement(fastify, req.tenantId, employeeId, fy, finalizedOnly)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }
      return serverError(req, reply, err, ErrorCode.COMPUTE_FAILED, 'Failed to build YTD statement')
    }
  })
}
