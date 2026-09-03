/**
 * statutory-payroll.ts
 *
 * Bridges the payroll run to the config-driven statutory engines (EPF / ESI /
 * Professional Tax). Before this, payslip PF/ESI lines came only from the
 * components baked into employee_compensation_components at authoring time
 * (a simplified flat-12% PF with no EPS/EDLI split, and no ESI/PT at all).
 *
 * applyStatutoryToSlip() takes a computed slip + the resolved statutory params
 * for the employee/month and returns a NEW slip whose PF/ESI/PT deduction and
 * employer-contribution lines are recomputed by the proper engines. Totals and
 * net_pay are recomputed; LOP is preserved untouched.
 *
 * Pure function — no I/O. The route layer resolves params via
 * resolveEmployeeStatutoryParams() and supplies them here.
 *
 * Scope: EPF, ESI, PTax. TDS is NOT applied here — it has its own
 * declaration-driven governance flow (tax-governance) and projected-annual
 * computation that does not belong in the per-month component pass.
 */

import { computeEPF } from './statutory/epf-engine.js'
import { computeESI } from './statutory/esi-engine.js'
import { computePTax } from './statutory/ptax-engine.js'
import { computeLWF } from './statutory/lwf-engine.js'
import type { EmployeeStatutoryParams } from './statutory/statutory-governance.js'
import { round2, finalizeDeductionsAndNet } from './payroll-engine.js'
import type { PayrollSlipResult, PayrollComponentSnapshot } from './payroll-engine.js'

/** Codes of statutory lines that the engines own and therefore replace.
 *  Matched ONLY against deduction / employer_contribution lines — earnings are
 *  never stripped (so a custom earning like "PT Allowance" is safe).
 *  Exported so salary-config-store.ts can reject a tenant creating a custom
 *  component whose code collides with one of these (ISSUE-142) — without this
 *  guard, applyStatutoryToSlip() silently overwrites the custom component's
 *  line with the statutory engine's own line on every payroll run, with no
 *  error anywhere. Keep this list and the guard in sync; they must never
 *  drift into two different reserved-word sets. */
export const STATUTORY_CODE = /^(PF|EPF|PF_EMPLOYEE|PF_EMPLOYER|EPF_EDLI|EPF_ADMIN|ESI|ESIC|ESI_EMPLOYEE|ESI_EMPLOYER|PT|PTAX|PROF_TAX|PROFESSIONAL_TAX|TDS|INCOME_TAX|LWF|LWF_EMPLOYEE|LWF_EMPLOYER)$/i

export interface StatutoryTrace {
  epf:  { applied: boolean; pfWages: number; employee: number; employer: number; reason?: string }
  esi:  { applied: boolean; esiWages: number; employee: number; employer: number; status: string }
  ptax: { applied: boolean; income: number; amount: number; stateCode: string | null }
  lwf:  { applied: boolean; employee: number; employer: number; stateCode: string | null }
}

export interface StatutoryApplicationResult {
  slip:  PayrollSlipResult
  trace: StatutoryTrace
}

/**
 * Inject a monthly TDS deduction line into an already-statutory-applied slip and
 * recompute totals/net. Pure — the caller computes monthlyTDS (async DB work).
 * Removes any pre-existing TDS line first so re-runs are idempotent. A monthlyTDS
 * of 0 (income below the rebate threshold) leaves the slip unchanged.
 */
export function applyTdsToSlip(slip: PayrollSlipResult, monthlyTDS: number): PayrollSlipResult {
  const m = round2(monthlyTDS)
  const kept = slip.component_breakdown.filter(c => !/^TDS$/i.test(c.code))
  const breakdown = m > 0 ? [...kept, mkLine('TDS', 'TDS (Income Tax)', 'deduction', m, 9005)] : kept
  const deductionBase = round2(
    breakdown.filter(c => c.component_type === 'deduction').reduce((s, c) => s + c.monthly_amount, 0),
  )
  const { total_deductions, net_pay, deduction_shortfall } =
    finalizeDeductionsAndNet(slip.gross_pay, round2(deductionBase + slip.lop_amount))
  return { ...slip, component_breakdown: breakdown, total_deductions, net_pay, deduction_shortfall }
}

