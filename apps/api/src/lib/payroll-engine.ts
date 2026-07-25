/**
 * payroll-engine.ts
 *
 * Core payroll computation logic.
 *
 * Algorithm (per employee, per month):
 *   1. Resolve active compensation → CTC + component breakdown
 *   2. Count total working days in month (calendar days − weekends − holidays)
 *   3. Count payable_days + lop_days + overtime_hours from attendance_daily
 *   4. Gross pay  = sum of earning components (full-month amounts)
 *   5. LOP amount = (lop_days / total_working_days) × gross_pay
 *   6. Net pay    = gross_pay − lop_amount − sum(deduction components)
 *   7. Employer contributions are tracked separately (not deducted from net)
 *
 * No I/O — pure computation given the inputs fetched by the route layer.
 *
 * Error handling contract:
 *   fetchActiveCompensation() — throws Error on DB failure (never returns null silently
 *     on query error; returns null only when the employee genuinely has no active record).
 *   fetchAttendanceSummary()  — throws Error on DB failure (never returns zeroes on
 *     query error; zeroes only mean the employee has no attendance rows for that period).
 *
 *   Callers must catch throws from both fetch functions per-employee so that one
 *   failed DB fetch does not abort the entire payroll run.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { expandDateRange } from './leave-engine.js'
import {
  resolveEmployeeOrgContext,
  getWeeklyOffDays,
  getHolidayDates,
  getLocalDayOfWeek,
} from './org-context.js'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PayrollComponentSnapshot {
  salary_component_id: string
  name:                string
  code:                string
  component_type:      'earning' | 'deduction' | 'employer_contribution'
  calc_type:           string
  value:               number
  monthly_amount:      number
  annual_amount:       number
  sequence:            number
  /** Statutory wage-base flags (from salary_components) — drive the EPF/ESI/PT engines */
  is_pf_applicable?:   boolean
  affects_pf?:         boolean
  is_esi_applicable?:  boolean
  is_pt_applicable?:   boolean
}

export interface PayrollSlipInput {
  tenantId:    string
  employeeId:  string
  month:       string    // 'YYYY-MM'
  /** Active compensation row */
  compensation: {
    id:          string
    ctc_monthly: number
    ctc_annual:  number
    components:  PayrollComponentSnapshot[]
  } | null
  /** From attendance_daily for the month */
  attendance: {
    payable_days:       number
    lop_days:           number
    present_days:       number
    late_days:          number
    overtime_hours:     number
    /** True if at least one attendance_daily row exists for this employee+month.
     *  False means no punch/attendance data was found — employee gets full pay
     *  by default (lop_days = 0) which is likely wrong.  Operators must verify. */
    has_attendance_data: boolean
  }
  /** Total scheduled working days in the month for this employee */
  total_working_days: number
  /** Pending advance recovery and loan EMI deductions fetched from schedules */
  advance_loan_deductions?: Array<{
    type:        'advance_recovery' | 'loan_emi'
    schedule_id: string   // advance_recovery_schedules.id or loan_schedules.id
    amount:      number
    label:       string   // "Salary Advance Recovery" or "Personal Loan EMI #3"
  }>
}

export interface PayrollSlipResult {
  employeeId:            string
  month:                 string
  total_working_days:    number
  payable_days:          number
  lop_days:              number
  overtime_hours:        number
  ctc_monthly:           number
  gross_pay:             number
  lop_amount:            number
  total_deductions:      number
  net_pay:               number
  employer_contributions:number
  component_breakdown:   PayrollComponentSnapshot[]
  /** advance_recovery_schedules / loan_schedules ids actually recovered this month */
  recovered_recovery_ids: string[]
  /** ...ids deferred this month (recovery exceeded available pay) — finalize rolls these forward */
  deferred_recovery_ids:  string[]
  /** Human-readable warning when compensation is missing */
  warning?:              string
  /** Amount by which uncapped deductions exceeded gross_pay this month, i.e. what
   *  net_pay would have gone negative by. 0 (or absent, for slips reconstructed
   *  from historical DB rows that predate this field) means deductions fit within
   *  gross pay. Populated by finalizeDeductionsAndNet() (ISSUE-143) so that
   *  `gross_pay - total_deductions = net_pay` always holds — total_deductions is
   *  capped at gross_pay rather than left uncapped while net_pay clamps at 0. */
  deduction_shortfall?:  number
}

