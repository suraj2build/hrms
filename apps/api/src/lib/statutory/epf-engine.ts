/**
 * EPF Calculation Engine (India)
 * Employees' Provident Fund computation with full trace.
 */

export interface EPFConfig {
  employeeContributionPct: number  // 12
  employerPfPct: number            // 3.67
  employerEpsPct: number           // 8.33
  wageCeiling: number              // 15000
  isWageCeilingApplicable: boolean
  allowVoluntaryPf: boolean
}

export interface EPFInput {
  employeeId: string
  pfWages: number          // basic + DA
  voluntaryPfPct: number
  isEpfApplicable: boolean
}

export interface EPFResult {
  pfWages: number
  cappedPfWages: number
  employeeContribution: number
  voluntaryPfContribution: number
  employerPf: number
  employerEps: number
  edliContribution: number
  totalEmployerContribution: number
  isCapped: boolean
  traceSteps: string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeEPF(input: EPFInput, config: EPFConfig): EPFResult {
  const zero: EPFResult = {
    pfWages: input.pfWages,
    cappedPfWages: 0,
    employeeContribution: 0,
    voluntaryPfContribution: 0,
    employerPf: 0,
    employerEps: 0,
    edliContribution: 0,
    totalEmployerContribution: 0,
    isCapped: false,
    traceSteps: ['EPF not applicable for this employee'],
  }

  if (!input.isEpfApplicable) {
    return zero
  }

  const traceSteps: string[] = []
  traceSteps.push(`Employee ID: ${input.employeeId}`)
  traceSteps.push(`PF Wages (Basic + DA): ${input.pfWages}`)

  // Apply wage ceiling
  const cappedPfWages = config.isWageCeilingApplicable
    ? Math.min(input.pfWages, config.wageCeiling)
    : input.pfWages
  const isCapped = cappedPfWages < input.pfWages

  if (config.isWageCeilingApplicable) {
    traceSteps.push(`Wage ceiling applicable: ${config.wageCeiling}`)
    traceSteps.push(`Capped PF wages: ${cappedPfWages}${isCapped ? ' (capped)' : ' (below ceiling)'}`)
  } else {
    traceSteps.push(`Wage ceiling not applicable, using full wages: ${cappedPfWages}`)
  }

  // Employee contribution
  const employeeContribution = round2(cappedPfWages * config.employeeContributionPct / 100)
  traceSteps.push(`Employee contribution: ${cappedPfWages} × ${config.employeeContributionPct}% = ${employeeContribution}`)

  // Voluntary PF
  const voluntaryPfContribution = config.allowVoluntaryPf && input.voluntaryPfPct > 0
    ? round2(cappedPfWages * input.voluntaryPfPct / 100)
    : 0
  if (config.allowVoluntaryPf && input.voluntaryPfPct > 0) {
    traceSteps.push(`Voluntary PF: ${cappedPfWages} × ${input.voluntaryPfPct}% = ${voluntaryPfContribution}`)
  } else {
    traceSteps.push(`No voluntary PF contribution`)
  }

  // Employer PF (3.67%)
  const employerPf = round2(cappedPfWages * config.employerPfPct / 100)
  traceSteps.push(`Employer PF: ${cappedPfWages} × ${config.employerPfPct}% = ${employerPf}`)

  // Employer EPS (8.33%)
  const employerEps = round2(cappedPfWages * config.employerEpsPct / 100)
  traceSteps.push(`Employer EPS: ${cappedPfWages} × ${config.employerEpsPct}% = ${employerEps}`)

  // EDLI (0.5%, capped at 75)
  const edliContribution = round2(Math.min(cappedPfWages * 0.005, 75))
  traceSteps.push(`EDLI contribution: min(${cappedPfWages} × 0.5%, 75) = ${edliContribution}`)

  // Total employer contribution
  const totalEmployerContribution = round2(employerPf + employerEps + edliContribution)
  traceSteps.push(`Total employer contribution: ${employerPf} + ${employerEps} + ${edliContribution} = ${totalEmployerContribution}`)

  return {
    pfWages: input.pfWages,
    cappedPfWages,
    employeeContribution,
    voluntaryPfContribution,
    employerPf,
    employerEps,
    edliContribution,
    totalEmployerContribution,
    isCapped,
    traceSteps,
  }
}
