/**
 * Payroll Calculation Engine
 * Reusable, strategy-based component computation with explainability traces.
 */

export type CalculationType =
  | 'fixed'
  | 'percentage_of_component'
  | 'formula_based'
  | 'slab_based'
  | 'attendance_based'
  | 'prorated'
  | 'reimbursement_based'
  | 'policy_based'

export interface SlabEntry {
  from: number
  to?: number
  amount: number
}

export interface ComponentInput {
  code: string
  name: string
  calculationType: CalculationType
  fixedAmount?: number
  percentage?: number
  baseComponentCode?: string
  slabConfig?: SlabEntry[]
  attendanceFactor?: 'working_days' | 'present_days' | 'paid_days'
  prorationType?: 'calendar_days' | 'working_days' | 'none'
  formula?: string
}

export interface AttendanceContext {
  totalCalendarDays: number
  workingDays: number
  presentDays: number
  paidDays: number
  lopDays: number
}

export interface CalculationContext {
  employeeId: string
  tenantId: string
  payrollMonth: string
  ctcAnnual: number
  ctcMonthly: number
  attendance: AttendanceContext
  resolvedComponents: Map<string, number>
}

export interface CalculationTrace {
  componentCode: string
  componentName: string
  formula?: string
  inputValues: Record<string, number | string>
  computedValue: number
  computationSteps: string[]
  warnings: string[]
}

/**
 * Evaluate a formula string with variable substitution.
 * Only alphanumeric variable names and standard arithmetic operators allowed.
 */
export function evaluateFormula(formula: string, variables: Record<string, number>): number {
  try {
    let expr = formula
    // Replace variable names (word boundary) with their numeric values
    for (const [key, value] of Object.entries(variables)) {
      // Only allow alphanumeric variable names
      if (/^\w+$/.test(key)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g')
        expr = expr.replace(regex, String(value))
      }
    }
    // Only allow numbers, operators, parentheses, spaces, and decimal points
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) {
      return 0
    }
    // eslint-disable-next-line no-new-func
    const result = Function('return ' + expr)()
    return typeof result === 'number' && isFinite(result) ? result : 0
  } catch {
    return 0
  }
}

/**
 * Compute a single payroll component and return a trace.
 */
