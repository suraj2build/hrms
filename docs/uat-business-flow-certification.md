# CognixHR Business Flow Certification — 5,000 Employee Edition

> **Purpose:** Prove the platform can support a complete payroll cycle for an
> enterprise of 5,000 employees without encountering a production-blocking defect.
>
> Every flow below must be executed against the seeded enterprise tenant
> (`SEED_TENANT_ID`) and its result recorded as PASS / FAIL / BLOCKED.
> Screenshots or API response bodies are required evidence for any PASS.
> Any FAIL is logged in the UAT Bug Register before proceeding.

---

## Pre-certification checklist

- [ ] Enterprise dataset seeded: `node scripts/seed-enterprise.mjs` completed with 0 errors
- [ ] Smoke suite green: `node scripts/smoke-test.mjs` → 5/5 probes pass
- [ ] UAT Bug Register open: https://claude.ai/code/artifact/4c36f677-ef7b-4c24-83da-f8f4469a4203
- [ ] Test session logged in as HR admin user on the enterprise tenant

---

## Flow 1 — Employee onboarding to payroll-ready

**Scenario:** A new hire is added, assigned a manager, and reaches a payroll-ready state.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 1.1 | Create employee via Admin → Workforce → New Employee | Employee created with `SE`-style code, appears in directory | Screenshot |
| 1.2 | Add job history record (dept, designation, grade) | Job history row saved; current record shows on profile | Screenshot |
| 1.3 | Add compensation record (CTC = ₹6,00,000 p.a.) | Compensation saved; components auto-populated | Screenshot |
| 1.4 | Verify `GET /payroll/compensation-coverage` includes new employee | `issues` array contains no entry for this employee | API response |
| 1.5 | Verify readiness score reflects one more covered employee | `total_active_employees` incremented; `coverage_percent` unchanged or higher | API response |

**Pass criteria:** New employee has 0 issues in coverage audit within 2 minutes of compensation save.

---

## Flow 2 — Attendance processing for full month

**Scenario:** Attendance for the seeded dataset is processed for the current month.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 2.1 | Open Attendance → Muster Roll, select current month | Muster renders for all 1,000+ seeded employees without blank rows | Screenshot (row count visible) |
| 2.2 | Verify `GET /attendance/muster?month=YYYY-MM` HTTP 200 | Response contains `employees` array with length = seeded count | API response |
| 2.3 | Confirm date range covers all working days in the month | No date gap in the response | Spot check |
| 2.4 | Trigger attendance processing: POST /attendance/process | Job accepted (202) or run starts | API response |
| 2.5 | Poll `/attendance/process/status` until complete | Status = `completed`; no `error` entries | API response |
| 2.6 | Recheck Muster Roll after processing | Statuses reflect processed values (not all `null`) | Screenshot |

**Pass criteria:** Muster renders all seeded employees; processing completes without error.

---

## Flow 3 — Leave application and approval

**Scenario:** An employee applies for leave; manager approves; balance decrements.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 3.1 | Log in as a seeded employee (L5/L6, has email `*@seed.test`) | ESS home renders; leave balance tile shows CL=12, EL=18 | Screenshot |
| 3.2 | Apply for 2 days Casual Leave via ESS → Leave → Apply | Leave request created in Pending state | Screenshot |
| 3.3 | Log in as employee's manager; open Approvals | Pending leave request visible | Screenshot |
| 3.4 | Manager approves the leave request | Status changes to Approved | Screenshot |
| 3.5 | Employee: check leave balance after approval | CL balance = 10 (12 − 2) | Screenshot |
| 3.6 | Verify `GET /attendance/leave/balance/:employeeId` | `balance` field = 10 for CL | API response |

**Pass criteria:** Balance decrements correctly; approval flow completes end-to-end.

---

## Flow 4 — Payroll run for enterprise dataset

**Scenario:** A payroll run is initiated for the full seeded dataset.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 4.1 | Verify `GET /payroll/readiness-score` ≥ 70 | Score returned; grade is B or higher | API response |
| 4.2 | Verify `GET /payroll/compensation-coverage` shows `ready_for_payroll: true` | Zero blocking issues | API response |
| 4.3 | Initiate payroll run: POST /payroll/runs | Run created with status = `processing` | API response (run ID) |
| 4.4 | Poll run status until complete | `status = completed`; `employee_count` = seeded count; no `failure_summary` | API response |
| 4.5 | Verify gross totals are non-zero | `total_gross` > 0; per-employee amounts in expected CTC ranges | API response |
| 4.6 | Check for payroll exceptions | `GET /payroll/runs/:id` → `exceptions` array empty or only warnings | API response |

