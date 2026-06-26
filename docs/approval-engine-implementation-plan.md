# Approval Engine — Implementation Plan (P1 → P3)

_CognixHR HRMS · plan authored 2026-06-26 · companion to `approval-mechanism-audit.md`_

> **Status:** P0 (security/correctness) is **DONE & shipped** (commit `24c0dca`).
> This document is the execution contract for **P1, P2, P3** — the work that makes
> the configurable approval engine actually run. Treat it as the locked design;
> deviations get noted here before coding.

---

## 0. Guiding principles (non-negotiable)

1. **Backward-compatible by default.** A tenant with **no chain configured** must
   behave **byte-for-byte** like today: single-step, manager-or-HR, immediate
   finalize. The engine only engages when an admin has configured ≥1 level.
2. **One engine, one runtime.** The `053` engine (`workflow-service` +
   `approval_workflow_config` / `approval_instances` / `approval_actions`) is the
   **single source of truth**. The `089` governance layer (matrices / delegations /
   overrides) becomes a **capability feed** into that engine — never a second runtime.
3. **Money/balance paths stay hardened.** Leave balance deduction, comp-off accrual,
   payroll writes keep their existing atomic RPCs. The engine **gates** finalization;
   it never reimplements it.
4. **Every commit is `tsc`-green and shippable.** No half-wired states left on `main`.
   Each slice is independently revertable.
5. **No `Emvora`, no raw Tailwind palette, gate on `tenants.status`** — existing repo rules hold.

---

## 1. Current state (verified in code, 2026-06-26)

### The three subsystems
| Engine | Files | State |
|---|---|---|
| **A — live ad-hoc** | `lib/approval-service.ts`, ~30 `/:id/approve` routes | ✅ runs, single-step |
| **B — 053 generic** | `lib/workflow-service.ts`, `routes/approvals/workflows.ts`, `053_*.sql` | ⚠️ built, **0 callers** |
| **C — 089 governance** | `routes/approvals/governance-evolution.ts`, `089_*.sql` | ⚠️ CRUD-only |

### 053 schema (what we build on)
- **`approval_workflow_config`** — `(tenant_id, workflow_type, level)` unique. Columns:
  `workflow_type` ∈ `{leave, correction, regularisation}`, `level` ≥1,
  `approver_type` ∈ `{direct_manager, hr_admin, super_admin, specific_role}`,
  `specific_role`, `label`, `auto_approve_after_hours`, `is_active`.
- **`approval_instances`** — `(tenant_id, entity_type, entity_id)` unique. Columns:
  `entity_type` ∈ `{leave_request, attendance_correction, attendance_regularisation}`,
  `submitted_by` (FK profiles, **NOT NULL**), `total_levels`, `current_level`,
  `final_approved` (null=open / true / false), `closed_at`.
- **`approval_actions`** — `instance_id`, `level`, `action` ∈
  `{approved, rejected, escalated, auto_approved}`, `actor_id`, `comments`, `acted_at`.

### 053 service API (reuse, don't reinvent)
- `createWorkflowInstance(sb, tenant, workflowType, entityType, entityId, submittedBy)`
- `processWorkflowAction(sb, tenant, instanceId, actorId, action, comments?)` — has a
  **generic** actor gate (role ∈ manager/HR + no-self); **not** per-level. We add per-level.
- `getWorkflowInstance`, `getPendingWorkflowInstances`, `getWorkflowConfig`.

### Entity submit / approve / reject map (live paths)
| Entity | Submit | Approve | Reject | Workflow type |
|---|---|---|---|---|
| Leave | `attendance/leave-requests.ts:50` | `:279` → `approveLeaveRequest` | `:357` → `rejectLeaveRequest` | `leave` |
| Regularisation | `attendance/regularisation.ts:80` | `:523` → `approveRegularisation` | `:652` → `rejectRegularisation` | `regularisation` |
| Overtime | `attendance/overtime.ts:416` | `:469` → `approveOtRequest` | `:508` → `rejectOtRequest` | `overtime`* |
| Comp-off | `attendance/comp-off.ts:99` | `:236` (inline) | `:404` (inline) | `comp_off`* |
| Reimbursement | `payroll/reimbursements.ts:78/199` | `:557` (HR) | `:620` (HR) | `reimbursement`* |
| Loan | `payroll/loans.ts:56` | `:104` (HR) | `:131` (HR) | `loan`* |
| Advance | `payroll/advances.ts:69` | `:123` (HR) | `:184` (HR) | `advance`* |