export function computeComponent(component: ComponentInput, ctx: CalculationContext): CalculationTrace {
  const warnings: string[] = []
  const computationSteps: string[] = []
  const inputValues: Record<string, number | string> = {}
  let computedValue = 0

  switch (component.calculationType) {
    case 'fixed': {
      computedValue = component.fixedAmount ?? 0
      inputValues['fixedAmount'] = computedValue
      computationSteps.push(`Fixed amount: ${computedValue}`)
      break
    }

    case 'percentage_of_component': {
      const baseCode = component.baseComponentCode ?? ''
      const base = ctx.resolvedComponents.get(baseCode) ?? 0
      if (!ctx.resolvedComponents.has(baseCode)) {
        warnings.push(`Base component '${baseCode}' not found`)
      }
      const pct = component.percentage ?? 0
      computedValue = base * pct / 100
      inputValues['baseComponentCode'] = baseCode
      inputValues['baseValue'] = base
      inputValues['percentage'] = pct
      computationSteps.push(`Base component '${baseCode}' = ${base}`)
      computationSteps.push(`${base} * ${pct}% = ${computedValue}`)
      break
    }

    case 'formula_based': {
      const variables: Record<string, number> = {
        ctcAnnual: ctx.ctcAnnual,
        ctcMonthly: ctx.ctcMonthly,
      }
      ctx.resolvedComponents.forEach((val, key) => {
        variables[key] = val
      })
      const formulaStr = component.formula ?? '0'
      computedValue = evaluateFormula(formulaStr, variables)
      inputValues['formula'] = formulaStr
      inputValues['ctcAnnual'] = ctx.ctcAnnual
      inputValues['ctcMonthly'] = ctx.ctcMonthly
      computationSteps.push(`Formula: ${formulaStr}`)
      computationSteps.push(`Evaluated with ctcAnnual=${ctx.ctcAnnual}, ctcMonthly=${ctx.ctcMonthly}`)
      computationSteps.push(`Result: ${computedValue}`)
      break
    }

    case 'slab_based': {
      const income = ctx.ctcMonthly
      const slabs = component.slabConfig ?? []
      const matchedSlab = slabs.find(slab => {
        const aboveFrom = income >= slab.from
        const belowTo = slab.to === undefined || income <= slab.to
        return aboveFrom && belowTo
      })
      computedValue = matchedSlab?.amount ?? 0
      inputValues['ctcMonthly'] = income
      inputValues['slabCount'] = slabs.length
      computationSteps.push(`Monthly income for slab lookup: ${income}`)
      if (matchedSlab) {
        computationSteps.push(`Matched slab: from=${matchedSlab.from}, to=${matchedSlab.to ?? 'unlimited'}, amount=${matchedSlab.amount}`)
      } else {
        computationSteps.push(`No slab matched for income ${income}`)
        warnings.push(`No matching slab found for ctcMonthly=${income}`)
      }
      computedValue = matchedSlab?.amount ?? 0
      break
    }

    case 'attendance_based': {
      const factor = component.attendanceFactor ?? 'paid_days'
      let days = 0
      if (factor === 'working_days') {
        days = ctx.attendance.workingDays
      } else if (factor === 'present_days') {
        days = ctx.attendance.presentDays
      } else {
        days = ctx.attendance.paidDays
      }
      const totalCalendar = ctx.attendance.totalCalendarDays
      const fixedAmt = component.fixedAmount ?? 0
      computedValue = totalCalendar > 0 ? fixedAmt * (days / totalCalendar) : 0
      inputValues['fixedAmount'] = fixedAmt
      inputValues['attendanceFactor'] = factor
      inputValues['days'] = days
      inputValues['totalCalendarDays'] = totalCalendar
      computationSteps.push(`Attendance factor: ${factor} = ${days} days`)
      computationSteps.push(`Total calendar days: ${totalCalendar}`)
      computationSteps.push(`${fixedAmt} * (${days} / ${totalCalendar}) = ${computedValue}`)
      break
    }

    case 'prorated': {
      const paidDays = ctx.attendance.paidDays
      const totalCalendar = ctx.attendance.totalCalendarDays
      const fixedAmt = component.fixedAmount ?? 0
      computedValue = totalCalendar > 0 ? fixedAmt * (paidDays / totalCalendar) : 0
      inputValues['fixedAmount'] = fixedAmt
      inputValues['paidDays'] = paidDays
      inputValues['totalCalendarDays'] = totalCalendar
      computationSteps.push(`Paid days: ${paidDays}`)
      computationSteps.push(`Total calendar days: ${totalCalendar}`)
      computationSteps.push(`${fixedAmt} * (${paidDays} / ${totalCalendar}) = ${computedValue}`)
      break
    }

    case 'reimbursement_based': {
      computedValue = component.fixedAmount ?? 0
      inputValues['fixedAmount'] = computedValue
      computationSteps.push(`Reimbursement amount: ${computedValue}`)
      break
    }

    case 'policy_based': {
      computedValue = component.fixedAmount ?? 0
      inputValues['fixedAmount'] = computedValue
      computationSteps.push(`Policy-based amount: ${computedValue}`)
      break
    }

    default: {
      warnings.push(`Unknown calculation type: ${(component as any).calculationType}`)
      computedValue = 0
      computationSteps.push(`Unknown type, defaulting to 0`)
    }
  }

  return {
    componentCode: component.code,
    componentName: component.name,
    formula: component.formula,
    inputValues,
    computedValue: Math.round(computedValue * 100) / 100,
    computationSteps,
    warnings,
  }
}

/**
 * Topological sort of components by dependency.
 * Components with no baseComponentCode come first.
 * Detects cycles and falls back to original order if found.
 */
export function sortByDependency(components: ComponentInput[]): ComponentInput[] {
  const codeSet = new Set(components.map(c => c.code))
  const emitted = new Set<string>()
  const result: ComponentInput[] = []
  const remaining = [...components]

  // Safety: max iterations = n^2 to detect cycles
  let maxIterations = components.length * components.length + components.length
  let changed = true

  while (remaining.length > 0 && changed && maxIterations-- > 0) {
    changed = false
    for (let i = remaining.length - 1; i >= 0; i--) {
      const comp = remaining[i]
      const base = comp.baseComponentCode
      // Emit if no base or base is not in the set (external) or base already emitted
      const canEmit = !base || !codeSet.has(base) || emitted.has(base)
      if (canEmit) {
        emitted.add(comp.code)
        result.push(comp)
        remaining.splice(i, 1)
        changed = true
      }
    }
  }

  // If anything remains, a cycle was detected — append in original order with a console warning
  if (remaining.length > 0) {
    console.warn(`[calculation-engine] Cycle detected in components: ${remaining.map(c => c.code).join(', ')}. Using original order.`)
    result.push(...remaining)
  }

  return result
}

/**
 * Compute a full set of components in dependency order.
 * Updates ctx.resolvedComponents after each computation.
 */
export function computeComponentSet(components: ComponentInput[], ctx: CalculationContext): CalculationTrace[] {
  const sorted = sortByDependency(components)
  const traces: CalculationTrace[] = []

  for (const component of sorted) {
    const trace = computeComponent(component, ctx)
    ctx.resolvedComponents.set(component.code, trace.computedValue)
    traces.push(trace)
  }

  return traces
}