// ── Core computation ───────────────────────────────────────────────────────────

export function computePayrollSlip(input: PayrollSlipInput): PayrollSlipResult {
  const {
    employeeId, month, compensation, attendance, total_working_days,
    advance_loan_deductions,
  } = input

  // ── Warning: no attendance data (employee will receive full pay — may be wrong) ─
  // This is distinct from "employee was present all month": presence produces actual
  // attendance_daily rows.  Zero rows means the punch system had no data — data gap,
  // not confirmed attendance.  Operator must verify before finalization.
  const noAttendanceWarning = !attendance.has_attendance_data
    ? `No attendance data found for this employee in ${month}. ` +
      'Employee will receive full pay (0 LOP days assumed). ' +
      'Verify punch records before finalizing.'
    : undefined

  // Guard: no compensation set up
  if (!compensation) {
    return {
      employeeId,
      month,
      total_working_days,
      payable_days:          attendance.payable_days,
      lop_days:              attendance.lop_days,
      overtime_hours:        attendance.overtime_hours,
      ctc_monthly:           0,
      gross_pay:             0,
      lop_amount:            0,
      total_deductions:      0,
      net_pay:               0,
      deduction_shortfall:   0,
      employer_contributions:0,
      component_breakdown:   [],
      recovered_recovery_ids: [],
      deferred_recovery_ids:  [],
      warning: [
        'No active compensation configured for this employee.',
        noAttendanceWarning,
      ].filter(Boolean).join(' '),
    }
  }

  const { ctc_monthly, components } = compensation

  // Earnings: sum all earning components
  const earnings   = components.filter(c => c.component_type === 'earning')
  const deductions = components.filter(c => c.component_type === 'deduction')
  const empContrib = components.filter(c => c.component_type === 'employer_contribution')

  const gross_pay             = round2(earnings.reduce((s, c) => s + c.monthly_amount, 0))
  const deduction_total_base  = round2(deductions.reduce((s, c) => s + c.monthly_amount, 0))
  const employer_contributions= round2(empContrib.reduce((s, c) => s + c.monthly_amount, 0))

  // LOP deduction: proportional to days missed.
  // Basis is gross_pay (sum of earning components), NOT ctc_monthly.
  // ctc_monthly includes employer contributions (PF, gratuity, etc.) which are
  // NOT paid to the employee and must not inflate the LOP deduction.
  //
  // Guard: when there are no scheduled working days we have NO valid basis to
  // prorate LOP. Do NOT clamp the denominator to 1 — that would make a single
  // LOP day wipe the entire salary. Skip the LOP deduction and flag for review.
  let lop_amount = 0
  let zeroDenomWarning: string | undefined
  if (total_working_days > 0) {
    const lop_daily_rate = gross_pay / total_working_days
    lop_amount = round2(Math.max(0, attendance.lop_days * lop_daily_rate))
  } else if (attendance.lop_days > 0) {
    zeroDenomWarning =
      `Total working days is 0 for ${month} but ${attendance.lop_days} LOP day(s) present — ` +
      'LOP deduction skipped to avoid wiping salary; verify holiday/roster/working-day setup.'
  }

  // Advance recovery and loan EMI deductions.
  //
  // Cap recovery at the pay available after statutory deductions + LOP, so a
  // scheduled installment can NEVER exceed what the employee actually earns this
  // month (which would otherwise make total_deductions exceed gross and force net
  // to 0). Installments are taken in order, fully or not at all; any that don't
  // fit are DEFERRED — left off this slip and rolled forward to the next cycle by
  // the payroll finalize step, so nothing is lost and the loan ledger stays honest.
  const alDeductions = advance_loan_deductions ?? []
  let availableForRecovery = round2(Math.max(0, gross_pay - deduction_total_base - lop_amount))
  const recoveredAL: typeof alDeductions = []
  const deferredAL:  typeof alDeductions = []
  for (const d of alDeductions) {
    if (d.amount <= availableForRecovery + 0.005) {
      recoveredAL.push(d)
      availableForRecovery = round2(availableForRecovery - d.amount)
    } else {
      deferredAL.push(d)
    }
  }
  const al_total = round2(recoveredAL.reduce((s, d) => s + d.amount, 0))
  const al_components: PayrollComponentSnapshot[] = recoveredAL.map((d, idx) => ({
    salary_component_id: d.schedule_id,
    name:                d.label,
    code:                d.type === 'advance_recovery' ? 'ADVANCE_RECOVERY' : 'LOAN_EMI',
    component_type:      'deduction' as const,
    calc_type:           'fixed',
    value:               d.amount,
    monthly_amount:      d.amount,
    annual_amount:       0,
    sequence:            900 + idx,
  }))

  const deferralWarning = deferredAL.length > 0
    ? `${deferredAL.length} advance/loan recovery installment(s) totalling ` +
      `${round2(deferredAL.reduce((s, d) => s + d.amount, 0))} deferred to next cycle ` +
      '(exceeded available net pay for the month).'
    : undefined

  const uncappedDeductions = round2(deduction_total_base + lop_amount + al_total)
  const { total_deductions, net_pay, deduction_shortfall } = finalizeDeductionsAndNet(gross_pay, uncappedDeductions)
  const shortfallWarning = deduction_shortfall > 0
    ? `Deductions (${uncappedDeductions}) exceed gross pay (${gross_pay}) by ${deduction_shortfall} — ` +
      'total_deductions and net_pay have been capped; the shortfall is not recovered automatically. Review this slip.'
    : undefined

  return {
    employeeId,
    month,
    total_working_days,
    payable_days:   attendance.payable_days,
    lop_days:       attendance.lop_days,
    overtime_hours: attendance.overtime_hours,
    ctc_monthly,
    gross_pay,
    lop_amount,
    total_deductions,
    net_pay,
    deduction_shortfall,
    employer_contributions,
    component_breakdown: [...components, ...al_components],
    recovered_recovery_ids: recoveredAL.map(d => d.schedule_id),
    deferred_recovery_ids:  deferredAL.map(d => d.schedule_id),
    // Propagate no-attendance + zero-working-days + recovery-deferral + shortfall warnings.
    warning: [noAttendanceWarning, zeroDenomWarning, deferralWarning, shortfallWarning].filter(Boolean).join(' ') || undefined,
  }
}

