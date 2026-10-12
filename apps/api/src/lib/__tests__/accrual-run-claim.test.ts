/**
 * accrual-engine — DEFECT-02 regression: atomic run claim, not just a
 * pre-check (found during the PR #30 live-screen Attendance/Leave UAT,
 * 2026-10-12, Round 8 follow-up).
 *
 * The old idempotency check was a pre-check SELECT against
 * leave_accrual_runs, with the whole employee-crediting loop below it and a
 * terminal upsert only at the very end. Two genuinely overlapping calls for
 * the same tenant+period+rule (an HR admin double-clicking "Run Accrual", or
 * a manual trigger overlapping a scheduled run) could both pass that
 * pre-check — neither had written the terminal row yet — and proceed to
 * credit employees in parallel: a lost-update race on employee_leave_balance
 * (an absolute SET of a pre-fetched balance + days, not an atomic
 * increment).
 *
 * Fixed with the same claim-before-side-effects pattern already used by
 * comp-off.ts's approval route (SYSCERT_AUDIT_2026-08-02.md H6): an INSERT
 * against leave_accrual_runs' own (tenant_id, run_period, leave_type_id)
 * unique constraint claims the slot; the loser of a genuine race gets a real
 * Postgres 23505 back immediately, before touching a single employee's
 * balance, and reclaims a prior 'partial'/'failed' run (but not 'success' or
 * a live 'running' claim) via a conditional UPDATE.
 *
 * These tests exercise runMonthlyAccrual() end-to-end with a mock that
 * tracks real row state for leave_accrual_runs (not just "always succeeds"),
 * so they depend on the actual claim-then-reclaim logic in
 * claimAccrualRun() — they would fail against the pre-fix plain
 * pre-check-SELECT-then-upsert code, which has no INSERT to race against at
 * all.
 */

import { describe, it, expect } from 'vitest'
import { runMonthlyAccrual } from '../accrual-engine.js'

const TENANT = 'tenant-001'
const RULE = {
  id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
  days_per_period: '1.00', prorate_on_joining: false,
  effective_from: '2026-01-01', effective_to: null,
}
const EMPLOYEES = [{ id: 'emp-1', joining_date: '2020-01-01' }]

/**
 * A mock Supabase client whose leave_accrual_runs table is a real in-memory
 * row store (keyed by tenant+run_period+leave_type), so INSERT can actually
 * conflict and UPDATE can actually be conditional on current status — not a
 * stub that always succeeds regardless of prior state.
 */
function mockSupabase(opts: { existingRun?: { status: string } } = {}) {
  let employeesPageServed = false
  const runsStore = new Map<string, { id: string; status: string }>()
  if (opts.existingRun) {
    runsStore.set('tenant-001|2026-10|lt-earned', { id: 'existing-run-id', status: opts.existingRun.status })
  }
  const insertAttempts: string[] = []

  return {
    from(table: string) {
      if (table === 'leave_accrual_rules') {
        const chain: any = { select: () => chain, eq: () => chain, lte: () => chain, or: () => Promise.resolve({ data: [RULE], error: null }) }
        return chain
      }
      if (table === 'employees') {
        const chain: any = {
          select: () => chain, eq: () => chain, order: () => chain,
          range: () => {
            if (employeesPageServed) return Promise.resolve({ data: [], error: null })
            employeesPageServed = true
            return Promise.resolve({ data: EMPLOYEES, error: null })
          },
        }
        return chain
      }
      if (table === 'leave_accrual_runs') {
        const key = 'tenant-001|2026-10|lt-earned'
        let updateFilter: { status?: string[] } = {}
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: (_col: string, statuses: string[]) => { updateFilter.status = statuses; return chain },
          insert: (row: any) => {
            insertAttempts.push(row.status)
            if (runsStore.has(key)) {
              return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }
            }
            runsStore.set(key, { id: 'new-run-id', status: row.status })
            return { select: () => Promise.resolve({ data: [{ id: 'new-run-id' }], error: null }) }
          },
          update: (patch: any) => {
            const apply = () => {
              const existing = runsStore.get(key)
              if (!existing) return Promise.resolve({ data: [], error: null })
              if (updateFilter.status && !updateFilter.status.includes(existing.status)) {
                return Promise.resolve({ data: [], error: null })
              }
              existing.status = patch.status
              return Promise.resolve({ data: [{ id: existing.id }], error: null })
            }
            const updateChain: any = { eq: () => updateChain, in: (_c: string, s: string[]) => { updateFilter.status = s; return updateChain }, select: apply, then: (r: any) => r(apply()) }
            return updateChain
          },
        }
        return chain
      }
      if (table === 'employee_leave_balance') {
        const chain: any = { select: () => chain, eq: () => chain, then: (resolve: any) => resolve({ data: [], error: null }), upsert: () => Promise.resolve({ data: null, error: null }) }
        return chain
      }
      if (table === 'leave_accrual_ledger') {
        const chain: any = { select: () => chain, eq: () => chain, in: () => Promise.resolve({ data: [], error: null }), insert: () => Promise.resolve({ data: null, error: null }) }
        return chain
      }
      return { insert: () => Promise.resolve({ data: null, error: null }) }
    },
    __runsStore: runsStore,
    __insertAttempts: insertAttempts,
  } as any
}

describe('runMonthlyAccrual — DEFECT-02: atomic run claim', () => {
  it('no prior run: claims and credits normally', async () => {
    const supabase = mockSupabase()
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
    expect(supabase.__runsStore.get('tenant-001|2026-10|lt-earned')?.status).toBe('success')
  })

  it('a prior SUCCESS run blocks a second claim — no re-credit', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'success' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('a prior FAILED run is reclaimable — retry credits normally', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'failed' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
    expect(supabase.__runsStore.get('tenant-001|2026-10|lt-earned')?.status).toBe('success')
  })

  it('a prior PARTIAL run is reclaimable — retry credits normally', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'partial' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('a currently-RUNNING claim (a concurrent request in flight) blocks a second claim — the core race fix', async () => {
    // This is the exact scenario the pre-fix pre-check-SELECT code could not
    // prevent: another call's claim is live ('running', not yet finalized to
    // success/partial/failed). The second call must NOT proceed to credit
    // employees in parallel.
    const supabase = mockSupabase({ existingRun: { status: 'running' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(0)
    expect(result.skipped).toBe(1)
    // Confirms the mock's INSERT was actually attempted and rejected (the
    // real race-safety mechanism), not that the code just happened to skip
    // some other way.
    expect(supabase.__insertAttempts).toContain('running')
  })
})
