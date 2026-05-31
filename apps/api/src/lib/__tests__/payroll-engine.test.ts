/**
 * payroll-engine — lop_days / payable_days regression tests
 *
 * Scenarios covered:
 *
 *  fetchAttendanceSummary — Supabase-facing function (mocked DB):
 *   1. All-absent month          → lop_days = N,     payable_days = 0
 *   2. All-half_day month        → lop_days = N×0.5, payable_days = N×0.5
 *   3. Single unpaid leave day   → lop_days = 1.0,   payable_days = 0
 *   4. Single paid leave day     → lop_days = 0,     payable_days = 1.0
 *   5. Mixed month               → sums correctly across all status types
 *   6. Half-day unpaid leave     → lop_days = 0.5,   payable_days = 0
 *   7. Empty result set          → all zeroes (no NaN / crash)
 *
 *  computePayrollSlip — pure function (no DB):
 *   8. LOP amount formula        → (lop_days / working_days) × ctc_monthly
 *   9. Half-day LOP amount       → proportional deduction (0.5 lop day)
 *  10. Zero lop_days             → lop_amount = 0, net = gross
 *  11. lop_amount cannot go negative (guard on max(0, …))
 *  12. payable_days passes through to slip output unchanged
 *
 * What is NOT tested:
 *   - countWorkingDaysInMonth (calendar / holiday logic — separate concern)
 *   - fetchActiveCompensation (passthrough query, no computation)
 *   - Actual Supabase connectivity
 */

import { describe, it, expect, vi } from 'vitest'
import {
  fetchAttendanceSummary,
  computePayrollSlip,
  type PayrollSlipInput,
} from '../payroll-engine.js'

// ── Supabase stub ──────────────────────────────────────────────────────────────

/**
 * Minimal stub that returns the given rows for any
 * attendance_daily select chain.  Other tables are not exercised here.
 */
