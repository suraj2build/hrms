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
): Promise<any> {
  const fyStart  = parseInt(financialYear.split('-')[0], 10)
  const fyEnd    = fyStart + 1
  const fromPeriod = `${fyStart}-04`
  const toPeriod   = `${fyEnd}-03`

  // ── Parallel fetch ─────────────────────────────────────────────────────────
  const [empResult, slipsResult] = await Promise.all([
    fastify.supabase
      .from('employees')
      .select('id, employee_code, profiles (full_name)')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    fastify.supabase
      .from('payroll_slips')
      .select(`
        period_month,
        gross_earnings,
        basic_salary,
        hra_component,
        special_allowance,
        provident_fund,
        esi_employee,
        professional_tax,
        tds_deducted,
        net_pay,
        employer_pf,
        employer_esi,
        work_days,
        payable_days
      `)
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .gte('period_month', fromPeriod)
      .lte('period_month', toPeriod)
      .order('period_month', { ascending: true }),
  ])

  const employee = empResult.data as any
  const slips    = (slipsResult.data as any[]) ?? []

  if (!employee) throw new Error('Employee not found')

  // Index slips by period_month
  const slipMap: Record<string, any> = {}
  for (const s of slips) slipMap[s.period_month] = s

  // ── Build ordered months ───────────────────────────────────────────────────
  const months = FY_MONTH_ORDER.map((monthNum) => {
    const year = monthNum >= 4 ? fyStart : fyEnd
    const periodKey = `${year}-${String(monthNum).padStart(2, '0')}`
    const slip = slipMap[periodKey] ?? null

    if (!slip) return null  // no payroll run yet for this month

    const basic             = Number(slip.basic_salary        ?? 0)
    const hra               = Number(slip.hra_component       ?? 0)
    const specialAllowance  = Number(slip.special_allowance   ?? 0)
    const gross             = Number(slip.gross_earnings      ?? 0)
    const reimbursements    = Math.max(0, gross - basic - hra - specialAllowance)

    const pfEmployee        = Number(slip.provident_fund  ?? 0)
    const esiEmployee       = Number(slip.esi_employee    ?? 0)
    const profTax           = Number(slip.professional_tax ?? 0)
    const tds               = Number(slip.tds_deducted    ?? 0)
    const totalDeductions   = pfEmployee + esiEmployee + profTax + tds

    const pfEmployer        = Number(slip.employer_pf  ?? 0)
    const esiEmployer       = Number(slip.employer_esi ?? 0)

    const netPay            = Number(slip.net_pay     ?? 0)
    const workDays          = Number(slip.work_days   ?? 0)
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

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    try {
      const statement = await buildYTDStatement(fastify, req.tenantId, employeeId, fy)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee record not found' })
      }
      fastify.log.error(err, 'YTD statement build failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: err.message })
    }
  })

  // ===========================================================================
  // GET /ytd/:employeeId — admin view
  // ===========================================================================
  fastify.get('/ytd/:employeeId', adminAuth, async (req: any, reply) => {
    const { employeeId } = req.params as { employeeId: string }

    const qs = z.object({ financial_year: z.string().optional() }).safeParse(req.query)
    const fy = qs.data?.financial_year ?? currentFinancialYear()

    try {
      const statement = await buildYTDStatement(fastify, req.tenantId, employeeId, fy)
      return reply.send(statement)
    } catch (err: any) {
      if (err.message === 'Employee not found') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
      }
      fastify.log.error(err, 'YTD statement build failed (admin)')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: err.message })
    }
  })
}
