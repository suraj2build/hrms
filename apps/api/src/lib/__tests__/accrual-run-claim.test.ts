/**
 * accrual-engine — DEFECT-02 regression: atomic run claim, not just a
 * pre-check (found during the PR #30 live-screen Attendance/Leave UAT,
 * 2026-10-12, Round 8 follow-up), PLUS SYSTEM_AUDIT_2026-10-14 item 1's
 * stale-'running'-claim reclaim (migration 459).
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
 * a genuinely LIVE 'running' claim) via a conditional UPDATE.
 *
 * Migration 459 additionally made a STALE 'running' claim (one whose ran_at
 * is older than the caller's threshold — i.e. a process that claimed the
 * run and then crashed before finalizing it) reclaimable too, now that
 * crediting itself (credit_monthly_accrual_batch) is idempotent per
 * employee. A FRESH 'running' claim (ran_at recent — someone else's run is
 * genuinely in flight right now) must still block, same as before.
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
const RUN_KEY = 'tenant-001|2026-10|lt-earned'
const RULE = {
  id: 'rule-1', leave_type_id: 'lt-earned', accrual_frequency: 'monthly',
  days_per_period: '1.00', prorate_on_joining: false,
  effective_from: '2026-01-01', effective_to: null,
}
const EMPLOYEES = [{ id: 'emp-1', joining_date: '2020-01-01' }]

/**
 * A mock Supabase client whose leave_accrual_runs table is a real in-memory
 * row store (keyed by tenant+run_period+leave_type), so INSERT can actually
 * conflict and UPDATE can actually be conditional on current status/ran_at —
 * not a stub that always succeeds regardless of prior state. The crediting
 * side effect is now a single `credit_monthly_accrual_batch` RPC call
 * (migration 459) rather than direct table writes.
 */
function mockSupabase(opts: { existingRun?: { status: string; ranAt?: string } } = {}) {
  let employeesPageServed = false
  const runsStore = new Map<string, { id: string; status: string; ran_at: string }>()
  if (opts.existingRun) {
    runsStore.set(RUN_KEY, {
      id: 'existing-run-id',
      status: opts.existingRun.status,
      ran_at: opts.existingRun.ranAt ?? new Date().toISOString(),
    })
  }
  const insertAttempts: string[] = []
  let rpcCalls = 0

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
        const key = RUN_KEY
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          insert: (row: any) => {
            insertAttempts.push(row.status)
            if (runsStore.has(key)) {
              return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }
            }
            runsStore.set(key, { id: 'new-run-id', status: row.status, ran_at: row.ran_at })
            return { select: () => Promise.resolve({ data: [{ id: 'new-run-id' }], error: null }) }
          },
          update: (patch: any) => {
            const filters: Array<(r: { id: string; status: string; ran_at: string }) => boolean> = []
            const applyUpdate = () => {
              const existing = runsStore.get(key)
              if (!existing) return Promise.resolve({ data: [], error: null })
              if (!filters.every((f) => f(existing))) return Promise.resolve({ data: [], error: null })
              Object.assign(existing, patch)
              return Promise.resolve({ data: [{ id: existing.id }], error: null })
            }
            const updateChain: any = {
              eq: (col: string, val: any) => {
                if (col === 'status') filters.push((r) => r.status === val)
                if (col === 'id') filters.push((r) => r.id === val)
                return updateChain
              },
              in: (col: string, vals: string[]) => {
                if (col === 'status') filters.push((r) => vals.includes(r.status))
                return updateChain
              },
              lt: (col: string, val: string) => {
                filters.push((r) => r.ran_at < val)
                return updateChain
              },
              select: () => applyUpdate(),
              then: (resolve: any, reject?: any) => applyUpdate().then(resolve, reject),
            }
            return updateChain
          },
        }
        return chain
      }
      return { insert: () => Promise.resolve({ data: null, error: null }) }
    },
    rpc(fnName: string, params: any) {
      if (fnName === 'credit_monthly_accrual_batch') {
        rpcCalls++
        const chunk = (params.p_employee_days ?? []) as Array<{ employee_id: string; days: number }>
        const total = chunk.reduce((s, r) => s + r.days, 0)
        return Promise.resolve({ data: [{ employees_credited: chunk.length, total_days: total }], error: null })
      }
      return Promise.resolve({ data: null, error: new Error(`unexpected rpc ${fnName}`) })
    },
    __runsStore: runsStore,
    __insertAttempts: insertAttempts,
    __rpcCalls: () => rpcCalls,
  } as any
}

describe('runMonthlyAccrual — DEFECT-02: atomic run claim', () => {
  it('no prior run: claims and credits normally', async () => {
    const supabase = mockSupabase()
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
    expect(supabase.__runsStore.get(RUN_KEY)?.status).toBe('success')
    expect(supabase.__rpcCalls()).toBe(1)
  })

  it('a prior SUCCESS run blocks a second claim — no re-credit', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'success' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(0)
    expect(result.skipped).toBe(1)
    expect(supabase.__rpcCalls()).toBe(0)
  })

  it('a prior FAILED run is reclaimable — retry credits normally', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'failed' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
    expect(supabase.__runsStore.get(RUN_KEY)?.status).toBe('success')
  })

  it('a prior PARTIAL run is reclaimable — retry credits normally', async () => {
    const supabase = mockSupabase({ existingRun: { status: 'partial' } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('a currently-RUNNING claim with a FRESH ran_at (a concurrent request genuinely in flight) blocks a second claim', async () => {
    // This is the exact scenario the pre-fix pre-check-SELECT code could not
    // prevent: another call's claim is live ('running', ran_at just now —
    // not stale). The second call must NOT proceed to credit employees in
    // parallel, and must NOT treat this as a crashed/stale claim either.
    const supabase = mockSupabase({ existingRun: { status: 'running', ranAt: new Date().toISOString() } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(0)
    expect(result.skipped).toBe(1)
    expect(supabase.__rpcCalls()).toBe(0)
    // Confirms the mock's INSERT was actually attempted and rejected (the
    // real race-safety mechanism), not that the code just happened to skip
    // some other way.
    expect(supabase.__insertAttempts).toContain('running')
  })

  it('a currently-RUNNING claim with a STALE ran_at (a crashed process that never finalized) is reclaimed and retried — migration 459', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const supabase = mockSupabase({ existingRun: { status: 'running', ranAt: twoHoursAgo } })
    const result = await runMonthlyAccrual(supabase, TENANT, 2026, 10)

    expect(result.employees_credited).toBe(1)
    expect(result.skipped).toBe(0)
    expect(supabase.__runsStore.get(RUN_KEY)?.status).toBe('success')
  })
})
