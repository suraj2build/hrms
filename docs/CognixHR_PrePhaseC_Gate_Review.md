# CognixHR — Pre-Phase C Gate Review

**Document type:** Pre-Phase C Remediation Classification
**Prepared:** 3 July 2026
**Source:** Phase B risk register (`docs/CognixHR_5000_Employee_MultiSite_Readiness_Plan.md §5`)
**Scope:** All 9 Critical + 20 High items classified for Phase C gating

---

## Classification Legend

| Gate | Definition |
|------|-----------|
| **GATE-1** | Must fix before Phase C. Leaving it open produces false failures or results that don't reflect true capacity. Phase C would confirm a known defect rather than measure scale behaviour. |
| **GATE-2** | Can proceed to Phase C. Phase C results will be valid — possibly with a documented "known gap" marker. Phase C evidence may inform whether this needs immediate remediation. |
| **POST-C** | Safe to defer. Risk materialises at year-3 volumes or in production operations, not during Phase C validation. |

**GATE-1 filter used:** Fix before Phase C if the item can (a) produce an HTTP timeout on a core Phase C scenario, (b) silently truncate or omit data used in the scenario, (c) make a scenario non-deterministic under concurrency, (d) generate misleading performance numbers by confirming a known defect rather than measuring capacity, or (e) cause correct results to be unachievable regardless of scale.

---

## Critical Items (9)

### C1 — `audit_logs` missing composite index `(tenant_id, created_at DESC)`

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | DB schema `006_audit_logs.sql:14–16`; `GET /audit-logs` compliance dashboard |
| Fix effort | 1 h — one `CREATE INDEX CONCURRENTLY` migration |
| Scenarios if open | WP4-4.8 — compliance dashboard query (1.5M row table, 30-day window) breaches the < 5 s SLA. Failure is a known missing-index defect, not a capacity ceiling. Phase C records a false negative. |
| Why GATE-1 | The fix is 1 h and must run **before data seeding** so the index covers the full Phase C dataset from day one. Post-seeding CONCURRENTLY build on 1.5M rows takes longer and risks concurrent DML contention during testing. |

---

### C2 — `attendance_raw_logs`, `attendance_daily`, `attendance_punch_logs` not partitioned

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | DB schema `019_attendance.sql`, `043_attendance_punch_logs.sql`; all attendance query paths |
| Fix effort | 3–5 days (migration + data movement) |
| Scenarios if open | WP2-2.4 (muster), WP2-2.5 (muster export) — may show elevated query times |
| Why GATE-2 | Phase C seeds year-1 data: 1.825 M rows in `attendance_daily`. At that volume, modern Postgres with the H1 composite index (tenant_id, status, date DESC) should keep muster queries within SLA. The partitioning concern is a year-2/3 regression, not a year-1 blocker. Phase C gives us the actual query-time evidence to decide whether to partition before GA or after. |
| Mitigation | Deploy H1 index (GATE-1) before seeding. Annotate the Phase C scorecard: "Year-1 data tested; year-2 partitioning required per C2 plan." |

---

### C3 — Cascade delete across 89+ tables; no soft-delete

**Gate: POST-C**

| Field | Detail |
|-------|--------|
| Affected | `employees` row and 89+ dependent tables; `PATCH /employees/:id/separation/relieve` |
| Fix effort | 5–10 days (architecture change) |
| Scenarios if open | WP2-2.15 (individual separation) — **not affected**. The separation workflow sets `employees.status = 'separated'` and applies AF-001 auth revocation without deleting any row. |
| Why POST-C | Phase C tests individual separation, not bulk DELETE operations. The cascade-delete risk materialises only in a bulk mass-separation DELETE (200 employees/month). Phase C does not exercise that path. Document as a post-launch operational policy: **never batch-DELETE employees; use status = 'separated'**. |

---

