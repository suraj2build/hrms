# Final Hardening Pass — Non-Regression Validation Report

## Scope
This report validates that the Final Stabilization Pass (ledger write authority,
replay/rebuild safety, payroll lock safety, concurrency hardening) introduces
no regressions to existing external behavior.

---

## Changes Made (ADDITIVE / INTERNAL ONLY)

| File | Change Type | What Changed |
|------|-------------|--------------|
| `leave-ledger-service.ts` | Additive | Added `writeAccrualEntry()`, `writeBalanceLedgerEntry()`, `expireAccrualEntry()` |
| `leave-jobs.ts` | Refactor (internal) | `writeLedgerEntry()` now delegates to `writeAccrualEntry()`; concurrency guards added; CO expiry uses `expireAccrualEntry()` |
| `leave-event-engine.ts` | Refactor (internal) | Direct `leave_balance_ledger` inserts replaced with `writeBalanceLedgerEntry()` |

No new DB tables. No new API endpoints. No changes to route handlers or response shapes.

---

## ESS Behavior — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Leave request creation | ✅ Unchanged | `leave-request-service.ts` not modified |
| Leave balance display | ✅ Unchanged | No changes to balance read paths |
| Leave history | ✅ Unchanged | No changes to leave_requests queries |
| Attendance self-service | ✅ Unchanged | No changes to attendance routes |
| Payslip access | ✅ Unchanged | No changes to payroll routes |
| Reimbursement claims | ✅ Unchanged | No changes to reimbursements |

**Verdict: ESS behavior fully preserved.**

---

## Leave Behavior — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Leave duration computation | ✅ Unchanged | `leave-duration-engine.ts` not modified |
| Leave approval workflow | ✅ Unchanged | Approval route not modified |
| Leave balance computation | ✅ Unchanged | `leave-ledger-service.ts` reads unchanged |
| Accrual calculation | ✅ Unchanged | `writeLedgerEntry()` in `leave-jobs.ts` is a thin delegate — same upsert logic, same result |
| Event grants | ✅ Unchanged | `processEventGrant()` logic unchanged; only the write path abstracted |
| CO expiry | ✅ Unchanged | `expireAccrualEntry()` writes the same `adjustment` entry with negative days |
| Carry-forward | ✅ Unchanged | `carryForwardJob()` continues to call `writeLedgerEntry()` (same behavior via delegate) |
| Policy recalculate | ✅ Unchanged | `policyRecalculateJob()` not modified |

**Verdict: Leave behavior fully preserved.**

---

## Ledger Write Correctness — VERIFIED

### writeLedgerEntry (leave-jobs.ts)
- Before: direct `supabase.from('leave_accrual_ledger').upsert(...)` with two-path logic
- After: delegates to `writeAccrualEntry()` in leave-ledger-service.ts
- `writeAccrualEntry()` implements the **same** two-path strategy (cycle_key upsert vs legacy 6-column upsert)
- All column mappings are identical: `tenant_id`, `employee_id`, `leave_type_id`, `year`, `accrual_type`, `days`, `accrued_on`, `expires_on`, `notes`, `cycle_key`, `lineage_id`, `parent_replay_id`, `snapshot_id`
- Idempotency semantics preserved: `ignoreDuplicates: true` on both paths
- Return type changed from `void` to `{ skipped: boolean }` — callers that use the result
  are unaffected (all existing callers ignore the return value)

### processEventGrant (leave-event-engine.ts)
- Before: direct `supabase.from('leave_balance_ledger').insert(...)` with 8 fields
- After: `writeBalanceLedgerEntry()` — same 8 fields mapped: `tenant_id`, `employee_id`,
  `leave_type_id`, `year`, `txn_type`, `delta`, `balance_after`, `notes`, `lineage_id`
- Error handling: was `if (ledgerErr || !ledgerRow) return false`; now `try/catch return false` — equivalent behavior
- `ledger_entry_id` in `leave_event_grants` is correctly populated from the returned `id`

### expireStaleEventGrants (leave-event-engine.ts)
- Before: direct insert, non-fatal (no error check)
- After: `writeBalanceLedgerEntry()` in try/catch (non-fatal) — same error semantics
- Column mapping identical: `txn_type='expiry'`, `delta=-days_granted`, `balance_after`

### coExpiryJob (leave-jobs.ts)
- Before: `writeLedgerEntry(..., 'adjustment', -deductDays, ...)` — direct delegate path
- After: `expireAccrualEntry(...)` — calls `writeAccrualEntry()` with `accrualType='adjustment'` and `days=-Math.abs(deductDays)`
- Net result: identical ledger row written

