/**
 * ESI Calculation Engine (India)
 * Employees' State Insurance computation.
 */

export interface ESIConfig {
  employeeContributionPct: number  // 0.75
  employerContributionPct: number  // 3.25
  wageCeiling: number              // 21000
}

export type ESIStatus =
  | 'eligible'       // wages <= ceiling; normal contribution
  | 'ineligible'     // wages > ceiling; no contribution
  | 'continuation'   // wages > ceiling but continuation period is active; contribute anyway
  | 'exempt'         // administratively exempt (override); no contribution

export interface ESIResult {
  esiWages:             number
  isEligible:           boolean
  employeeContribution: number
  employerContribution: number
  totalContribution:    number
  status:               ESIStatus
  traceSteps:           string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * ESIC statutory rounding: each contribution is rounded UP to the next higher
 * rupee (ESI (General) Regulations, reg. 40). Applied per employee/employer
 * contribution; the total is the sum of the two rounded amounts.
 */
function ceilRupee(n: number): number {
  return Math.ceil(n - 1e-9)   // epsilon guards fp noise on an exact rupee
}

/**
 * Compute ESI contributions for a single employee.
 *
 * @param grossWages     - Gross wages for the payroll month
 * @param config         - ESI configuration (rates + ceiling)
 * @param forceApplicable - true = contribution period continuation is active.
 *                         Bypasses the wage ceiling check so contributions
 *                         continue through the end of the enrolled period even
 *                         if wages have crossed ₹21,000 mid-period.
 *                         Statutory basis: ESIC contribution period rules.
 */
export function computeESI(
  grossWages:      number,
  config:          ESIConfig,
  forceApplicable: boolean = false,
): ESIResult {
  const traceSteps: string[] = []
  traceSteps.push(`Gross wages: ${grossWages}`)
  traceSteps.push(`ESI wage ceiling: ${config.wageCeiling}`)

  const withinCeiling = grossWages <= config.wageCeiling

  if (forceApplicable && !withinCeiling) {
    traceSteps.push(
      `Contribution period continuation active — wages ${grossWages} exceed ceiling ` +
      `${config.wageCeiling} but ESI forced through period end`,
    )
  } else {
    traceSteps.push(
      `Eligible for ESI: ${withinCeiling} (${grossWages} ${withinCeiling ? '<=' : '>'} ${config.wageCeiling})`,
    )
  }

  const isEligible = withinCeiling || forceApplicable

  if (!isEligible) {
    traceSteps.push(`Employee exceeds wage ceiling — no ESI contribution`)
    return {
      esiWages:             grossWages,
      isEligible:           false,
      employeeContribution: 0,
      employerContribution: 0,
      totalContribution:    0,
      status:               'ineligible',
      traceSteps,
    }
  }

  const employeeContribution = ceilRupee(grossWages * config.employeeContributionPct / 100)
  traceSteps.push(`Employee contribution: ${grossWages} × ${config.employeeContributionPct}% = ${employeeContribution} (rounded up to next rupee)`)

  const employerContribution = ceilRupee(grossWages * config.employerContributionPct / 100)
  traceSteps.push(`Employer contribution: ${grossWages} × ${config.employerContributionPct}% = ${employerContribution} (rounded up to next rupee)`)

  const totalContribution = employeeContribution + employerContribution
  traceSteps.push(`Total ESI contribution: ${employeeContribution} + ${employerContribution} = ${totalContribution}`)

  return {
    esiWages:             grossWages,
    isEligible:           true,
    employeeContribution,
    employerContribution,
    totalContribution,
    status:               forceApplicable && !withinCeiling ? 'continuation' : 'eligible',
    traceSteps,
  }
}