### C4 — `leave-scheduler-tick`: all 6 sub-jobs share one 120-second durable job timeout

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `leave-scheduler` plugin; monthly_accrual, carry_forward, co_expiry, event_grants, reconciliation sub-jobs |
| Fix effort | 3–4 days — split sub-jobs into independent durable queue entries; each gets its own timeout and retry counter |
| Scenarios if open | WP2-2.7 (monthly accrual) **auto-FAIL** — DLQ after 3 timeouts. WP2-2.8 (year-end carry-forward) **auto-FAIL**. Both are automatic certification blockers. |
| Why GATE-1 | At 5,000 employees × 12 leave types = 60,000 DB operations, the combined tick exceeds 120 s — this is a static guarantee, not a hypothesis. Running Phase C confirms a known timeout rather than measuring whether the accrual algorithm can handle the load. Fix first; Phase C then tests whether the per-sub-job version completes within its individual timeout. |

---

### C5 — `send-pulse-poll`: 5,000 serial WhatsApp API calls, no per-employee send log

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `send-pulse-poll` durable job handler; WhatsApp API integration; `pulse_questions` / enrolled employees |
| Fix effort | 2–3 days — add `pulse_send_log (UNIQUE question_id, employee_id)`; chunk employees into batches of 100; `Promise.allSettled` at concurrency = 20 |
| Scenarios if open | WP2-2.10 (WhatsApp delivery) — guaranteed timeout at 3,800 serial calls; SLA miss. WP4-4.13 (retry idempotency) — **guaranteed duplicate sends** on retry; automatic certification blocker. |
| Why GATE-1 | The timeout and duplicate-send outcome are static guarantees at 3,800 employees. Phase C would confirm two known defects rather than test delivery capacity. Fix first; Phase C then verifies whether the batched approach delivers within 30 minutes with zero duplicates on retry. |

---

### C6 — `POST /payroll/runs`: blocking HTTP handler, PAYROLL_CONCURRENCY = 10

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `POST /payroll/runs` HTTP handler; payroll computation engine (`PAYROLL_CONCURRENCY` constant) |
| Fix effort | 3–5 days — return 202 + `run_id` immediately; move computation to a durable background job with 30-minute timeout; raise concurrency to 50–100; add `GET /payroll/runs/:id/status` |
| Scenarios if open | WP2-2.1 (5,000-employee payroll) **auto-FAIL** with HTTP 504. WP2-2.2 (1,500 contractual) **auto-FAIL**. These are the two most important Phase C scenarios. |
| Why GATE-1 | At PAYROLL_CONCURRENCY = 10, processing 5,000 employees requires 500 serial batch rounds × ~5 DB calls = ~250 s minimum. Standard HTTP/load-balancer timeout is 60 s. The timeout is mathematically guaranteed. Phase C would confirm this known architecture defect instead of measuring payroll capacity. Fix first. |

---

### C7 — `GET /attendance/muster`: `attendance_daily` silently truncated at 50,000 rows

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `GET /attendance/muster` handler; `attendance_daily` query |
| Fix effort | 0.5 day — raise hard limit to 200,000; add `X-Truncated: true` response header when limit is hit |
| Scenarios if open | WP2-2.4 (daily muster for 5,000 employees over 31 days = 155,000 rows) **auto-FAIL**. Acceptance criterion "returns all 5,000 employees; no truncation" cannot be met at the current 50,000-row cap. This is a data-correctness automatic certification blocker. |
| Why GATE-1 | The fix is 0.5 day. Without it, WP2-2.4 and every downstream muster scenario return incorrect data. Phase C would surface a known limit, not a capacity finding. |

---

### G1 — `attendance_policies` not site-assignable

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `attendance_policies` table (tenant_id-scoped only); attendance scheduler policy resolution |
| Fix effort | 3–5 days — add `site_id UUID NULL` to `attendance_policies`; add resolution function (site → tenant default fallback) |
| Scenarios if open | WP3-3.2 (office vs field grace period differentiation) — **expected gap**, not a data distortion in other scenarios |
| Why GATE-2 | G1 is a product completeness gap, not a scale risk. WP3-3.2 is specifically designed to test and document this gap. All of WP1, WP2, WP4, and the remaining WP3 scenarios are unaffected. Phase C can proceed with WP3-3.2 marked "KNOWN GAP — G1 remediation committed." |
| Mitigation | Record WP3-3.2 expected result in the Phase C scorecard before running. The "Conditionally Certified" result is valid if WP3-3.2 fails with G1 as the documented cause. |

