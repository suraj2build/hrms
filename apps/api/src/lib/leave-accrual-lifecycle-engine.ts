/**
 * Leave Accrual Lifecycle Engine (v1)
 *
 * PURE COMPUTATION — no I/O.  All database reads happen in the calling
 * service; this module only transforms data.
 *
 * Responsibilities:
 *   1. Eligibility evaluation — freeze check, minimum service / attendance,
 *      consumability timing, advance vs earned determination.
 *   2. Tiered rate resolution — pick accrual_days_per_year from
 *      leave_accrual_tiers based on employee service tenure.
 *   3. Partial-cycle proration — joining / separation mid-cycle handling.
 *   4. Advance accrual recovery — compute days to recover on separation.
 *   5. Consumability date — derive when a credit becomes consumable.
 *   6. Service-anniversary cycle check — is this month an anniversary month?
 *
 * All public functions are pure (no side-effects, no async).
 * The engine is deterministic — same inputs always produce same outputs.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type AccrualEarningBasis  = 'advance' | 'earned' | 'prorated'
export type CreditTiming         = 'cycle_start' | 'cycle_end'
export type ConsumptionTiming    = 'immediate' | 'after_cycle_completion' | 'after_payroll_lock' | 'after_attendance_confirmation'
/** leave_accrual_ledger.release_trigger CHECK constraint vocabulary (migration 159) — deliberately
 *  distinct from ConsumptionTiming's 'after_X'-prefixed values; use consumptionTimingToReleaseTrigger()
 *  to convert before writing to the ledger. */
export type ReleaseTrigger       = 'immediate' | 'cycle_completion' | 'payroll_lock' | 'attendance_confirmation' | 'manual_release'
export type RecoveryMode         = 'none' | 'prorate' | 'full_recovery' | 'lop_deduction'
export type JoiningHandling      = 'full' | 'prorate' | 'next_cycle'
export type SeparationHandling   = 'full' | 'prorate' | 'none'
export type PayrollCutoffBehavior = 'hold' | 'release' | 'defer_to_next'
export type FreezeMode           = 'skip' | 'replay'

/**
 * Policy fields the lifecycle engine needs for its decisions.
 * Maps to both leave_policy_rules (engine) and leave_policies (legacy).
 */
export interface LifecyclePolicy {
  // Identity
  id:                       string
  leave_type_id:            string
  accrual_type:             'monthly' | 'quarterly' | 'yearly' | 'upfront'
  accrual_days_per_year:    number
  year_type:                'calendar' | 'financial'

  // Core eligibility
  eligibility_days:         number
  minimum_service_days:     number   // additional guard beyond eligibility_days
  minimum_paid_days:        number   // min paid days in cycle
  minimum_attendance_pct:   number   // 0-100

  // Advance vs earned
  accrual_earning_basis:    AccrualEarningBasis
  accrual_credit_timing:    CreditTiming
  accrual_consumption_timing: ConsumptionTiming
  future_accrual_consumable: boolean
  advance_accrual_recovery_mode: RecoveryMode

  // Partial cycle
  joining_cycle_handling:   JoiningHandling
  separation_cycle_handling: SeparationHandling

  // Operational
  payroll_cutoff_behavior:  PayrollCutoffBehavior
  accrual_freeze_mode:      FreezeMode

  // Tiered
  tiered_accrual_enabled:   boolean

  // Service anniversary
  service_anniversary_cycle: boolean
}

export interface AccrualTierRow {
  id:                     string
  service_years_from:     number
  service_years_to:       number | null
  accrual_days_per_year:  number
  description:            string | null
}

export interface ActiveFreeze {
  id:              string
  freeze_from:     string  // YYYY-MM-DD
  freeze_to:       string | null
  accrual_freeze_mode: FreezeMode
  reason:          string
}

/** Input context for a single accrual cycle evaluation */
export interface AccrualContext {
  // Employee
  employee_id:         string
  joining_date:        string   // YYYY-MM-DD
  separation_date?:    string   // YYYY-MM-DD — null if still active

  // Cycle
  cycle_year:          number
  cycle_month:         number   // 1-12; ignored for yearly accrual
  accrual_date:        string   // YYYY-MM-DD — the credit date (usually 1st of month)

  // Attendance data for the cycle (optional — needed for attendance-gated policies)
  paid_days_in_cycle?:   number
  attendance_pct?:       number  // 0-100

