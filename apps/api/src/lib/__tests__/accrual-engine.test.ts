/**
 * accrual-engine — runMonthlyAccrual NUMERIC-as-string coercion regressions (G13 sweep)
 *
 * leave_accrual_rules.days_per_period is DECIMAL(5,2); PostgREST/Supabase serialize
 * NUMERIC/DECIMAL columns as JSON strings, not numbers. Before the fix, any employee
 * who joined on/before the accrual period's start (i.e. almost every employee, every
 * month) took proratedDays()'s "full month" branch, which returned `daysPerPeriod`
 * UNCHANGED — still a string. `currentBalance + days` then string-concatenated, and
 * calling `.toFixed()` on the resulting string threw a TypeError, crashing the whole
 * rule's loop before any employee's credit was written. Confirmed by direct
 * reproduction against this table's real seed values (`node -e`):
 *   parseFloat((0 + "1.00").toFixed(2))  ->  TypeError: (...).toFixed is not a function
 */

import { describe, it, expect } from 'vitest'
import { runMonthlyAccrual } from '../accrual-engine.js'

const TENANT = 'tenant-001'

/** Builds a mock Supabase client covering every table runMonthlyAccrual touches. */
function mockSupabase(opts: {
  rules: Array<{
    id: string
    leave_type_id: string
    accrual_frequency: string
    days_per_period: string | number
    prorate_on_joining: boolean
    effective_from: string
    effective_to: string | null
  }>
  employees: Array<{ id: string; joining_date: string }>
  existingBalances?: Array<{ employee_id: string; balance: string | number }>
  existingRuns?: Array<{ leave_type_id: string }>
}) {
  const { rules, employees, existingBalances = [], existingRuns = [] } = opts
  const upserts: Record<string, any[]> = {}
  // fetchAllRows() calls the query builder (and thus `.from('employees')`) fresh once
  // per page — this flag must live outside `from()` to actually terminate pagination.
  let employeesPageServed = false

  return {
    from(table: string) {
      const record = (rows: any[]) => { (upserts[table] ??= []).push(...rows) }

      if (table === 'leave_accrual_rules') {
        const chain: any = {
          select: () => chain, eq: () => chain, lte: () => chain, or: () => Promise.resolve({ data: rules, error: null }),
        }
        return chain
      }
      if (table === 'employees') {
        // fetchAllRows: paginates via .range(from, to) until an empty page.
        const chain: any = {
          select: () => chain, eq: () => chain, order: () => chain,
          range: () => {
            if (employeesPageServed) return Promise.resolve({ data: [], error: null })
            employeesPageServed = true
            return Promise.resolve({ data: employees, error: null })
          },
        }
        return chain
      }
      if (table === 'leave_accrual_runs') {
        // Three chained .eq() calls before the idempotency-check SELECT resolves.
        const chain: any = {
          select: () => chain, eq: () => chain,
          then: (resolve: any) => resolve({ data: existingRuns, error: null }),
          upsert: (rows: any) => { record(Array.isArray(rows) ? rows : [rows]); return Promise.resolve({ data: null, error: null }) },
        }
        return chain
      }
      if (table === 'employee_leave_balance') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          then: (resolve: any) => resolve({ data: existingBalances, error: null }),
          upsert: (rows: any[]) => { record(rows); return Promise.resolve({ data: null, error: null }) },
        }
        return chain
      }
      // leave_balance_ledger (insert) / leave_accrual_ledger (upsert)
      const chain: any = {
        insert: (rows: any[]) => { record(rows); return Promise.resolve({ data: null, error: null }) },
        upsert: (rows: any[]) => { record(rows); return Promise.resolve({ data: null, error: null }) },
      }
      return chain
    },
    __upserts: upserts,
  } as any
}

describe('runMonthlyAccrual — DB-string days_per_period (G13 sweep)', () => {
  it('does not throw for a full-month employee when days_per_period is a string (the confirmed crash)', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.50', prorate_on_joining: true,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2025-01-01' }],  // joined well before the period -> "full month" branch
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.errors).toEqual([])
    expect(result.employees_credited).toBe(1)
    expect(result.total_days_credited).toBe(1.5)
    expect(Number.isNaN(result.total_days_credited)).toBe(false)
  })

  it('credits correctly on top of an existing string balance', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.00', prorate_on_joining: true,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2025-01-01' }],
      existingBalances: [{ employee_id: 'emp-1', balance: '19.50' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.errors).toEqual([])
    const balanceUpsert = supabase.__upserts['employee_leave_balance']?.[0]
    expect(balanceUpsert?.balance).toBe(20.5)   // 19.5 + 1.0, not "19.501.00" / NaN
  })

  it('non-prorated rule (prorate_on_joining=false) with string days_per_period does not crash', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-fixed', accrual_frequency: 'monthly',
        days_per_period: '0.75', prorate_on_joining: false,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2020-01-01' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.errors).toEqual([])
    expect(result.total_days_credited).toBe(0.75)
  })

  it('multiple employees with a string days_per_period sum total_days_credited correctly', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.50', prorate_on_joining: true,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [
        { id: 'emp-1', joining_date: '2025-01-01' },
        { id: 'emp-2', joining_date: '2025-01-01' },
        { id: 'emp-3', joining_date: '2025-01-01' },
      ],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(3)
    expect(result.total_days_credited).toBe(4.5)   // 3 x 1.5, not "1.51.51.5" / NaN
  })
})
