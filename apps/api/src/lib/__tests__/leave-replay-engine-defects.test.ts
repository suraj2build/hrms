/**
 * leave-replay-engine — DEFECT-11 regression (found during the PR #30
 * live-screen Attendance/Leave UAT, 2026-10-12).
 *
 * accrual-engine.ts's runMonthlyAccrual() and processCarryForward() each
 * write TWO rows for the exact same credit event: one to
 * leave_accrual_ledger (accrual_type 'monthly' / 'carry_forward' — the sole
 * source recompute_leave_balance() sums into the authoritative
 * employee_leave_balance cache) and a mirrored row to leave_balance_ledger
 * (txn_type 'accrual' / 'carry_forward', same employee/type/year/days) for
 * the employee-facing ledger-history screen
 * (GET /leave/accrual/ledger/:employeeId reads leave_balance_ledger alone).
 *
 * replayBalanceAsOf() read both tables and summed every row from each as if
 * they were independent, non-overlapping events — so a single real accrual
 * grant was counted twice in the reconstructed balance. Confirmed with live
 * data: an employee whose only real credit was 1.0 day (correctly
 * balance=1.0 in the cache) reconstructed to 2.0 in the replay.
 *
 * Fixed by excluding leave_balance_ledger rows with txn_type IN
 * ('accrual','carry_forward') from the replay — those are the only two
 * txn_types confirmed (by reading every leave_balance_ledger write site) to
 * mirror a leave_accrual_ledger row for the same event. Every other
 * txn_type (manual_credit, deduction, encashment, expiry, opening_balance,
 * event_grant, reversal, payroll_adjustment, correction, lop_recovery) has
 * no accrual_ledger mirror and must stay counted, or the replay would start
 * omitting real events instead.
 */

import { describe, it, expect } from 'vitest'
import { replayBalanceAsOf, validateReconstructedVsStored } from '../leave-replay-engine.js'

const TENANT = 'tenant-001'
const EMP = 'emp-1'
const LEAVE_TYPE = 'lt-casual'

/**
 * Mock Supabase client whose leave_accrual_ledger / leave_balance_ledger
 * chains actually apply `.eq()` and `.not('col','in',...)` filters against
 * the seeded rows, the way real PostgREST would — not a stub that just
 * returns whatever rows were handed to it regardless of the query. This is
 * what makes the test able to fail against the pre-fix code (which issued
 * no such filter at all) instead of passing unconditionally.
 */
function mockSupabase(opts: {
  accrualRows: Array<{ id: string; days: number; accrual_type: string; accrued_on: string; is_expired?: boolean }>
  balanceRows: Array<{ id: string; delta: number; txn_type: string; created_at: string }>
  storedBalance?: number
}) {
  const { accrualRows, balanceRows, storedBalance } = opts

  return {
    from(table: string) {
      if (table === 'leave_accrual_ledger') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          lte: (_col: string, val: string) => {
            chain.__filtered = accrualRows.filter((r) => r.accrued_on <= val)
            return chain
          },
          order: () => chain,
          then: (resolve: any) => resolve({ data: chain.__filtered ?? accrualRows, error: null }),
        }
        return chain
      }
      if (table === 'leave_balance_ledger') {
        let rows = balanceRows
        const chain: any = {
          select: () => chain, eq: () => chain,
          not: (col: string, op: string, val: string) => {
            if (col === 'txn_type' && op === 'in') {
              const excluded = new Set(val.replace(/^\(/, '').replace(/\)$/, '').split(','))
              rows = rows.filter((r) => !excluded.has(r.txn_type))
            }
            return chain
          },
          order: () => chain,
          then: (resolve: any) => resolve({ data: rows, error: null }),
        }
        return chain
      }
      if (table === 'employee_leave_balance') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: storedBalance != null ? { balance: storedBalance } : null, error: null }),
        }
        return chain
      }
      throw new Error(`mockSupabase: unexpected table "${table}"`)
    },
  } as any
}

describe('replayBalanceAsOf — DEFECT-11: no double-counting of mirrored accrual rows', () => {
  it('does not double-count a monthly accrual mirrored into both ledger tables', async () => {
    const supabase = mockSupabase({
      accrualRows: [
        { id: 'al-1', days: 1.0, accrual_type: 'monthly', accrued_on: '2026-10-31' },
      ],
      balanceRows: [
        // Mirror of the same grant — same employee/type/days, written by the
        // same runMonthlyAccrual() call, for the ledger-history screen.
        { id: 'bl-1', delta: 1.0, txn_type: 'accrual', created_at: '2026-10-12T10:00:00Z' },
      ],
    })

    const result = await replayBalanceAsOf(supabase, TENANT, EMP, LEAVE_TYPE, '2026-10-31')

    expect(result.reconstructed_balance).toBe(1.0)
    expect(result.total_credited).toBe(1.0)
  })

  it('does not double-count a carry-forward mirrored into both ledger tables', async () => {
    const supabase = mockSupabase({
      accrualRows: [
        { id: 'al-1', days: 5.0, accrual_type: 'carry_forward', accrued_on: '2027-01-01' },
      ],
      balanceRows: [
        { id: 'bl-1', delta: 5.0, txn_type: 'carry_forward', created_at: '2027-01-01T00:00:00Z' },
      ],
    })

    const result = await replayBalanceAsOf(supabase, TENANT, EMP, LEAVE_TYPE, '2027-01-01')

    expect(result.reconstructed_balance).toBe(5.0)
  })

  it('still counts leave_balance_ledger entry types that have no accrual_ledger mirror', async () => {
    const supabase = mockSupabase({
      accrualRows: [
        { id: 'al-1', days: 10.0, accrual_type: 'yearly', accrued_on: '2026-01-01' },
      ],
      balanceRows: [
        // A manual credit recorded only in leave_balance_ledger — no
        // leave_accrual_ledger row backs it, so it must NOT be excluded.
        { id: 'bl-1', delta: 2.0, txn_type: 'manual_credit', created_at: '2026-03-01T00:00:00Z' },
        // An encashment debit, likewise balance_ledger-only here.
        { id: 'bl-2', delta: -1.0, txn_type: 'encashment', created_at: '2026-04-01T00:00:00Z' },
      ],
    })

    const result = await replayBalanceAsOf(supabase, TENANT, EMP, LEAVE_TYPE, '2026-12-31')

    // 10 (yearly) + 2 (manual_credit) - 1 (encashment) = 11
    expect(result.reconstructed_balance).toBe(11.0)
    expect(result.event_count).toBe(3)
  })

  it('validateReconstructedVsStored reports no drift once the mirror is excluded', async () => {
    const supabase = mockSupabase({
      accrualRows: [
        { id: 'al-1', days: 1.0, accrual_type: 'monthly', accrued_on: '2026-10-31' },
      ],
      balanceRows: [
        { id: 'bl-1', delta: 1.0, txn_type: 'accrual', created_at: '2026-10-12T10:00:00Z' },
      ],
      storedBalance: 1.0,
    })

    const result = await validateReconstructedVsStored(supabase, TENANT, EMP, LEAVE_TYPE, 2026, '2026-10-31')

    expect(result.is_drifted).toBe(false)
    expect(result.reconstructed_balance).toBe(1.0)
    expect(result.stored_balance).toBe(1.0)
    expect(result.drift).toBe(0)
  })
})