  // Policy + tiers + active freezes for this employee/leave-type
  policy:              LifecyclePolicy
  tiers:               AccrualTierRow[]
  active_freezes:      ActiveFreeze[]

  // Whether payroll for this cycle is currently locked
  payroll_locked?:     boolean

  // Whether attendance for this cycle has been confirmed
  attendance_confirmed?: boolean
}

/** Result of a single accrual lifecycle evaluation */
export interface AccrualLifecycleResult {
  should_credit:             boolean
  /** Reason for skip (human-readable).  Null when should_credit = true. */
  skip_reason:               string | null
  /** Days to credit.  0 when should_credit = false. */
  days_to_credit:            number
  /** Earning basis of this entry */
  accrual_earning_basis:     AccrualEarningBasis
  /** Tier that was applied (null when tiered_accrual_enabled = false) */
  applied_tier:              AccrualTierRow | null
  /** When the credit becomes consumable (null = immediate) */
  consumption_eligible_from: string | null
  /** The release trigger that must fire before the credit is consumable */
  release_trigger:           ReleaseTrigger
  /** Approximate service tenure in years at accrual date */
  service_years_at_accrual:  number
  /** Cycle period string (e.g. '2025-06' for monthly, '2025' for yearly) */
  cycle_period:              string
  /** Explains the lifecycle decision (for debugging / ledger notes) */
  explain:                   string[]
}