`*` = workflow_type / entity_type **not yet in the 053 CHECK enums** → needs migration to extend (P1.3 / P2).

---

## 2. The integration design (the core idea)

A small **orchestrator** (`lib/approval-orchestrator.ts`) sits in front of each live
finalize. It answers one question per action: **"finalize now, advance a level, or reject?"**

```
approve handler
   │
   ├─ fetch entity + status pre-check          (unchanged)
   │
   ├─ gateApprove(entity, actor, target)  ─────────────────────┐
   │     • no config for this workflow_type → FINALIZE(legacy)  │  orchestrator
   │     • config + not final level        → ADVANCED           │  (new)
   │     • config + final level            → FINALIZE(authed)   │
   │     • actor fails per-level gate       → ERROR             │
   │                                                            ┘
   ├─ ADVANCED  → record approval_action(approved), bump        (entity stays PENDING)
   │              current_level, audit, return success
   │
   └─ FINALIZE  → run existing atomic RPC (balance deduct etc.)
                  • legacy   → still run validateApprover (manager|HR)
                  • authed   → skip legacy gate (per-level already authorized)
```

### `gateApprove` / `gateReject` contract
```ts
type GateDecision =
  | { kind: 'finalize'; authorized: boolean }              // run the real finalize
  | { kind: 'advanced'; level: number; nextLevel: number; totalLevels: number }
  | { kind: 'error'; error: { type: string; message: string } }
```
- `authorized:false` ⇢ **legacy path** — caller still runs its existing `validateApprover`.
- `authorized:true`  ⇢ per-level gate already authorized; caller **skips** legacy gate.
- **Reject always finalizes** (any level can reject → entity REJECTED), but still records
  the action + closes the instance when a chain exists.

### Per-level approver resolution (P1.2)
For the config row at `instance.current_level`:
| `approver_type` | passes when |
|---|---|
| `direct_manager` | actor's `employee_id` == target employee's `manager_id` |
| `hr_admin` | actor role ∈ `{hr_admin, super_admin}` |
| `super_admin` | actor role == `super_admin` |
| `specific_role` | actor role == `specific_role` value |
Plus: **always block self-approval** (actor employee == target employee).
Plus (**P2**): if a valid **delegation** routes the level's approver to the actor, pass.

### Lazy get-or-create
Instance is created on the **first approval action**, not at submit — so in-flight
requests created before this ships still work, and we don't touch 7 submit handlers.
`submitted_by` resolved from `profiles.employee_id == target employee` (NOT NULL col);
fall back handled explicitly. Re-entry safe via the `(tenant,entity_type,entity_id)`
unique index (create → 23505 → re-fetch).

---

## 3. Phases & slices (each = one commit, `tsc`-green)

### P1 — make ONE engine real

| # | Slice | Files | Migration? | Risk |
|---|---|---|---|---|
| **1.1** | Orchestrator module + wire **leave** approve/reject | `lib/approval-orchestrator.ts` (new), `lib/approval-service.ts`, `routes/attendance/leave-requests.ts` | none | med |
| **1.2** | Per-level approver resolution (the gate) — folded into 1.1's orchestrator | `lib/approval-orchestrator.ts` | none | med |
| **1.3** | Wire **regularisation** approve/reject | `approval-service.ts`, `routes/attendance/regularisation.ts` | none | med |
| **1.4** | Extend engine enums to **overtime + comp_off**; wire both | `053`-extending migration, `overtime.ts`, `comp-off.ts`, `workflow-service.ts` types | **yes** (relax CHECK) | med |
| **1.5** | Pending-instance read API surfaces level/stage for inboxes | `routes/approvals/workflows.ts`, join entity rows | none | low |
| **1.6** | Reconcile config UIs: `ApprovalWorkflows` = runtime driver; `GovernanceMatrix` → advisory/read + "this is now informational" banner; cross-link | web `settings/ApprovalWorkflows.tsx`, `approvals/GovernanceMatrix.tsx` | none | low |

