/**
 * EPF Calculation Engine (India)
 * Employees' Provident Fund computation with full trace.
 *
 * All rates and thresholds are configuration-driven — nothing is hardcoded.
 * EDLI rate and cap are now configurable (previously hardcoded at 0.5% / ₹75).
 */

export interface EPFConfig {
  employeeContributionPct: number  // typically 12.00
  employerPfPct:           number  // typically 3.67 (EPF portion)
  employerEpsPct:          number  // typically 8.33 (EPS portion)
  wageCeiling:             number  // typically 15000
  isWageCeilingApplicable: boolean
  allowVoluntaryPf:        boolean
  // EDLI — configurable; statutory defaults: 0.5% rate, ₹75 cap, ₹25 floor
  edliRatePct:             number  // typically 0.5
  edliCap:                 number  // typically 75
  edliFloor:               number  // typically 25 (admin charge floor — set 0 to disable)
  // Admin charges on EPF contributions (employer side, not in scope of employee deduction)
  adminChargesPct:         number  // typically 0.50 on EPF wages (not subtracted from net pay)
}

export const DEFAULT_EPF_CONFIG: EPFConfig = {
  employeeContributionPct: 12,
  employerPfPct:           3.67,
  employerEpsPct:          8.33,
  wageCeiling:             15000,
  isWageCeilingApplicable: true,
  allowVoluntaryPf:        false,
  edliRatePct:             0.5,
  edliCap:                 75,
  edliFloor:               25,
  adminChargesPct:         0.50,
}

export interface EPFInput {
  employeeId:        string
  pfWages:           number   // sum of PF-applicable components (basic + DA)
  voluntaryPfPct:    number   // 0 if not opted
  isEpfApplicable:   boolean
  isInternationalWorker: boolean  // international workers have no wage ceiling
  higherPfOpted:     boolean      // employee opts for higher PF (on actual wages, ignoring ceiling)
  higherPfPct:       number       // applicable when higherPfOpted = true
}

export interface EPFResult {
  pfWages:                 number
  cappedPfWages:           number
  employeeContribution:    number
  voluntaryPfContribution: number
  employerPf:              number
  employerEps:             number
  edliContribution:        number
  adminCharges:            number
  totalEmployerContribution: number
  isCapped:                boolean
  traceSteps:              string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeEPF(input: EPFInput, config: EPFConfig): EPFResult {
  const zero: EPFResult = {
    pfWages:                 input.pfWages,
    cappedPfWages:           0,
    employeeContribution:    0,
    voluntaryPfContribution: 0,
    employerPf:              0,
    employerEps:             0,
    edliContribution:        0,
    adminCharges:            0,
    totalEmployerContribution: 0,
    isCapped:                false,
    traceSteps:              ['EPF not applicable for this employee'],
  }

  if (!input.isEpfApplicable) return zero

  const traceSteps: string[] = []
  traceSteps.push(`Employee ID: ${input.employeeId}`)
  traceSteps.push(`PF Wages (Basic + DA): ${input.pfWages}`)

  // ── Wage ceiling ─────────────────────────────────────────────────────────────
  // International workers: no wage ceiling (EPFO circular)
  // Higher PF opted: use actual wages (ignoring ceiling) for employee contribution only
  const ceilingApplicable = config.isWageCeilingApplicable && !input.isInternationalWorker
  const cappedPfWages = ceilingApplicable
    ? Math.min(input.pfWages, config.wageCeiling)
    : input.pfWages
  const isCapped = ceilingApplicable && cappedPfWages < input.pfWages

  traceSteps.push(ceilingApplicable
    ? `Wage ceiling: ${config.wageCeiling} — effective PF wages: ${cappedPfWages}${isCapped ? ' (capped)' : ' (below ceiling)'}`
    : `Wage ceiling not applicable (${input.isInternationalWorker ? 'international worker' : 'ceiling disabled'}) — using: ${cappedPfWages}`)

  // ── Employee contribution ─────────────────────────────────────────────────────
  // If higher PF opted, use actual wages (uncapped) at employee's chosen rate
  const employeeBase = input.higherPfOpted ? input.pfWages : cappedPfWages
  const empContribRate = input.higherPfOpted ? input.higherPfPct : config.employeeContributionPct
  const employeeContribution = round2(employeeBase * empContribRate / 100)
  traceSteps.push(`Employee contribution: ${employeeBase} × ${empContribRate}% = ${employeeContribution}${input.higherPfOpted ? ' (higher PF)' : ''}`)

  // ── Voluntary PF (on top of statutory contribution) ───────────────────────────
  const voluntaryPfContribution = config.allowVoluntaryPf && input.voluntaryPfPct > 0
    ? round2(cappedPfWages * input.voluntaryPfPct / 100)
    : 0
  if (voluntaryPfContribution > 0) {
    traceSteps.push(`Voluntary PF: ${cappedPfWages} × ${input.voluntaryPfPct}% = ${voluntaryPfContribution}`)
  }

  // ── Employer PF (3.67% of capped wages) ──────────────────────────────────────
  const employerPf = round2(cappedPfWages * config.employerPfPct / 100)
  traceSteps.push(`Employer PF (${config.employerPfPct}%): ${cappedPfWages} × ${config.employerPfPct}% = ${employerPf}`)

  // ── Employer EPS (8.33% of capped wages) ─────────────────────────────────────
  const employerEps = round2(cappedPfWages * config.employerEpsPct / 100)
  traceSteps.push(`Employer EPS (${config.employerEpsPct}%): ${cappedPfWages} × ${config.employerEpsPct}% = ${employerEps}`)

  // ── EDLI contribution (rate, capped — no floor; the floor field protects admin charges) ──
  const edliRaw = round2(cappedPfWages * config.edliRatePct / 100)
  const edliContribution = Math.min(edliRaw, config.edliCap)
  traceSteps.push(
    `EDLI (${config.edliRatePct}%, cap=${config.edliCap}): raw=${edliRaw} → applied=${edliContribution}`,
  )

  // ── Admin charges (proportional only — no per-employee floor) ────────────────
  // The statutory admin-charge floor (config.edliFloor) applies once to an
  // establishment's *total* monthly admin charges, not to each employee's
  // individual share. Flooring here, per employee, overstated the aggregate
  // by floor×employeeCount whenever most employees' raw share fell under the
  // floor (e.g. 200 employees × ₹15 raw → floored to ₹25 each = ₹5,000
  // instead of the correct establishment-level ₹3,000). The floor is applied
  // once, to the summed total, at the call sites that aggregate this across
  // an establishment (payroll/exports.ts, payroll/filing-pack.ts,
  // datasets/statutory.ts).
  const adminCharges = round2(cappedPfWages * config.adminChargesPct / 100)
  traceSteps.push(`Admin charges (${config.adminChargesPct}%): ${cappedPfWages} × ${config.adminChargesPct}% = ${adminCharges}`)

  // ── Total employer contribution ───────────────────────────────────────────────
  const totalEmployerContribution = round2(employerPf + employerEps + edliContribution)
  traceSteps.push(`Total employer contribution: ${employerPf} + ${employerEps} + ${edliContribution} = ${totalEmployerContribution}`)

  return {
    pfWages:                 input.pfWages,
    cappedPfWages,
    employeeContribution,
    voluntaryPfContribution,
    employerPf,
    employerEps,
    edliContribution,
    adminCharges,
    totalEmployerContribution,
    isCapped,
    traceSteps,
  }
}