---

### G2 — Manager hierarchy resolves only one level in the application layer

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `manager-scope.ts` `getDirectReportIds()`; all leave approval, team-view, succession, and OT approval routes |
| Fix effort | 3–5 days — recursive CTE (`WITH RECURSIVE subordinates AS ...`) in `getDirectReportIds()` with configurable `max_depth`; add `(manager_id, tenant_id, status)` composite index |
| Scenarios if open | WP3-3.11 (cluster manager visibility) **auto-FAIL**. WP3-3.5 (6-level leave approval) partially masked — depth-1 passes, deeper levels fail silently. WP2-2.9 (300 simultaneous leave submissions) gives misleading correctness results because approval routing appears to work but is silently broken for 80% of the org. |
| Why GATE-1 | The silent mis-routing of approvals beyond depth 1 makes WP2-2.9 and WP3-3.5 produce misleading "pass" results. Phase C would record that 300 leave submissions processed correctly when in fact only direct-manager-level approvals were routed correctly; deeper chains were silently ignored. That distorts the certification scorecard for the 6-level org scenario. |

---

## High Items (20)

### H1 — `attendance_daily` missing `(tenant_id, status, date DESC)` index

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `attendance_daily` table (019_attendance.sql); all muster, status-count, and dashboard queries |
| Fix effort | 0.5 day — `CREATE INDEX CONCURRENTLY idx_ad_status_date ON attendance_daily (tenant_id, status, date DESC)` |
| Scenarios if open | WP2-2.4, 2.5, 2.6 — all attendance queries post-filter across 1.825 M rows per day without pruning; artificially elevated query times mask true capacity |
| Why GATE-1 | Must run before data seeding. Index on an empty table is instant; same index on 1.825 M pre-seeded rows requires a CONCURRENTLY build that holds shared lock during testing. |

---

### H2 — `employees` group indexes lack `tenant_id` prefix

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `113b_employees_indexes.sql:133–135` — `idx_employees_payroll_group`, `idx_employees_employment_category`, `idx_employees_statutory_group` |
| Fix effort | 0.5 day — rebuild each index as `(tenant_id, {column}) WHERE {column} IS NOT NULL` |
| Scenarios if open | WP2-2.1, 2.2 — payroll-group queries during run may miss these indexes; artificially slow payroll-group fan-out masks true concurrency capacity |
| Why GATE-1 | Same rationale as H1 — must run before seeding 5,000 employees to avoid post-seeding CONCURRENTLY rebuild during active testing. |

---

### H3 — `employees.joining_date` index lacks `tenant_id` prefix

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `004_employees.sql:49` — `idx_employees_joining` is `(joining_date)` only |
| Fix effort | 0.5 day — add `idx_employees_tenant_joining ON employees (tenant_id, joining_date)`; drop old index |
| Scenarios if open | WP2-2.13 (ESS home anniversary scan), WP2-2.17 (intelligence scanner onboarding-blocker pass) — index may be skipped by planner; cross-tenant scan risk |
| Why GATE-1 | Same rationale as H1 and H2. |

---

### H4 — No auto-provisioning for `security_events` / `trace_spans` partitions after Dec 2027

**Gate: POST-C**

| Field | Detail |
|-------|--------|
| Affected | `security_events`, `trace_spans` monthly partitions |
| Fix effort | 1 day — implement partition-maintenance scheduler job |
| Scenarios if open | None during Phase C |
| Why POST-C | Pre-created partitions cover through Dec 2027. Phase C runs in 2026. This risk materialises 18+ months from now and has zero impact on Phase C results. |

