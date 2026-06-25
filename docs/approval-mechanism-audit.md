# Approval Mechanism — End-to-End Audit, Gaps & Plan of Action

_CognixHR HRMS · audited 2026-06-25 · scope: `apps/api`, `apps/web`, `supabase/migrations`_

## Executive summary

CognixHR ships the **database schema and admin UI of a sophisticated, configurable,
multi-level, delegated, SLA-escalating approval engine** — but the **runtime that
enforces it is largely orphaned**. What actually runs in production is **single-step,
hardcoded-per-entity, HR-admin-centric** approval, with self-approval guards and SLA
*alerting* (not escalation).

There are **three disconnected "approval" subsystems** plus ~30 hand-rolled
`/:id/approve` routes. Two of the three engines are effectively dead code. Two admin
config screens exist that **do not gate** the endpoints the manager UIs actually call.

This audit also surfaced **two real security/correctness bugs** (verified in code), not
just architectural drift.

---

## 1. The three subsystems (and which one is real)

| Subsystem | Files | Status |
|---|---|---|
| **(A) Live ad-hoc path** — what runs | `lib/approval-service.ts` (leave + regularisation), ~30 per-entity `/:id/approve` routes | ✅ **Live**, single-step |
| **(B) Generic multi-level engine** | `lib/workflow-service.ts`, `routes/approvals/workflows.ts`, `053_approval_workflows.sql` | ⚠️ **Orphaned** — `createWorkflowInstance` has **zero callers**; `approval_instances` is never written |
| **(C) Governance layer** (matrices/delegation/overrides/simulate) | `routes/approvals/governance-evolution.ts`, `089_governance_evolution.sql` | ⚠️ **CRUD-only** — tables referenced only inside their own route file; nothing reads them at approval time |

**Admin config that doesn't enforce:** `settings/ApprovalWorkflows.tsx` (per-level chains)
and `approvals/GovernanceMatrix.tsx` (matrices/SLA/thresholds/delegation/simulate) are
**two redundant, unreconciled** surfaces. Neither is consulted by the live
entity-specific approve endpoints. **Configuring a chain has no effect.**

---

## 2. Coverage map — where approvals apply today

| Entity | Approve path | Approver (real) | Levels | Reject reason | Audit | Guarded |
|---|---|---|---|---|---|---|
| **Leave** | `approval-service.approveLeaveRequest` | direct manager **or** HR admin | 1 | optional | `audit_logs` | ✅ |
| **Attendance regularisation** | `approval-service.approveRegularisation` | direct manager **or** HR admin (self-approve blocked) | 1 | optional | `audit_logs` | ✅ |
| **Overtime** | `/overtime/requests/:id/approve` | manager/HR | 1 | ❌ **empty `{}`** | partial | ✅ |
| **Comp-off** | `/attendance/comp-off` | manager/HR | 1 | ❌ **empty `{}`** | partial | ✅ |
| **Reimbursement** | `/payroll/reimbursements/*` | manager→HR | ~2 | varies | partial | ✅ |
| **Loans / advances** | `/payroll/ess/manager/*` | manager (L1) → HR (L2) | 2 | required | yes | ✅ |
| **Compensation revision** (salary correction / increment) | `/compensation/revisions` → `…/:id/approve` | **manager or employee raises** (self or direct report only) → **HR admin approves** | 1 (manager-initiated submission + HR approval) | ✅ **required** | yes | ✅ + withdraw/preview |
| **Bulk leave-approve** | `/payroll/bulk/leave-approve` | **raw UPDATE — no guard** | 1 | n/a | weak | ⚠️ **bypass** |
| **Requisition** | `/requisitions/:id/approve` or `/approvals/:step/decide` | **HR admin** (chain labels cosmetic) | 1 or 3 | optional | yes | ✅ |
| **Job offer** | candidate accept/decline (public) | **no internal sign-off**; candidate only | — | hardcoded | partial | ✅ |
| **Asset request** | `/assets/asset-requests/:id/decide` | **HR admin only** (manager read-only) | 1 | optional | yes | ✅ |
| **Separation** | `/separation/approve` | **HR admin** (+manager only for manager-clearance) | 1 + 4-stage lifecycle | optional | yes + events | ✅ strong |
| **FnF** | `/separation-ff/approve` | HR admin (no finance tier) | 1 + mark-paid | n/a (no reject) | yes | ✅ |
| **Onboarding draft** | `/onboarding/drafts/:id/approve` | HR (inline check) | 1 | ✅ **required** | `onboarding_audit_log` | ✅ |
| **Pre-joinee** | `/onboarding/pre-joinee/:id/approve` | **ANY authenticated user** ⛔ | 1 | required | logAction | partial |
| **Recognition / kudos** | — | **none — no approval, no budget cap** | — | — | none | ❌ |
| **Letter issuance** | `/letters/issued/:id/approve` | HR admin (chain role **not** enforced) | template multi-level | optional | `letter_approval_log` | partial |
| **Documents** | — | pure CRUD, no approval | — | — | logAction | n/a |