/** Advance recovery calculation result */
export interface AdvanceRecoveryResult {
  days_to_recover:   number
  recovery_mode:     RecoveryMode
  earned_by_sep:     number   // days the employee actually earned before sep
  advance_credited:  number   // total advance credit in the cycle
  unearned_days:     number   // advance_credited - earned_by_sep
  explain:           string[]
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Round to 1 decimal place */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Parse a YYYY-MM-DD string into a UTC Date at noon (avoids DST issues).
 */
function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00.000Z`)
}

/**
 * Compute decimal service years between joiningDate and asOf.
 * Uses 365.25-day year for accuracy.
 */
export function computeServiceYears(joiningDate: string, asOf: string): number {
  const joining = parseDate(joiningDate)
  const date    = parseDate(asOf)
  const diffMs  = date.getTime() - joining.getTime()
  if (diffMs < 0) return 0
  return round2(diffMs / (365.25 * 24 * 3600 * 1000))
}

/**
 * Compute working days in a month excluding weekends.
 * Used for proration when only a portion of the month is active.
 *
 * @param year   4-digit year
 * @param month  1-indexed month
 */
export function workdaysInMonth(year: number, month: number): number {
  const days = new Date(year, month, 0).getDate() // total days in month
  let workdays = 0
  for (let d = 1; d <= days; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (dow !== 0 && dow !== 6) workdays++
  }
  return workdays
}

/**
 * Determine the first day the employee can accrue, considering both
 * the eligibility_days wait AND minimum_service_days.
 *
 * Returns YYYY-MM-DD string of first eligible date.
 */
export function computeFirstEligibleDate(
  joiningDate: string,
  policy: Pick<LifecyclePolicy, 'eligibility_days' | 'minimum_service_days'>,
): string {
  const joining = parseDate(joiningDate)
  const waitDays = Math.max(policy.eligibility_days, policy.minimum_service_days)
  const eligibleMs = joining.getTime() + waitDays * 86_400_000
  return new Date(eligibleMs).toISOString().slice(0, 10)
}

/**
 * Check whether an active freeze covers the given accrual date for a
 * specific leave type (or any leave type if freeze.leave_type_id is null).
 *
 * Returns the matching freeze if one applies, otherwise null.
 */
export function findActiveFreezeForDate(
  freezes:      ActiveFreeze[],
  accrualDate:  string,
): ActiveFreeze | null {
  for (const freeze of freezes) {
    if (freeze.freeze_from > accrualDate) continue
    if (freeze.freeze_to && freeze.freeze_to < accrualDate) continue
    return freeze
  }
  return null
}

/**
 * Resolve the applicable accrual rate from tiered rules.
 *
 * Picks the tier whose [service_years_from, service_years_to) range
 * contains serviceYears.  service_years_to = null means "no upper bound".
 *
 * Returns null if no matching tier found (caller falls back to policy rate).
 */
export function resolveTieredRate(
  tiers:        AccrualTierRow[],
  serviceYears: number,
): AccrualTierRow | null {
  // Sort by service_years_from ascending so lower tiers take priority
  const sorted = [...tiers].sort((a, b) => a.service_years_from - b.service_years_from)

  for (const tier of sorted) {
    if (serviceYears < tier.service_years_from) continue
    if (tier.service_years_to !== null && serviceYears >= tier.service_years_to) continue
    return tier
  }
  return null
}

/**
 * Compute days to credit for a partial (joining or separation) cycle.
 *
 * For monthly accrual:
 *   - joining: days from (effective joining / eligibility) to month-end
 *   - separation: days from month-start to separation_date
 *
 * For yearly accrual, proration is done at the year level (months remaining).
 *
 * @param mode          joining_cycle_handling or separation_cycle_handling
 * @param fullAmount    the full-cycle accrual amount (days)
 * @param eventDate     joining date or separation date (YYYY-MM-DD)
 * @param cycleYear     the cycle year
 * @param cycleMonth    1-indexed month (ignored for yearly)
 * @param isJoining     true = joining proration; false = separation proration
 */
export function proratePartialCycle(
  mode:        JoiningHandling | SeparationHandling,
  fullAmount:  number,
  eventDate:   string,
  cycleYear:   number,
  cycleMonth:  number,
  isJoining:   boolean,
): number {
  if (mode === 'full')       return round1(fullAmount)
  if (mode === 'none')       return 0
  if (mode === 'next_cycle') return 0  // credit deferred

  // prorate
  const event     = parseDate(eventDate)
  const daysInMo  = new Date(cycleYear, cycleMonth, 0).getDate()

  let activeDays: number
  if (isJoining) {
    // Days from event to end of month (inclusive)
    const monthEnd  = new Date(`${cycleYear}-${String(cycleMonth).padStart(2,'0')}-${String(daysInMo).padStart(2,'0')}T12:00:00.000Z`)
    activeDays = Math.ceil((monthEnd.getTime() - event.getTime()) / 86_400_000) + 1
  } else {
    // Days from start of month to event (inclusive)
    const monthStart = new Date(`${cycleYear}-${String(cycleMonth).padStart(2,'0')}-01T12:00:00.000Z`)
    activeDays = Math.ceil((event.getTime() - monthStart.getTime()) / 86_400_000) + 1
  }

  activeDays = Math.max(0, Math.min(activeDays, daysInMo))
  return round1((fullAmount * activeDays) / daysInMo)
}

/**
 * Derive the consumption_eligible_from date based on consumption timing.
 *
 * @param accrualDate   YYYY-MM-DD — the credit posting date
 * @param cycleYear     the cycle year
 * @param cycleMonth    the cycle month (1-12)
 * @param timing        the policy's accrual_consumption_timing
 */
export function computeConsumptionEligibleDate(
  accrualDate: string,
  cycleYear:   number,
  cycleMonth:  number,
  timing:      ConsumptionTiming,
): string | null {
  switch (timing) {
    case 'immediate':
      return null  // null = available immediately on credit date

    case 'after_cycle_completion': {
      // Last day of the credit month
      const lastDay = new Date(cycleYear, cycleMonth, 0).getDate()
      return `${cycleYear}-${String(cycleMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    }

    case 'after_payroll_lock':
      // Conservative: next month's 10th (typical payroll lock date)
      // The exact date is refined by the release event at actual lock time.
      return deriveNextMonthDate(cycleYear, cycleMonth, 10)

    case 'after_attendance_confirmation':
      // Next month's 5th (typical attendance cut-off day)
      return deriveNextMonthDate(cycleYear, cycleMonth, 5)

    default:
      return null
  }
}

