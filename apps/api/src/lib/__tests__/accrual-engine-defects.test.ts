/**
 * accrual-engine — regression tests for two defects found during the PR #30
 * live-screen Attendance/Leave UAT (2026-10-12):
 *
 * DEFECT-01: the active-rules query compared `effective_from` against the
 * period's FIRST day (`periodDate`), which wrongly excluded any accrual
 * rule created mid-period for that same period — the ordinary case right
 * after an HR admin sets one up and runs that month's accrual immediately.
 * Fixed by comparing against the period's LAST day (`periodEndDate`)
 * instead, matching the standard interval-overlap check.
 *
 * DEFECT-02: the `leave_accrual_ledger` write used `.upsert(rows, {
 * onConflict: 'tenant_id,employee_id,leave_type_id,year,accrual_type,
 * accrued_on' })` against `uidx_accrual_ledger_idempotency`, which is a
 * PARTIAL unique index — Postgres can only honor ON CONFLICT against a
 * partial index when the statement repeats its WHERE predicate, which
 * PostgREST's upsert() has no way to express, so the write failed outright
 * on any re-run. Originally fixed with a client-side pre-check (a SELECT of
 * which employee_id keys already had a ledger row, then an INSERT of only
 * the rest). SYSTEM_AUDIT_2026-10-14 item 1 / migration 459 superseded that
 * client-side pre-check with the same idempotency check done INSIDE the
 * atomic SQL batch function (credit_monthly_accrual_batch), in the same
 * statement that writes the ledger — the real ON CONFLICT target the
 * partial index needed all along, which raw SQL inside a function can
 * express but a PostgREST client call never could. These tests now
 * simulate that function via the mock's `rpc()` method instead of
 * `leave_accrual_ledger`'s own `.select()/.in()/.upsert()` chain.
 */

import { describe, it, expect } from 'vitest'
import { runMonthlyAccrual } from '../accrual-engine.js'

const TENANT = 'tenant-001'

/**
 * Builds a mock Supabase client covering every table runMonthlyAccrual
 * touches. Unlike the simpler G13-sweep mock, this one actually simulates
 * Postgres filtering on `leave_accrual_rules` (`.lte('effective_from', ...)`)
 * and real ON-CONFLICT-against-a-partial-index failure semantics on
 * `leave_accrual_ledger`, since both defects are invisible to a mock that
 * always just returns whatever rows the test handed it.
 */
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
  existingLedgerRows?: Array<{ employee_id: string }>
}) {
  const { rules, employees, existingLedgerRows = [] } = opts
  const upserts: Record<string, any[]> = {}
  const inserts: Record<string, any[]> = {}
  const calls: Record<string, any[]> = {}
  let employeesPageServed = false

  const record = (bucket: Record<string, any[]>, table: string, rows: any[]) => {
    (bucket[table] ??= []).push(...rows)
  }

  return {
    from(table: string) {
      if (table === 'leave_accrual_rules') {
        let ltEffectiveFrom: string | undefined
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          lte: (_col: string, val: string) => { ltEffectiveFrom = val; return chain },
          or: () => {
            (calls['leave_accrual_rules.lte'] ??= []).push(ltEffectiveFrom)
            // Real Postgres semantics: only rules effective on/before the
            // compared date are returned.
            const filtered = rules.filter((r) => r.effective_from <= (ltEffectiveFrom ?? '9999-12-31'))
            return Promise.resolve({ data: filtered, error: null })
          },
        }
        return chain
      }
      if (table === 'employees') {
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
        // DEFECT-02 fix: atomic claim via INSERT — no prior run exists in
        // any of these tests, so the insert always succeeds.
        const chain: any = {
          select: () => chain, eq: () => chain, update: () => chain, in: () => chain,
          insert: (row: any) => {
            record(upserts, table, [row])
            return { select: () => Promise.resolve({ data: [{ id: `claim-${row.leave_type_id}` }], error: null }) }
          },
        }
        return chain
      }
      if (table === 'employee_leave_balance') {
        const chain: any = {
          select: () => chain, eq: () => chain,
          then: (resolve: any) => resolve({ data: [], error: null }),
          upsert: (rows: any[]) => { record(upserts, table, rows); return Promise.resolve({ data: null, error: null }) },
        }
        return chain
      }
      if (table === 'leave_balance_ledger') {
        const chain: any = {
          insert: (rows: any[]) => { record(inserts, table, rows); return Promise.resolve({ data: null, error: null }) },
        }
        return chain
      }
      if (table === 'leave_accrual_ledger') {
        // Simulates the real pre-check-then-insert path: a SELECT filtered
        // by .in('employee_id', ...), followed by an INSERT of only the
        // rows not already present. A plain upsert() here (the pre-fix
        // code) would instead be exercised via `.upsert`, which this mock
        // makes fail — matching Postgres's real "no unique or exclusion
        // constraint matching the ON CONFLICT specification" error against
        // the partial index.
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: (_col: string, ids: string[]) => {
            (calls['leave_accrual_ledger.select.in'] ??= []).push(ids)
            const existing = existingLedgerRows.filter((r) => ids.includes(r.employee_id))
            return Promise.resolve({ data: existing, error: null })
          },
          insert: (rows: any[]) => { record(inserts, table, rows); return Promise.resolve({ data: null, error: null }) },
          upsert: () => Promise.resolve({
            data: null,
            error: { message: 'no unique or exclusion constraint matching the ON CONFLICT specification' },
          }),
        }
        return chain
      }
      throw new Error(`mockSupabase: unexpected table "${table}"`)
    },
    // Simulates credit_monthly_accrual_batch (migration 459): the real
    // idempotency check (skip any employee_id already ledgered for this
    // exact run) now happens inside this one atomic call, not via a
    // separate client-side SELECT against leave_accrual_ledger.
    rpc(fnName: string, params: any) {
      if (fnName !== 'credit_monthly_accrual_batch') {
        return Promise.resolve({ data: null, error: { message: `mockSupabase: unexpected rpc "${fnName}"` } })
      }
      (calls['rpc.credit_monthly_accrual_batch'] ??= []).push(params)
      const alreadyCredited = new Set(existingLedgerRows.map((r) => r.employee_id))
      const chunk = (params.p_employee_days ?? []) as Array<{ employee_id: string; days: number }>
      const todo = chunk.filter((r) => !alreadyCredited.has(r.employee_id))

      record(upserts, 'employee_leave_balance', todo.map((r) => ({
        tenant_id: params.p_tenant_id, employee_id: r.employee_id, leave_type_id: params.p_leave_type_id,
        year: params.p_year, balance: r.days,
      })))
      record(inserts, 'leave_balance_ledger', todo.map((r) => ({
        tenant_id: params.p_tenant_id, employee_id: r.employee_id, leave_type_id: params.p_leave_type_id,
        year: params.p_year, txn_type: 'accrual', delta: r.days, balance_after: r.days,
      })))
      record(inserts, 'leave_accrual_ledger', todo.map((r) => ({
        tenant_id: params.p_tenant_id, employee_id: r.employee_id, leave_type_id: params.p_leave_type_id,
        year: params.p_year, accrual_type: 'monthly', days: r.days,
      })))

      const totalDays = todo.reduce((s, r) => s + r.days, 0)
      return Promise.resolve({ data: [{ employees_credited: todo.length, total_days: totalDays }], error: null })
    },
    __upserts: upserts,
    __inserts: inserts,
    __calls: calls,
  } as any
}

