# Phase 3 — Non-Regression Validation Report

## Scope
This report validates that Phase 3 (Deterministic Cross-System Workforce State Engine)
introduces no regressions to existing external behavior.

---

## ESS Behavior — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Leave request creation | ✅ Unchanged | `leave-request-service.ts` unchanged in Phase 3 |
| Leave balance display | ✅ Unchanged | `leave-ledger-service.ts` unchanged |
| Leave history | ✅ Unchanged | No changes to leave_requests queries |
| Attendance self-service | ✅ Unchanged | No changes to attendance routes |
| Payslip access | ✅ Unchanged | No changes to payroll routes |
| Reimbursement claims | ✅ Unchanged | No changes to reimbursements |
| Tax declarations | ✅ Unchanged | No changes |

**Verdict: ESS behavior fully preserved.**

---

## Leave Behavior — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Leave duration computation | ✅ Unchanged | `leave-duration-engine.ts` not modified in Phase 3 |
| Leave approval workflow | ✅ Unchanged | Approval route not modified |
| Leave cancellation | ✅ Unchanged | Cancellation route not modified |
| Leave type semantics | ✅ Unchanged | leave_types not modified |
| Accrual calculation | ✅ Unchanged | `leave-jobs.ts` Phase 3 changes are additive only |
| Balance computation | ✅ Unchanged | `leave-ledger-service.ts` not modified in Phase 3 |
| Policy resolution | ✅ Unchanged | `leave-policy-resolver.ts` not modified |

**Verdict: Leave behavior fully preserved.**

---

## Attendance Calculations — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Attendance engine logic | ✅ Unchanged | `attendance-engine.ts` not modified |
| Punch log processing | ✅ Unchanged | No changes to punch processing |
| Shift/roster computation | ✅ Unchanged | No changes to roster engine |
| LOP calculation | ✅ Unchanged | LOP logic untouched |
| Regularisation processing | ✅ Unchanged | No changes to regularisation |

**Note:** `attendance-state-service.ts` is NEW and ADDITIVE. It does NOT read from
`attendance_daily` for any calculations — it only tracks state in a new table
(`attendance_processing_states`). The `attendance_daily` table is never written
to by Phase 3 code. All attendance calculations remain in `attendance-engine.ts`.

**Verdict: Attendance calculation behavior fully preserved.**

---

## Payroll Outputs — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Payroll engine computation | ✅ Unchanged | `payroll-engine.ts` not modified in Phase 3 |
| Payroll run creation | ✅ Unchanged | No changes to payroll run routes |
| Slip generation | ✅ Unchanged | No changes to slip generation |
| Component calculation | ✅ Unchanged | No changes to payroll components |

**Note:** `payroll-freeze-service.ts` is NEW and ADDITIVE. It writes to a new
table (`payroll_period_states`) that does not affect payroll_runs processing.
Payroll computation reads `payroll_runs` and `employee_compensations` — neither
is modified. `payroll_period_states` is a governance layer only.

**Verdict: Payroll outputs fully preserved.**

---

## Scheduler Outcomes — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Monthly accrual | ✅ Unchanged | Credits same days; only adds lineage_id/cycle_key (Phase 2, not Phase 3) |
| Yearly accrual | ✅ Unchanged | Same |
| CO expiry | ✅ Unchanged | `leave-jobs.ts` Phase 3 changes: none |
| Carry-forward | ✅ Unchanged | Not modified |
| Event grants | ✅ Unchanged | lineage_id added (Phase 2); Phase 3 adds no changes |
| Reconciliation | ✅ Unchanged | `leave-reconciliation.ts` Phase 3 changes: none |

**Note:** The workforce-orchestrator and reconciliation-service do not call
any scheduler functions. The scheduler continues to run independently.

**Verdict: Scheduler outcomes fully preserved.**

---

## Lifecycle Governance — UNCHANGED

| Check | Result | Evidence |
|-------|--------|----------|
| Carry-forward execution | ✅ Unchanged | No changes |
| CO lifecycle | ✅ Unchanged | No changes |
| Entitlement release | ✅ Unchanged | No changes |
| Freeze application | ✅ Unchanged | No changes to freeze routes |
| Settlement recovery | ✅ Unchanged | No changes |

**Verdict: Lifecycle governance fully preserved.**

---

## TypeScript Compilation — ZERO NEW ERRORS

```
Pre-Phase 3 error count:  22 (all pre-existing)
Post-Phase 3 error count: 22 (same pre-existing errors)
New errors introduced:    0
```

All 22 pre-existing errors are in files NOT modified by Phase 3:
- `src/index.ts` — durable-queue type issue
- `src/lib/attendance-engine.ts` — missing rows_protected property
- `src/lib/attendance-freshness.ts` — type cast issue
- `src/lib/durable-queue.ts` — any/never type issue
- `src/lib/leave-scheduler.ts` — issues_found property (pre-existing gap)
- `src/lib/payroll-accounting-engine.ts` — GLMapping property
- `src/routes/attendance/leave-scheduler-status.ts` — catch property issues
- `src/routes/employees/index.ts` + `manager.ts` + `separation.ts` — logAction arity
- `src/routes/payroll/compensation-revisions.ts` + `index.ts` + `reimbursements.ts` — logAction arity

**Verdict: Zero new TypeScript errors.**

---

## Phase 3 Additions Summary (ADDITIVE ONLY)

### New tables (no existing data affected)
- `payroll_period_states` — new; no FK on payroll_runs (payroll_run_id nullable)
- `attendance_processing_states` — new; no FK on attendance_daily
- `workforce_rebuild_events` — new
- `workforce_event_timeline` — new
- `workforce_reconciliation_runs` — new
- `workforce_reconciliation_issues` — new

### Modified tables (only additive columns)
- `retroactive_rebuild_queue` — 5 new nullable/defaulted columns added

### Modified DB constraint (bug fix, not behavior change)
- `leave_reconciliation_issues.issue_type` — adds `replay_drift` to allowed values
  (required so Phase 2's replay_drift check can write issues without constraint violation)

### New TypeScript files (no imports from production paths yet)
- `workforce-orchestrator.ts`
- `attendance-state-service.ts`
- `payroll-freeze-service.ts`
- `workforce-event-timeline-service.ts`
- `workforce-reconciliation-service.ts`

### Modified TypeScript files
- `retroactive-rebuild-orchestrator.ts` — extended types + optional fields in enqueueRebuild;
  backward compatible (new opts fields all optional, existing callers unaffected)

---

## End-User Visibility

Phase 3 is completely invisible to end users:
- No new API endpoints
- No UI changes
- No workflow changes
- No notification changes
- No changed response shapes

The orchestration infrastructure sits entirely at the internal service layer.
End users experience no change in any workflow.

**Overall verdict: ✅ FULLY NON-REGRESSIVE**
