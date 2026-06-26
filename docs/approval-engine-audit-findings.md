# Approval Engine — Post-Build Self-Audit

_CognixHR HRMS · audited 2026-06-26 · scope: the 21-commit approval programme
(`24c0dca`→`d27fdac`). Four parallel adversarial reviewers over engine / entity-wiring
/ governance / frontend+migrations._

## Result

Real bugs were found (and I'd introduced them). All CRITICAL + HIGH, plus the cheap
MEDIUM/LOW ones, are **fixed** in `d665820`. Frontend + migrations came back fully clean.

## Fixed

| ID | Sev | Area | Bug | Fix |
|---|---|---|---|---|
| **C1** | CRITICAL | reimbursements.ts | Admin UI calls `/:id/approve\|reject` aliases which were HR-only and **bypassed the gate** — configured chain ignored on the live admin path | Aliases now run `gateApprove`/`gateReject`; no-chain stays HR-only |
| **C2** | CRITICAL | approval-orchestrator.ts | Delegation let a **requester delegate approval of their own request** (delegator≠target unchecked) | Skip any delegation whose delegator is the target employee |
| **H1** | HIGH | approval-orchestrator.ts | `?? applicable[last]` fallback silently finalized at the **wrong level** when stored `total_levels` and recomputed `applicable.length` diverged | Removed fallback → CONFLICT on out-of-range; final-level uses `applicable.length` |
| **H2** | HIGH | approval-orchestrator.ts | Empty delegation `entity_types` (`'{}'` default) authorized **all workflows** | Require non-empty, matching scope |
| **H3** | HIGH | sla-scanner.ts | Auto-advance looked up config by **raw level** while amount-routed chains index by filtered position | Exclude reimbursement/loan/advance from auto-advance |
| **H4** | HIGH | recruitment/index.ts | Offer sign-off checker dispatched **their own body**, not the maker's signed-off terms | Pin amount/joining/recipient to `maker_data` |
| **M1** | MED | bulk-ops.ts | Bulk leave-approve counted an intermediate advance as `approved` + spurious payroll adjustment | Branch on `status==='APPROVED'`; report `advanced_count` |
| **M2** | MED | approval-orchestrator.ts | `NaN` amount silently dropped thresholded levels | NaN→undefined guard in `applicableLevels` |
| **S3** | LOW | sla-scanner.ts | Non-atomic advance → possible double-advance on race/restart | Advance conditional on `current_level` (no-op if moved) |
| **P1** | LOW | payroll/index.ts | super_admin preparer self-approval override not distinctly logged | Writes `checker_notes: PREPARER_SELF_APPROVED_OVERRIDE` |

## Documented residuals (lower risk, not yet fixed)

| ID | Sev | Note |
|---|---|---|
| **H5** | HIGH→scoped | OT/comp-off route preHandlers (`requireManagerOrAdmin`/`hrAdminAuth`) block a configured `specific_role` approver before the gate runs, so a non-manager/HR `specific_role` level deadlocks **for OT/comp-off only**. Common `direct_manager`/`hr_admin` chains work. Fixing needs a careful preHandler refactor (the legacy `authorizeOtTarget` also assumes manager/HR). Deferred. |
| **M3** | MED | `recordAndAdvance` is two writes (action insert + instance update) with no transaction; a DB failure between them can leave a duplicate action or a dangling open instance. Needs an RPC/transaction or a `UNIQUE(instance_id, level)` on terminal actions (migration). |
| **M4** | MED | SLA `systemActor = hrProfileIds[0]` could be the requester in a single-HR tenant (auto-advance attributed to them). Bounded — never finalizes. |
| **O2** | MED | No partial unique index on pending `maker_checker_log` rows → concurrent makers can create two pending rows (payroll + offer). Needs a migration. |
| **SD** | LOW | Self-approval guard fails open if the actor's profile has no linked `employee_id` (an HR admin not mapped to an employee could approve their own role-gated request). Niche. |

## Confirmed clean ✅
- Leave / regularisation / comp-off / OT **gated entry points** skip every finalize
  side-effect on an intermediate advance; self-approval holds; no double event/audit.
- Delegation tenant-scoping + expiry/timezone (TIMESTAMPTZ) correct.
- SLA never auto-finalizes the final level.
- Payroll preparer-identity, maker-as-preparer-allowed, closed third-party-proposes hole.
- Offer sign-off: no premature email/DB write, consistent entity_id, disabled-path unchanged.
- All frontend (stepper states, mobile paths/bodies, badge, config UI null-safety).
- All 3 migrations (constraint names, idempotency, enum supersets). No raw color tokens.