---

### H5 — Monthly and yearly accrual: O(N × M) sequential DB writes

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | Leave accrual job (after C4 splits sub-jobs) |
| Fix effort | 3–4 days — bulk-upsert `leave_accrual_ledger` and `employee_leave_balance` via `INSERT ... ON CONFLICT DO UPDATE` with arrays |
| Scenarios if open | WP2-2.7 — may exceed the 20-minute SLA; Phase C measures actual wall-clock time |
| Why GATE-2 | H5 only becomes visible after C4 is fixed (sub-jobs have individual timeouts). Phase C's job is precisely to measure whether accrual completes within 20 min with the per-job timeout. If it passes, H5 is a latent concern; if it fails, Phase C provides evidence for the bulk-upsert rewrite. |
| Mitigation | Monitor WP2-2.7 wall-clock time carefully. If > 20 min, promote H5 to GATE-1 and re-run that scenario after implementing bulk-upsert. |

---

### H6 — `fetchActiveEmployees()` called once per sub-job (N redundant fetches per tick)

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | Leave scheduler tick orchestrator |
| Fix effort | 0.5 day — fetch employees once in orchestrator; pass array to sub-jobs |
| Scenarios if open | WP2-2.7 — 5–6× more employee-fetch queries than needed; measurable but not correctness-impacting |
| Why GATE-2 | After C4 is fixed, sub-jobs run independently. The redundant fetch is a performance inefficiency that Phase C will quantify. No correctness risk. |

---

### H7 — `co_expiry` unbounded initial SELECT on `leave_accrual_ledger`

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | Leave co-expiry job; `leave_accrual_ledger` table |
| Fix effort | 1 day — cursor-based chunked processing (`id > last_processed_id`, chunks of 1,000) |
| Scenarios if open | WP2-2.19 (co-expiry job) — 60,000 ledger rows loaded into Node.js memory; may cause memory pressure; Phase C measures actual behaviour |
| Why GATE-2 | At 60,000 rows (year-1 volume), the SELECT will return a large but probably non-fatal payload. Phase C will reveal whether memory pressure causes a timeout or OOM. Either result is valid evidence. |

---

### H8 — Six schedulers write no heartbeat

**Gate: POST-C**

| Field | Detail |
|-------|--------|
| Affected | digest-scheduler, poll-scheduler, SLA scanner, intelligence scanner, WO-credit reconciler, absconding scanner |
| Fix effort | 1 day — add `scheduler_heartbeats` upsert to each scheduler's main loop |
| Scenarios if open | WP4-4.5 — explicitly designed to document this gap: "No automated staleness detection — gap documented." |
| Why POST-C | WP4-4.5 is a gap-documentation scenario, not a pass/fail scenario. Phase C's job here is to confirm the gap exists and record it. Post-Phase C: add heartbeats in the operational readiness sprint before GA. |

---

### H9 — Intelligence scanner: multi-pass over 5,000 employees; no per-batch checkpointing

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | Intelligence scanner durable job; all check-type passes |
| Fix effort | 2–3 days — each check type as a separate durable sub-job; cursor-based employee iteration |
| Scenarios if open | WP2-2.17 (intelligence scan, 6h job) — may timeout mid-run; Phase C measures whether a single pass completes within the durable job window |
| Why GATE-2 | Phase C measures whether the scanner completes at 5,000-employee scale. If it passes, checkpointing is a resilience improvement only. If it times out, Phase C provides the evidence for the sub-job split. |

---

### H10 — `GET /helpdesk/tickets` (admin queue): no pagination, `SELECT *`

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `GET /helpdesk/tickets` handler |
| Fix effort | 1 day — add page/limit pagination (max 100); replace `SELECT *` with explicit column list |
| Scenarios if open | WP2-2.11 (helpdesk admin queue) — at 18,000+ tickets (year-1), a `SELECT *` with no pagination returns a multi-megabyte JSON payload and will timeout at the HTTP/gateway layer. |
| Why GATE-1 | The timeout is not a capacity finding — it is a missing pagination guard. Phase C would confirm a known missing feature rather than test whether the helpdesk queue is operationally viable at scale. Fix is 1 day. |