/** Round to 2 decimal places. Exported so callers can use the same rounding. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Cap total_deductions at gross_pay so `gross_pay - total_deductions = net_pay`
 * always holds (ISSUE-143). Previously net_pay alone was clamped at 0 while
 * total_deductions stayed uncapped — e.g. gross 20,000 / deductions 25,000 stored
 * total_deductions=25,000 and net_pay=0, silently breaking the invariant
 * routes/payroll/index.ts documents as load-bearing for GL/reporting
 * reconciliation (total_gross - total_deductions = total_net). The excess is
 * surfaced as deduction_shortfall instead of being absorbed invisibly.
 *
 * Shared by computePayrollSlip (payroll-engine.ts) and applyStatutoryToSlip /
 * applyTdsToSlip (statutory-payroll.ts) — the same clamp-without-capping bug
 * existed independently in all three; fixing it in one place only prevents the
 * three from drifting again.
 */
export function finalizeDeductionsAndNet(
  grossPay: number,
  uncappedDeductions: number,
): { total_deductions: number; net_pay: number; deduction_shortfall: number } {
  const total_deductions   = round2(Math.min(uncappedDeductions, grossPay))
  const net_pay             = round2(grossPay - total_deductions)
  const deduction_shortfall = round2(Math.max(0, uncappedDeductions - grossPay))
  return { total_deductions, net_pay, deduction_shortfall }
}

// ── buildPayrollSlipPreview ─────────────────────────────────────────────────────

export interface PayrollSlipPreviewLine {
  code:           string
  name:           string
  component_type: 'earning' | 'deduction' | 'employer_contribution'
  monthly_amount: number
  annual_amount:  number
}

export interface PayrollSlipPreview {
  employee_id:            string
  month:                  string
  earnings:               PayrollSlipPreviewLine[]
  deductions:             PayrollSlipPreviewLine[]
  employer_contributions: PayrollSlipPreviewLine[]
  gross_pay:              number
  lop_impact:             number
  net_pay:                number
  employer_contributions_total: number
  payable_days:           number
  lop_days:               number
  total_working_days:     number
  overtime_hours:         number
  /** Operator warnings — non-blocking but should be reviewed */
  warning_flags: string[]
}

/**
 * Build a rich payroll slip preview from a `computePayrollSlip` result.
 *
 * This is a pure formatting function — no I/O, no computation.
 * Use after `computePayrollSlip` to get a structured breakdown for:
 *   - dry-run UI rendering
 *   - preview modals in the payroll runs page
 *   - payslip template data
 *
 * @param result  Output of computePayrollSlip
 * @param month   The payroll period (YYYY-MM) — for display context
 */