**P1 exit criteria:** an admin can configure Leave = `[L1 direct_manager → L2 hr_admin]`,
and a leave request then **requires both** approvals in order, with each recorded in
`approval_actions`, balance deducted only at final approval, and **zero behavior change**
for tenants with no config.

### P2 — capabilities (build on the live engine)

| # | Slice | Migration? |
|---|---|---|
| **2.1** | **Delegation enforcement** — gate consults active `approval_delegations`; self-service "delegate my approvals" in inbox | maybe (read existing 089) |
| **2.2** | **SLA escalation + auto-approve job** — extend `sla-scanner` to re-route to `escalation_employee_id` and honor `auto_approve_after_hours` (writes `auto_approved` action) | none (cols exist) |
| **2.3** | **Threshold/amount routing** — reimbursement/loan/requisition consult `payroll_threshold` / matrix stages to inject a finance level by amount | enum extend |
| **2.4** | **Payroll maker-checker** (preparer ≠ approver) + **offer salary sign-off** chains | new chains |

### P3 — UX

| # | Slice |
|---|---|
| **3.1** | **Unified approval inbox** — one queue across entity types; retire duplicate regularisation screens |
| **3.2** | **Chain/stage stepper everywhere** — reuse loans `WorkflowTracker` for managers (current stage) + employees (who/where) |
| **3.3** | **Aggregate pending badge** across all entity types; SLA/age cues on every queue |
| **3.4** | **Mobile approvals** — fold engine into mobile ESS Approvals/Team |

---

## 4. Migrations (anticipated)

| # | Purpose | When |
|---|---|---|
| `313_*` | Extend `approval_workflow_config.workflow_type` + `approval_instances.entity_type` CHECK enums to include `overtime`, `comp_off` | P1.4 |
| `314_*` | (if needed) threshold/finance enum extension `{reimbursement, loan, requisition, payroll_run}` | P2.3 |

> Migrations are **append-only & idempotent** (`IF NOT EXISTS`, `DROP CONSTRAINT … ADD CONSTRAINT`).
> User runs them manually in Supabase; each slice's PR/commit names the exact migration to run.

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Breaking the hardened leave-balance path | Engine **gates**, never reimplements; legacy path runs unchanged when no config; final-level finalize calls the same RPC |
| Double-create races on instance | `(tenant,entity_type,entity_id)` unique + create→23505→refetch |
| An admin configures a chain whose final approver can't be resolved (e.g. employee with no manager) | Per-level gate returns structured FORBIDDEN; request stays PENDING (safe — never auto-approves) |
| Two config UIs drift again | P1.6 makes `GovernanceMatrix` explicitly advisory; only `ApprovalWorkflows` writes runtime config |
| In-flight requests at deploy time | Lazy get-or-create means they enter the engine on next action; no backfill needed |

---

## 6. Out of scope (explicitly)

- Parallel/quorum approvers (sequential-only for now).
- Rewriting the `089` governance tables (kept; repurposed as advisory + delegation/override source).
- Cross-tenant / owner-portal approval (separate product).
- AI Assistant (Phase 5) — **after** this track, as agreed.

---

## 7. Progress log

| Date | Slice | Commit | Notes |
|---|---|---|---|
| 2026-06-26 | P0 security | `24c0dca` | 6 verified bugs closed (pre-joinee guard, bulk-leave via service, comp self-approve, OT/comp-off reject reason, counts fix) |
| — | P1.1 | _pending_ | orchestrator + leave |
