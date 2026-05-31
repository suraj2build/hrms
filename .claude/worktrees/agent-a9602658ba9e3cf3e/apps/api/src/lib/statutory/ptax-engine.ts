/**
 * Professional Tax Engine (India)
 * State-wise slab-based computation.
 */

export interface PTaxSlab {
  monthlyIncomeFrom: number
  monthlyIncomeTo?: number
  monthlyPtax: number
}

/**
 * Compute professional tax for a given monthly income using state slabs.
 * Filters slabs where income >= from AND (no to OR income <= to).
 * Sorts matched slabs by monthlyIncomeFrom DESC, returns first match's monthlyPtax.
 * Returns 0 if no match found.
 */
export function computePTax(monthlyIncome: number, slabs: PTaxSlab[]): number {
  const matchedSlabs = slabs.filter(slab => {
    const aboveFrom = monthlyIncome >= slab.monthlyIncomeFrom
    const belowTo = slab.monthlyIncomeTo === undefined || monthlyIncome <= slab.monthlyIncomeTo
    return aboveFrom && belowTo
  })

  if (matchedSlabs.length === 0) {
    return 0
  }

  // Sort by monthlyIncomeFrom DESC, take the first (highest applicable slab)
  matchedSlabs.sort((a, b) => b.monthlyIncomeFrom - a.monthlyIncomeFrom)
  return matchedSlabs[0].monthlyPtax
}