export function buildPayrollSlipPreview(
  result: PayrollSlipResult,
): PayrollSlipPreview {
  const earnings: PayrollSlipPreviewLine[]               = []
  const deductions: PayrollSlipPreviewLine[]             = []
  const employer_contributions: PayrollSlipPreviewLine[] = []
  const warning_flags: string[]                          = []

  for (const c of result.component_breakdown) {
    const line: PayrollSlipPreviewLine = {
      code:           c.code,
      name:           c.name,
      component_type: c.component_type,
      monthly_amount: c.monthly_amount,
      annual_amount:  c.annual_amount,
    }
    if (c.component_type === 'earning')               earnings.push(line)
    else if (c.component_type === 'deduction')        deductions.push(line)
    else if (c.component_type === 'employer_contribution') employer_contributions.push(line)
  }

  // Add LOP deduction line when applicable
  if (result.lop_amount > 0) {
    deductions.push({
      code:           'LOP',
      name:           'Loss of Pay',
      component_type: 'deduction',
      monthly_amount: result.lop_amount,
      annual_amount:  result.lop_amount * 12,
    })
  }

  // Surface warnings
  if (result.warning) {
    warning_flags.push(result.warning)
  }
  if (earnings.length === 0) {
    warning_flags.push('No earning components — gross pay is ₹0')
  }
  if (result.gross_pay === 0 && result.ctc_monthly > 0) {
    warning_flags.push(
      `CTC is ₹${result.ctc_monthly}/month but gross pay computed as ₹0 — ` +
      'check component formulas',
    )
  }
  if (result.lop_days > result.total_working_days) {
    warning_flags.push(
      `LOP days (${result.lop_days}) exceed total working days (${result.total_working_days}) — verify attendance data`,
    )
  }

  return {
    employee_id:                  result.employeeId,
    month:                        result.month,
    earnings,
    deductions,
    employer_contributions,
    gross_pay:                    result.gross_pay,
    lop_impact:                   result.lop_amount,
    net_pay:                      result.net_pay,
    employer_contributions_total: result.employer_contributions,
    payable_days:                 result.payable_days,
    lop_days:                     result.lop_days,
    total_working_days:           result.total_working_days,
    overtime_hours:               result.overtime_hours,
    warning_flags,
  }
}

// ── Data-fetching helpers (used by the route layer) ───────────────────────────

/**
 * Count total scheduled working days in a month for a tenant.
 * Working day = calendar day that is NOT a public holiday AND NOT Saturday/Sunday.
 * (Sunday = 0, Saturday = 6 in getUTCDay())
 *
 * Note: this is a tenant-level count (not employee-specific).
 * A future version can accept weekly_off_days per employee.
 */
export async function countWorkingDaysInMonth(
  supabase:  SupabaseClient,
  tenantId:  string,
  month:     string,   // 'YYYY-MM'
): Promise<number> {
  const [year, mon] = month.split('-').map(Number)
  const firstDay    = `${month}-01`
  const lastDay     = new Date(year, mon, 0).toISOString().slice(0, 10)
  const allDates    = expandDateRange(firstDay, lastDay)

  // Fetch public holidays for the month (tenant-wide, non-optional).
  // This query is run-level (not per-employee) — failure throws so the entire run
  // fails immediately rather than silently producing wrong working-day counts for
  // every employee (which would corrupt all LOP calculations).
  const { data: holidays, error: holidayErr } = await supabase
    .from('holiday_calendar')
    .select('date')
    .eq('tenant_id', tenantId)
    .eq('is_optional', false)
    .gte('date', firstDay)
    .lte('date', lastDay)

  if (holidayErr) {
    throw new Error(
      `DB error fetching holiday calendar for ${month}: ` +
      `${holidayErr.message} [code=${holidayErr.code}] — ` +
      'payroll run aborted to prevent incorrect working-day counts',
    )
  }

  const holidaySet = new Set<string>((holidays ?? []).map((h: { date: string }) => h.date))

  return allDates.filter(d => {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    return dow !== 0 && dow !== 6 && !holidaySet.has(d)
  }).length
}

