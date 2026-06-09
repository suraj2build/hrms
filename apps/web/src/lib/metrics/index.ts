/**
 * Pure metric calculation functions — no imports, no side effects.
 * All functions are testable in isolation.
 */

// ── General ───────────────────────────────────────────────────────────────────

/** Round a number to 2 decimal places. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Attendance ────────────────────────────────────────────────────────────────

/**
 * Calculate attendance rate as a percentage.
 * Returns 0 if totalWorkingDays is 0.
 */
export function calcAttendanceRate(presentDays: number, totalWorkingDays: number): number {
  if (totalWorkingDays === 0) return 0
  return round2((presentDays / totalWorkingDays) * 100)
}

/**
 * Calculate Loss-of-Pay days.
 * Half days count as 0.5 LOP days each.
 */
export function calcLopDays(absentDays: number, halfDays: number): number {
  return round2(absentDays + halfDays * 0.5)
}

// ── Headcount / Attrition ─────────────────────────────────────────────────────

/**
 * Calculate annualised attrition rate as a percentage.
 * Returns 0 if avgActiveHeadcount is 0.
 */
export function calcAttritionRate(exits: number, avgActiveHeadcount: number): number {
  if (avgActiveHeadcount === 0) return 0
  return round2((exits / avgActiveHeadcount) * 100)
}

/**
 * Calculate net headcount change for a period.
 */
export function calcNetHeadcountChange(joiners: number, exits: number): number {
  return joiners - exits
}

// ── Payroll ───────────────────────────────────────────────────────────────────

/**
 * Calculate month-over-month variance as a percentage.
 * Returns 0 if prior is 0.
 */
export function calcMomVariancePct(current: number, prior: number): number {
  if (prior === 0) return 0
  return round2(((current - prior) / prior) * 100)
}

/**
 * Calculate EPFO admin charges at the standard rate of 0.5%.
 */
export function calcEpfAdminCharges(totalPfWages: number): number {
  return round2(totalPfWages * 0.005)
}

/**
 * Calculate average cost per employee.
 * Returns 0 if headcount is 0.
 */
export function calcCostPerEmployee(totalCost: number, headcount: number): number {
  if (headcount === 0) return 0
  return round2(totalCost / headcount)
}
