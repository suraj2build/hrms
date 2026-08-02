# PRODUCTION-READINESS AUDIT — CognixHR HRMS
Date: 2026-08-02 · Baseline A1 (`sk-skill-syscert`) · Read-only, evidence-based, 18 independent specialist passes (~2.8M tokens, 1,159 tool calls)

**Scope:** `apps/api/src` (~594 files), `apps/web/src` (~646 files), `supabase/migrations` (419 files) · 424,333 LOC

## System Health Score & Verdict

- **Health Score: 0 / 100** *(100 − 25×Critical − 8×High − 2×Medium − 0.5×Low, floored)*
- **Verdict: NOT READY** — 9 open Criticals, each independently sufficient to block certification.

## Per-audit summary

| # | Audit | Verdict | Crit | High | Med | Low |
|---|---|---|---|---|---|---|
| 1 | Architecture | WARNING | 0 | 2 | 4 | 1 |
| 2 | Backend — Payroll/Statutory | WARNING | 1 | 2 | 3 | 1 |
| 3 | Backend — Employees/Auth/RBAC | WARNING | 0 | 0 | 2 | 0 |
| 4 | Backend — Attendance/Leave | FAIL | 1 | 3 | 1 | 1 |
| 5 | Backend — Remaining modules/platform | WARNING | 1 | 1 | 1 | 2 |
| 6 | Frontend — ESS | FAIL | 0 | 1 | 1 | 1 |
| 7 | Frontend — Admin/HR console | FAIL | 0 | 3 | 1 | 0 |
| 8 | Integration | FAIL | 0 | 2 | 3 | 1 |
| 9 | Database — Query performance/N+1 | FAIL | 1 | 1 | 1 | 0 |
| 10 | Database — Schema/RLS/migrations | FAIL | 1 | 0 | 1 | 1 |
| 11 | Security — AuthZ/RBAC/IDOR | WARNING | 0 | 1 | 1 | 1 |
| 12 | Security — Injection/secrets/PII | WARNING | 0 | 1 | 2 | 1 |
| 13 | Performance | FAIL | 0 | 1 | 3 | 1 |
| 14 | AI (CognixHR Assistant) | FAIL | 1 | 2 | 3 | 1 |
| 15 | Business Logic — Payroll/Statutory | FAIL | 1 | 1 | 3 | 0 |
| 16 | Business Logic — Leave/Attendance | FAIL | 2 | 1 | 2 | 0 |
| 17 | UX | WARNING | 0 | 2 | 2 | 2 |
| 18 | Operational Readiness | FAIL | 0 | 2 | 4 | 0 |
| | **TOTALS** | | **9** | **26** | **38** | **14** — 87 findings |

