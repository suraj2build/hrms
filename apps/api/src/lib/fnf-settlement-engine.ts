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
import { getLeaveYear } from './leave-entitlement-service.js'

export interface FnfBreakdown {
  gratuity_amount:         number
  gratuity_eligible:       boolean
  gratuity_years:          number
  leave_encashment_amount: number
  leave_encashment_days:   number
  leave_encashment_rate:   number
  /** Exact (leave_type_id, year) rows this computation read `employee_leave_balance`
   *  for — stored verbatim on `separation_ff_summary.leave_encashment_basis` so
   *  `mark_fnf_paid_atomic` (migration 448) can re-sum precisely those rows at
   *  mark-paid time and detect drift from a concurrent standalone-encashment
   *  approval, without duplicating the encashable-type/leave-year resolution
   *  logic in SQL. Empty array (not null) means "no encashable leave types for
   *  this employee" — a real, verified zero, not "not computed yet". */
  leave_encashment_basis:  Array<{ leave_type_id: string; year: number }>
  notice_period_deduction: number
  notice_shortfall_days:   number
  salary_basis_basic:      number
  salary_basis_gross:      number
  asset_recovery_amount:    number
  asset_recovery_count:     number
  loan_recovery_amount:     number
  advance_recovery_amount:  number
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
    .select('notice_date, last_working_date, notice_period_days_override, notice_waived')
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
    const { data: cat, error: catErr } = await supabase
      .from('employment_categories')
      .select('notice_period_days, gratuity_eligible')
      .eq('id', (emp as any).employment_category_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    // A query error must not fall through as "no category configured" — that
    // would silently substitute the permissive defaults (30-day notice,
    // gratuity-eligible) over a tenant's actual category config, which could
    // mark this category notice-period-different or gratuity-ineligible.
    if (catErr) return { error: `Failed to fetch employment category: ${catErr.message}` }
    if (cat) {
      noticePeriodDays = (cat as any).notice_period_days ?? 30
      categoryGratuityEligible = (cat as any).gratuity_eligible ?? true
    }
  }

  // 3. Gratuity config (fall back to statutory defaults)
  const { data: gc, error: gcErr } = await supabase
    .from('gratuity_config')
    .select('enabled, rate_numerator, rate_denominator, min_years, max_amount, basis')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  // A query error must not fall through as "no config" — that would silently
  // substitute the generic statutory defaults (15/26, 5yr, ₹20L cap) over a
  // tenant's actual configured rate/cap/basis, which could be more
  // restrictive (e.g. a lower cap) than what gets paid out.
  if (gcErr) return { error: `Failed to fetch gratuity config: ${gcErr.message}` }
  const cfg = {
    enabled:     (gc as any)?.enabled ?? true,
    numerator:   Number((gc as any)?.rate_numerator ?? 15),
    denominator: Number((gc as any)?.rate_denominator ?? 26),
    minYears:    Number((gc as any)?.min_years ?? 5),
    maxAmount:   Number((gc as any)?.max_amount ?? 2_000_000),
    basis:       ((gc as any)?.basis ?? 'basic') as 'basic' | 'gross',
  }

