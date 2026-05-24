/**
 * ESI Calculation Engine (India)
 * Employees' State Insurance computation.
 */

export interface ESIConfig {
  employeeContributionPct: number  // 0.75
  employerContributionPct: number  // 3.25
  wageCeiling: number              // 21000
}

export interface ESIResult {
  esiWages: number
  isEligible: boolean
  employeeContribution: number
  employerContribution: number
  totalContribution: number
  traceSteps: string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeESI(grossWages: number, config: ESIConfig): ESIResult {
  const traceSteps: string[] = []
  traceSteps.push(`Gross wages: ${grossWages}`)
  traceSteps.push(`ESI wage ceiling: ${config.wageCeiling}`)

  const isEligible = grossWages <= config.wageCeiling
  traceSteps.push(`Eligible for ESI: ${isEligible} (${grossWages} ${isEligible ? '<=' : '>'} ${config.wageCeiling})`)

  if (!isEligible) {
    traceSteps.push(`Employee exceeds wage ceiling — no ESI contribution`)
    return {
      esiWages: grossWages,
      isEligible: false,
      employeeContribution: 0,
      employerContribution: 0,
      totalContribution: 0,
      traceSteps,
    }
  }

  const employeeContribution = round2(grossWages * config.employeeContributionPct / 100)
  traceSteps.push(`Employee contribution: ${grossWages} × ${config.employeeContributionPct}% = ${employeeContribution}`)

  const employerContribution = round2(grossWages * config.employerContributionPct / 100)
  traceSteps.push(`Employer contribution: ${grossWages} × ${config.employerContributionPct}% = ${employerContribution}`)

  const totalContribution = round2(employeeContribution + employerContribution)
  traceSteps.push(`Total ESI contribution: ${employeeContribution} + ${employerContribution} = ${totalContribution}`)

  return {
    esiWages: grossWages,
    isEligible: true,
    employeeContribution,
    employerContribution,
    totalContribution,
    traceSteps,
  }
}
