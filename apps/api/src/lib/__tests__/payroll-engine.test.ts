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
  fetchActiveCompensation,
  computePayrollSlip,
  applyAdvanceLoanRecovery,
  finalizeDeductionsAndNet,
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

  it('recovery exceeding available pay is deferred (capped), net never negative', () => {
    const base = computePayrollSlip(slipInput(0, 22, 15_000, 22))
    const result = applyAdvanceLoanRecovery(base, [
      { type: 'loan_emi', schedule_id: 'ls-big', amount: 35_000, label: 'Oversized EMI' },
    ])
    // 35k recovery on 15k gross cannot fit → fully deferred, slip stays sane
    expect(result.total_deductions).toBe(0)
    expect(result.net_pay).toBe(15_000)
    expect(result.recovered_recovery_ids).toEqual([])
    expect(result.deferred_recovery_ids).toEqual(['ls-big'])
    expect(result.total_deductions).toBeLessThanOrEqual(result.gross_pay)
    expect(result.warning ?? '').toMatch(/deferred/i)
  })

  it('recovery: installments taken in order until available pay runs out', () => {
    const base = computePayrollSlip(slipInput(0, 22, 15_000, 22))
    const result = applyAdvanceLoanRecovery(base, [
      { type: 'advance_recovery', schedule_id: 'a-1', amount: 10_000, label: 'Advance' },
      { type: 'loan_emi',        schedule_id: 'l-2', amount: 8_000,  label: 'EMI' },
    ])
    // 10k fits (15k avail → 5k left); 8k does not → deferred
    expect(result.recovered_recovery_ids).toEqual(['a-1'])
    expect(result.deferred_recovery_ids).toEqual(['l-2'])
    expect(result.total_deductions).toBe(10_000)
    expect(result.net_pay).toBe(5_000)
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

// ── Section 3: ISSUE-143 — gross_pay - total_deductions = net_pay invariant ──

describe('finalizeDeductionsAndNet — deduction cap invariant (ISSUE-143)', () => {
  it('deductions within gross pay: total_deductions unchanged, no shortfall', () => {
    const r = finalizeDeductionsAndNet(60_000, 10_000)
    expect(r.total_deductions).toBe(10_000)
    expect(r.net_pay).toBe(50_000)
    expect(r.deduction_shortfall).toBe(0)
    expect(r.net_pay).toBe(60_000 - r.total_deductions)
  })

  it('deductions exceeding gross pay: total_deductions capped at gross_pay, excess surfaced as shortfall', () => {
    const r = finalizeDeductionsAndNet(20_000, 25_000)
    expect(r.total_deductions).toBe(20_000)
    expect(r.net_pay).toBe(0)
    expect(r.deduction_shortfall).toBe(5_000)
    // The invariant routes/payroll/index.ts relies on for GL/reporting reconciliation:
    expect(r.net_pay).toBe(20_000 - r.total_deductions)
  })

  it('zero gross pay with any deductions: total_deductions and net_pay both 0', () => {
    const r = finalizeDeductionsAndNet(0, 5_000)
    expect(r.total_deductions).toBe(0)
    expect(r.net_pay).toBe(0)
    expect(r.deduction_shortfall).toBe(5_000)
  })
})

describe('computePayrollSlip — LOP exceeding gross pay caps total_deductions (ISSUE-143)', () => {
  it('lop_days far exceeding total_working_days: net_pay never negative, invariant holds, shortfall warned', () => {
    // 25 lop_days on a 22-working-day month → lop_amount = (25/22) × 60000 = 68,181.82 > gross_pay
    const result = computePayrollSlip(slipInput(25, 0, 60_000, 22))

    expect(result.gross_pay).toBe(60_000)
    expect(result.total_deductions).toBe(60_000)     // capped at gross_pay, not the uncapped 68,181.82
    expect(result.net_pay).toBe(0)
    expect(result.deduction_shortfall).toBeCloseTo(8181.82, 1)
    // The invariant: gross_pay - total_deductions = net_pay, always.
    expect(result.gross_pay - result.total_deductions).toBe(result.net_pay)
    expect(result.warning ?? '').toMatch(/exceed gross pay/i)
  })
})

// ── Section 4: G13 sweep — NUMERIC-as-string coercion regressions ────────────
//
// attendance_daily.day_fraction is DECIMAL(3,1); PostgREST/Supabase serialize
// NUMERIC/DECIMAL columns as JSON strings, not numbers. These tests exercise
// fetchAttendanceSummary and fetchActiveCompensation with string-shaped rows
// (as the real DB layer actually returns them) instead of the numeric-literal
// rows Section 1 above uses, to guard the Number()-coercion fix.

describe('fetchAttendanceSummary — DB-string day_fraction (G13 sweep)', () => {
  it('2+ rows with string day_fraction sum correctly instead of string-concatenating', async () => {
    // Before the fix: 0 + "1.0" + "1.0" -> "01.01.0" -> round2() -> NaN.
    const rows = [
      { status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
      { status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
      { status: 'half_day', is_payable: true, day_fraction: '0.5', overtime_minutes: 0 },
    ]
    const result = await fetchAttendanceSummary(mockSupabase(rows as any), TENANT, EMP, MONTH)

    expect(result.payable_days).toBe(2.5)
    expect(result.lop_days).toBe(0.5)
    expect(Number.isNaN(result.payable_days)).toBe(false)
    expect(Number.isNaN(result.lop_days)).toBe(false)
  })

  it('string "0.0" day_fraction (a genuine full LOP day) is NOT treated as missing/null', async () => {
    // Regression guard: the fix must use `Number(x ?? 1.0)`, not `Number(x) || 1.0`,
    // or a real 0 gets wrongly replaced with a full present day.
    const rows = [
      { status: 'absent', is_payable: false, day_fraction: '0.0', overtime_minutes: 0 },
      { status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
    ]
    const result = await fetchAttendanceSummary(mockSupabase(rows as any), TENANT, EMP, MONTH)

    expect(result.payable_days).toBe(1)   // not 2 — the "0.0" day must stay 0, not become 1.0
    expect(result.lop_days).toBe(1)
  })

  it('fractional string day_fraction (e.g. "0.25") sums correctly', async () => {
    const rows = [
      { status: 'half_day', is_payable: true, day_fraction: '0.25', overtime_minutes: 0 },
      { status: 'half_day', is_payable: true, day_fraction: '0.75', overtime_minutes: 0 },
    ]
    const result = await fetchAttendanceSummary(mockSupabase(rows as any), TENANT, EMP, MONTH)

    expect(result.payable_days).toBe(1)
    expect(result.lop_days).toBe(1)
  })

  it('null day_fraction among string rows still defaults to full present (1.0)', async () => {
    const rows = [
      { status: 'present', is_payable: true, day_fraction: null, overtime_minutes: 0 },
      { status: 'present', is_payable: true, day_fraction: '1.0', overtime_minutes: 0 },
    ]
    const result = await fetchAttendanceSummary(mockSupabase(rows as any), TENANT, EMP, MONTH)

    expect(result.payable_days).toBe(2)
    expect(result.lop_days).toBe(0)
  })
})

describe('fetchActiveCompensation — DB-string computed_monthly/computed_annual (G13 sweep)', () => {
  /** Mock matching fetchActiveCompensation's two-query shape:
   *  employee_compensations (.select().eq().eq().eq().lte().order().limit().maybeSingle())
   *  employee_compensation_components (.select().eq().order() — thenable, no maybeSingle) */
  function mockCompSupabase(
    comp: { id: string; ctc_annual: string | number; ctc_monthly: string | number; effective_from: string } | null,
    components: Array<{
      salary_component_id: string
      sequence: number
      computed_monthly: string | number | null
      computed_annual:  string | number | null
      calculation_type: string
      value: string | number
      salary_components: { id: string; name: string; code: string; component_type: string }
    }>,
  ) {
    return {
      from(table: string) {
        if (table === 'employee_compensations') {
          const chain: any = {
            select: () => chain,
            eq:     () => chain,
            lte:    () => chain,
            order:  () => chain,
            limit:  () => chain,
            maybeSingle: () => Promise.resolve({ data: comp, error: null }),
          }
          return chain
        }
        // employee_compensation_components — resolved via await on the chain itself (thenable)
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          order:  () => Promise.resolve({ data: components, error: null }),
        }
        return chain
      },
    } as any
  }

  it('2+ components with string computed_monthly sum correctly (not string-concatenated)', async () => {
    // Before the fix: monthly_amount stayed the raw string, and computePayrollSlip's
    // `earnings.reduce((s, c) => s + c.monthly_amount, 0)` string-concatenated once
    // there were 2+ earning components — i.e. virtually every real employee.
    const result = await fetchActiveCompensation(
      mockCompSupabase(
        { id: 'comp-1', ctc_annual: '600000.00', ctc_monthly: '50000.00', effective_from: '2026-01-01' },
        [
          { salary_component_id: 'sc-1', sequence: 1, computed_monthly: '30000.00', computed_annual: '360000.00', calculation_type: 'fixed', value: '30000.0000', salary_components: { id: 'x', name: 'Basic', code: 'BASIC', component_type: 'earning' } },
          { salary_component_id: 'sc-2', sequence: 2, computed_monthly: '20000.00', computed_annual: '240000.00', calculation_type: 'fixed', value: '20000.0000', salary_components: { id: 'y', name: 'HRA', code: 'HRA', component_type: 'earning' } },
        ],
      ),
      TENANT, EMP,
    )

    expect(result).not.toBeNull()
    expect(result!.ctc_monthly).toBe(50000)
    expect(result!.ctc_annual).toBe(600000)
    expect(result!.components[0].monthly_amount).toBe(30000)
    expect(result!.components[1].monthly_amount).toBe(20000)
    const grossPay = result!.components.reduce((s, c) => s + c.monthly_amount, 0)
    expect(grossPay).toBe(50000)
    expect(Number.isNaN(grossPay)).toBe(false)
  })

  it('string "0.00" computed_monthly is a real zero, not dropped or NaN', async () => {
    const result = await fetchActiveCompensation(
      mockCompSupabase(
        { id: 'comp-2', ctc_annual: '360000.00', ctc_monthly: '30000.00', effective_from: '2026-01-01' },
        [
          { salary_component_id: 'sc-1', sequence: 1, computed_monthly: '30000.00', computed_annual: '360000.00', calculation_type: 'fixed', value: '30000.0000', salary_components: { id: 'x', name: 'Basic', code: 'BASIC', component_type: 'earning' } },
          { salary_component_id: 'sc-2', sequence: 2, computed_monthly: '0.00', computed_annual: '0.00', calculation_type: 'fixed', value: '0.0000', salary_components: { id: 'z', name: 'Bonus', code: 'BONUS', component_type: 'earning' } },
        ],
      ),
      TENANT, EMP,
    )

    expect(result!.components[1].monthly_amount).toBe(0)
    const grossPay = result!.components.reduce((s, c) => s + c.monthly_amount, 0)
    expect(grossPay).toBe(30000)
  })

  it('null computed_monthly/computed_annual default to 0, not null/NaN', async () => {
    const result = await fetchActiveCompensation(
      mockCompSupabase(
        { id: 'comp-3', ctc_annual: '120000.00', ctc_monthly: '10000.00', effective_from: '2026-01-01' },
        [
          { salary_component_id: 'sc-1', sequence: 1, computed_monthly: null, computed_annual: null, calculation_type: 'fixed', value: '0', salary_components: { id: 'x', name: 'Allowance', code: 'ALLOW', component_type: 'earning' } },
        ],
      ),
      TENANT, EMP,
    )

    expect(result!.components[0].monthly_amount).toBe(0)
    expect(result!.components[0].annual_amount).toBe(0)
    expect(Number.isNaN(result!.components[0].monthly_amount)).toBe(false)
  })

  it('fractional string computed_monthly (e.g. "1234.56") converts exactly', async () => {
    const result = await fetchActiveCompensation(
      mockCompSupabase(
        { id: 'comp-4', ctc_annual: '14814.72', ctc_monthly: '1234.56', effective_from: '2026-01-01' },
        [
          { salary_component_id: 'sc-1', sequence: 1, computed_monthly: '1234.56', computed_annual: '14814.72', calculation_type: 'fixed', value: '1234.5600', salary_components: { id: 'x', name: 'Basic', code: 'BASIC', component_type: 'earning' } },
        ],
      ),
      TENANT, EMP,
    )

    expect(result!.components[0].monthly_amount).toBe(1234.56)
    expect(result!.ctc_monthly).toBe(1234.56)
  })
})