---

## 3. Gap analysis

### A. Architecture
- **No single source of truth.** Three engines, none reconciled; the configurable ones are orphaned.
- **Multi-level is schema-only.** `validateApprover` is single-step (HR admin OR direct manager). No L1→L2→L3 runs anywhere reachable.
- **Config ≠ enforcement.** `approval_workflow_config`, `approval_matrices` (incl. `payroll_threshold`, `stages`, `sla_hours`, `escalation_employee_id`), `approval_delegations`, `operational_overrides` are all written by admin UIs and **read by nothing** at approval time.
- **Per-level audit trail dead.** `approval_actions` table exists but is never populated (engine orphaned). Live paths log to `audit_logs` only.

### B. Approver model
- **HR-admin-centric.** `HR_ADMIN_ROLES = ['super_admin','hr_admin']` is the only *approver* tier across most of the system. A reporting manager can only **approve**: leave, regularisation, overtime, comp-off, loan-L1, and the **separation manager-clearance** step. A manager can also **initiate** (but not approve) a **compensation revision / salary correction** for a direct report — it lands `pending` for HR approval (`routes/compensation/revisions.ts`). Everything else (assets, requisitions, offers, letters, FnF, onboarding) is HR-only.
- **Compensation revision is one of the best-designed flows** (and was missed in the first pass): proper requester≠approver separation (manager raises, HR approves), direct-report scoping (`403` otherwise), required rejection reason, status guards (`409` if not `pending`), plus `withdraw` and `preview`. It is the closest thing in the codebase to a correct maker-checker.
- **Cosmetic chains.** Requisition ("Reporting Manager / HR Head / Finance Head") and Letters (`approver_role`) display chain labels but only check `hrAdminAuth` — the named role/identity is never verified.
- **No finance tier** anywhere (FnF, offers/salary, reimbursement, payroll) — no maker-checker separation between HR and Finance.