N/A: none. Could-not-audit: none (Database Schema audit's initial run returned a degenerate placeholder and was re-run to completion).

## Critical findings (9) — full detail

### C1. Leave approval and reversal completely bypass period-lock protection
**Severity:** Critical · **Category:** business-logic/backend · **File:** `apps/api/src/lib/approval-service.ts` — `approveLeaveRequest()` L166-371, `reverseApprovedLeaveRequest()` L382-486
Neither function calls `isMonthLocked`/`assertRangeOpen` from `period-lock.ts`. Every sibling approval type (regularisation, corrections, overtime, comp-off) checks the lock; leave — the highest-traffic type — never does.
**Impact:** HR/manager can approve or reverse leave inside a LOCKED/PAYROLL_PROCESSING month, silently rewriting `attendance_daily` and the leave ledger after payroll closed the period, with no error.
**Fix:** add the same lock check already proven in `approveRegularisation()`, before the atomic RPC call. Regression risk: Low. Effort: S.

### C2. Loan/advance recovery affordability decided before statutory deductions exist
**Severity:** Critical · **Category:** numerical/business-logic · **File:** `apps/api/src/lib/payroll-engine.ts` `computePayrollSlip()` L192-211, `apps/api/src/lib/statutory-payroll.ts` `applyStatutoryToSlip()` L96-221
The EMI accept-or-defer decision runs against a deduction base that structurally excludes ESI/PT (injected only afterward). Worked example: gross=20,000, EMI=18,000 accepted against a PF-only base (≈18,200 headroom); after real PF+ESI+PT (2,150) are added, total deductions clamp at gross, **net_pay forced to 0**, shortfall silently absorbed instead of the EMI being deferred (correct outcome: net_pay=17,850).
**Fix:** compute statutory PF/ESI/PT before evaluating recovery affordability. Regression risk: Medium. Effort: Medium.

### C3. Attendance engine ignores per-day session on multi-day leave
**Severity:** Critical · **Category:** numerical/business-logic · **File:** `apps/api/src/lib/attendance-engine.ts` `fetchApprovedLeave()` L693, `computeDay()` L926-966
Reads only the single legacy `session` column and applies it to every date in a multi-day span, while the duration engine that sets balance deduction correctly computes per-day. Worked example: Mon second_half/Tue full_day/Wed first_half (2.0 days correctly deducted) — Tuesday still reads `session='second_half'` → `day_fraction=0.5` instead of 1.0 → payroll LOP docks 0.5 day already paid via balance → **double-penalized** (reversed direction for unpaid leave = silent overpayment).
**Fix:** select `start_session`/`end_session`/`duration_breakdown` in `fetchApprovedLeave()`; resolve per-date session from `duration_breakdown.per_day` in `computeDay()`. Effort: M.

### C4. Duplicate carry-forward engine still forfeits leave balance with zero audit record
**Severity:** Critical · **Category:** business-logic · **File:** `apps/api/src/lib/accrual-engine.ts` `processCarryForward()` L247-384, reachable via `POST /leave/accrual/carry-forward`
ISSUE-156's forfeiture-ledger fix is genuinely present in `leave-jobs.ts`'s cron-wired `carryForwardJob()`, but a second, independent implementation (`accrual-engine.ts`, driven by `leave_accrual_rules`) still caps balance with no forfeiture-ledger write — live, HR-admin-reachable.
**Fix:** delete `processCarryForward()` and route the endpoint through the fixed `carryForwardJob()`, or port the identical forfeiture-ledger fix. Effort: S-M.

### C5. AI assistant tool lets any employee redirect their own salary bank account
**Severity:** Critical · **Category:** security/AI · **File:** `apps/api/src/lib/ai/assistant-tools.ts` `updateBankDetails()` L1146-1168
No role check at all — a direct upsert to `employee_bank_statutory`, contradicting a documented "HR-verified only" design decision elsewhere in the same codebase. Takes effect immediately, no approval state, no audit log.
**Fix:** make the tool read-only or route through an HR-review-gated request row. Effort: S.

### C6. Statutory compliance GET/export endpoints unpaginated — real EPFO filing can be silently incomplete
**Severity:** Critical · **Category:** database/compliance · **File:** `apps/api/src/routes/payroll/statutory/{epf,esi,ptax,lwf,tds}.ts`, 6 locations (incl. `epf.ts` L707-713 — the actual ECR export)
No `.range()`/`fetchAllRows()`, despite the write-side compute endpoint in the same file correctly using it 200 lines earlier. For tenants >1,000 employees, the actual government PF filing would silently omit part of the workforce.
**Fix:** wrap all six queries in `fetchAllRows()`. Effort: Low.

### C7. Billing webhook writes `tenants.status` directly, contradicting the single-writer contract
**Severity:** Critical · **Category:** security/architecture · **File:** `apps/api/src/routes/billing/index.ts` L159-197
CLAUDE.md: "HRMS never writes license state... owner portal is responsible." A Razorpay webhook independently flips `tenants.status`, the same field the write-gate reads — a third uncoordinated writer alongside `routes/owner/index.ts`.
**Fix:** decide the single authoritative writer; remove this webhook's direct writes or add explicit reconciliation/ordering. Regression risk: Medium (needs product decision).

### C8. Leave accrual/carry-forward jobs run 3 unbatched O(employees×policies) implementations
**Severity:** Critical · **Category:** database/performance · **File:** `apps/api/src/lib/leave-jobs.ts`, `apps/api/src/lib/leave-entitlement-service.ts`
Up to 8 sequential DB round trips per employee×policy. ISSUE-030-033's fix landed only in `accrual-engine.ts`; the scheduler-wired implementations were never touched, and no batched carry-forward path exists in production at all. At the documented 2,877-employee reference scale: 15,000-70,000+ sequential round trips against a 5-minute job timeout — silent missing accruals for tenants processed after timeout.
**Fix:** port the proven batch pattern from `accrual-engine.ts`. Regression risk: Medium. Effort: L.

### C9. SECURITY DEFINER RPC functions directly callable by any authenticated user, bypassing all API RBAC and tenant isolation
**Severity:** Critical · **Category:** security/database · **File:** `supabase/migrations/` — 27 of 32 `SECURITY DEFINER` functions (`reassign_manager_atomic`, `delete_position_atomic`, `delete_salary_component_atomic`, `set_primary_emergency_contact_atomic`, `register_talent_interest_atomic`, `checked_deduct_leave_balance`, `record_loan_payment_atomic`, `approve_leave_request_atomic`, `search_policies`, and ~18 more)
Postgres grants EXECUTE to PUBLIC by default; none of these functions verify the caller's session tenant. Migration 380 proves the team knows the correct mitigation (`REVOKE EXECUTE ... FROM anon, authenticated; GRANT ... TO service_role`) but applied it to only 3 of 32 functions.
**Impact:** any authenticated user, any role, any tenant, can call these directly via PostgREST (`POST /rest/v1/rpc/reassign_manager_atomic`) with any tenant UUID, completely bypassing Fastify's RBAC and RLS — rewriting org charts, deleting positions/salary components, approving/reversing leave, recording loan payments, reading another tenant's policy documents.
**Fix:** `REVOKE`/`GRANT EXECUTE ... TO service_role` on all remaining tenant-parameterized SECURITY DEFINER functions, mirroring migration 380. Regression risk: Low. Effort: M.
**Priority note:** the most severe finding in this report — requires no chat/AI interaction, just a valid login and a guessed tenant UUID. Fix first.

## High findings (26) — summary

1. Payroll run slip search box is a complete no-op (`payroll/index.ts` L2933-3003) — S
2. Notification bell badge undercounts (`NotificationBell.tsx` + `notifications/index.ts`) — S
3. Onboarding draft reject has no status-transition guard (`onboarding/drafts.ts` L695-763)
4. `create_helpdesk_ticket` AI tool bypasses governed ticket-creation service (`assistant-tools.ts` L916-952)
5. `update_emergency_contact` AI tool can create duplicate contacts (`assistant-tools.ts` L1170-1202)
6. Comp-off approval race can leave request 'approved' with zero balance credited (`comp-off.ts` L366-479) — M
7. `leave.rejected` only fires on the legacy event system, unlike fixed sibling `leave.approved` (`approval-service.ts` L567) — S
8. Four independent event systems still live, migration incomplete (`event-bus.ts` family)
9. Admin-triggered leave entitlement endpoints run unbatched N+1 synchronously in-request (`leave-entitlement.ts`)
10. `GET /employees/:id` IDOR — any employee can read any colleague's full PII by ID (`employees/index.ts` L321-338)
11. JWT signature comparison not constant-time (`plugins/auth.ts` `verifySupabaseJwt()` L51-68)
12. Webhook delivery retry entirely manual — no scheduler reads `next_retry_at` (`webhook-service.ts` L174-195/296-313) — M
13. "AI confidence scores" on Trust/Compliance dashboards are hardcoded literals (`explainability.service.ts` L62/88/110)
14. ESS: majority of pages never check `useQuery`'s `isError` (39 files, 11 correct) — systemic
15. Admin console: same isError-blindness recurs in 30+ pages incl. Audit Trail, Payroll Validation
16. `PayrollControlCenter.tsx`'s payroll trigger never invalidates shared run cache (reopens ISSUE-134) — S
17. Same page's freeze action leaves `AttendancePeriods.tsx` stale for 30s
18. `POST /leave/reconciliation/run` replays every employee sequentially, no cap — M
19. Attendance-correction "Reject" has two different friction levels on two pages for the same action
20. "run payroll" nav search resolves to a page that can't run payroll (`nav-config.ts` L449-452)
21. Correlation-ID enrichment plugin is a no-op — pino silently drops the mutated property (`correlation.ts` L46-49)
22. No feature-flag/kill-switch mechanism exists anywhere in the codebase
23. Fresh-DB provisioning permanently broken for 6 migrations (`check-schema-drift.mjs` KNOWN_FAILING)
24. Structured logging inconsistently enforced — 113 `console.log`/`warn` across 44 files, only `console.error` ratcheted
25. `sla-scanner.ts` per-tenant loop lacks top-level try/catch unlike sibling schedulers — M
26. Deployment rollback runbook has no DB-migration-compatibility step

(Full evidence/root-cause/fix detail for all 26 is in the chat transcript of this audit round; consult before fixing if detail beyond this summary is needed.)

## Medium findings (38) and Low findings (14)

See the full chat transcript of this audit (session dated 2026-08-02) for the complete per-finding detail (evidence, root cause, impact, fix, effort, regression risk) on all 38 Medium and 14 Low findings — omitted here for file length; every one was captured with the same evidence-bound rigor as the Critical/High findings above. Notable clusters:
- 236 raw `reply.code(500)` call sites (CI-ratchet-grandfathered technical debt, mitigated by a working global sanitizer but a single point of failure) — clusters in `tds-bulk.ts`/`tds-recovery.ts` (High-adjacent, leaks DB schema info), `it-statement.ts` (also 5 unchecked `Promise.all` results), `payroll/validation.ts`, `system/*.ts` (51 sites), `import/index.ts`/`onboarding/drafts.ts`.
- EPF admin-charge floor applied per-employee not per-establishment; EPF/ESI rounding-convention inconsistency; ESI/LWF ceiling eligibility flip-flops on LOP-reduced wages; hourly-leave day-fraction ignores actual worked minutes (real overpayment vector); leave requests spanning a year boundary don't split balance buckets; `reverse_leave_request_atomic` silently no-ops the balance-cache restore.
- Two independent, undocumented data-import pipelines (`/import` vs `/imports`); `payroll/index.ts` (5,687-line god-file) and `EmployeeProfile.tsx` (5,036-line god-component); bulk-action endpoints process sequentially instead of batching.
- Reimbursement approval has no server-side cap on `approved_amount` vs `claimed_amount`.
- Owner-panel API-key issuance uses the looser auth tier than sibling tenant-lifecycle mutations; tenant-licensing write-gate exempts `/billing`/`/support` via raw `startsWith` not exact match.
- No hard confirmation gate on immediate-effect AI write-tools; AI writes carry no source/channel marker; no confidence-gating on chat prose answers.
- `GET /intelligence/workforce-command` issues 19 sequential queries instead of batched; payroll finalize recomputes stale employees sequentially; `MusterRoll.tsx` debug panel recomputes unmemoized on every keystroke at 2,877-employee scale.
- "Approve/Reject" reinvented independently in 4+ modules with different friction levels; payroll's Validate/Reconcile/Finalize pipeline UI implies a gate it doesn't enforce; orphaned 1,490-line dead component still ships in the bundle.
- SECURITY DEFINER functions lack `search_path` pinning (companion to C9); unexplained migration-numbering gaps (228, 256-259).

## Verified clean (representative — not exhaustive; see full transcript for the complete list per audit)

Zero circular dependencies across the entire codebase (madge-verified, 4 trees, 0 cycles); `finalizeDeductionsAndNet()`'s `gross−deductions=net` invariant genuinely enforced everywhere it's wired; ESI's statutory whole-rupee round-up matches a hand-computed example exactly; TOCTOU on approve/reject correctly closed via CAS-in-WHERE-clause across corrections/overtime/comp-off/orchestrator; self-approval (SoD) genuinely blocked on every leave-approval code path including the multi-level chain; tenant-licensing write-gate's fresh-read-on-every-write mechanism is correctly implemented on both cache paths; global error-sanitizer is a genuine, working backstop against raw DB-error leakage; `apply_leave`/`regularize_attendance` AI tools correctly delegate to governed services (unlike the 3 tools flagged above); React Query global config correctly prevents refetch storms; 15/15 manually-deep-checked tenant tables have correct tenant_id+RLS+policy coverage; zero silent-failure (`onError: () => {}`) mutations anywhere in `apps/web/src`.

## Recommended fix order

1. **C9** (RPC RBAC bypass — no chat/AI required, broadest blast radius, fix first)
2. **C5** (AI bank-fraud vector — exploitable today via chat)
3. **C1** (payroll-integrity gate — period lock)
4. **C2, C3** (wrong-money payroll/leave calculations)
5. **C7** (billing webhook contract violation — company-wide lockout risk)
6. **C6** (statutory filing truncation — compliance exposure)
7. **C4** (leave forfeiture, no audit trail)
8. **C8** (accrual job scalability)
9. Then the 26 Highs, prioritizing ones with an already-proven fix pattern elsewhere in the codebase (H7 `leave.rejected`, H10 IDOR, H11 JWT timing, H1/H2 no-op search/badge).

*Full narrative detail for every finding lives in this session's chat transcript (2026-08-02); this file is the durable, saved record referenced by `AUDIT_CONSTITUTION.md`.*