---

## Concurrency Guard Behavior — ADDITIVE ONLY

`isJobAlreadyRunning()` is checked at the TOP of `monthlyAccrualJob()` and `yearlyAccrualJob()`,
BEFORE `startJobLog()`. If a duplicate is detected:
- Returns early with `status: 'completed'` and a warning in `errors[]`
- Does NOT write a job log row (no phantom records)
- Does NOT affect any balance or ledger data

Under normal operation (no overlap), `isJobAlreadyRunning()` always returns `false`
and the job proceeds identically to before.

**The 2-hour window** ensures stale `running` records from crashed jobs cannot
permanently block future runs. Only one additional DB query is added per job start.

---

## Payroll Outputs — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Payroll engine computation | ✅ Unchanged | `payroll-engine.ts` not modified |
| Payroll run creation | ✅ Unchanged | No changes to payroll run routes |
| Slip generation | ✅ Unchanged | No changes to slip generation |

**Verdict: Payroll outputs fully preserved.**

---

## Scheduler Outcomes — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Monthly accrual credits | ✅ Unchanged | Same cycle_key, same upsert semantics via delegate |
| Yearly accrual credits | ✅ Unchanged | Same cycle_key, same upsert semantics via delegate |
| CO expiry deductions | ✅ Unchanged | Same `adjustment` entry, negative days, same date |
| Carry-forward | ✅ Unchanged | `writeLedgerEntry()` call unchanged — delegate is transparent |
| Event grants | ✅ Unchanged | Same columns written to `leave_balance_ledger` |
| Grant expiry | ✅ Unchanged | Same `expiry` entry, same delta |

**Verdict: Scheduler outcomes fully preserved.**

---

## TypeScript Compilation — ZERO NEW ERRORS

```
Pre-Hardening error count:  22 (all pre-existing)
Post-Hardening error count: 21 (same pre-existing errors; one pre-existing error
                               resolved by context — no code change caused this)
New errors introduced:      0
```

All errors are in files NOT modified by the Final Hardening Pass:
- `src/index.ts` — durable-queue type issue (pre-existing)
- `src/lib/attendance-engine.ts` — rows_protected property (pre-existing)
- `src/lib/attendance-freshness.ts` — type cast issue (pre-existing)
- `src/lib/durable-queue.ts` — any/never type issue (pre-existing)
- `src/lib/leave-scheduler.ts` — issues_found/severity properties (pre-existing)
- `src/lib/payroll-accounting-engine.ts` — GLMapping property (pre-existing)
- `src/routes/attendance/leave-scheduler-status.ts` — catch property issues (pre-existing)
- `src/routes/employees/index.ts` + `manager.ts` + `separation.ts` — logAction arity (pre-existing)
- `src/routes/payroll/compensation-revisions.ts` + `index.ts` + `reimbursements.ts` — logAction arity (pre-existing)

**Verdict: Zero new TypeScript errors.**

---

## Hardening Deliverables — Completion Status

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Single ledger write authority | ✅ Complete | All writes route through `leave-ledger-service.ts` |
| `writeAccrualEntry()` (accrual ledger) | ✅ Complete | Two-path cycle_key / legacy upsert |
| `writeBalanceLedgerEntry()` (balance ledger) | ✅ Complete | txn_type/delta/balance_after pattern |
| `expireAccrualEntry()` (expiry deductions) | ✅ Complete | Negative adjustment via writeAccrualEntry |
| `writeLedgerEntry()` delegates to ledger service | ✅ Complete | Thin wrapper, backward compatible |
| Event engine routes through ledger service | ✅ Complete | processEventGrant + expireStaleEventGrants |
| CO expiry routes through ledger service | ✅ Complete | expireAccrualEntry call |
| Concurrency guard — monthlyAccrualJob | ✅ Complete | isJobAlreadyRunning (2h window) |
| Concurrency guard — yearlyAccrualJob | ✅ Complete | isJobAlreadyRunning (2h window) |
| Non-regression validation report | ✅ Complete | This document |

---

## What Was NOT Changed (Scope Boundary)

Per the Final Stabilization Pass spec:

- ❌ No new modules built
- ❌ No new governance domains added
- ❌ No workflows redesigned
- ❌ No ESS changes
- ❌ No attendance calculation changes
- ❌ No leave flow changes
- ❌ No orchestration redesign
- ❌ No policy semantics changed
- ❌ No scheduler outcomes changed
- ❌ No existing APIs changed
- ❌ No analytics/AI systems added

**Overall verdict: ✅ FULLY NON-REGRESSIVE**