### C. Security / correctness bugs (verified in code)
| Sev | Bug | Location | Impact |
|---|---|---|---|
| 🔴 **Critical** | Pre-joinee approve/reject has **no role guard** (only `authenticate`) | `routes/onboarding/pre-joinee.ts` (approve ~:863, reject ~:1254) | **Any authenticated tenant user can approve a pre-joinee → create/reactivate an employee record.** Sibling `drafts.ts` does an inline HR check; this file has zero `userRole` checks. |
| 🟠 **High** | Bulk leave-approve does raw `UPDATE status='APPROVED'`, skipping `approveLeaveRequest` | `routes/payroll/bulk-ops.ts` ~:225 | No `validateApprover`, **no self-approval guard**, no atomic balance deduction — a weaker, divergent path that can approve leave the normal path would reject. |
| 🟡 **Medium** | Recognition has no points-budget cap | `routes/recognition/index.ts` :146 | Any user can mint unlimited recognition points; no per-giver monthly allowance. |
| 🟡 **Medium** | Compensation revision **approve has no maker-checker within HR** | `routes/compensation/revisions.ts` (approve ~:260) | Approve only checks `isAdmin`, not `requested_by !== userId` — an HR admin who *raises* a salary revision can *self-approve* it. (Manager→HR separation does hold; HR-self does not.) |
| 🟡 **Medium** | HR can **bypass the revision-approval workflow** via direct comp write | `routes/employees/compensation.ts:410` (`POST /employees/:id/compensation`, HR-only) | Two ways to change pay exist: the audited revision workflow *and* a direct HR write with no approval — same bypass pattern as bulk leave-approve. |
| ⚪ **Low** | `counts.ts` filters `approval_instances` on a **non-existent `status` column** | `routes/operations/counts.ts:38` | Latent bug; count is meaningless (table also empty). |

### D. Consistency
- **Reject-reason capture is inconsistent:** required for onboarding draft & pre-joinee & application-reject; **optional** for leave, regularisation, requisition, letters, separation, assets; **not captured at all** for overtime & comp-off (reject posts empty `{}`).
- At least **3 different components approve regularisation** (`ApprovalInbox` embedded table, `ManagerTeamRegularisation`, `ManagerRegularisationQueue`, `RegularisationApproval`).

### E. Missing cross-cutting capabilities
- **Delegation** — schema + admin UI exist; **no approval path honours it**; no self-service ("I'm on leave, delegate to X").
- **SLA escalation** — `sla-scanner.ts` only *alerts* HR; never re-routes or auto-acts. `escalation_employee_id` unused.
- **Auto-approval** — `auto_approve_after_hours` column + `auto_approved` enum exist; no job produces them.
- **Threshold/amount routing** — `payroll_threshold` + matrix stages exist; never consulted (reimbursement/loan/payroll approve the same regardless of amount).
- **Parallel/quorum approvers** — not supported (sequential-only, and only in dead code).
- **Override / bypass** — `operational_overrides` defined; never enforced.

### F. UX
- **Scattered inboxes**; bulk-approve for regularisation lives in a screen *outside* the unified inbox.
- **No chain/level visibility** for managers or employees — flat "pending" everywhere, except `EssLoansAdvances` (`WorkflowTracker` stepper). Employees can't see who their current approver is or where in the chain they are.
- **Manager badge undercounts** — `usePendingApprovalsCount` → `/approvals/pending` counts only leave + regularisation, omitting overtime/comp-off/loans (which are tabs of the same inbox).
- **No SLA/age cues** on overtime/comp-off/loan queues.

---

## 4. Where approvals *should* apply (target applicability matrix)

| Entity | Recommended chain | Why |
|---|---|---|
| Leave | L1 reporting manager → (L2 HR if > N days) | length-based escalation |
| Regularisation / OT / comp-off / WFH | L1 reporting manager | manager owns time |
| Reimbursement | L1 manager → L2 Finance **above ₹ threshold** | spend control |
| Loan / advance | L1 manager → L2 HR → L3 Finance **by amount** | already 2-step; add finance + threshold |
| Requisition | L1 manager → L2 HR → **L3 Finance (budget)** — enforce the labels that exist | headcount cost |
| Job offer | **internal salary/grade sign-off** before candidate send | comp governance (missing) |
| Separation / FnF | manager clearance → HR → **Finance for FnF payout** | money out the door |
| Payroll run | **maker-checker** (preparer ≠ approver), threshold on variance | statutory risk |
| Recognition | **monthly points budget per giver**; HR spot-audit (no per-item approval) | abuse prevention without friction |
| Letters | enforce the template `approval_chains` role identity | currently cosmetic |

---

## 5. Plan of action (phased)