/**
 * Per-employee scheduled working days in a month — ROSTER-AWARE.
 *
 * Working day = calendar day that is NOT this employee's weekly-off AND NOT an
 * applicable (non-optional) holiday. The weekly-off is resolved per employee
 * from the roster (emp roster → site default), exactly as the attendance engine
 * resolves it when computing day_fraction. This makes the LOP denominator
 * (total_working_days) consistent with the LOP numerator (lop_days), fixing the
 * mismatch where countWorkingDaysInMonth hardcoded Sat/Sun tenant-wide.
 *
 * Fallback: when no roster weekly-off is configured for the employee, defaults
 * to Sat/Sun ([0,6]) so tenants without rosters keep the previous behavior.
 *
 * Throws on holiday DB error (mirrors countWorkingDaysInMonth) so a run aborts
 * rather than silently producing wrong denominators.
 */
export async function countWorkingDaysForEmployee(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  month:      string,   // 'YYYY-MM'
): Promise<number> {
  const [year, mon] = month.split('-').map(Number)
  const firstDay    = `${month}-01`
  const lastDay     = new Date(year, mon, 0).toISOString().slice(0, 10)
  const allDates    = expandDateRange(firstDay, lastDay)

  const ctx = await resolveEmployeeOrgContext(supabase, tenantId, employeeId, firstDay)

  const { data: rawHolidays, error: holErr } = await supabase
    .from('holiday_calendar')
    .select('date, name, is_optional, site_id, location_id, holiday_group_id')
    .eq('tenant_id', tenantId)
    .eq('is_optional', false)
    .gte('date', firstDay)
    .lte('date', lastDay)

  if (holErr) {
    throw new Error(
      `DB error fetching holiday calendar for employee ${employeeId} (${month}): ` +
      `${holErr.message} [code=${holErr.code}] — payroll run aborted to prevent ` +
      'incorrect working-day counts',
    )
  }

  const holidaySet = getHolidayDates((rawHolidays ?? []) as any, ctx)

  let weeklyOff = getWeeklyOffDays([], ctx.emp_roster_weekly_off, ctx.site_default_roster_weekly_off)
  if (weeklyOff.length === 0) weeklyOff = [0, 6]   // Sun/Sat default when no roster

  return countScheduledWorkingDays(allDates, weeklyOff, holidaySet, ctx.site_timezone)
}

/**
 * Pure counter: how many of `allDates` are scheduled working days — i.e. not a
 * weekly-off day-of-week and not a holiday. Extracted for unit testing.
 *
 * @param allDates    list of YYYY-MM-DD dates
 * @param weeklyOffDays day-of-week numbers that are weekly-offs (0=Sun … 6=Sat)
 * @param holidaySet  set of YYYY-MM-DD holiday dates
 * @param timezone    IANA timezone used to resolve the local day-of-week
 */
export function countScheduledWorkingDays(
  allDates:     string[],
  weeklyOffDays: number[],
  holidaySet:   Set<string>,
  timezone:     string,
): number {
  return allDates.filter(d => {
    const dow = getLocalDayOfWeek(d, timezone)
    return !weeklyOffDays.includes(dow) && !holidaySet.has(d)
  }).length
}

/**
 * Fetch attendance summary for one employee for a given month.
 * Returns zeroes when no records exist.
 */
export async function fetchAttendanceSummary(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  month:      string,
): Promise<{
  payable_days:        number
  lop_days:            number
  present_days:        number
  late_days:           number
  overtime_hours:      number
  /** True if at least one attendance_daily row exists for this employee+month.
   *  When false, payable_days and lop_days are both 0 by default — the employee
   *  will receive full pay.  Callers should surface this as an operator warning. */
  has_attendance_data: boolean
}> {
  const [year, mon] = month.split('-').map(Number)
  const from = `${month}-01`
  const to   = new Date(year, mon, 0).toISOString().slice(0, 10)

  const { data: rows, error: attErr } = await supabase
    .from('attendance_daily')
    .select('status, is_payable, day_fraction, overtime_minutes')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .gte('date', from)
    .lte('date', to)

  if (attErr) {
    // Throw so the per-employee catch in the route layer can isolate this failure.
    // Never return silent zeroes on a DB error — zeroes would produce full pay (0 LOP)
    // which is an incorrect financial outcome indistinguishable from genuine full attendance.
    throw new Error(
      `DB error fetching attendance for employee ${employeeId} (${month}): ` +
      `${attErr.message} [code=${attErr.code}]`,
    )
  }

  const daily = (rows ?? []) as Array<{
    status:           string
    is_payable:       boolean
    day_fraction:     number
    overtime_minutes: number
  }>

  return {
    // Sum fractions so a half-day counts as 0.5, not 1.0.
    // null day_fraction = legacy/unprocessed row (attendance engine never ran for that date).
    // Treat null as 1.0 (full present day) to avoid phantom LOP on unprocessed records.
    payable_days:   round2(daily.reduce((s, r) => s + (r.day_fraction ?? 1.0), 0)),
    // LOP = working days not covered by payable time.
    // Absent = 1.0 LOP, half_day = 0.5 LOP, unpaid leave = 1.0 LOP.
    // null day_fraction → treated as 1.0 present → 0.0 LOP (safe default).
    lop_days:       round2(daily.reduce((s, r) => s + Math.max(0, 1.0 - (r.day_fraction ?? 1.0)), 0)),
    present_days:   daily.filter(r => r.status === 'present' || r.status === 'late').length,
    late_days:      daily.filter(r => r.status === 'late').length,
    overtime_hours: round2(daily.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0) / 60),
    has_attendance_data: daily.length > 0,
  }
}