describe('runMonthlyAccrual — DEFECT-01: mid-period rule effective_from', () => {
  it('includes a rule whose effective_from falls inside the period being run (not just before it)', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        // Created on the 15th of the SAME month the accrual is being run for —
        // after periodDate (the 1st) but before periodEndDate (the 31st).
        days_per_period: '1.00', prorate_on_joining: false,
        effective_from: '2026-10-15', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2020-01-01' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(supabase.__calls['leave_accrual_rules.lte']).toEqual(['2026-10-31'])
    expect(result.errors).toEqual([])
    expect(result.employees_credited).toBe(1)
    expect(result.total_days_credited).toBe(1)
  })

  it('still excludes a rule that only becomes effective next period', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.00', prorate_on_joining: false,
        effective_from: '2026-11-01', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2020-01-01' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(0)
    expect(result.total_days_credited).toBe(0)
  })
})

describe('runMonthlyAccrual — DEFECT-02: leave_accrual_ledger write against a partial unique index', () => {
  it('writes the ledger row via the atomic batch RPC, not a plain client-side upsert (which fails against the partial index)', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.00', prorate_on_joining: false,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [{ id: 'emp-1', joining_date: '2020-01-01' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.errors).toEqual([])
    expect(supabase.__calls['rpc.credit_monthly_accrual_batch']).toBeDefined()
    expect(supabase.__inserts['leave_accrual_ledger']).toHaveLength(1)
    expect(supabase.__inserts['leave_accrual_ledger'][0]).toMatchObject({ employee_id: 'emp-1', days: 1 })
  })

  it('does not re-insert (and does not error) for an employee already credited this period — idempotent re-run', async () => {
    const supabase = mockSupabase({
      rules: [{
        id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
        days_per_period: '1.00', prorate_on_joining: false,
        effective_from: '2026-01-01', effective_to: null,
      }],
      employees: [
        { id: 'emp-already-credited', joining_date: '2020-01-01' },
        { id: 'emp-new', joining_date: '2020-01-01' },
      ],
      // emp-already-credited has a ledger row for this exact period already
      existingLedgerRows: [{ employee_id: 'emp-already-credited' }],
    })

    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.errors).toEqual([])
    const ledgerInserts = supabase.__inserts['leave_accrual_ledger']
    expect(ledgerInserts).toHaveLength(1)
    expect(ledgerInserts[0].employee_id).toBe('emp-new')
  })
})