  // 4. Salary basis — last finalized payroll slip (gross + BASIC component)
  // G03: this previously had no status filter, so a draft slip (unreviewed,
  // possibly mid-correction) could outrank an older finalized slip by month
  // and get used as the gratuity/notice-pay basis instead.
  const { data: lastSlip, error: slipErr } = await supabase
    .from('payroll_slips')
    .select('gross_pay, component_breakdown')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('status', 'finalized')
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  // A query error must not fall through as "no prior slip" (→ gross/basic=0)
  // — that would zero out gratuity and notice-shortfall entirely instead of
  // surfacing the failure, silently understating the settlement.
  if (slipErr) return { error: `Failed to fetch salary basis: ${slipErr.message}` }
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
  const { data: rules, error: rulesErr } = await supabase
    .from('leave_accrual_rules')
    .select('leave_type_id')
    .eq('tenant_id', tenantId)
    .eq('encashable', true)
  // A query error must not fall through as "no encashable leave types" —
  // that would silently zero out leave_encashment_amount for an employee
  // who does have encashable balance, rather than surfacing the failure.
  if (rulesErr) return { error: `Failed to fetch encashable leave types: ${rulesErr.message}` }
  const encashableTypeIds = ((rules ?? []) as any[]).map(r => r.leave_type_id)
  let encashDays = 0
  let leaveEncashmentBasis: Array<{ leave_type_id: string; year: number }> = []
  if (encashableTypeIds.length > 0) {
    // employee_leave_balance.year is keyed per the employee's assigned
    // policy year_type: for 'financial' (Apr–Mar) policies it stores the FY
    // START year, not the calendar year — so a Jan–Mar exit under a
    // financial-year policy would silently match zero balance rows if keyed
    // by plain calendar year. Resolve the employee's policy year_type first
    // (policy assignment is one-per-employee — see the "one-policy" guard
    // in leave-entitlement-service.ts) and compute the leave year the same
    // way accrual does.
    const { data: assignment } = await supabase
      .from('leave_policy_assignments')
      .select('policy_id')
      .eq('tenant_id', tenantId)
      .eq('scope_type', 'employee')
      .eq('scope_id', employeeId)
      .or(`effective_from.is.null,effective_from.lte.${lastWorking}`)
      .or(`effective_to.is.null,effective_to.gte.${lastWorking}`)
      .maybeSingle()

    let yearType: 'calendar' | 'financial' = 'calendar'
    if ((assignment as any)?.policy_id) {
      const { data: master } = await supabase
        .from('leave_policy_masters')
        .select('year_type')
        .eq('id', (assignment as any).policy_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if ((master as any)?.year_type === 'financial') yearType = 'financial'
    }

    const year = getLeaveYear(new Date(lastWorking), yearType)
    leaveEncashmentBasis = encashableTypeIds.map((id: string) => ({ leave_type_id: id, year }))
    const { data: balances, error: balancesErr } = await supabase
      .from('employee_leave_balance')
      .select('balance, leave_type_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('year', year)
      .in('leave_type_id', encashableTypeIds)
    // Same reasoning as above: a query error here must not silently read as
    // "zero balance" for a departing employee's leave encashment.
    if (balancesErr) return { error: `Failed to fetch leave balances: ${balancesErr.message}` }
    encashDays = ((balances ?? []) as any[]).reduce((s, b) => s + Math.max(0, Number(b.balance ?? 0)), 0)
  }
  const encashRate = round2(basisAmount / 26)
  const leaveEncashment = round2(encashDays * encashRate)

  // 7. Notice shortfall — gross/30 × unserved days.
  // A per-separation override takes precedence over the category notice period;
  // a waiver (e.g. employer-agreed buyout/waiver) zeroes the deduction.
  const overrideDays = (sep as any).notice_period_days_override
  if (overrideDays != null) noticePeriodDays = overrideDays
  let shortfallDays = 0
  if ((sep as any).notice_date) {
    const served = daysBetween((sep as any).notice_date, lastWorking)
    shortfallDays = Math.max(0, noticePeriodDays - served)
  }
  if ((sep as any).notice_waived) shortfallDays = 0
  const noticeDeduction = round2(shortfallDays * (gross / 30))

  // 8. Outstanding asset recovery — unreturned assets still assigned to this
  // employee, at purchase cost. Mirrors the same check the clearance flow's
  // IT-department block already runs, but surfaces the amount here too.
  const { data: assets, error: assetsErr } = await supabase
    .from('assets')
    .select('purchase_cost')
    .eq('tenant_id', tenantId)
    .eq('assigned_to', employeeId)
    .eq('status', 'assigned')
  // A query error must not fall through as "no outstanding assets" — that
  // would silently drop a real recovery amount from the settlement.
  if (assetsErr) return { error: `Failed to fetch outstanding assets: ${assetsErr.message}` }
  const assetRecoveryCount = ((assets ?? []) as any[]).length
  const assetRecovery = round2(
    ((assets ?? []) as any[]).reduce((s, a) => s + Number(a.purchase_cost ?? 0), 0),
  )

  // 9. Outstanding loan recovery — active/disbursed employee loans' remaining
  // balance.
  const { data: loans, error: loansErr } = await supabase
    .from('employee_loans')
    .select('outstanding_balance')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .in('status', ['disbursed', 'active'])
  // Same reasoning as above: a query error here must not silently read as
  // "no outstanding loans" for a departing employee.
  if (loansErr) return { error: `Failed to fetch outstanding loans: ${loansErr.message}` }
  const loanRecovery = round2(
    ((loans ?? []) as any[]).reduce((s, l) => s + Number(l.outstanding_balance ?? 0), 0),
  )

  // 10. Advance salary recovery — scheduled-but-not-yet-recovered instalments
  // against advances still being recovered.
  const { data: advances, error: advancesErr } = await supabase
    .from('advance_salary_requests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .in('status', ['disbursed', 'recovering'])
  if (advancesErr) return { error: `Failed to fetch advance salary requests: ${advancesErr.message}` }
  const advanceIds = ((advances ?? []) as any[]).map(a => a.id)
  let advanceRecovery = 0
  if (advanceIds.length > 0) {
    const { data: schedules, error: schedulesErr } = await supabase
      .from('advance_recovery_schedules')
      .select('scheduled_amount')
      .eq('tenant_id', tenantId)
      .in('advance_id', advanceIds)
      .eq('status', 'pending')
    // Same reasoning as above: a query error here must not silently read as
    // "fully recovered" for a departing employee's pending advance.
    if (schedulesErr) return { error: `Failed to fetch advance recovery schedules: ${schedulesErr.message}` }
    advanceRecovery = round2(
      ((schedules ?? []) as any[]).reduce((s, r) => s + Number(r.scheduled_amount ?? 0), 0),
    )
  }

  return {
    gratuity_amount:         gratuity,
    gratuity_eligible:       gratuityEligible,
    gratuity_years:          years,
    leave_encashment_amount: leaveEncashment,
    leave_encashment_days:   round2(encashDays),
    leave_encashment_rate:   encashRate,
    leave_encashment_basis:  leaveEncashmentBasis,
    notice_period_deduction: noticeDeduction,
    notice_shortfall_days:   shortfallDays,
    salary_basis_basic:      basic,
    salary_basis_gross:      gross,
    asset_recovery_amount:   assetRecovery,
    asset_recovery_count:    assetRecoveryCount,
    loan_recovery_amount:    loanRecovery,
    advance_recovery_amount: advanceRecovery,
    last_payroll_amount:     0,
    other_additions:         0,
    other_deductions:        0,
  }
}