### P0 — Security & correctness (days, ship first)
1. **Add HR role guard to pre-joinee approve/reject** (`hrAdminAuth`) — closes the employee-creation hole.
2. **Route bulk leave-approve through `approveLeaveRequest`** (per-item) so it inherits `validateApprover`, self-approval guard, and atomic balance.
3. **Require a rejection reason consistently** — add `reason: z.string().min(1)` to overtime, comp-off, leave, regularisation, requisition, letters, separation, assets reject handlers.
4. **Fix `counts.ts`** non-existent-column query (or drop the dead count).
5. **Add a recognition monthly points budget** per giver.
6. **Block self-approval on compensation revisions** — reject when `requested_by === userId` (an HR admin shouldn't approve their own salary revision); decide whether the direct HR comp-write (`POST /employees/:id/compensation`) should be retained as an intentional override or routed through the revision workflow.

### P1 — Make ONE engine the source of truth (the core fix)
6. **Pick one engine** (recommend the `053` config + `workflow-service` instances, since it's simpler and already half-built) and **delete or merge** the governance-evolution duplicate to avoid two models.
7. **Wire `createWorkflowInstance` on submit** for leave, regularisation, overtime, comp-off, reimbursement, loan — so an `approval_instances` row + per-level config actually drive routing.
8. **Implement per-level approver resolution** (`direct_manager` / `hr_admin` / `specific_role` / Finance) — the code comment admits this is unfinished.
9. **Populate `approval_actions`** for a real per-step audit trail.
10. **Reconcile the two admin config UIs** into one that the runtime reads.

### P2 — Capabilities
11. **Delegation enforcement** — `validateApprover` consults active `approval_delegations`; add a self-service "delegate my approvals" entry in the inbox.
12. **SLA escalation + auto-approve jobs** — extend `sla-scanner` to re-route to `escalation_employee_id` and honour `auto_approve_after_hours`.
13. **Threshold/amount routing** — consult `payroll_threshold` / matrix stages for reimbursement, loan, requisition (finance tier), payroll run.
14. **Payroll maker-checker** + **offer salary sign-off** (new chains).

### P3 — UX
15. **Unified approval inbox** — one queue across all entity types, with cross-entity bulk; retire the duplicate regularisation screens.
16. **Chain/stage visibility everywhere** — reuse the loans `WorkflowTracker` stepper for managers (current stage) and employees (who/where).
17. **Aggregate the pending badge** across all entity types; add SLA/age cues to every queue.
18. **Mobile approvals** — fold the new engine into the mobile ESS Approvals/Team screens (ties into the mobile-ESS work already underway).

### Sequencing & risk
P0 is low-risk and high-value (ship immediately). P1 is the heavy lift and the linchpin — until the engine is wired, every config screen is theatre. P2/P3 build on P1. Recommend P0 now, P1 as a dedicated track, P2/P3 incrementally.

---

## Key files
- `apps/api/src/lib/approval-service.ts` — live single-step engine
- `apps/api/src/lib/approval-guards.ts` — self-approval SoD
- `apps/api/src/lib/workflow-service.ts` — generic multi-level (orphaned)
- `apps/api/src/routes/approvals/workflows.ts`, `governance-evolution.ts` — config CRUD (unwired)
- `apps/api/src/lib/sla-scanner.ts` — SLA alerting (not escalation)
- `apps/api/src/routes/payroll/bulk-ops.ts` — bulk leave-approve bypass
- `apps/api/src/routes/onboarding/pre-joinee.ts` — missing role guard
- `apps/api/src/routes/recognition/index.ts` — no budget cap
- `apps/api/src/routes/operations/counts.ts:38` — non-existent-column bug
- `supabase/migrations/053_approval_workflows.sql`, `089_governance_evolution.sql`, `042_approval_transactions.sql`
- Web: `pages/attendance/ApprovalInbox.tsx`, `pages/manager/*`, `pages/ess/EssApprovals.tsx`, `pages/settings/ApprovalWorkflows.tsx`, `pages/approvals/GovernanceMatrix.tsx`
