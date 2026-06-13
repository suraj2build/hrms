/**
 * fnf-settlement-engine.ts — Full & Final settlement computation.
 *
 * Computes the formula-driven components of an exit settlement from existing
 * data (no new payroll run):
 *   • Gratuity        — (numerator/denominator) × last basic (or gross) ×
 *                       completed years, gated by eligibility + statutory cap.
 *                       Configurable per tenant via gratuity_config.
 *   • Leave encashment — remaining balance of encashable leave types × day rate
 *                       (basis/26).
 *   • Notice shortfall — (notice_period_days − days served) × gross/30.
 *
 * last_payroll_amount (final partial-month salary) and other +/- remain manual
 * — a dedicated final-run is a separate follow-up. HR can override any value
 * via the existing POST /separation-ff after computing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { round2 } from './payroll-engine.js'

export interface FnfBreakdown {
  gratuity_amount:         number
  gratuity_eligible:       boolean
  gratuity_years:          number
  leave_encashment_amount: number
  leave_encashment_days:   number
  leave_encashment_rate:   number
  notice_period_deduction: number
  notice_shortfall_days:   number
  salary_basis_basic:      number
  salary_basis_gross:      number
  // preserved/passed-through (manual)
  last_payroll_amount:     number
  other_additions:         number
  other_deductions:        number
}

const DAY = 86_400_000

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY))
}

// Completed years of service per the Payment of Gratuity Act: a part-year of
// more than 6 months counts as a full year.
function completedYears(joiningIso: string, lastWorkingIso: string): number {
  const totalDays = daysBetween(joiningIso, lastWorkingIso)
  const years = totalDays / 365.25
  const whole = Math.floor(years)
  const remainderMonths = (years - whole) * 12
  return remainderMonths > 6 ? whole + 1 : whole
}

export async function computeFnfSettlement(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<FnfBreakdown | { error: string }> {
  // 1. Separation dates
  const { data: sep } = await supabase
    .from('employee_separation')
    .select('notice_date, last_working_date')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!sep) return { error: 'No separation record found. Initiate separation first.' }
  const lastWorking = (sep as any).last_working_date as string | null
  if (!lastWorking) return { error: 'Last working date not set on the separation record.' }

  // 2. Employee + employment category (eligibility, notice period)
  const { data: emp } = await supabase
    .from('employees')
    .select('joining_date, employment_category_id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!emp) return { error: 'Employee not found.' }
  const joiningDate = (emp as any).joining_date as string | null

  let noticePeriodDays = 30
  let categoryGratuityEligible = true
  if ((emp as any).employment_category_id) {
    const { data: cat } = await supabase
      .from('employment_categories')
      .select('notice_period_days, gratuity_eligible')
      .eq('id', (emp as any).employment_category_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (cat) {
      noticePeriodDays = (cat as any).notice_period_days ?? 30
      categoryGratuityEligible = (cat as any).gratuity_eligible ?? true
    }
  }

  // 3. Gratuity config (fall back to statutory defaults)
  const { data: gc } = await supabase
    .from('gratuity_config')
    .select('enabled, rate_numerator, rate_denominator, min_years, max_amount, basis')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const cfg = {
    enabled:     (gc as any)?.enabled ?? true,
    numerator:   Number((gc as any)?.rate_numerator ?? 15),
    denominator: Number((gc as any)?.rate_denominator ?? 26),
    minYears:    Number((gc as any)?.min_years ?? 5),
    maxAmount:   Number((gc as any)?.max_amount ?? 2_000_000),
    basis:       ((gc as any)?.basis ?? 'basic') as 'basic' | 'gross',
  }

  // 4. Salary basis — last finalized payroll slip (gross + BASIC component)
  const { data: lastSlip } = await supabase
    .from('payroll_slips')
    .select('gross_pay, component_breakdown')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  const gross = Number((lastSlip as any)?.gross_pay ?? 0)
  const components = ((lastSlip as any)?.component_breakdown ?? []) as Array<{ code?: string; monthly_amount?: number }>
  const basic = round2(
    components
      .filter(c => (c.code ?? '').toUpperCase() === 'BASIC')
      .reduce((s, c) => s + Number(c.monthly_amount ?? 0), 0),
  )
  const basisAmount = cfg.basis === 'gross' ? gross : basic

  // 5. Gratuity
  const years = joiningDate ? completedYears(joiningDate, lastWorking) : 0
  const gratuityEligible = cfg.enabled && categoryGratuityEligible && years >= cfg.minYears
  const gratuityRaw = gratuityEligible && cfg.denominator > 0
    ? (cfg.numerator / cfg.denominator) * basisAmount * years
    : 0
  const gratuity = round2(Math.min(cfg.maxAmount, gratuityRaw))

  // 6. Leave encashment — encashable types' remaining balance × (basis/26)
  const { data: rules } = await supabase
    .from('leave_accrual_rules')
    .select('leave_type_id')
    .eq('tenant_id', tenantId)
    .eq('encashable', true)
  const encashableTypeIds = ((rules ?? []) as any[]).map(r => r.leave_type_id)
  let encashDays = 0
  if (encashableTypeIds.length > 0) {
    const year = new Date(lastWorking).getFullYear()
    const { data: balances } = await supabase
      .from('employee_leave_balance')
      .select('balance, leave_type_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('year', year)
      .in('leave_type_id', encashableTypeIds)
    encashDays = ((balances ?? []) as any[]).reduce((s, b) => s + Math.max(0, Number(b.balance ?? 0)), 0)
  }
  const encashRate = round2(basisAmount / 26)
  const leaveEncashment = round2(encashDays * encashRate)

  // 7. Notice shortfall — gross/30 × unserved days
  let shortfallDays = 0
  if ((sep as any).notice_date) {
    const served = daysBetween((sep as any).notice_date, lastWorking)
    shortfallDays = Math.max(0, noticePeriodDays - served)
  }
  const noticeDeduction = round2(shortfallDays * (gross / 30))

  return {
    gratuity_amount:         gratuity,
    gratuity_eligible:       gratuityEligible,
    gratuity_years:          years,
    leave_encashment_amount: leaveEncashment,
    leave_encashment_days:   round2(encashDays),
    leave_encashment_rate:   encashRate,
    notice_period_deduction: noticeDeduction,
    notice_shortfall_days:   shortfallDays,
    salary_basis_basic:      basic,
    salary_basis_gross:      gross,
    last_payroll_amount:     0,
    other_additions:         0,
    other_deductions:        0,
  }
}