function mkLine(
  code: string, name: string,
  type: 'deduction' | 'employer_contribution',
  monthly: number, sequence: number,
): PayrollComponentSnapshot {
  const m = round2(monthly)
  return {
    salary_component_id: `__statutory_${code.toLowerCase()}__`,
    name, code,
    component_type: type,
    calc_type:      'statutory',
    value:          0,
    monthly_amount: m,
    annual_amount:  round2(m * 12),
    sequence,
  }
}

/**
 * Recompute a slip's statutory deductions/contributions via the engines.
 *
 * @param slip          Result of computePayrollSlip (unmodified input)
 * @param params        Resolved EmployeeStatutoryParams for this employee+month
 * @param calendarMonth Calendar month 1-12 of the payroll period (for PT frequency)
 */
export function applyStatutoryToSlip(
  slip: PayrollSlipResult,
  params: EmployeeStatutoryParams,
  calendarMonth: number,
): StatutoryApplicationResult {
  const comps = slip.component_breakdown
  const earnings = comps.filter(c => c.component_type === 'earning')

  // ── Wage bases ────────────────────────────────────────────────────────────
  // component_breakdown's monthly_amount values are the full, un-prorated
  // monthly amounts (computePayrollSlip's own docstring: "Gross pay = sum of
  // earning components (full-month amounts)") — LOP is applied only as a
  // separate deduction line, never reducing gross_pay or any component
  // itself. Statutory wage bases must reflect actual EARNED wages for the
  // month, not the full-month figure, or PF is over-deducted and ESI/PT/LWF
  // eligibility is under-counted for any employee with LOP days this month
  // (fresh audit finding — verified: Basic 18,000/Gross 30,000 with 11/22
  // LOP days previously computed PF on the full 18,000 → capped-at-ceiling
  // ₹1,800 deducted, and ESI on the full 30,000 → wrongly marked ineligible,
  // instead of the correct earned Basic 9,000 → PF ₹1,080, and earned gross
  // 15,000 → correctly ESI-eligible). Apply the same proportional reduction
  // LOP applies to gross_pay to the PF-applicable earnings subtotal.
  const payableFraction = slip.gross_pay > 0
    ? (slip.gross_pay - slip.lop_amount) / slip.gross_pay
    : 1
  const pfWages = round2(
    earnings.filter(c => c.is_pf_applicable || c.affects_pf)
            .reduce((s, c) => s + c.monthly_amount, 0) * payableFraction,
  )
  // ESI / PT / LWF are computed on earned gross (gross_pay less LOP), not the
  // full un-prorated monthly gross.
  const grossWages = round2(slip.gross_pay - slip.lop_amount)

  // ── EPF ───────────────────────────────────────────────────────────────────
  // Fold the per-employee PF wage basis into the config so the SLIP matches the
  // employee's setting (Capped / Actual), not just the tenant default:
  //   restrictPfToCeiling true  → cap PF wages to the ceiling
  //   false → no ceiling (PF on full PF wages)
  //   null  → follow tenant (isWageCeilingApplicable)
  const restrictPfToCeiling = params.epfApplicability.restrictPfToCeiling
  const effEpfConfig = restrictPfToCeiling === null
    ? params.epfConfig
    : { ...params.epfConfig, isWageCeilingApplicable: restrictPfToCeiling }

  const epfApplicable = params.epfApplicability.isApplicable && pfWages > 0
  const epf = epfApplicable
    ? computeEPF(
        {
          employeeId:            params.employeeId,
          pfWages,
          voluntaryPfPct:        params.epfApplicability.voluntaryPfPct,
          isEpfApplicable:       true,
          isInternationalWorker: params.epfApplicability.isInternationalWorker,
          higherPfOpted:         params.epfApplicability.higherPfOpted,
          higherPfPct:           params.epfApplicability.higherPfPct,
        },
        effEpfConfig,
      )
    : null

  // ── ESI ───────────────────────────────────────────────────────────────────
  // forceApplicable keeps deducting through a contribution-period continuation
  // even when wages crossed the ₹21,000 ceiling mid-period (ESIC rule). Without
  // it the payslip silently dropped ESI for continuation employees while the
  // filing still reported it — a deposit-vs-filing divergence.
  const esi = params.esiApplicability.isApplicable
    ? computeESI(grossWages, params.esiConfig, params.esiApplicability.continuationActive)
    : null

  // ── PTax ──────────────────────────────────────────────────────────────────
  const ptax = params.ptaxApplicability.isApplicable
    ? computePTax(grossWages, params.ptaxApplicability.slabs, calendarMonth, params.ptaxApplicability.stateCode)
    : null

  // ── LWF ───────────────────────────────────────────────────────────────────
  const lwf = params.lwfApplicability.isApplicable && params.lwfApplicability.config
    ? computeLWF(grossWages, calendarMonth, params.lwfApplicability.config)
    : null

  // ── Rebuild breakdown: keep earnings + non-statutory lines, replace statutory ─
  const kept = comps.filter(
    c => c.component_type === 'earning' || !STATUTORY_CODE.test(c.code),
  )

  const statLines: PayrollComponentSnapshot[] = []
  if (epf) {
    const empPf = round2(epf.employeeContribution + epf.voluntaryPfContribution)
    statLines.push(mkLine('PF_EMPLOYEE', 'Provident Fund (Employee)', 'deduction', empPf, 9000))
    // Employer PF = 12% (EPF 3.67% + EPS 8.33%). EDLI (0.5%) is shown as a separate
    // retiral line, matching how leading payroll systems present employer PF.
    const employerPf12 = round2(epf.employerPf + epf.employerEps)
    statLines.push(mkLine('PF_EMPLOYER', 'Provident Fund (Employer)', 'employer_contribution', employerPf12, 9001))
    if (epf.edliContribution > 0) {
      statLines.push(mkLine('EPF_EDLI', 'EDLI (Employer)', 'employer_contribution', epf.edliContribution, 9008))
    }
    if (epf.adminCharges > 0) {
      statLines.push(mkLine('EPF_ADMIN', 'EPF Admin Charges (Employer)', 'employer_contribution', epf.adminCharges, 9009))
    }
  }
  if (esi && esi.isEligible) {
    statLines.push(mkLine('ESI_EMPLOYEE', 'ESI (Employee)', 'deduction', esi.employeeContribution, 9002))
    statLines.push(mkLine('ESI_EMPLOYER', 'ESI (Employer)', 'employer_contribution', esi.employerContribution, 9003))
  }
  if (ptax && ptax.ptaxAmount > 0) {
    statLines.push(mkLine('PTAX', 'Professional Tax', 'deduction', ptax.ptaxAmount, 9004))
  }
  if (lwf && lwf.isEligible && lwf.employeeContribution > 0) {
    statLines.push(mkLine('LWF_EMPLOYEE', 'Labour Welfare Fund (Employee)', 'deduction', lwf.employeeContribution, 9006))
  }
  if (lwf && lwf.isEligible && lwf.employerContribution > 0) {
    statLines.push(mkLine('LWF_EMPLOYER', 'Labour Welfare Fund (Employer)', 'employer_contribution', lwf.employerContribution, 9007))
  }

  const breakdown = [...kept, ...statLines]

  // ── Detect configured-but-silently-dropped statutory components ───────────
  // STATUTORY_CODE-matching deduction/employer_contribution lines are always
  // stripped from `kept` above and replaced by the engines' own lines above —
  // but if the engine determines the employee isn't applicable (e.g. no
  // site/state resolved, so PT slabs can't be looked up), no replacement line
  // is added either, and the deduction silently disappears with nothing on
  // the payslip to say why. Warn exactly like the existing no-attendance
  // warning so this can't slip past payroll review unnoticed — the same
  // "never silently zero a statutory deduction" rule this codebase already
  // enforces for TDS (see applyTdsToSlip) must hold for PF/ESI/PT/LWF too.
  const droppedCategories = new Set<string>()
  for (const c of comps) {
    if (c.component_type === 'earning') continue
    if (!STATUTORY_CODE.test(c.code)) continue
    if (/^(TDS|INCOME_TAX)$/i.test(c.code)) continue // owned by applyTdsToSlip, not this function
    if (/^(PF|EPF|PF_EMPLOYEE|PF_EMPLOYER|EPF_EDLI|EPF_ADMIN)$/i.test(c.code) && !epf) {
      droppedCategories.add('Provident Fund')
    } else if (/^(ESI|ESIC|ESI_EMPLOYEE|ESI_EMPLOYER)$/i.test(c.code) && !(esi && esi.isEligible)) {
      droppedCategories.add('ESI')
    } else if (/^(PT|PTAX|PROF_TAX|PROFESSIONAL_TAX)$/i.test(c.code) && !(ptax && ptax.ptaxAmount > 0)) {
      droppedCategories.add('Professional Tax')
    } else if (/^(LWF|LWF_EMPLOYEE|LWF_EMPLOYER)$/i.test(c.code) &&
               !(lwf && lwf.isEligible && (lwf.employeeContribution > 0 || lwf.employerContribution > 0))) {
      droppedCategories.add('LWF')
    }
  }
  const statutoryDropWarning = droppedCategories.size > 0
    ? `${[...droppedCategories].join(', ')} ${droppedCategories.size === 1 ? 'is' : 'are'} configured for this employee but could not be applied this run (unresolved statutory setup — check site/state/registration). Verify before finalizing.`
    : undefined

  // ── Recompute totals (LOP preserved exactly) ───────────────────────────────
  const deductionBase = round2(
    breakdown.filter(c => c.component_type === 'deduction')
             .reduce((s, c) => s + c.monthly_amount, 0),
  )
  const employer_contributions = round2(
    breakdown.filter(c => c.component_type === 'employer_contribution')
             .reduce((s, c) => s + c.monthly_amount, 0),
  )
  const { total_deductions, net_pay, deduction_shortfall } =
    finalizeDeductionsAndNet(slip.gross_pay, round2(deductionBase + slip.lop_amount))

  return {
    slip: {
      ...slip,
      component_breakdown: breakdown,
      total_deductions,
      employer_contributions,
      net_pay,
      deduction_shortfall,
      warning: [slip.warning, statutoryDropWarning].filter(Boolean).join(' ') || undefined,
    },
    trace: {
      epf: {
        applied:  !!epf,
        pfWages,
        employee: epf ? round2(epf.employeeContribution + epf.voluntaryPfContribution) : 0,
        employer: epf?.totalEmployerContribution ?? 0,
        reason:   epfApplicable ? undefined : (params.epfApplicability.exemptionReason ?? 'not applicable'),
      },
      esi: {
        applied:  !!(esi && esi.isEligible),
        esiWages: grossWages,
        employee: esi?.employeeContribution ?? 0,
        employer: esi?.employerContribution ?? 0,
        status:   esi?.status ?? 'not_applicable',
      },
      ptax: {
        applied:   !!(ptax && ptax.ptaxAmount > 0),
        income:    grossWages,
        amount:    ptax?.ptaxAmount ?? 0,
        stateCode: params.ptaxApplicability.stateCode,
      },
      lwf: {
        applied:   !!(lwf && lwf.isEligible && (lwf.employeeContribution > 0 || lwf.employerContribution > 0)),
        employee:  lwf?.employeeContribution ?? 0,
        employer:  lwf?.employerContribution ?? 0,
        stateCode: params.lwfApplicability.config?.stateCode ?? null,
      },
    },
  }
}
