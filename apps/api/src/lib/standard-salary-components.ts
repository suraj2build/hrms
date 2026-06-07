/**
 * standard-salary-components.ts
 *
 * Canonical best-practice salary component library (India-first, monthly-rated).
 * Tenants can load this set in one click to get a sensible, compliant starting
 * point, then edit / add / remove as needed. Every component carries its global
 * truth (type, taxability, statutory flags) plus a SUGGESTED default rule that
 * pre-fills the structure builder.
 *
 * Notes:
 *   - SPECIAL (Special Allowance) intentionally has NO default rule — it is the
 *     residual "balancing" component that absorbs whatever is left of CTC.
 *   - PF_EMPLOYEE / PF_EMPLOYER use the codes the compensation engine reserves,
 *     so a pre-seeded tenant reuses these rows instead of auto-creating new ones.
 *   - TDS has no default rule — it is computed by the statutory/tax flow, not a
 *     fixed component value.
 *   - These are DEFAULTS. Rates/ceilings (PF 12%, ESI 0.75/3.25%, PT ₹200,
 *     gratuity 4.81%) reflect common statutory values; tenants tune per policy.
 */

export type StdComponentType = 'earning' | 'deduction' | 'employer_contribution'
export type StdCalcType = 'fixed' | 'pct_of_basic' | 'pct_of_ctc' | 'pct_of_gross' | 'balance'

export interface StandardComponent {
  code:               string
  name:               string
  component_type:     StdComponentType
  is_taxable:         boolean
  is_pf_applicable:   boolean
  is_esi_applicable:  boolean
  is_pt_applicable:   boolean
  is_lwf_applicable:  boolean
  is_variable:        boolean
  is_basic:           boolean
  affects_pf:         boolean
  affects_nlc:        boolean
  default_calculation_type: StdCalcType | null
  default_value:            number | null
  display_order:      number
}

/** Build a row with sensible defaults so each entry below stays terse. */
function c(p: Partial<StandardComponent> & Pick<StandardComponent, 'code' | 'name' | 'component_type' | 'display_order'>): StandardComponent {
  return {
    is_taxable:        true,
    is_pf_applicable:  false,
    is_esi_applicable: false,
    is_pt_applicable:  false,
    is_lwf_applicable: false,
    is_variable:       false,
    is_basic:          false,
    affects_pf:        false,
    affects_nlc:       false,
    default_calculation_type: null,
    default_value:            null,
    ...p,
  }
}

export const STANDARD_SALARY_COMPONENTS: StandardComponent[] = [
  // ── Earnings ──────────────────────────────────────────────────────────────
  c({ code: 'BASIC', name: 'Basic Salary', component_type: 'earning', display_order: 10,
      is_pf_applicable: true, is_esi_applicable: true, is_pt_applicable: true,
      is_basic: true, affects_pf: true, affects_nlc: true,
      default_calculation_type: 'pct_of_ctc', default_value: 40 }),
  c({ code: 'HRA', name: 'House Rent Allowance', component_type: 'earning', display_order: 20,
      is_esi_applicable: true,
      default_calculation_type: 'pct_of_basic', default_value: 50 }),
  c({ code: 'CONVEYANCE', name: 'Conveyance Allowance', component_type: 'earning', display_order: 30,
      is_esi_applicable: true,
      default_calculation_type: 'fixed', default_value: 1600 }),
  c({ code: 'MEDICAL', name: 'Medical Allowance', component_type: 'earning', display_order: 40,
      is_esi_applicable: true,
      default_calculation_type: 'fixed', default_value: 1250 }),
  c({ code: 'LTA', name: 'Leave Travel Allowance', component_type: 'earning', display_order: 50,
      default_calculation_type: 'fixed', default_value: 1667 }),
  c({ code: 'SPECIAL', name: 'Special Allowance', component_type: 'earning', display_order: 60,
      is_esi_applicable: true,
      // The residual that balances earnings to CTC — engine computes it as
      // CTC − all other earnings − employer contributions.
      default_calculation_type: 'balance', default_value: 0 }),

  // ── Deductions ────────────────────────────────────────────────────────────
  c({ code: 'PF_EMPLOYEE', name: 'Provident Fund (Employee)', component_type: 'deduction', display_order: 70,
      is_taxable: false, is_pf_applicable: true,
      default_calculation_type: 'pct_of_basic', default_value: 12 }),
  c({ code: 'PT', name: 'Professional Tax', component_type: 'deduction', display_order: 80,
      is_taxable: false,
      default_calculation_type: 'fixed', default_value: 200 }),
  c({ code: 'ESI_EMPLOYEE', name: 'ESI (Employee)', component_type: 'deduction', display_order: 90,
      is_taxable: false,
      default_calculation_type: 'pct_of_gross', default_value: 0.75 }),
  c({ code: 'TDS', name: 'Income Tax (TDS)', component_type: 'deduction', display_order: 100,
      is_taxable: false,
      // Computed by the statutory/tax flow — no fixed default.
      default_calculation_type: null, default_value: null }),

  // ── Employer contributions ────────────────────────────────────────────────
  // Employer PF = 12% (EPF 3.67% + EPS 8.33%). EDLI (0.5%) is a separate retiral line
  // on the payslip; admin (0.5%) is an A/c-2 establishment cost. Matches how Keka /
  // Zoho / RazorpayX present the CTC employer PF line.
  c({ code: 'PF_EMPLOYER', name: 'Provident Fund (Employer)', component_type: 'employer_contribution', display_order: 110,
      is_taxable: false,
      default_calculation_type: 'pct_of_basic', default_value: 12 }),
  c({ code: 'ESI_EMPLOYER', name: 'ESI (Employer)', component_type: 'employer_contribution', display_order: 120,
      is_taxable: false,
      default_calculation_type: 'pct_of_gross', default_value: 3.25 }),
  c({ code: 'GRATUITY', name: 'Gratuity', component_type: 'employer_contribution', display_order: 130,
      is_taxable: false,
      default_calculation_type: 'pct_of_basic', default_value: 4.81 }),
]
