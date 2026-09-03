# COGNIXHR LIVE UAT — FINAL REPORT

**Date:** 2026-09-03
**Operator:** Claude, acting as UAT Lead / HR-Payroll Domain Expert / QA Auditor / System Operator
**Method:** Live execution against a from-scratch local replica of the actual codebase (Postgres 16 + PostgREST + Fastify API + Vite web, same migrations, same seed data shape as the user's own local dev environment) — driven with real Chromium (Playwright) as an actual user would, plus direct API/DB verification for evidence that a browser alone can't show. Not a code review; not a theoretical test plan. Full detail, evidence, and repro steps: `docs/UAT_LIVE_AUDIT.md`.

---

## 1. Executive Verdict

# **RELEASE READY WITH CONDITIONS**

CognixHR's core HR and payroll machinery is genuinely solid: real policy engines (not mocked math), real governance (four-eyes finalize, immutability triggers, statutory-drop protection), and correct server-side security enforcement. Three real defects were found, root-caused, fixed, and **verified live in this session** — including one that was silently overstating net pay. One further defect was found and precisely root-caused but deliberately **not** patched live, because the correct fix touches a mission-critical payroll code path and deserves a dedicated, fully regression-tested change rather than a UAT-session patch.

This is not a verdict of "developers built all the components." It is a verdict that a real HR/payroll operator, running this platform live, would find the tested workflows behave correctly, safely, and legibly — with one governance workflow (payroll finalize under low admin-headcount) that needs a fix before go-live, and substantial ground (TDS deep UAT, separation/F&F, manager-role experience, reports, mobile) that this session did not have time to reach and cannot vouch for either way.

---

## 2. Coverage Summary

| Domain | Status |
|---|---|
| Environment / login | ✅ Tested — pass |
| Employee onboarding & compensation setup | ✅ Tested — pass, with 2 minor findings |
| Payroll run (draft → finalize → immutability) | ✅ Tested — pass, with 1 P0 fixed + 1 P1 found |
| Statutory (PF/ESI/PT/LWF) silent-failure protection | ✅ Tested — 1 P0 fixed |
| Leave (HR approve/reject, ESS apply) | ✅ Tested — pass |
| Attendance regularisation (ESS submit → HR approve) | ✅ Tested — 1 P0 fixed |
| ESS Home + 4 other pillar pages (dev environment) | ✅ Tested — 1 P1 (dev-only) fixed, plus 9 more of the same class found & fixed |
| Security / RBAC (API-level) | ✅ Tested — pass |
| TDS deep UAT | ⛔ Not tested |
| Manager-role experience (as a distinct login) | ⛔ Not tested |
| Employee personas C–H (PF cap, ESI, mid-joiner, LOP, arrear, separation) | ⛔ Not created / not tested |
| Separation / Full & Final settlement | ⛔ Not tested |
| Reports, audit trail (generation, not just page-load) | ⛔ Not tested |
| Responsive / mobile | ⛔ Not tested |
| Full cross-module reconciliation chain | ◐ Partial — pairwise checks done, not one end-to-end chain |

Full table with evidence: `docs/UAT_LIVE_AUDIT.md` → Coverage section.

---

## 3. Release Blockers (P0 / P1 only)

### Fixed and verified live this session
1. **P0 — Statutory deductions silently dropped from payroll** (PF/ESI/PT/LWF). Net pay could be overstated with zero warning. **Fixed & retested live** (commit `799f754`).
2. **P0 — ESS attendance regularisation submission always failed.** The core "employee corrects their attendance" workflow was completely non-functional — every submission with a time returned 400. **Fixed & retested live**, including the full downstream approval → recompute pipeline (commit `2d4bebb`).
3. **P1 (dev-environment only, not production) — ESS Home and 9 other pages couldn't load their data** in local dev due to a proxy-config gap. **Fixed & retested live** (commits `5549970`, `c514d13`). Confirmed not a production issue — production uses an absolute, different-origin API URL with no path collision — but the user's own local dev environment has the identical setup, so this was worth fixing regardless.

### Found, root-caused, NOT fixed — recommended before go-live
4. **P1 — Payroll finalize's four-eyes approval can be silently wasted**, creating an operational deadlock risk. Reproduced 3× live: any of 4 gates that run *after* a checker approves (attendance-lock, missing-attendance, open-blockers, validation-not-run) discards the completed approval on failure and forces the whole maker→checker cycle to restart with a **fresh distinct pair**. Combined with the existing "preparer cannot approve their own run" rule, a tenant with only two HR admins can become permanently unable to finalize a payroll run once that pairing is spent. The fix (reorder ~900 lines of a single finalize handler so validation gates run before the approval step) is well-understood but was deliberately left for a dedicated, fully regression-tested follow-up rather than patched under UAT time pressure. **Full repro: `docs/UAT_LIVE_AUDIT.md` UAT-014.**

No other P0/P1s were found in the areas actually tested.

---

## 4. Financial Correctness

- **Payroll math verified correct** across a 14-employee run: Gross = sum of earnings, Net = Gross − deductions, Total CTC = Gross + employer contributions, reconciling exactly at both the individual-slip and run-aggregate level.
- **LOP (loss of pay) correctly computed** even under a `force_finalize` override for employees with missing attendance data (₹1,02,121.59 across 13 employees) — the override affects the finalize *gate*, not the underlying LOP calculation.
- **Statutory engines (PF/ESI/PT/LWF)** are architecturally sound — a deliberate design that strips manually-configured statutory components and replaces them with slab/ceiling-based engine computation. The one gap (silent drop when applicability can't be resolved) is now fixed and warns clearly on the payslip.
- **Not verified this session:** TDS deep behavior (declarations, regime comparison, Form 16 data), PF-ceiling behavior at high salary, ESI eligibility crossover, mid-month proration, arrears through to a finalized payslip. These require the C/D/E/G personas that were not created due to time.

---

## 5. HR Workflow Correctness

- **Employee onboarding** (3-step Add Employee wizard): correct end-to-end, `job_history` correctly linked, tenure computed correctly.
- **Compensation setup** (Standard CTC template): math correct; **one real gap** — the system accepts a declared Annual CTC that doesn't match the actual sum of configured components, with zero validation warning (P2, not fixed — flagged for product decision, not a UAT-scope patch).
- **Leave**: HR approve/reject both verified correct, including the exact balance debit on approval (19.5 → 14.5 days for a 5-day approval) and correct queue removal on both actions.
- **Attendance regularisation**: now fully correct end-to-end after the P0 fix — submission, approval, and the resulting `attendance_daily` flip from `absent`/0hrs to `present`/9.08hrs, all verified live.
- **Payroll finalize governance**: self-approval blocked, preparer-cannot-approve blocked, `force_finalize` correctly gated to `super_admin`, immutability of a finalized run correctly enforced (409 on re-run attempt) at the application layer, with DB-level triggers confirmed scoped exactly as their own migration documents. The one real gap is the P1 above.

---

## 6. ESS / Manager Experience

- **ESS Home** ("Experience Core"): once its dev-environment loading bug was fixed, this is a genuinely well-built page — real personalized greeting, real pending-approval cards, real salary/kudos/birthday signals, all computed from live data, not mocked.
- **ESS Apply Leave**: fully tested end-to-end — dynamic policy mapping, a real-time collision/sandwich-policy engine, and correct submission (verified in DB: `computed_days = 2.0`, `status = PENDING`).
- **ESS Payslip**: a **navigation gap**, not a data bug — the "Payslip" quick-action on ESS Home and the Pay menu both lead to an unbuilt stub page, while a working, fully-populated payslip view already exists one click away under Pay & Compensation → Pay Slips tab (P3, not fixed — an IA/routing fix, out of scope for a UAT patch).
- **Manager experience as a distinct role**: not tested this session — the HR admin account used throughout doubles as the Approval Inbox owner, so approve/reject flows were exercised, but a genuine manager-only login (team dashboard, team-scoped views) was not.

---

## 7. Roles & Security

- **API-level RBAC verified correct**: a real plain `employee`-role account was provisioned and tested against 8 endpoints. All 6 admin/HR/owner-only endpoints correctly returned 403 (full employee directory, payroll runs, HR leave-approvals inbox, platform-owner routes, another employee's payroll record). Both of the account's own-data endpoints correctly returned 200.
- Authorization is enforced **server-side**, which is the layer that actually matters — a frontend route guard alone would not have been sufficient evidence.
- **Not tested**: direct URL navigation in an actual browser session as a restricted role (would require a full non-demo login flow this session's tooling didn't have time to build).

---

## 8. Data Integrity

- **Payroll immutability confirmed at the correct layer**: attempting to re-run payroll for an already-finalized month returns 409 `RUN_FINALIZED` at the API. The DB-level triggers (migration 263) are deliberately scoped — by their own documented design — to block the finalized→processing re-run and DELETE paths, not raw superuser SQL, which is standard and expected.
- **Reconciliation checks performed and passed**: leave-balance debit exactly matches days approved; slip-sum exactly matches run-aggregate total; attendance-daily state correctly reflects an approved regularisation.
- **The universal `fetchAllRows()` pagination pattern** (documented in this repo's own CLAUDE.md as a prior hard-won fix) was seen correctly applied in the finalize handler's attendance-completeness check — a good sign this lesson has propagated through the codebase.

---

## 9. Paperless Journey

- Leave application → approval is a clean digital flow with zero paper touchpoints, verified live.
- Attendance correction is now a clean digital flow too (post-fix).
- Payslip access has the navigation gap noted above (§6) — a real employee following the platform's own shortcut hits a dead end, which undermines the "paperless" promise for that one specific path until fixed.
- Onboarding, compensation setup, and payroll processing are all digital-native with no evidence of manual/offline steps required.

---

## 10. Issues Fixed During UAT

| # | Severity | Issue | Fix | Retest |
|---|---|---|---|---|
| 1 | **P0** | Statutory (PF/ESI/PT/LWF) silently dropped from payroll with zero warning | Added drop-detection + payslip warning in `statutory-payroll.ts`, mirroring the existing no-attendance-warning pattern | ✅ Live: warning now visible on the actual payslip screen; 218/218 tests pass |
| 2 | **P0** | ESS attendance regularisation submission always failed (400 on every real submission) | Frontend/backend datetime-format mismatch fixed by converting the browser's naive local time into the tenant's timezone before validation, reusing the AttendanceEngine's own existing conversion helpers | ✅ Live: 201 Created; full approval → recompute pipeline verified (absent/0hrs → present/9.08hrs) |
| 3 | **P1 (dev-only)** | ESS Home + 9 other pages couldn't load data in local dev | Dev-proxy config gap closed by adding missing routes, reusing the existing `/manager`-route bypass pattern for the 5 that collide with page routes | ✅ Live: all pages load with zero console errors |

Full before/fix/retest evidence for each: `docs/UAT_LIVE_AUDIT.md`.

---

## 11. Remaining Issues (P0–P3)

| ID | Severity | Issue | Status |
|---|---|---|---|
| UAT-014 | **P1** | Payroll finalize's four-eyes approval wasted by downstream gate failures, creating a deadlock risk for low-admin-headcount tenants | Root-caused precisely, not fixed — needs a dedicated regression-tested change |
| UAT-006 | P2 | Payroll Hub shows "100/100 Grade A" and "Not Ready · 14 blockers" simultaneously | Confusing but confirmed non-blocking (doesn't actually gate Run Payroll) |
| UAT-003 | P2 | Declared Annual CTC vs. actual component-sum: no validation warning on mismatch | Product decision needed on whether this should warn/block |
| UAT-013 | P3 | ESS "Payslip" shortcut leads to an unbuilt stub instead of the working payslip tab | Routing/IA fix |
| UAT-004 | P3 | Compensation template's auto-filled row order doesn't match the component dropdown's option order | Minor UX; each row is correctly labeled so real users are unlikely to be misled |

---

## 12. Modules Not Tested — Exact Reasons

- **TDS deep UAT** (declarations, old/new regime comparison, Form 16 data): not reached — session time was prioritized toward the highest-financial-risk areas found first (statutory drop, payroll finalize governance).
- **Employee personas C–H** (PF cap/high salary, ESI, mid-month joiner, LOP, arrear/revision, separation): not created. Two personas (A, B) were created and used for onboarding/compensation/payroll/statutory testing; the remaining six require dedicated setup time this session did not have.
- **Separation / Full & Final settlement**: not reached — no separation persona was created.
- **Manager-role experience as a distinct login**: not reached — the session's tooling had one demo HR-admin account; testing a genuine manager-only view would require provisioning and logging in as a second, distinct role (as was done for security/payroll-governance testing, but time did not extend to a full manager-experience pass).
- **Reports (generation, not just page-load) and audit-trail content**: the Audit Trail *page* was confirmed to load without errors (as part of the dev-proxy fix verification), but no report was actually generated/inspected end-to-end.
- **Responsive / mobile breakpoints**: not reached.
- **Browser console/network review across the full app**: done for the specific pages touched during testing, not swept across the entire app.
- **Full single-chain cross-module reconciliation** (one scenario traced start-to-finish through attendance → leave → payroll → ledger): pairwise reconciliations were done (leave↔balance, attendance↔LOP, slip-sum↔run-total) but not stitched into one continuous trace.

---

## 13. Recommended Go-Live Conditions

1. **Fix UAT-014 (payroll finalize approval-wasting)** before go-live for any tenant likely to run with 2 or fewer HR admins — which is a very plausible profile for an early customer. This is the one item in this report that could genuinely block a real company's ability to close a payroll month.
2. **Complete TDS deep UAT** before go-live — TDS was deliberately out of scope for this session (owned by a separate governance flow from the statutory engines already tested) and carries the same class of financial/compliance risk as the PF/ESI/PT/LWF issue that was found.
3. **Complete separation/F&F testing** before go-live if any customer is expected to process an exit in their first live payroll cycle.
4. **Decide and implement a stance on UAT-003** (CTC declaration vs. component-sum mismatch) — silently accepting a mismatched CTC configuration is a real risk for HR data quality even though it isn't a P0/P1 on its own.
5. **Fix UAT-013's navigation gap** before go-live — a broken "Payslip" shortcut on the employee home page is a first-impression issue for every single employee.
6. Continue this UAT into the areas listed in §12, prioritized in the order above.

---

## 14. Final Confidence Scores

| Domain | Confidence |
|---|---|
| HR Core (onboarding, compensation setup) | **High** |
| Attendance | **High** (post-fix) |
| Leave | **High** |
| Payroll (computation & correctness) | **High** |
| Payroll (finalize governance workflow) | **Medium** — correct in every tested scenario except the approval-wasting gap |
| Statutory (PF/ESI/PT/LWF) | **High** (post-fix) |
| TDS | **Not assessed** — untested |
| ESS | **High** (post-fix), with one known navigation gap |
| Manager experience | **Not assessed** — untested as a distinct role |
| Security / RBAC | **High** (API layer); frontend-navigation layer not independently verified |
| Data Integrity | **High** |
| Separation / F&F | **Not assessed** — untested |
| **Overall Platform** | **Medium-High** — a genuinely well-engineered platform with real governance and correct core math, held back from a straight "release ready" only by one real, well-understood workflow gap and a meaningful amount of untested ground, both enumerated precisely above rather than glossed over. |

---

*Full findings ledger, evidence, and repro steps: `docs/UAT_LIVE_AUDIT.md`. Screenshots sent throughout this session cover the key live-tested flows.*