**Pass criteria:** Run completes without hard failures; employee_count matches seed count.

---

## Flow 5 — Payslip generation and ESS download

**Scenario:** Payslip generated after run completion; employee downloads via ESS.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 5.1 | Confirm run from Flow 4 is in `completed` state | — | — |
| 5.2 | Generate payslips: POST /payroll/runs/:id/payslips | Payslip generation job accepted | API response |
| 5.3 | Log in as a seeded employee with a payroll record | ESS → Pay → Payslips shows the latest month | Screenshot |
| 5.4 | Download PDF payslip | PDF downloads and opens without error; amounts match CTC | Screenshot of PDF |
| 5.5 | Verify `GET /ess/home` includes pay section with payslip reference | `pay` or `payslip` key present in response | API response |

**Pass criteria:** Employee can self-serve their payslip without HR admin intervention.

---

## Flow 6 — HR admin operations dashboard

**Scenario:** HR admin views and acts on the Operations Center without errors.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 6.1 | Open Payroll → Operations Center | Page loads in < 5 s; all cards render | Screenshot |
| 6.2 | Compensation coverage card shows correct totals | `total_active_employees` = seeded count; `coverage_percent` = 100% | Screenshot |
| 6.3 | Click through to an employee with an issue (if any) | Remediation link navigates to correct compensation section | Screenshot |
| 6.4 | Open Attendance → Manager Dashboard | Team attendance chart renders; no blank sections | Screenshot |
| 6.5 | Export Muster Roll for the seeded month | CSV/Excel downloads; row count = seeded employee count | File download |
| 6.6 | Run `node scripts/smoke-test.mjs` after dashboard interactions | 5/5 probes still pass (no side-effect regressions) | Console output |

**Pass criteria:** All Operations Center cards load; export produces correct row count.

---

## Flow 7 — Separation and offboarding

**Scenario:** An employee (L6 associate from seed) is marked for separation.

| Step | Action | Expected | Evidence |
|------|--------|----------|----------|
| 7.1 | Initiate separation for a seeded L6 employee | Separation workflow created; notice period set | Screenshot |
| 7.2 | Verify employee status changes to `on_notice` | `employees.status = 'on_notice'` | DB check or API |
| 7.3 | Attendance continues to generate for employee | Muster Roll still includes employee for notice period | Screenshot |
| 7.4 | After notice period, mark as `separated` | Status = `separated` | Screenshot |
| 7.5 | Run coverage audit after separation | Employee no longer appears in `total_active_employees` | API response |
| 7.6 | Final settlement payroll (if applicable) | Settlement run completes; payslip available | API response |

**Pass criteria:** Separation flow removes employee from active payroll scope without corrupting existing records.

---

## Regression guard (after all flows)

Run the following after completing all 7 flows to confirm nothing was broken by the UAT activity itself:

```sh
# 1. Smoke suite
node scripts/smoke-test.mjs
# Expected: 5/5 PASS

# 2. Ratchets (no new violations from any test data created)
node scripts/check-tenant-isolation.mjs --ratchet
node scripts/check-unbounded-queries.mjs --ratchet
node scripts/check-manual-500s.mjs

# 3. Re-check coverage audit returns HTTP 200
curl -H "Authorization: Bearer $TOKEN" \
  "$SMOKE_BASE_URL/payroll/compensation-coverage" | jq '.data.ready_for_payroll'
# Expected: true (or false with specific issues listed, not a 500)
```

---

## Sign-off

| Flow | Tester | Date | Result | Bug IDs |
|------|--------|------|--------|---------|
| Flow 1 — Onboarding | | | | |
| Flow 2 — Attendance | | | | |
| Flow 3 — Leave      | | | | |
| Flow 4 — Payroll Run | | | | |
| Flow 5 — Payslip ESS | | | | |
| Flow 6 — HR Dashboard | | | | |
| Flow 7 — Separation | | | | |
| Regression guard    | | | | |

**Certification verdict:**
- [ ] **PASS** — All 7 flows completed with PASS; 0 open P0/P1 bugs; regression guard green
- [ ] **CONDITIONAL PASS** — Flows complete; only P2/P3 open bugs; documented exceptions accepted
- [ ] **FAIL** — One or more P0/P1 bugs blocking a flow; certification deferred

Signed: ___________________________ Date: ___________