---

### H11 — `GET /helpdesk/stats`: post-fetch JavaScript aggregation

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `GET /helpdesk/stats` handler |
| Fix effort | 0.5 day incremental (paired with H10) — replace with single SQL `COUNT(*) FILTER (WHERE ...)` aggregation |
| Scenarios if open | WP2-2.11 (helpdesk stats sidebar) — same timeout risk as H10; fetches all tickets before aggregating |
| Why GATE-1 | Paired fix with H10. No additional effort required beyond adding the stats SQL query. |

---

### H12 — `GET /attendance/who-is-in`: loads all 5,000 employees synchronously

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `GET /attendance/who-is-in` handler; five parallel fan-out queries |
| Fix effort | 1 day — add pagination or default to requesting HR admin's site with an "all sites" toggle |
| Scenarios if open | WP2-2.6 (who's-in, concurrent × 50) — may breach the < 2 s p95 SLA; Phase C will measure |
| Why GATE-2 | The five queries fan out in parallel (not serial). At 5,000 employees with indexes in place, Supabase may return within 2 s. Phase C gives us the actual measurement. If > 2 s, fix and re-run WP2-2.6. |
| Mitigation | If p95 exceeds 2 s in the first WP2-2.6 run, pause, apply H12 fix, and re-run before recording the final result. |

---

### H13 — `GET /datasets/employees`: unbounded multi-table JOIN, post-fetch region filter

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `GET /datasets/employees` data-import endpoint |
| Fix effort | 1–2 days — server-side pagination; push region/zone filter into SQL WHERE |
| Scenarios if open | WP1-1.1 (employee seeding) — only if the datasets endpoint is used for seeding. It should not be. |
| Why GATE-2 | Phase C data seeding (WP1) should use the direct bulk-insert path or `POST /employees` API — not the datasets endpoint. If the seeding script avoids this endpoint, H13 is not exercised in Phase C. Document as a known slow-path: never use `/datasets/employees` for bulk data loading. |
| Mitigation | Confirm seeding script does not call `/datasets/employees`. If it does, replace with direct API calls. |

---

### H14 — Attendance-payroll comparison: five unbounded queries

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `GET /reports/attendance-payroll-comparison` handler |
| Fix effort | 1–2 days — per-query limits; materialise comparison data at payroll finalisation time |
| Scenarios if open | WP2-2.13 — may breach the < 5 min SLA; Phase C measures actual query time |
| Why GATE-2 | At year-1 volumes (5,000 employees, 1 month of attendance + one payroll run), five unbounded queries may still return within 5 min. Phase C gives us the evidence. If > 5 min, the fix plan is ready to execute. |

---

### H15 — `GET /reports/muster-roll/export`: no export limit guard

**Gate: GATE-1**

| Field | Detail |
|-------|--------|
| Affected | `GET /reports/muster-roll/export` handler |
| Fix effort | 0.5 day — mirror payroll export pattern: `EXPORT_LIMIT = 200,000`; return 422 if exceeded; stream CSV in chunks |
| Scenarios if open | WP2-2.11 (muster export, 155,000 rows) — will timeout at HTTP/gateway layer without limit guard or streaming. Acceptance criterion "file complete" cannot be met. |
| Why GATE-1 | The fix is 0.5 day and mirrors an existing pattern already in the payroll export. Without it, WP2-2.11 auto-fails with a timeout that masks whether streaming can handle the volume. |

---

### H16 — `GET /payroll/runs/blockers`: three unbounded queries

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `GET /payroll/runs/blockers` handler — employees (no limit), attendance_daily for month (no limit), employee_compensations (no limit) |
| Fix effort | 0.5 day — add `.limit(5000)` guards on all three queries |
| Scenarios if open | WP2-2.18 (payroll blockers, < 5 s SLA) — at 5,000 employees with indexed lookups, may still return within 5 s; Phase C measures |
| Why GATE-2 | The three queries are each filtered by tenant_id and date (indexes available). At 5,000 employees they may well return within 5 s. Phase C tells us. If > 5 s, the 0.5-day fix is trivial to apply before recording the final result. |

---

### G3 — No `site_id` on `attendance_devices` / `attendance_raw_logs`

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `attendance_devices` table; `attendance_raw_logs` table |
| Fix effort | 2–3 days — add `site_id UUID NULL REFERENCES sites(id)` to both tables |
| Scenarios if open | WP3-3.4 — **expected to document this gap**: "Current platform: no site-to-device binding — punch accepted by any device." |
| Why GATE-2 | WP3-3.4 is a gap-documentation scenario. Phase C records the current behaviour and documents the gap; no other scenario is distorted. |

---

### G4 — No `site_id` on `attendance_daily`, `leave_requests`, `payroll_slips`

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | `attendance_daily`, `leave_requests`, `payroll_slips` tables; all multi-site report queries |
| Fix effort | 2–3 days — add `site_id UUID NULL` (denormalised) with backfill + partial index to each table |
| Scenarios if open | WP3-3.10 (site-scoped HR report) — queries require JOIN to `employees.site_id`; Phase C measures whether JOINs are fast enough |
| Why GATE-2 | With H1 index in place (`attendance_daily`: tenant_id, status, date), the JOIN to employees.site_id adds one pass but may stay within SLA at year-1 volumes. Phase C gives us the JOIN-cost evidence needed to justify the denormalisation. |
| Mitigation | Ensure H1 is deployed; annotate scorecard: "Multi-site queries use employee JOIN; site_id denormalisation deferred pending Phase C JOIN-cost evidence." |

---

### G5 — No multi-legal entity model

**Gate: POST-C**

| Field | Detail |
|-------|--------|
| Affected | Tenant architecture (product-level gap) |
| Fix effort | Product decision required — not estimable without product design |
| Scenarios if open | None in Phase C |
| Why POST-C | Phase C tests a single-entity tenant scenario. Multi-legal entity is a product roadmap item requiring architecture decisions that Phase C evidence does not inform. |

---

### G6 — No site-scoped RLS

**Gate: GATE-2**

| Field | Detail |
|-------|--------|
| Affected | RLS policies `007_rls_policies.sql` — `manager` and `hr_viewer` roles |
| Fix effort | 3–5 days — site-scoped RLS policies for hr_viewer and manager roles |
| Scenarios if open | WP3-3.10 (site-scoped data isolation) — tests **application-layer** isolation via `req.tenantId`; this passes. Direct Supabase client access is not part of Phase C. |
| Why GATE-2 | Phase C tests all scenarios through the API layer. The application-layer `req.tenantId` and `req.employeeId` guards fully enforce site isolation for all Phase C API calls. The RLS gap only matters for direct Supabase client access, which is documented as unsupported. |
| Mitigation | Add to Phase C scorecard: "RLS site-scoping not implemented; application-layer isolation tested and confirmed; direct DB access blocked at ops policy level." |

---

### G7 — Cluster manager RBAC not implemented

**Gate: POST-C**

| Field | Detail |
|-------|--------|
| Affected | RBAC system; cluster manager role (migration 274 deferred) |
| Fix effort | 3–5 days |
| Scenarios if open | WP3-3.11 — uses `hr_admin` fallback as documented: "RBAC deferred — verify with role=hr_admin fallback" |
| Why POST-C | WP3-3.11 is designed to test the hr_admin fallback path and document the RBAC gap. This is not a distortion — it is the specified Phase C behaviour for this scenario. Post-Phase C: implement cluster manager RBAC before GA. |

---

## Summary — Classification Matrix

### GATE-1 (fix before Phase C) — 12 items

| ID | Severity | Finding | Fix effort | Scenarios blocked if open |
|----|----------|---------|-----------|--------------------------|
| C1 | Critical | `audit_logs` composite index | 1 h | WP4-4.8 false SLA fail |
| C4 | Critical | Leave sub-job 120 s shared timeout | 3–4 d | WP2-2.7, 2.8 auto-FAIL (certification blockers) |
| C5 | Critical | WhatsApp serial sends + no per-employee log | 2–3 d | WP2-2.10 timeout; WP4-4.13 guaranteed duplicates |
| C6 | Critical | Payroll blocking HTTP handler | 3–5 d | WP2-2.1, 2.2 HTTP 504 (auto-FAIL) |
| C7 | Critical | Muster truncated at 50 k rows | 0.5 d | WP2-2.4 data-correctness auto-FAIL |
| G2 | Critical | Manager hierarchy 1 level (flat) | 3–5 d | WP3-3.11 FAIL; WP2-2.9 misleading results |
| H1 | High | `attendance_daily` status+date index | 0.5 d | WP2-2.4, 2.5, 2.6 artificially slow |
| H2 | High | `employees` group indexes no tenant_id | 0.5 d | WP2-2.1, 2.2 index miss |
| H3 | High | `joining_date` index no tenant_id | 0.5 d | WP2-2.13, 2.17 index miss |
| H10 | High | Helpdesk no pagination | 1 d | WP2-2.11 timeout |
| H11 | High | Helpdesk stats post-fetch JS | 0.5 d | WP2-2.11 timeout |
| H15 | High | Muster export no limit guard | 0.5 d | WP2-2.11 timeout |
| **Total** | | | **~16–22 d** | |

### GATE-2 (proceed to Phase C with mitigation) — 13 items

| ID | Severity | Finding | Mitigation / Phase C outcome |
|----|----------|---------|------------------------------|
| C2 | Critical | Attendance tables unpartitioned | Deploy H1 first; Year-1 volumes may pass; Phase C measures |
| G1 | Critical | Attendance policies not site-scoped | WP3-3.2 marked expected-gap; all other scenarios valid |
| H5 | High | Accrual O(N×M) sequential | After C4: measure WP2-2.7 wall-clock; promote if > 20 min |
| H6 | High | fetchActiveEmployees N redundant fetches | Phase C measures extra query count; no correctness risk |
| H7 | High | co_expiry unbounded SELECT | Phase C measures memory pressure on 60 k rows |
| H9 | High | Intelligence scanner no checkpointing | Phase C measures whether single-pass completes in timeout |
| H12 | High | Who's-in loads all 5 k synchronously | Phase C measures p95; re-run after fix if > 2 s |
| H13 | High | /datasets/employees unbounded JOIN | Avoid in Phase C seeding scripts; use POST /employees API |
| H14 | High | Attendance-payroll comparison 5 unbounded | Phase C measures against 5-min SLA |
| H16 | High | Payroll blockers 3 unbounded queries | Phase C measures against 5 s SLA; 0.5-d fix if breached |
| G3 | High | No site_id on devices / raw_logs | WP3-3.4 expected to document gap; no other scenarios distorted |
| G4 | High | No site_id on key tables | Phase C measures JOIN cost; evidence for denormalisation |
| G6 | High | No site-scoped RLS | API-layer isolation tested; direct DB access blocked by ops policy |

### POST-C (defer until after Phase C) — 5 items

| ID | Severity | Finding | Why deferred |
|----|----------|---------|-------------|
| C3 | Critical | Cascade delete no soft-delete | Phase C tests individual separation only; no bulk DELETE path exercised |
| H4 | High | No partition auto-provision after 2027 | 18+ months out; zero Phase C impact |
| H8 | High | Six schedulers no heartbeat | WP4-4.5 is designed to document this gap, not fix it pre-Phase C |
| G5 | High | No multi-legal entity | Product architecture decision required; not in Phase C scope |
| G7 | High | Cluster manager RBAC | WP3-3.11 uses hr_admin fallback as specified |

---

## Pre-Phase C Work Tranche (GATE-1 items only)

**12 items. Estimated effort: 16–22 engineering days.**

### Recommended execution order

**Track A — Schema / indexes (parallel, run before any data seeding)**

All four are `CREATE INDEX CONCURRENTLY` or index rebuilds on empty tables. Run them together before WP1 data seeding begins.

| Step | Item | Effort | Notes |
|------|------|--------|-------|
| A1 | C1 — `audit_logs` composite index | 1 h | `(tenant_id, created_at DESC)` |
| A2 | H1 — `attendance_daily` status+date index | 0.5 d | `(tenant_id, status, date DESC)` |
| A3 | H2 — `employees` group indexes rebuild | 0.5 d | `(tenant_id, payroll_group)`, etc. |
| A4 | H3 — `employees.joining_date` rebuild | 0.5 d | `(tenant_id, joining_date)` |

**Track B — Quick API fixes (parallel with or just after Track A)**

Low-risk logic changes, each self-contained.

| Step | Item | Effort | Notes |
|------|------|--------|-------|
| B1 | C7 — Muster limit 50 k → 200 k | 0.5 d | Add `X-Truncated` header; unblocks all muster WP2 scenarios |
| B2 | H10 + H11 — Helpdesk pagination + stats SQL | 1.5 d | Pair these; unblocks WP2-2.11 |
| B3 | H15 — Muster export limit guard | 0.5 d | Mirror payroll export pattern |

**Track C — Complex logic changes (sequential)**

These are higher-complexity and have inter-dependencies. Execute in order.

| Step | Item | Effort | Prerequisite | Notes |
|------|------|--------|-------------|-------|
| C-1 | C6 — Payroll async handler | 3–5 d | None | Critical path; highest Phase C impact |
| C-2 | C4 — Leave sub-job splitting | 3–4 d | None | Prerequisite for H5 to be testable |
| C-3 | C5 — WhatsApp batching + send log | 2–3 d | None | Can run in parallel with C-1/C-2 |
| C-4 | G2 — Recursive CTE manager hierarchy | 3–5 d | None | Can run in parallel with C-1/C-2 |

### Total tranche estimate

| Track | Items | Effort |
|-------|-------|--------|
| A — Indexes | C1, H1, H2, H3 | ~1.5 d (parallel) |
| B — API fixes | C7, H10+H11, H15 | ~2.5 d (parallel) |
| C — Logic | C6, C4, C5, G2 | ~12–17 d (partial parallel) |
| **Total wall-clock** | | **~2.5–3 weeks with 2 engineers** |

Track A and B can be executed by one engineer in 4 days. Track C items (C6, C4, C5, G2) can run in parallel across two engineers in ~2 weeks.

---

## Decision Checkpoint Before Phase C

Once the GATE-1 tranche is complete, run this checklist before starting Phase C:

- [ ] All 4 Track A index migrations deployed and confirmed on the Phase C database
- [ ] WP1 data seeding complete (5,000 employees, year-1 history) **after** indexes are deployed
- [ ] Muster endpoint returns 155,000 rows without truncation (smoke test C7)
- [ ] Payroll run returns 202 with `run_id` and completes asynchronously (smoke test C6)
- [ ] Leave accrual sub-jobs each appear as separate durable queue entries (smoke test C4)
- [ ] WhatsApp poll sends in batches; `pulse_send_log` records are created (smoke test C5)
- [ ] Helpdesk admin queue returns paginated result < 2 s (smoke test H10)
- [ ] Muster export returns complete CSV for one month's data (smoke test H15)
- [ ] `getDirectReportIds()` returns all 6-level subordinates for a test manager (smoke test G2)

All nine checkboxes must pass before Phase C scenario runs begin.

---

*Generated from Phase B static audit. No execution testing has been performed.
Source: `docs/CognixHR_5000_Employee_MultiSite_Readiness_Plan.md §5`*