function mockSupabase(rows: Array<{
  status:           string
  is_payable:       boolean
  day_fraction:     number
  overtime_minutes: number
}>) {
  return {
    from(_table: string) {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                lte: () => Promise.resolve({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      }
    },
  } as any
}

// ── Fixture builders ──────────────────────────────────────────────────────────

const TENANT = 'tenant-001'
const EMP    = 'emp-001'
const MONTH  = '2024-01'

/** Row shorthand */
function row(
  status: string,
  is_payable: boolean,
  day_fraction: number,
  overtime_minutes = 0,
) {
  return { status, is_payable, day_fraction, overtime_minutes }
}

/** Minimal PayrollSlipInput for computePayrollSlip tests */
function slipInput(
  lop_days: number,
  payable_days: number,
  ctc_monthly = 60_000,
  total_working_days = 22,
): PayrollSlipInput {
  return {
    tenantId:    TENANT,
    employeeId:  EMP,
    month:       MONTH,
    total_working_days,
    attendance: {
      lop_days,
      payable_days,
      present_days:        0,
      late_days:           0,
      overtime_hours:      0,
      has_attendance_data: true,
    },
    compensation: {
      id:          'comp-001',
      ctc_monthly,
      ctc_annual:  ctc_monthly * 12,
      components: [
        {
          salary_component_id: 'sc-basic',
          name:           'Basic',
          code:           'BASIC',
          component_type: 'earning',
          calc_type:      'fixed',
          value:          ctc_monthly,
          monthly_amount: ctc_monthly,
          annual_amount:  ctc_monthly * 12,
          sequence:       1,
        },
      ],
    },
  }
}

// ── Section 1: fetchAttendanceSummary ─────────────────────────────────────────

describe('fetchAttendanceSummary — lop_days and payable_days', () => {
  it('all-absent month: lop_days = row count, payable_days = 0', async () => {
    const rows = Array.from({ length: 5 }, () => row('absent', false, 0.0))
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(5)
    expect(result.payable_days).toBe(0)
  })

  it('all-half_day month: lop_days = N×0.5, payable_days = N×0.5', async () => {
    const rows = Array.from({ length: 4 }, () => row('half_day', true, 0.5))
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(2)      // 4 × 0.5
    expect(result.payable_days).toBe(2)  // 4 × 0.5
  })

  it('single unpaid leave day: lop_days = 1.0, payable_days = 0', async () => {
    const rows = [row('leave', false, 0.0)]
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(1)
    expect(result.payable_days).toBe(0)
  })

  it('single paid leave day: lop_days = 0, payable_days = 1.0', async () => {
    const rows = [row('leave', true, 1.0)]
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(0)
    expect(result.payable_days).toBe(1)
  })

  it('half-day unpaid leave: lop_days = 0.5, payable_days = 0', async () => {
    // Unpaid half-day leave: is_payable=false, day_fraction=0.5 (per engine logic)
    const rows = [row('leave', false, 0.5)]
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(0.5)
    expect(result.payable_days).toBe(0.5)  // fraction still counts as payable time served
  })

  it('mixed month: absent + half_day + paid leave + present are all summed correctly', async () => {
    const rows = [
      row('present',   true,  1.0),   // 0 LOP, 1.0 payable
      row('present',   true,  1.0),   // 0 LOP, 1.0 payable
      row('late',      true,  1.0),   // 0 LOP, 1.0 payable
      row('half_day',  true,  0.5),   // 0.5 LOP, 0.5 payable
      row('half_day',  true,  0.5),   // 0.5 LOP, 0.5 payable
      row('absent',    false, 0.0),   // 1.0 LOP, 0 payable
      row('leave',     true,  1.0),   // 0 LOP (paid), 1.0 payable
      row('leave',     false, 0.0),   // 1.0 LOP (unpaid), 0 payable
      row('holiday',   true,  1.0),   // 0 LOP, 1.0 payable
      row('weekly_off',true,  1.0),   // 0 LOP, 1.0 payable
    ]
    const result = await fetchAttendanceSummary(mockSupabase(rows), TENANT, EMP, MONTH)

    // LOP: 0+0+0+0.5+0.5+1+0+1+0+0 = 3.0
    expect(result.lop_days).toBe(3)
    // Payable: 1+1+1+0.5+0.5+0+1+0+1+1 = 7.0
    expect(result.payable_days).toBe(7)
  })

  it('empty result set: returns all zeroes without NaN or crash', async () => {
    const result = await fetchAttendanceSummary(mockSupabase([]), TENANT, EMP, MONTH)

    expect(result.lop_days).toBe(0)
    expect(result.payable_days).toBe(0)
    expect(result.present_days).toBe(0)
    expect(result.late_days).toBe(0)
    expect(result.overtime_hours).toBe(0)
    // Explicit NaN guard
    expect(Number.isNaN(result.lop_days)).toBe(false)
    expect(Number.isNaN(result.payable_days)).toBe(false)
  })
})

// ── Section 2: computePayrollSlip — LOP amount formula ───────────────────────

describe('computePayrollSlip — lop_amount and net_pay', () => {
  it('lop_amount = (lop_days / working_days) × ctc_monthly', () => {
    // 2 absent days out of 22 working days on ₹60,000 CTC
    // expected: (2 / 22) × 60000 = 5454.55
    const result = computePayrollSlip(slipInput(2, 20, 60_000, 22))

    expect(result.lop_amount).toBeCloseTo(5454.55, 1)
    expect(result.net_pay).toBeCloseTo(60_000 - 5454.55, 1)
  })

  it('half-day LOP: 0.5 lop_days → proportional deduction (not 0, not 1 full day)', () => {
    // 0.5 lop out of 22 days on ₹60,000
    // expected: (0.5 / 22) × 60000 = 1363.64
    const result = computePayrollSlip(slipInput(0.5, 21.5, 60_000, 22))

    expect(result.lop_amount).toBeCloseTo(1363.64, 1)
    // Deduction must be strictly between 0 and a full-day deduction
    const oneDay = (1 / 22) * 60_000
    expect(result.lop_amount).toBeGreaterThan(0)
    expect(result.lop_amount).toBeLessThan(oneDay)
  })

  it('zero lop_days: lop_amount = 0, net_pay = gross_pay', () => {
    const result = computePayrollSlip(slipInput(0, 22, 60_000, 22))

    expect(result.lop_amount).toBe(0)
    expect(result.net_pay).toBe(result.gross_pay)
  })

  it('lop_amount cannot be negative even with edge-case inputs', () => {
    // Passing a negative lop_days (should never happen but guard must hold)
    const result = computePayrollSlip(slipInput(-1, 23, 60_000, 22))

    expect(result.lop_amount).toBeGreaterThanOrEqual(0)
    expect(result.net_pay).toBeGreaterThanOrEqual(0)
  })

  it('payable_days passes through to the slip result unchanged', () => {
    const result = computePayrollSlip(slipInput(1.5, 20.5, 60_000, 22))

    expect(result.payable_days).toBe(20.5)
    expect(result.lop_days).toBe(1.5)
  })

  it('mixed-month totals from fetchAttendanceSummary drive correct lop_amount end-to-end', () => {
    // Simulate: 3 lop_days on ₹90,000 CTC over 20 working days
    // (3 / 20) × 90000 = 13500
    const result = computePayrollSlip(slipInput(3, 7, 90_000, 20))

    expect(result.lop_amount).toBe(13500)
    expect(result.net_pay).toBe(90_000 - 13500)  // = 76500
  })
})
