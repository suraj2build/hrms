/**
 * Professional Tax Engine (India)
 * State-wise slab-based computation with frequency support.
 *
 * Supports:
 *   - monthly   : deduct every payroll month
 *   - half_yearly: deduct in two specific calendar months per year
 *   - annual    : deduct only in one specific calendar month per year
 */

export type PTaxFrequency = 'monthly' | 'half_yearly' | 'annual'

export interface PTaxSlab {
  monthlyIncomeFrom: number
  monthlyIncomeTo?: number
  monthlyPtax: number
  frequency?: PTaxFrequency  // defaults to 'monthly'
  deductionMonth?: number    // calendar month 1–12; null = March(3) for annual, Sept(9)+March(3) for half_yearly
}

/**
 * Determine whether this slab fires in the given calendar month.
 * - monthly:     always fires
 * - half_yearly: fires in deductionMonth and deductionMonth+6 (wrapping at 12)
 * - annual:      fires only in deductionMonth
 */
function isSlabActiveForMonth(slab: PTaxSlab, calendarMonth: number): boolean {
  const freq = slab.frequency ?? 'monthly'

  if (freq === 'monthly') return true

  const dm = slab.deductionMonth
  if (freq === 'annual') {
    const fireMonth = dm ?? 3  // default: March
    return calendarMonth === fireMonth
  }

  if (freq === 'half_yearly') {
    const first  = dm ?? 9                            // default: September
    const second = ((first - 1 + 6) % 12) + 1        // +6 months, wrapping
    return calendarMonth === first || calendarMonth === second
  }

  return true
}

export interface PTaxResult {
  stateCode: string | null
  monthlyIncome: number
  ptaxAmount: number
  slabMatched: boolean
  frequency: PTaxFrequency
  traceSteps: string[]
}

/**
 * Compute professional tax for a given monthly income using state slabs.
 *
 * @param monthlyIncome  - gross monthly income for the payroll period
 * @param slabs          - state-specific slabs loaded from ptax_slabs
 * @param calendarMonth  - calendar month (1–12) of the payroll period
 * @param stateCode      - state code for trace output
 */
export function computePTax(
  monthlyIncome: number,
  slabs: PTaxSlab[],
  // No default here deliberately: both call sites already resolve calendarMonth
  // from the payroll month before calling in, and a `new Date().getMonth() + 1`
  // default would silently use the server process's local time (UTC) instead of
  // the tenant's payroll period — the same UTC/IST bug class fixed elsewhere in
  // this module (ISSUE-154). Making it required prevents a future caller from
  // ever falling back to that wrong default.
  calendarMonth: number,
  stateCode: string | null = null,
): PTaxResult {
  const traceSteps: string[] = []
  traceSteps.push(`State: ${stateCode ?? 'unknown'}, Calendar month: ${calendarMonth}`)
  traceSteps.push(`Monthly income: ${monthlyIncome}`)
  traceSteps.push(`Total slabs loaded: ${slabs.length}`)

  // Step 1: match slabs by income range
  let incomeMatched = slabs.filter(slab => {
    const aboveFrom = monthlyIncome >= slab.monthlyIncomeFrom
    const belowTo   = slab.monthlyIncomeTo === undefined || monthlyIncome <= slab.monthlyIncomeTo
    return aboveFrom && belowTo
  })

  // Catch-all: PT's top band is always open-ended ("above ₹X → flat rate"). If the
  // configured top slab has a finite upper bound and the employee earns ABOVE it,
  // no band matches by range — but PT must still apply at the highest band's rate.
  // So when nothing matched and income exceeds every slab, fall to the top slab.
  if (incomeMatched.length === 0 && slabs.length > 0) {
    const topSlab = [...slabs].sort((a, b) => b.monthlyIncomeFrom - a.monthlyIncomeFrom)[0]
    if (monthlyIncome >= topSlab.monthlyIncomeFrom) {
      traceSteps.push(`Income ${monthlyIncome} exceeds all slab bands — applying highest band (from ${topSlab.monthlyIncomeFrom}) as the open-ended top rate`)
      incomeMatched = [topSlab]
    }
  }

  if (incomeMatched.length === 0) {
    traceSteps.push(`No slab matched income ${monthlyIncome} — PTax = 0`)
    return { stateCode, monthlyIncome, ptaxAmount: 0, slabMatched: false, frequency: 'monthly', traceSteps }
  }

  // Sort by income_from DESC — highest applicable slab wins
  incomeMatched.sort((a, b) => b.monthlyIncomeFrom - a.monthlyIncomeFrom)
  const slab = incomeMatched[0]
  const freq = slab.frequency ?? 'monthly'

  traceSteps.push(`Slab matched: from=${slab.monthlyIncomeFrom} to=${slab.monthlyIncomeTo ?? '∞'}, ptax=${slab.monthlyPtax}, frequency=${freq}`)

  // Step 2: check frequency — does this slab fire this month?
  const fires = isSlabActiveForMonth(slab, calendarMonth)
  if (!fires) {
    traceSteps.push(`Frequency '${freq}' — slab does NOT fire in calendar month ${calendarMonth} — PTax = 0`)
    return { stateCode, monthlyIncome, ptaxAmount: 0, slabMatched: true, frequency: freq, traceSteps }
  }

  traceSteps.push(`Frequency '${freq}' — fires in month ${calendarMonth} — PTax = ${slab.monthlyPtax}`)

  return {
    stateCode,
    monthlyIncome,
    ptaxAmount:   slab.monthlyPtax,
    slabMatched:  true,
    frequency:    freq,
    traceSteps,
  }
}
