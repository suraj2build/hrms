/**
 * payroll-accounting-engine — ad-hoc component posting (migration 449)
 *
 * A review of G12 found that generateLedgerEntries only ever received
 * compensation_snapshot.components (the employee's STANDING catalog
 * structure) — so ad-hoc, synthesized-at-compute-time lines (a standalone
 * leave encashment payout + its withholding, advance/loan-EMI recovery
 * deductions) were silently absent from every journal entry, AND their
 * rupee value leaked into the LOP contra bucket via the
 * gross_pay - net_pay - statutoryDedTotal formula (which implicitly assumed
 * total_deductions only ever contained catalog deductions + LOP).
 *
 * These tests prove, at the unit level:
 *   1. computeLopAmount correctly excludes ad-hoc deductions (the fix) —
 *      without it, their amount would be misclassified as LOP.
 *   2. generateLedgerEntries posts an ad-hoc deduction (TDS) to the correct
 *      statutory GL bucket, same as a catalog TDS line would be.
 *   3. generateLedgerEntries posts an ad-hoc earning (LEAVE_ENCASHMENT) via
 *      the default Salary Expense / Payroll Payable fallback.
 *   4. The resulting entry set still balances (sum debit == sum credit).
 */
import { describe, it, expect } from 'vitest'
import { generateLedgerEntries, computeLopAmount, validateLedgerBalance, GL } from '../payroll-accounting-engine.js'

describe('computeLopAmount — excludes ad-hoc deductions from the LOP remainder', () => {
  it('ordinary case: no ad-hoc deductions, LOP is exactly gross - net - catalog deductions', () => {
    // 50000 gross, 3000 catalog PF, 2000 LOP baked into net => net = 45000
    expect(computeLopAmount(50_000, 45_000, 3_000, 0)).toBe(2_000)
  })

  it('an ad-hoc deduction (e.g. encashment TDS) is excluded, not misclassified as LOP', () => {
    // 50000 gross, 3000 catalog PF, 500 ad-hoc TDS, 2000 real LOP => net = 50000-3000-500-2000 = 44500
    const net = 50_000 - 3_000 - 500 - 2_000
    expect(computeLopAmount(50_000, net, 3_000, 500)).toBe(2_000)
    // Without the fix (omitting the adhocDeductionTotal term), this would
    // have returned 2500 — folding the 500 TDS into "LOP recovery".
    expect(computeLopAmount(50_000, net, 3_000, 0)).toBe(2_500)
  })

  it('an ad-hoc earning (e.g. leave encashment payout) does not perturb LOP — gross and net move together', () => {
    // Base: 50000 gross, 3000 catalog ded, 2000 LOP, net = 45000.
    // Add a 20000 encashment payout with 0 TDS: gross=70000, net=65000.
    expect(computeLopAmount(70_000, 65_000, 3_000, 0)).toBe(2_000)
  })

  it('never returns negative — clamps at zero', () => {
    expect(computeLopAmount(50_000, 50_000, 0, 0)).toBe(0)
    expect(computeLopAmount(50_000, 52_000, 0, 0)).toBe(0)
  })
})

describe('generateLedgerEntries — ad-hoc components post via the same GL path as catalog ones', () => {
  const baseParams = {
    employeeId: 'emp-1', employeeCode: 'E001', employeeName: 'Test Employee',
    month: '2026-11', seq: 1, grossPay: 70_000, netPay: 64_500, lopAmount: 0,
    glMappings: [], accountingDate: '2026-11-01',
  }

  it('an ad-hoc TDS deduction line posts Dr Payroll Payable / Cr TDS Payable, same as a catalog TDS line would', () => {
    const entries = generateLedgerEntries({
      ...baseParams,
      components: [
        { code: 'LEAVE_ENCASHMENT', name: 'Leave Encashment', component_type: 'earning', monthly_amount: 20_000 },
        { code: 'TDS', name: 'TDS on Leave Encashment', component_type: 'deduction', monthly_amount: 2_000 },
      ],
    })

    const tdsDebit  = entries.find(e => e.gl_account_code === GL.PAYROLL_PAYABLE.code && e.debit_amount === 2_000)
    const tdsCredit = entries.find(e => e.gl_account_code === GL.TDS_PAYABLE.code && e.credit_amount === 2_000)
    expect(tdsDebit).toBeDefined()
    expect(tdsCredit).toBeDefined()
  })

  it('an ad-hoc earning line with no GL mapping falls back to Salary Expense / Payroll Payable', () => {
    const entries = generateLedgerEntries({
      ...baseParams,
      components: [
        { code: 'LEAVE_ENCASHMENT', name: 'Leave Encashment', component_type: 'earning', monthly_amount: 20_000 },
      ],
    })

    const expenseDebit  = entries.find(e => e.gl_account_code === GL.SALARY_EXPENSE.code && e.debit_amount === 20_000)
    const payableCredit = entries.find(e => e.gl_account_code === GL.PAYROLL_PAYABLE.code && e.credit_amount === 20_000)
    expect(expenseDebit).toBeDefined()
    expect(payableCredit).toBeDefined()
    expect(expenseDebit?.source_component_code).toBe('LEAVE_ENCASHMENT')
  })

  it('an ad-hoc advance/loan EMI deduction falls back to Other Statutory Payable (no specific mapping)', () => {
    const entries = generateLedgerEntries({
      ...baseParams,
      components: [
        { code: 'LOAN_EMI', name: 'Personal Loan EMI', component_type: 'deduction', monthly_amount: 5_500 },
      ],
    })
    const credit = entries.find(e => e.gl_account_code === GL.OTHER_STATUTORY_PAYABLE.code && e.credit_amount === 5_500)
    expect(credit).toBeDefined()
  })

  it('the full entry set (catalog + ad-hoc earning + ad-hoc deduction + LOP) still balances', () => {
    const entries = generateLedgerEntries({
      ...baseParams,
      lopAmount: 1_000,
      components: [
        { code: 'BASIC', name: 'Basic', component_type: 'earning', monthly_amount: 40_000 },
        { code: 'LEAVE_ENCASHMENT', name: 'Leave Encashment', component_type: 'earning', monthly_amount: 20_000 },
        { code: 'PF_EMPLOYEE', name: 'PF', component_type: 'deduction', monthly_amount: 2_000 },
        { code: 'TDS', name: 'TDS on Leave Encashment', component_type: 'deduction', monthly_amount: 2_000 },
      ],
    })
    const balance = validateLedgerBalance(entries)
    expect(balance.balanced).toBe(true)
    expect(balance.total_debit).toBe(balance.total_credit)
  })
})
