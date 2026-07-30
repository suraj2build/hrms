/**
 * payroll-validator.ts
 *
 * Pre-insert validation for payroll slip payloads and compensation resolution.
 *
 * validatePayrollSlipPayload()
 *   Call before every payroll_slips insert.  Rejects null, undefined, NaN,
 *   Infinity, and negative values in all numeric fields so the DB never
 *   receives malformed data and produces an opaque
 *   "invalid input syntax for type numeric" error with no field context.
 *
 * validateCompensation()
 *   Call after fetchActiveCompensation() to surface blocking errors (no
 *   compensation, negative CTC) and non-blocking warnings (zero CTC, no
 *   earning components) before computation starts.
 *
 * Both functions are pure — no I/O.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PayrollSlipValidation {
  valid:  boolean
  errors: string[]   // field-level error messages; empty when valid
}

export interface CompensationValidation {
  /** Errors that must block payroll computation for this employee */
  blocking_errors: string[]
  /** Warnings that should be surfaced but do not block computation */
  warnings:        string[]
}

export interface CompensationInput {
  id:          string
  ctc_monthly: number
  ctc_annual:  number
  effective_from?: string
  components:  Array<{
    component_type:  string
    monthly_amount:  number
    annual_amount?:  number
    name?:           string
    code?:           string
  }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Numeric columns in payroll_slips (must mirror 074_payroll_engine.sql +
 * 138_payroll_slip_numeric_days.sql).
 * Every field here is checked for null/undefined/NaN/Infinity/negative.
 */
const NUMERIC_FIELDS = [
  'total_working_days',
  'payable_days',
  'lop_days',
  'overtime_hours',
  'ctc_monthly',
  'gross_pay',
  'lop_amount',
  'total_deductions',
  'net_pay',
  'employer_contributions',
  'tds_deducted',
] as const

type SlipNumericField = (typeof NUMERIC_FIELDS)[number]

const MONTH_RE = /^\d{4}-\d{2}$/

// ── validatePayrollSlipPayload ─────────────────────────────────────────────────

/**
 * Validate a payroll slip insert row before it reaches the DB.
 *
 * Returns { valid: true, errors: [] } on success.
 * Returns { valid: false, errors: [...] } with human-readable messages on failure.
 *
 * @param row     The row object that will be passed to supabase.from('payroll_slips').insert(row)
 * @param context Used only for error message context — not validated here
 */
export function validatePayrollSlipPayload(
  row:     Record<string, unknown>,
  context: { employeeId: string; month: string },
): PayrollSlipValidation {
  const errors: string[] = []

  // ── Required identifier fields ────────────────────────────────────────────

  if (!row.tenant_id || typeof row.tenant_id !== 'string') {
    errors.push('tenant_id is missing or not a string')
  }
  if (!row.run_id || typeof row.run_id !== 'string') {
    errors.push('run_id is missing or not a string')
  }
  if (!row.employee_id || typeof row.employee_id !== 'string') {
    errors.push('employee_id is missing or not a string')
  }

  // ── Month format ─────────────────────────────────────────────────────────

  if (!row.month || typeof row.month !== 'string' || !MONTH_RE.test(row.month as string)) {
    errors.push(`month "${row.month}" is not YYYY-MM format`)
  } else if (row.month !== context.month) {
    errors.push(
      `month field "${row.month}" does not match run month "${context.month}" — ` +
      'this slip would be inserted into the wrong period',
    )
  }

  // ── Numeric fields ────────────────────────────────────────────────────────

  for (const field of NUMERIC_FIELDS) {
    const raw = row[field as string]

    if (raw === null) {
      errors.push(`${field} is null — expected a non-negative number`)
      continue
    }
    if (raw === undefined) {
      errors.push(`${field} is undefined — field is missing from slip payload`)
      continue
    }

    const n = Number(raw)

    if (Number.isNaN(n)) {
      errors.push(`${field} is NaN (raw value: ${JSON.stringify(raw)})`)
    } else if (!Number.isFinite(n)) {
      errors.push(
        `${field} is ${n > 0 ? 'Infinity' : '-Infinity'} (raw value: ${JSON.stringify(raw)})`,
      )
    } else if (n < 0) {
      errors.push(`${field} is negative (${n}) — all payroll amounts must be ≥ 0`)
    }
  }

  // ── component_breakdown ───────────────────────────────────────────────────

  if (!Array.isArray(row.component_breakdown)) {
    errors.push(
      `component_breakdown must be an array (got ${
        row.component_breakdown === null ? 'null' : typeof row.component_breakdown
      })`,
    )
  }

  // ── status ────────────────────────────────────────────────────────────────

  const VALID_STATUSES = new Set(['draft', 'finalized', 'held'])
  if (row.status !== undefined && !VALID_STATUSES.has(row.status as string)) {
    errors.push(`status "${row.status}" is not a valid payroll_slips status (draft|finalized|held)`)
  }

  return { valid: errors.length === 0, errors }
}

// ── validateCompensation ───────────────────────────────────────────────────────

/**
 * Validate a compensation record before payroll computation.
 *
 * Blocking errors must prevent this employee's payroll from running.
 * Warnings should be surfaced to the operator but do not stop computation.
 *
 * @param compensation  Result of fetchActiveCompensation() — null means none found
 * @param context       Employee + month for error messages
 * @param periodEndDate Optional: the last day of the payroll period (YYYY-MM-DD).
 *                      When provided, checks that effective_from ≤ periodEndDate.
 */
export function validateCompensation(
  compensation:  CompensationInput | null,
  context:       { employeeId: string; month: string },
  periodEndDate?: string,
): CompensationValidation {
  const blocking_errors: string[] = []
  const warnings:        string[] = []

  // ── No compensation at all ────────────────────────────────────────────────

  if (!compensation) {
    blocking_errors.push(
      `No active compensation found for employee ${context.employeeId} ` +
      `as of ${periodEndDate ?? context.month} — employee cannot be included in payroll`,
    )
    return { blocking_errors, warnings }
  }

  // ── Record integrity ──────────────────────────────────────────────────────

  if (!compensation.id || typeof compensation.id !== 'string') {
    blocking_errors.push(
      `Compensation record for employee ${context.employeeId} has no valid ID — data integrity issue`,
    )
  }

  // ── CTC validity ─────────────────────────────────────────────────────────

  const ctcM = Number(compensation.ctc_monthly)
  const ctcA = Number(compensation.ctc_annual)

  if (Number.isNaN(ctcM) || !Number.isFinite(ctcM)) {
    blocking_errors.push(
      `ctc_monthly is ${ctcM} for employee ${context.employeeId} — ` +
      `invalid numeric value in compensation record ${compensation.id}`,
    )
  } else if (ctcM < 0) {
    blocking_errors.push(
      `ctc_monthly is negative (${ctcM}) for employee ${context.employeeId} — ` +
      `compensation record ${compensation.id} has corrupt data`,
    )
  } else if (ctcM === 0) {
    warnings.push(
      `ctc_monthly is 0 for employee ${context.employeeId} — ` +
      'employee will receive zero gross pay (verify compensation setup)',
    )
  }

  if (Number.isNaN(ctcA) || !Number.isFinite(ctcA)) {
    blocking_errors.push(
      `ctc_annual is ${ctcA} for employee ${context.employeeId} — ` +
      `invalid numeric value in compensation record ${compensation.id}`,
    )
  } else if (ctcA < 0) {
    blocking_errors.push(
      `ctc_annual is negative (${ctcA}) for employee ${context.employeeId}`,
    )
  }

  // ── Effective period guard ─────────────────────────────────────────────────
  // If compensation effective_from is after the period end, the asOf filter
  // in fetchActiveCompensation should have excluded it — but verify defensively.

  if (periodEndDate && compensation.effective_from) {
    if (compensation.effective_from > periodEndDate) {
      blocking_errors.push(
        `Compensation ${compensation.id} is future-dated (effective_from=${compensation.effective_from}) ` +
        `and should not apply to period ending ${periodEndDate} — ` +
        'this indicates the asOf filter in fetchActiveCompensation was bypassed',
      )
    }
  }

  // ── Component analysis ────────────────────────────────────────────────────

  const earningComponents = compensation.components.filter(c => c.component_type === 'earning')
  const deductionComponents = compensation.components.filter(c => c.component_type === 'deduction')

  if (earningComponents.length === 0) {
    warnings.push(
      `Employee ${context.employeeId} has no earning components — ` +
      'gross pay will be 0 regardless of CTC (check component configuration)',
    )
  } else {
    const grossFromComponents = earningComponents.reduce((s, c) => s + (c.monthly_amount ?? 0), 0)

    if (grossFromComponents === 0 && ctcM > 0) {
      warnings.push(
        `All earning components sum to 0 for employee ${context.employeeId} ` +
        `despite ctc_monthly=${ctcM} — component amounts may not have been computed`,
      )
    }

    // Per-component NaN/Infinity checks
    for (const comp of compensation.components) {
      const amt = Number(comp.monthly_amount)
      if (Number.isNaN(amt) || !Number.isFinite(amt)) {
        blocking_errors.push(
          `Component "${comp.name ?? comp.code ?? comp.component_type}" for employee ` +
          `${context.employeeId} has invalid monthly_amount=${comp.monthly_amount}`,
        )
      }
    }
  }

  // Warn if deductions exceed earnings (would produce net_pay = 0 not negative,
  // but this is suspicious and worth surfacing)
  if (earningComponents.length > 0 && deductionComponents.length > 0) {
    const gross   = earningComponents.reduce((s, c) => s + (c.monthly_amount ?? 0), 0)
    const deducts = deductionComponents.reduce((s, c) => s + (c.monthly_amount ?? 0), 0)
    if (deducts > gross) {
      warnings.push(
        `Deduction components (${deducts}) exceed earning components (${gross}) ` +
        `for employee ${context.employeeId} — net pay will be clamped to 0`,
      )
    }
  }

  return { blocking_errors, warnings }
}

// ── validateComponentTotals ────────────────────────────────────────────────────

export interface ComponentTotalsInput {
  ctc_annual:  number
  ctc_monthly: number
  components: Array<{
    name?:           string
    code?:           string
    component_type:  string
    is_basic?:       boolean
    monthly_amount:  number
    annual_amount?:  number
  }>
}

export interface ComponentTotalsValidation {
  valid:    boolean
  errors:   string[]
  warnings: string[]
}

/**
 * Validate that a compensation's component totals are internally consistent.
 *
 * Returns `valid=false` when hard data-integrity violations are found
 * (NaN amounts, negative values, duplicate codes).
 * Returns `valid=true` with non-empty `warnings` for soft mismatches
 * (gross ≠ CTC, no BASIC, deductions > gross).
 */
export function validateComponentTotals(
  input: ComponentTotalsInput,
): ComponentTotalsValidation {
  const errors:   string[] = []
  const warnings: string[] = []

  const { ctc_annual, ctc_monthly, components } = input

  if (!Array.isArray(components) || components.length === 0) {
    errors.push('components array is empty — at least one earning component required')
    return { valid: false, errors, warnings }
  }

  // ── Per-component integrity ──────────────────────────────────────────────

  const seenNames = new Set<string>()

  for (const c of components) {
    const label = c.name ?? c.code ?? c.component_type

    // NaN / Infinity
    const amt = Number(c.monthly_amount)
    if (Number.isNaN(amt)) {
      errors.push(`Component "${label}" has NaN monthly_amount`)
    } else if (!Number.isFinite(amt)) {
      errors.push(`Component "${label}" has Infinity monthly_amount`)
    } else if (amt < 0) {
      errors.push(`Component "${label}" has negative monthly_amount (${amt})`)
    }

    // Annual vs monthly consistency (allow 2% rounding tolerance)
    if (c.annual_amount !== undefined) {
      const expectedAnnual = Math.round(amt * 12)
      const actualAnnual   = Math.round(Number(c.annual_amount))
      if (Math.abs(expectedAnnual - actualAnnual) > 2) {
        warnings.push(
          `Component "${label}" annual (${actualAnnual}) is not 12× monthly (${Math.round(amt * 12)})`,
        )
      }
    }

    // Duplicate component names
    if (c.name || c.code) {
      const key = (c.code ?? c.name ?? '').toLowerCase()
      if (seenNames.has(key)) {
        errors.push(`Duplicate component: "${label}"`)
      }
      seenNames.add(key)
    }
  }

  // Return early on hard errors — cross-component checks don't make sense
  if (errors.length > 0) return { valid: false, errors, warnings }

  // ── Cross-component analysis ─────────────────────────────────────────────

  const earnings   = components.filter(c => c.component_type === 'earning')
  const deductions = components.filter(c => c.component_type === 'deduction')

  const grossMonthly    = earnings.reduce((s, c)   => s + (c.monthly_amount ?? 0), 0)
  const deductMonthly   = deductions.reduce((s, c) => s + (c.monthly_amount ?? 0), 0)

  // BASIC component check
  const hasBasic = components.some(
    c => c.is_basic === true || (c.code ?? '').toUpperCase() === 'BASIC',
  )
  if (!hasBasic) {
    warnings.push(
      'No BASIC component found — PF and other statutory computations may be incorrect',
    )
  }

  // Deductions > gross
  if (deductMonthly > grossMonthly) {
    warnings.push(
      `Total deductions (₹${deductMonthly.toFixed(0)}/mo) exceed gross earnings ` +
      `(₹${grossMonthly.toFixed(0)}/mo) — net pay will be clamped to ₹0`,
    )
  }

  // Gross vs CTC_monthly (within 10% tolerance — employer contributions inflate CTC)
  const ctcM = Number(ctc_monthly)
  if (ctcM > 0 && grossMonthly > 0) {
    const diff  = Math.abs(grossMonthly - ctcM)
    const pctOff = (diff / ctcM) * 100
    if (pctOff > 15) {
      warnings.push(
        `Gross monthly from earning components (₹${Math.round(grossMonthly)}) differs from ` +
        `CTC monthly (₹${Math.round(ctcM)}) by ${pctOff.toFixed(1)}% — ` +
        'verify component formulas (employer contributions are expected to add to CTC)',
      )
    }
  }

  // Annual CTC consistency
  const ctcA          = Number(ctc_annual)
  const grossAnnual   = grossMonthly * 12
  if (ctcA > 0 && grossAnnual === 0) {
    warnings.push(
      `CTC annual is ₹${ctcA.toLocaleString('en-IN')} but all earning components sum to ₹0/year — ` +
      'verify component formula values',
    )
  }

  return { valid: true, errors, warnings }
}