/**
 * Fetch the active compensation for an employee with all components.
 * Returns null when no active compensation exists.
 *
 * Pass `asOf` (YYYY-MM-DD) to prevent future-dated compensations from being
 * applied to payroll periods before their effective date.
 */
export async function fetchActiveCompensation(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  // asOf defaults to today so future-dated compensations are never accidentally
  // applied to the current period when the caller omits the argument.
  asOf:       string = new Date().toISOString().slice(0, 10),
): Promise<{
  id:             string
  ctc_monthly:    number
  ctc_annual:     number
  effective_from: string
  components:     PayrollComponentSnapshot[]
} | null> {
  // Get the active compensation record capped to asOf date so
  // future-dated revisions never affect payroll runs for earlier periods.
  let q = supabase
    .from('employee_compensations')
    .select('id, ctc_annual, ctc_monthly, effective_from')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('is_active',   true)
  if (asOf) q = q.lte('effective_from', asOf)
  const { data: comp, error: compErr } = await q
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (compErr) {
    // Throw so the per-employee catch in the route layer can isolate this failure.
    // Never return null silently on a DB error — null would cause computePayrollSlip
    // to produce a zero-pay slip with a "no compensation" warning, which is wrong
    // (the compensation may well exist; the query just failed).
    throw new Error(
      `DB error fetching active compensation for employee ${employeeId}: ` +
      `${compErr.message} [code=${compErr.code}]`,
    )
  }

  // Genuinely no active compensation — caller decides how to handle (warning vs skip)
  if (!comp) return null

  // Get its components
  const { data: compComponents, error: compCompErr } = await supabase
    .from('employee_compensation_components')
    .select(`
      salary_component_id, sequence,
      computed_monthly, computed_annual,
      calculation_type, value,
      salary_components(id, name, code, component_type, is_pf_applicable, affects_pf, is_esi_applicable, is_pt_applicable)
    `)
    .eq('compensation_id', comp.id)
    .order('sequence', { ascending: true })

  if (compCompErr) {
    throw new Error(
      `DB error fetching compensation components for employee ${employeeId} ` +
      `(compensation_id=${comp.id}): ${compCompErr.message} [code=${compCompErr.code}]`,
    )
  }

  const components: PayrollComponentSnapshot[] = (compComponents ?? []).map((cc: any) => ({
    salary_component_id: cc.salary_component_id,
    name:                cc.salary_components?.name ?? '',
    code:                cc.salary_components?.code ?? '',
    component_type:      cc.salary_components?.component_type ?? 'earning',
    calc_type:           cc.calculation_type,
    value:               cc.value,
    monthly_amount:      cc.computed_monthly ?? 0,
    annual_amount:       cc.computed_annual  ?? 0,
    sequence:            cc.sequence ?? 0,
    is_pf_applicable:    !!cc.salary_components?.is_pf_applicable,
    affects_pf:          !!cc.salary_components?.affects_pf,
    is_esi_applicable:   !!cc.salary_components?.is_esi_applicable,
    is_pt_applicable:    !!cc.salary_components?.is_pt_applicable,
  }))

  return {
    id:             comp.id,
    ctc_monthly:    Number(comp.ctc_monthly),
    ctc_annual:     Number(comp.ctc_annual),
    effective_from: comp.effective_from as string,
    components,
  }
}
