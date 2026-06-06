/**
 * LWF Engine — Labour Welfare Fund computation.
 *
 * LWF is state-driven (like PT). The configuration (employee_amount,
 * employer_amount, frequency, wage_ceiling, deduction_months) comes from
 * lwf_state_settings and is resolved per employee.
 *
 * Deduction frequencies:
 *   monthly     — deducted every month
 *   half_yearly — deducted in specific months (e.g. June + December → '6,12')
 *   annual      — deducted once a year (e.g. December → '12')
 */

export interface LWFConfig {
  stateCode:        string
  employeeAmount:   number        // fixed ₹ amount per employee per deduction period
  employerAmount:   number        // fixed ₹ employer contribution
  wageCeiling:      number | null // only applies to employees earning below this
  frequency:        'monthly' | 'half_yearly' | 'annual'
  deductionMonths:  number[]      // calendar months when deduction applies (1–12)
}

export interface LWFResult {
  stateCode:            string
  isEligible:           boolean
  employeeContribution: number
  employerContribution: number
  reason:               string
}

/**
 * Compute LWF for an employee for a given calendar month.
 *
 * @param grossSalary   Employee's gross salary for the month
 * @param calendarMonth Calendar month 1–12
 * @param config        Resolved LWF config for the employee's state
 */
export function computeLWF(
  grossSalary:   number,
  calendarMonth: number,
  config:        LWFConfig,
): LWFResult {
  // Wage ceiling check — if configured, employee must earn below it to be eligible.
  if (config.wageCeiling !== null && grossSalary > config.wageCeiling) {
    return {
      stateCode:            config.stateCode,
      isEligible:           false,
      employeeContribution: 0,
      employerContribution: 0,
      reason:               `Gross salary ₹${grossSalary} exceeds LWF wage ceiling ₹${config.wageCeiling}`,
    }
  }

  // Frequency check — only deduct in the configured months.
  if (!config.deductionMonths.includes(calendarMonth)) {
    return {
      stateCode:            config.stateCode,
      isEligible:           true,
      employeeContribution: 0,
      employerContribution: 0,
      reason:               `LWF not deductible in month ${calendarMonth} for ${config.stateCode} (${config.frequency})`,
    }
  }

  return {
    stateCode:            config.stateCode,
    isEligible:           true,
    employeeContribution: Math.round(config.employeeAmount * 100) / 100,
    employerContribution: Math.round(config.employerAmount * 100) / 100,
    reason:               `LWF applied for ${config.stateCode} (${config.frequency})`,
  }
}

/** Parse the deduction_months string ('6,12') into an array of numbers [6,12]. */
export function parseDeductionMonths(
  frequency: string,
  deductionMonths: string | null | undefined,
): number[] {
  if (frequency === 'monthly') return [1,2,3,4,5,6,7,8,9,10,11,12]
  if (!deductionMonths) {
    // Sensible defaults when not configured
    if (frequency === 'half_yearly') return [6, 12]
    if (frequency === 'annual')      return [12]
    return [1,2,3,4,5,6,7,8,9,10,11,12]
  }
  return deductionMonths
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n >= 1 && n <= 12)
}