function deriveNextMonthDate(year: number, month: number, day: number): string {
  let nextMonth = month + 1
  let nextYear  = year
  if (nextMonth > 12) { nextMonth = 1; nextYear++ }
  return `${nextYear}-${String(nextMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

/**
 * Is this accrual_date a service-anniversary month for the employee?
 *
 * A service anniversary month is any month whose month number matches the
 * employee's joining month.  For monthly accrual this credits once per year
 * on the work-anniversary month.
 */
export function isAnniversaryMonth(joiningDate: string, cycleMonth: number): boolean {
  const joining = parseDate(joiningDate)
  return (joining.getUTCMonth() + 1) === cycleMonth
}

/**
 * Compute the advance accrual recovery amount when an employee separates
 * mid-cycle.
 *
 * For a monthly advance policy, the employee was credited at the start of the
 * month for the full month.  If they resign on day N, only days 1-N are earned.
 *
 * @param policy           lifecycle policy
 * @param fullCycleCredit  total days credited for this cycle
 * @param separationDate   YYYY-MM-DD
 * @param cycleYear        cycle year
 * @param cycleMonth       cycle month (1-indexed)
 */
export function computeAdvanceRecovery(
  policy:           LifecyclePolicy,
  fullCycleCredit:  number,
  separationDate:   string,
  cycleYear:        number,
  cycleMonth:       number,
): AdvanceRecoveryResult {
  const explain: string[] = []

  if (policy.advance_accrual_recovery_mode === 'none') {
    explain.push('recovery_mode=none — no recovery on separation')
    return {
      days_to_recover: 0,
      recovery_mode: 'none',
      earned_by_sep: fullCycleCredit,
      advance_credited: fullCycleCredit,
      unearned_days: 0,
      explain,
    }
  }

  if (policy.accrual_earning_basis !== 'advance') {
    explain.push('accrual_earning_basis=earned — no advance recovery applicable')
    return {
      days_to_recover: 0,
      recovery_mode: policy.advance_accrual_recovery_mode,
      earned_by_sep: fullCycleCredit,
      advance_credited: fullCycleCredit,
      unearned_days: 0,
      explain,
    }
  }

  // Compute days worked in cycle before separation
  const sep       = parseDate(separationDate)
  const daysInMo  = new Date(cycleYear, cycleMonth, 0).getDate()
  const monthStart = new Date(`${cycleYear}-${String(cycleMonth).padStart(2,'0')}-01T12:00:00.000Z`)

  let daysWorked = Math.ceil((sep.getTime() - monthStart.getTime()) / 86_400_000) + 1
  daysWorked     = Math.max(0, Math.min(daysWorked, daysInMo))

  const earnedByMonthFraction = daysWorked / daysInMo
  const earnedByDays          = round1(fullCycleCredit * earnedByMonthFraction)
  const unearnedDays          = round1(fullCycleCredit - earnedByDays)

  explain.push(`cycle_days=${daysInMo}, worked_days=${daysWorked}, earned_fraction=${earnedByMonthFraction.toFixed(3)}`)
  explain.push(`advance_credited=${fullCycleCredit}, earned_by_sep=${earnedByDays}, unearned=${unearnedDays}`)

  let daysToRecover = 0
  switch (policy.advance_accrual_recovery_mode) {
    case 'prorate':
      daysToRecover = unearnedDays
      explain.push('recovery_mode=prorate → recover prorated unearned portion')
      break
    case 'full_recovery':
      daysToRecover = unearnedDays > 0 ? fullCycleCredit : 0
      explain.push('recovery_mode=full_recovery → recover full advance if any unearned')
      break
    case 'lop_deduction':
      daysToRecover = 0  // LOP handled at payroll level, not as ledger reversal
      explain.push('recovery_mode=lop_deduction → LOP deduction via payroll; no ledger reversal')
      break
  }

  return {
    days_to_recover: daysToRecover,
    recovery_mode: policy.advance_accrual_recovery_mode,
    earned_by_sep: earnedByDays,
    advance_credited: fullCycleCredit,
    unearned_days: unearnedDays,
    explain,
  }
}

// ── Core evaluation function ───────────────────────────────────────────────────

/**
 * Evaluate the lifecycle of a single accrual credit for one employee,
 * one leave type, one cycle.
 *
 * This is the primary entry point called by the scheduler extension.
 *
 * @returns AccrualLifecycleResult — caller decides whether to credit based on
 *          should_credit; all metadata is included for ledger persistence.
 */
export function evaluateAccrualLifecycle(
  ctx: AccrualContext,
): AccrualLifecycleResult {
  const { policy, tiers, active_freezes, accrual_date } = ctx
  const explain: string[] = []

  const serviceYears  = computeServiceYears(ctx.joining_date, accrual_date)
  const cyclePeriod   = policy.accrual_type === 'monthly' || policy.accrual_type === 'quarterly'
    ? `${ctx.cycle_year}-${String(ctx.cycle_month).padStart(2, '0')}`
    : `${ctx.cycle_year}`

  explain.push(`employee=${ctx.employee_id}, date=${accrual_date}, service_years=${serviceYears}`)

  // ── 1. Minimum service check ─────────────────────────────────────────────────
  const firstEligible = computeFirstEligibleDate(ctx.joining_date, policy)
  if (accrual_date < firstEligible) {
    explain.push(`SKIP: minimum service not met — eligible from ${firstEligible}`)
    return skip('Minimum service period not yet completed', serviceYears, cyclePeriod, explain, policy)
  }
  explain.push(`✓ service check passed (eligible_from=${firstEligible})`)

  // ── 2. Separation check — is this cycle a partial cycle? ─────────────────────
  let isPartialCycle = false
  let partialReason: 'joining' | 'separation' | null = null

  if (ctx.separation_date && ctx.separation_date <= lastDayOfMonth(ctx.cycle_year, ctx.cycle_month)) {
    isPartialCycle = true
    partialReason = 'separation'
    if (policy.separation_cycle_handling === 'none') {
      explain.push('SKIP: separation_cycle_handling=none in separation month')
      return skip('No credit in separation cycle (policy)', serviceYears, cyclePeriod, explain, policy)
    }
  }

  // Check joining partial cycle (employee joined after the 1st of this cycle month)
  const cycleFirstDay = `${ctx.cycle_year}-${String(ctx.cycle_month).padStart(2,'0')}-01`
  if (ctx.joining_date > cycleFirstDay) {
    isPartialCycle = true
    partialReason  = 'joining'
    if (policy.joining_cycle_handling === 'next_cycle') {
      explain.push('SKIP: joining_cycle_handling=next_cycle — no credit in join month')
      return skip('No credit in joining cycle (policy)', serviceYears, cyclePeriod, explain, policy)
    }
  }

  // ── 3. Active freeze check ────────────────────────────────────────────────────
  const freeze = findActiveFreezeForDate(active_freezes, accrual_date)
  if (freeze) {
    explain.push(`SKIP: active freeze ${freeze.id} (${freeze.freeze_from}→${freeze.freeze_to ?? 'open'}) reason="${freeze.reason}"`)
    explain.push(`freeze_mode=${freeze.accrual_freeze_mode} — ${freeze.accrual_freeze_mode === 'replay' ? 'will replay on unfreeze' : 'credit skipped permanently'}`)
    return skip(`Accrual frozen: ${freeze.reason}`, serviceYears, cyclePeriod, explain, policy)
  }
  explain.push('✓ no active freeze')

  // ── 4. Service anniversary cycle (if enabled) ─────────────────────────────────
  if (policy.service_anniversary_cycle) {
    const isAnniversary = isAnniversaryMonth(ctx.joining_date, ctx.cycle_month)
    if (!isAnniversary) {
      explain.push('SKIP: service_anniversary_cycle=true but this month is not anniversary month')
      return skip('Not an anniversary accrual month', serviceYears, cyclePeriod, explain, policy)
    }
    explain.push(`✓ anniversary month check passed (joining month=${parseDate(ctx.joining_date).getUTCMonth() + 1})`)
  }

  // ── 5. Attendance / paid-day threshold check ──────────────────────────────────
  if (policy.minimum_paid_days > 0) {
    const paidDays = ctx.paid_days_in_cycle ?? null
    if (paidDays === null) {
      explain.push('WARN: minimum_paid_days configured but paid_days_in_cycle not provided — skipping attendance gate')
    } else if (paidDays < policy.minimum_paid_days) {
      explain.push(`SKIP: paid_days=${paidDays} < minimum_paid_days=${policy.minimum_paid_days}`)
      return skip(`Insufficient paid days in cycle (${paidDays} < ${policy.minimum_paid_days})`, serviceYears, cyclePeriod, explain, policy)
    } else {
      explain.push(`✓ paid_days check passed (${paidDays} >= ${policy.minimum_paid_days})`)
    }
  }

  if (policy.minimum_attendance_pct > 0) {
    const attPct = ctx.attendance_pct ?? null
    if (attPct === null) {
      explain.push('WARN: minimum_attendance_pct configured but attendance_pct not provided — skipping')
    } else if (attPct < policy.minimum_attendance_pct) {
      explain.push(`SKIP: attendance_pct=${attPct}% < minimum=${policy.minimum_attendance_pct}%`)
      return skip(`Insufficient attendance (${attPct}% < ${policy.minimum_attendance_pct}%)`, serviceYears, cyclePeriod, explain, policy)
    } else {
      explain.push(`✓ attendance check passed (${attPct}% >= ${policy.minimum_attendance_pct}%)`)
    }
  }

  // ── 6. Resolve accrual amount (tiered or flat) ────────────────────────────────
  let appliedTier: AccrualTierRow | null = null
  let baseDaysPerYear = policy.accrual_days_per_year

  if (policy.tiered_accrual_enabled && tiers.length > 0) {
    const tier = resolveTieredRate(tiers, serviceYears)
    if (tier) {
      appliedTier    = tier
      baseDaysPerYear = tier.accrual_days_per_year
      explain.push(`✓ tier applied: ${tier.description ?? `${tier.service_years_from}-${tier.service_years_to ?? '∞'} yrs`} → ${baseDaysPerYear} days/yr`)
    } else {
      explain.push('WARN: tiered_accrual_enabled=true but no matching tier — using policy base rate')
    }
  }

  // Compute the per-cycle amount
  let cycleAmount: number
  if (policy.accrual_type === 'monthly') {
    cycleAmount = round1(baseDaysPerYear / 12)
  } else if (policy.accrual_type === 'quarterly') {
    cycleAmount = round1(baseDaysPerYear / 4)
  } else {
    // yearly / upfront — full year credit
    cycleAmount = round1(baseDaysPerYear)
  }
  explain.push(`base_cycle_amount=${cycleAmount} (${baseDaysPerYear} days/yr ÷ ${policy.accrual_type})`)

  // ── 7. Partial cycle adjustment ───────────────────────────────────────────────
  if (isPartialCycle && partialReason === 'joining') {
    const prorated = proratePartialCycle(
      policy.joining_cycle_handling,
      cycleAmount,
      ctx.joining_date,
      ctx.cycle_year,
      ctx.cycle_month,
      true,
    )
    explain.push(`joining proration: ${cycleAmount} → ${prorated} (mode=${policy.joining_cycle_handling})`)
    cycleAmount = prorated
  } else if (isPartialCycle && partialReason === 'separation' && ctx.separation_date) {
    const prorated = proratePartialCycle(
      policy.separation_cycle_handling,
      cycleAmount,
      ctx.separation_date,
      ctx.cycle_year,
      ctx.cycle_month,
      false,
    )
    explain.push(`separation proration: full=${cycleAmount} → ${prorated} (mode=${policy.separation_cycle_handling})`)
    cycleAmount = prorated
  }

  if (cycleAmount <= 0) {
    explain.push('SKIP: computed cycle amount is 0 after proration')
    return skip('Zero days after proration', serviceYears, cyclePeriod, explain, policy)
  }

  // ── 8. Earning basis and credit timing ───────────────────────────────────────
  let earningBasis: AccrualEarningBasis = policy.accrual_earning_basis
  if (isPartialCycle) earningBasis = 'prorated'

  explain.push(`earning_basis=${earningBasis}, credit_timing=${policy.accrual_credit_timing}`)

  // For cycle_end credit timing, we do NOT skip here — the scheduler only calls
  // evaluateAccrualLifecycle at the correct phase (start vs end) based on timing.
  // The calling code in leave-jobs.ts decides when to invoke this engine.

  // ── 9. Consumability date ─────────────────────────────────────────────────────
  let consumptionTiming = policy.accrual_consumption_timing

  // If advance accrual and future_accrual_consumable = false, hold until cycle end
  if (earningBasis === 'advance' && !policy.future_accrual_consumable) {
    consumptionTiming = 'after_cycle_completion'
    explain.push('future_accrual_consumable=false → overriding consumption_timing to after_cycle_completion')
  }

  const consumptionEligibleFrom = computeConsumptionEligibleDate(
    accrual_date,
    ctx.cycle_year,
    ctx.cycle_month,
    consumptionTiming,
  )

  explain.push(`consumption_timing=${consumptionTiming}, eligible_from=${consumptionEligibleFrom ?? 'immediate'}`)
  explain.push(`✓ credit ${cycleAmount} days for cycle ${cyclePeriod}`)

  return {
    should_credit:             true,
    skip_reason:               null,
    days_to_credit:            cycleAmount,
    accrual_earning_basis:     earningBasis,
    applied_tier:              appliedTier,
    consumption_eligible_from: consumptionEligibleFrom,
    release_trigger:           consumptionTimingToReleaseTrigger(consumptionTiming),
    service_years_at_accrual:  serviceYears,
    cycle_period:              cyclePeriod,
    explain,
  }
}

// ── Internal result builders ───────────────────────────────────────────────────

function skip(
  reason:      string,
  serviceYears: number,
  cyclePeriod: string,
  explain:     string[],
  policy:      LifecyclePolicy,
): AccrualLifecycleResult {
  return {
    should_credit:             false,
    skip_reason:               reason,
    days_to_credit:            0,
    accrual_earning_basis:     policy.accrual_earning_basis,
    applied_tier:              null,
    consumption_eligible_from: null,
    release_trigger:           'immediate',
    service_years_at_accrual:  serviceYears,
    cycle_period:              cyclePeriod,
    explain,
  }
}

/** Maps the engine's internal ConsumptionTiming vocabulary to the
 *  leave_accrual_ledger.release_trigger CHECK constraint's bare-name vocabulary. */
function consumptionTimingToReleaseTrigger(timing: ConsumptionTiming): ReleaseTrigger {
  switch (timing) {
    case 'after_cycle_completion':       return 'cycle_completion'
    case 'after_payroll_lock':           return 'payroll_lock'
    case 'after_attendance_confirmation': return 'attendance_confirmation'
    case 'immediate':
    default:                              return 'immediate'
  }
}

function lastDayOfMonth(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
}

// ── Lifecycle status summary ───────────────────────────────────────────────────

export interface LifecycleStatusSummary {
  employee_id:            string
  leave_type_id:          string
  service_years:          number
  is_frozen:              boolean
  active_freeze:          ActiveFreeze | null
  current_tier:           AccrualTierRow | null
  next_accrual_date:      string | null      // YYYY-MM-DD
  next_accrual_amount:    number | null
  earning_basis:          AccrualEarningBasis
  consumption_timing:     ConsumptionTiming
  held_credits:           number             // days credited but not yet consumable
  future_accrual_consumable: boolean
}

/**
 * Compute a lifecycle status summary for display in the ESS and governance UI.
 *
 * @param employeeId      employee UUID
 * @param leaveTypeId     leave type UUID
 * @param joiningDate     YYYY-MM-DD
 * @param asOf            YYYY-MM-DD — evaluation date (usually today)
 * @param policy          lifecycle policy
 * @param tiers           tiered rate rows
 * @param activeFreezes   freezes for this employee/leave-type combination
 * @param heldCredits     total days in ledger with consumption_eligible_from > asOf
 */
export function computeLifecycleStatus(
  employeeId:   string,
  leaveTypeId:  string,
  joiningDate:  string,
  asOf:         string,
  policy:       LifecyclePolicy,
  tiers:        AccrualTierRow[],
  activeFreezes: ActiveFreeze[],
  heldCredits:  number,
): LifecycleStatusSummary {
  const serviceYears = computeServiceYears(joiningDate, asOf)
  const freeze       = findActiveFreezeForDate(activeFreezes, asOf)
  const currentTier  = policy.tiered_accrual_enabled ? resolveTieredRate(tiers, serviceYears) : null

  // Derive next accrual date (1st of next month for monthly)
  let nextAccrualDate:   string | null = null
  let nextAccrualAmount: number | null = null

  if (!freeze && policy.accrual_type === 'monthly') {
    const asOfDate = parseDate(asOf)
    const nextMo   = asOfDate.getUTCMonth() + 1  // 0-indexed + 1 = next month index (1-indexed current)
    const nextYear = asOfDate.getUTCFullYear()
    const nextMonthNum = nextMo >= 12 ? 1 : nextMo + 1
    const nextMonthYear = nextMo >= 12 ? nextYear + 1 : nextYear
    nextAccrualDate   = `${nextMonthYear}-${String(nextMonthNum).padStart(2,'0')}-01`
    const ratePerYear = currentTier ? currentTier.accrual_days_per_year : policy.accrual_days_per_year
    nextAccrualAmount = round1(ratePerYear / 12)
  }

  return {
    employee_id:               employeeId,
    leave_type_id:             leaveTypeId,
    service_years:             serviceYears,
    is_frozen:                 freeze !== null,
    active_freeze:             freeze,
    current_tier:              currentTier,
    next_accrual_date:         nextAccrualDate,
    next_accrual_amount:       nextAccrualAmount,
    earning_basis:             policy.accrual_earning_basis,
    consumption_timing:        policy.accrual_consumption_timing,
    held_credits:              heldCredits,
    future_accrual_consumable: policy.future_accrual_consumable,
  }
}
