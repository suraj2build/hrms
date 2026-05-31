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
 *   5. LOP amount = (lop_days / total_working_days) × ctc_monthly
 *   6. Net pay    = gross_pay − lop_amount − sum(deduction components)
 *   7. Employer contributions are tracked separately (not deducted from net)
 *
 * No I/O — pure computation given the inputs fetched by the route layer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { expandDateRange } from './leave-engine.js'

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
    payable_days:   number
    lop_days:       number
    present_days:   number
    late_days:      number
    overtime_hours: number
  }
  /** Total scheduled working days in the month for this employee */
  total_working_days: number
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
  /** Human-readable warning when compensation is missing */
  warning?:              string
}

// ── Core computation ───────────────────────────────────────────────────────────

export function computePayrollSlip(input: PayrollSlipInput): PayrollSlipResult {
  const {
    employeeId, month, compensation, attendance, total_working_days,
  } = input

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
      employer_contributions:0,
      component_breakdown:   [],
      warning: 'No active compensation configured for this employee.',
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

  // LOP deduction: proportional to days missed
  const safe_working_days = total_working_days > 0 ? total_working_days : 1
  const lop_amount = round2(
    Math.max(0, (attendance.lop_days / safe_working_days) * ctc_monthly)
  )

  const total_deductions = round2(deduction_total_base + lop_amount)
  const net_pay          = round2(Math.max(0, gross_pay - total_deductions))

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
    employer_contributions,
    component_breakdown: components,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
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

  // Fetch public holidays for the month (tenant-wide, non-optional)
  const { data: holidays } = await supabase
    .from('holiday_calendar')
    .select('date')
    .eq('tenant_id', tenantId)
    .eq('is_optional', false)
    .gte('date', firstDay)
    .lte('date', lastDay)

  const holidaySet = new Set<string>((holidays ?? []).map((h: { date: string }) => h.date))

  return allDates.filter(d => {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    return dow !== 0 && dow !== 6 && !holidaySet.has(d)
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
  payable_days:   number
  lop_days:       number
  present_days:   number
  late_days:      number
  overtime_hours: number
}> {
  const [year, mon] = month.split('-').map(Number)
  const from = `${month}-01`
  const to   = new Date(year, mon, 0).toISOString().slice(0, 10)

  const { data: rows } = await supabase
    .from('attendance_daily')
    .select('status, is_payable, overtime_minutes')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .gte('date', from)
    .lte('date', to)

  const daily = (rows ?? []) as Array<{
    status: string
    is_payable: boolean
    overtime_minutes: number
  }>

  return {
    payable_days:   daily.filter(r => r.is_payable).length,
    lop_days:       daily.filter(r => r.status === 'absent').length,
    present_days:   daily.filter(r => r.status === 'present' || r.status === 'late').length,
    late_days:      daily.filter(r => r.status === 'late').length,
    overtime_hours: round2(daily.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0) / 60),
  }
}

/**
 * Fetch the active compensation for an employee with all components.
 * Returns null when no active compensation exists.
 */
export async function fetchActiveCompensation(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<{
  id:          string
  ctc_monthly: number
  ctc_annual:  number
  components:  PayrollComponentSnapshot[]
} | null> {
  // Get the active compensation record
  const { data: comp } = await supabase
    .from('employee_compensations')
    .select('id, ctc_annual, ctc_monthly')
    .eq('tenant_id',   tenantId)
    .eq('employee_id', employeeId)
    .eq('is_active',   true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!comp) return null

  // Get its components
  const { data: compComponents } = await supabase
    .from('employee_compensation_components')
    .select(`
      salary_component_id, sequence,
      computed_monthly, computed_annual,
      calculation_type, value,
      salary_components(id, name, code, component_type)
    `)
    .eq('compensation_id', comp.id)
    .order('sequence', { ascending: true })

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
  }))

  return {
    id:          comp.id,
    ctc_monthly: Number(comp.ctc_monthly),
    ctc_annual:  Number(comp.ctc_annual),
    components,
  }
}
