# CognixHR — 5,000-Employee Multi-Site Readiness Certification Plan

**Document type:** Phase A (Readiness Design) + Phase B (Static Audit)
**Prepared:** 3 July 2026
**Scope:** Scale and functional readiness assessment for CognixHR at 5,000-employee / multi-site enterprise
**Status:** Phase A + B complete. Phase C (execution) and Phase D (final memo) pending.

---

## Table of Contents

1. [Reference Enterprise Customer Profile](#1-reference-enterprise-customer-profile)
2. [Readiness Plan — Validation Buckets and Thresholds](#2-readiness-plan)
3. [Static Audit — What Is Already Safe](#3-static-audit--already-safe)
4. [Static Audit — Scale Risks Identified Before Testing](#4-static-audit--scale-risks)
   - 4.1 Database layer
   - 4.2 Scheduler / durable queue
   - 4.3 API query patterns
   - 4.4 Multi-site functional completeness
5. [Consolidated Risk Register](#5-consolidated-risk-register)
6. [Suggested Sequencing for Phase C and Phase D](#6-suggested-sequencing)

---

## 1. Reference Enterprise Customer Profile

### 1.1 Organisation Shape

| Dimension | Value | Notes |
|-----------|-------|-------|
| Total employees | 5,000 | Active headcount; ~200 separated/month |
| Legal entities | 1 (single tenant) | Multi-entity not yet supported in the platform |
| Sites / branches | 12 | 3 metro offices, 4 regional offices, 5 manufacturing / field locations |
| Clusters | 3 | North, South, West — each with a cluster manager |
| Departments | 35 | Some sites share departments; finance and HR are HQ-only |
| Org depth (manager chain) | 6 levels | CEO → BU Head → Regional Head → Manager → TL → Employee |
| Direct reports per manager | avg 8, max 40 | Team leads have smaller spans; site heads have wide spans |
| Employment types | 4 | Regular, contractual, intern, apprentice |
| Payroll groups | 4 | Head-office monthly, factory weekly-off-adjusted, contract, executive |
| Shifts | 8 | Day / Evening / Night for manufacturing; standard / flexi / WFH for offices |
| Roster types | 5 | 5-day, 6-day, rotating 3-shift, factory 4-on-4-off, retail flexi |
| Leave types | 12 | EL, CL, SL, PL, ML, PatL, comp-off, LWP, restricted holidays (2), optional (1), emergency |
| Holiday calendars | 6 | National + 3 regional (state-specific) + 2 factory (union calendar) |
| Attendance policy variants | 3 | Office (5-min grace), Field (30-min grace), Manufacturing (punch-in required, no grace) |
| Biometric devices | 45 | ~3–4 per site; mix of fingerprint and face-recognition |
| WhatsApp-enrolled employees | 3,800 | Used for pulse poll, leave approvals, payslip notifications |
| ESS daily active users | 2,000 | Peak: 09:00–10:00, Mon–Fri |
| HR admins | 18 | 1–2 per site + central HRIS team |
| Payroll runs / month | 2 | One for regular staff, one for contractual |

### 1.2 Data Volume Assumptions

| Table | Rows at steady state (year 3) |
|-------|-------------------------------|
| employees | 5,000 active + ~3,600 separated archive |
| attendance_daily | 1.825M/year → **5.5M at year 3** |
| attendance_raw_logs | 3.65M/year → **10.9M at year 3** |
| attendance_punch_logs | 3.65M/year → **10.9M at year 3** |
| leave_requests | ~30,000/year (avg 6/employee) → **90,000 at year 3** |
| leave_accrual_ledger | ~60,000/year → **180,000 at year 3** |
| payroll_slips | 60,000/year → **180,000 at year 3** |
| payroll_run_employees | 60,000/year → **180,000 at year 3** |
| audit_logs | ~500,000/year (triggers) → **1.5M at year 3** |
| security_events | ~200,000/year → **600,000 at year 3** (partitioned) |
| pii_access_log | ~50,000/year → **150,000 at year 3** |
| helpdesk_tickets | ~18,000/year → **54,000 at year 3** |
| succession_candidates | ~200 active plans → stable |

### 1.3 Top 20 Business-Critical Flows

These are the flows that **must work correctly at scale**. Any failure here is a production incident.

| # | Flow | Peak timing | Employees involved | SLA target |
|---|------|-------------|-------------------|------------|
| 1 | Monthly payroll run (5,000 regular employees) | 25th–28th of month | 3,500 | < 30 min end-to-end |
| 2 | Monthly payroll run (contractual) | 28th–30th of month | 1,500 | < 15 min |
| 3 | Daily attendance ingestion (biometric + API) | 05:00, 09:00, 14:00, 18:00 | 5,000 | < 5 min per cycle |
| 4 | Daily muster report (admin view) | 09:30 daily | 5,000 | Page load < 3 s |
| 5 | Who's-in dashboard (real-time) | 09:00–10:00 | 5,000 | < 2 s |
| 6 | Leave request submission + approval (ESS) | Mon 09:00 surge | ~300 simultaneous | Submit < 1 s, approve < 2 s |
| 7 | Monthly leave accrual (leave-scheduler-tick) | 1st–3rd of month | 5,000 × 12 leave types | Complete < 20 min |
| 8 | Year-end carry-forward | 31 Dec / 31 Mar | 5,000 | Complete < 30 min |
| 9 | ESS home page load (concurrent 9 AM peak) | 09:00 Mon | 2,000 concurrent | < 2 s |
| 10 | Weekly mood poll (WhatsApp, 3,800 enrolled) | Mon 09:00 | 3,800 | All sent < 30 min |
| 11 | Muster roll export (CSV, monthly) | Month-end | 5,000 × 31 days | < 3 min |
| 12 | Payroll register export (all departments) | Month-end | 5,000 | < 2 min |
| 13 | Attendance-payroll comparison report | Month-end | 5,000 | < 5 min |
| 14 | Helpdesk admin ticket queue (all open tickets) | Daily | Cumulative | < 2 s |
| 15 | Org-tree render (admin org chart) | On demand | 5,000 | < 3 s |
| 16 | Employee separation / offboarding | Ad hoc | 1 at a time | Auth revoked < 5 s |
| 17 | Inter-site employee transfer | Ad hoc | 1 at a time | Effective immediately |
| 18 | Payroll run blockers check | Pre-run | 5,000 | < 5 s |
| 19 | Audit log compliance dashboard | Monthly audit | Year's worth | < 5 s |
| 20 | Intelligence scan (6-hourly) | Every 6h | 5,000 | Complete < 15 min |

### 1.4 Pass / Fail Thresholds

| Category | Pass threshold | Conditional pass | Fail |
|----------|----------------|------------------|------|
| API p95 response time (read) | < 500 ms | 500 ms – 2 s | > 2 s |
| API p95 response time (export/report) | < 3 min | 3–10 min | > 10 min or timeout |
| Payroll run end-to-end | < 30 min | 30–60 min | > 60 min or HTTP timeout |
| Scheduler job completion within timeout | 100% of jobs complete before timeout | Any job hits timeout but retries succeed | Any job consistently DLQs |
| Data correctness (leave balance, payroll) | Zero discrepancy | — | Any incorrect result |
| Muster data completeness | 100% of employees | — | Any silent truncation |
| WhatsApp poll delivery | > 99% of enrolled employees, no duplicates | 95–99%, no duplicates | < 95% or any duplicate |
| Cascade employee delete (separation archive) | No timeout, no partial state | — | Any timeout or partial cascade |
| Multi-site report isolation | Site A HR sees only Site A data | — | Cross-site data leak |
| Auth revocation on separation | < 5 s from lifecycle event | 5–60 s | > 60 s or missed |

---

## 2. Readiness Plan

### Work Package 1 — Data Volume and Org-Shape Simulation

**Objective:** Seed a realistic 5,000-employee dataset that mirrors the reference customer profile before any execution testing.

| Test scenario | Data to create | Acceptance |
|---------------|---------------|------------|
| 1.1 Employee seeding | 5,000 employees across 12 sites, 35 departments, 4 employment types, 8 shift assignments | All employee records created; org-tree renders correctly |
| 1.2 Manager hierarchy | 6-level tree; no cycles; cluster managers link to sites | `PUT /employees/:id/manager` cycle check passes for all 5,000 |
| 1.3 Leave balance seed | 12 leave types × 5,000 employees = 60,000 balance rows | All balances match expected entitlement formula |
| 1.4 Attendance history | 365 days × 5,000 employees = 1.825M rows; realistic mix of present/absent/half-day/leave | attendance_daily rows created with no UNIQUE violations |
| 1.5 Payroll history | 12 months × 5,000 employees = 60,000 payroll_slips; realistic gross/net/deductions variance | All slips created; variance report shows expected spread |
| 1.6 Multi-site holiday calendars | 6 distinct calendars assigned to 12 sites | Holiday resolution returns site-correct holidays for each employee |
| 1.7 Biometric device registration | 45 devices registered; employee-code-to-device mapping | All attendance_raw_logs have valid device_id (or source_id) |
| 1.8 Separation archive | 200 separated employees; profiles inactive; auth banned | Separated employees cannot log in; data preserved |

**Data volumes that will stress the system (create these first):**
- `attendance_daily`: 1.825M rows minimum (year of history)
- `attendance_raw_logs`: 3.65M rows (matching the daily records)
- `audit_logs`: ~200,000 rows (triggered by employee + leave operations above)
- `leave_accrual_ledger`: ~60,000 rows (12 leave types × 5,000 employees)

---

### Work Package 2 — Core Workflow Scale Validation

**Objective:** Validate that every high-volume business workflow completes within SLA at 5,000-employee load.

| # | Scenario | Method | Pass criteria |
|---|----------|--------|---------------|
| 2.1 | Payroll run — 5,000 employees | Trigger via `POST /payroll/runs` | Completes without HTTP timeout; all 5,000 slips created; total < 30 min |
| 2.2 | Payroll run — 1,500 contractual | Same | < 15 min |
| 2.3 | Attendance ingestion cycle (5-min tick) | Monitor `process-attendance` durable job; inject 5,000 raw punches | All records upserted within one cycle; job completes before next tick |
| 2.4 | Daily muster report | `GET /attendance/muster?date=YYYY-MM-DD` | Returns all 5,000 employees; no truncation; < 3 s |
| 2.5 | Monthly muster export (CSV) | `GET /reports/muster-roll/export?month=YYYY-MM` | 155,000 rows exported without timeout; file complete |
| 2.6 | Who's-in dashboard | `GET /attendance/who-is-in` concurrent × 50 | Each request < 2 s; no timeout; correct employee count |
| 2.7 | Leave accrual (monthly, tick) | Trigger `POST /leave/jobs/monthly-accrual` for all 5,000 | Completes within durable job 120s timeout OR new per-job timeout is confirmed |
| 2.8 | Year-end carry-forward | Trigger `POST /leave/jobs/carry-forward` | All eligible balances carried; no employee missed; < 30 min |
| 2.9 | Leave request surge (concurrent) | 300 simultaneous `POST /leave-requests` | All submitted without 500; no duplicate leave rows; p95 < 1 s |
| 2.10 | Weekly mood poll (WhatsApp) | Monday 09:00 — `send-pulse-poll` durable job | 3,800 messages delivered; no duplicates; no timeout |
| 2.11 | Helpdesk admin queue | `GET /helpdesk/tickets` | Returns paginated result < 2 s; not a full table dump |
| 2.12 | Attendance-payroll comparison | `GET /reports/attendance-payroll-comparison` | Completes < 5 min; all 5,000 rows present; no memory OOM |
| 2.13 | ESS home page (concurrent) | 2,000 simultaneous `GET /ess/home` | p95 < 2 s; birthday/anniversary data complete for full org |
| 2.14 | Payroll blockers check | `GET /payroll/runs/blockers` | < 5 s; no timeout; all blocking conditions surfaced |
| 2.15 | Separation + auth revocation | `PATCH /employees/:id/separation/relieve` | `profiles.is_active = false` and JWT banned within 5 s |
| 2.16 | Bulk payslip export | `GET /payroll/runs/:id/export` | 5,000 rows exported; hits 10,000-row guard correctly if needed |
| 2.17 | Intelligence scan | Monitor 6h durable job | Completes within durable job timeout; all check types run |
| 2.18 | Audit log compliance query | `GET /audit-logs?tenant_id=X&from=Y&to=Z` | < 5 s for 30-day window; 1.5M+ row table |
| 2.19 | Co-expiry job | `POST /leave/jobs/co-expiry` | Completes without unbounded SELECT blowout; correct rows expired |
| 2.20 | SLA scanner | 4h durable tick | All SLA-breached items surfaced; no missed items |

---

### Work Package 3 — Multi-Site Functional Validation

**Objective:** Confirm that site-differentiated features work correctly for employees across 12 sites.

| # | Scenario | What to test | Pass criteria |
|---|----------|-------------|---------------|
| 3.1 | Site-specific holiday calendar | Employee at factory Site A (union calendar) and employee at HQ (national calendar) both apply for leave on a state holiday | Factory employee gets LWP; HQ employee gets approved leave; different holiday records used |
| 3.2 | Attendance policy by site (grace period) | Employee at office punches in 12 minutes late; employee at field punches in 35 minutes late | Office employee marked LATE; field employee marked PRESENT (30-min grace) |
| 3.3 | Shift differentiation by site | Manufacturing site has 3 rotating shifts; HQ has flex shift | Muster report shows correct shift context per employee |
| 3.4 | Biometric device scoping | Device at Site A ingests punch for an employee assigned to Site B | Behaviour documented: currently no site-to-device binding — punch is accepted by any device |
| 3.5 | Manager hierarchy depth (6 levels) | Leave request from a Level 6 employee goes to Level 5 manager for approval | Level 5 manager sees the request in pending approvals; Level 4 does not (unless skip-level configured) |
| 3.6 | Inter-site employee transfer | Move employee from Site A to Site B via `POST /employees/:id/job-history` (reason: Transfer) + `POST /employees/:id/org-context` | Employee's site_id updated; attendance and leave now resolved under new site's calendar and policy |
| 3.7 | Roster assignment (site-level default) | New employee onboarded at manufacturing site with 4-on-4-off roster | `employees.roster_id` = manufacturing roster; shift_roster resolves correctly |
| 3.8 | Weekly-off rules by site | Office site: Saturday off. Factory site: rotating Saturday | Attendance correctly marks WO per employee's roster, not a uniform rule |
| 3.9 | Multi-site leave approval delegation | Manager on leave: auto-escalation to deputy or HR admin | Pending approvals do not block |
| 3.10 | Multi-site attendance report (admin) | HR admin at Site A runs muster for their site only; HR admin at HQ runs muster for all sites | Site-scoped HR sees only their site's employees (application-layer filter confirmed; RLS not site-scoped) |
| 3.11 | Cluster manager visibility | Cluster manager for North cluster views dashboard | Dashboard shows North cluster sites only; cross-cluster data not visible (currently: RBAC deferred — verify with role=hr_admin fallback) |
| 3.12 | Org tree multi-level | CEO views full org tree of 5,000 employees | Tree loads completely; no silent 1,000-employee truncation |
| 3.13 | Geo-fence validation | Employee punches in via mobile from outside geo-fence radius | Current platform: geo-fence columns exist on `sites` but no enforcement engine — document gap |
| 3.14 | Succession plan (multi-site) | Succession plan for a Regional Head role; candidates span 3 sites | All candidates visible regardless of site; readiness levels editable |
| 3.15 | Letter generation (multi-site header) | Appointment letter issued to Site B employee uses Site B address and GSTIN | Letter template resolution uses correct site-level variables |

---

### Work Package 4 — Operational Readiness and Observability

**Objective:** Confirm that the platform can be operated at 5,000-employee scale: failures are detected, queues drain, and recovery is possible.

| # | Scenario | What to test | Pass criteria |
|---|----------|-------------|---------------|
| 4.1 | Durable queue DLQ visibility | Deliberately kill a leave-scheduler-tick mid-run; inspect dead jobs | Dead job appears in `GET /system/jobs/durable/dead` with failure_category and error; manual requeue works |
| 4.2 | Retry storm detection | Submit 15 identical failing jobs within 10 min | `retry_storm_incidents` row created; `GET /system/jobs/durable/retry-storm` returns incident |
| 4.3 | Poison job quarantine | Requeue a dead job 4 times; observe quarantine | Job appears in `GET /system/jobs/durable/quarantine`; no further auto-retry |
| 4.4 | Leave-scheduler heartbeat staleness | Kill the leave-scheduler plugin; wait 2h | `GET /system/scheduler-health` returns stale=true for leave-scheduler; alerting trigger documented |
| 4.5 | Non-leave scheduler silence detection | Kill digest-scheduler; wait 2h | No automated staleness detection — gap documented (digest, poll, SLA, intelligence, WO-credit, absconding write no heartbeat) |
| 4.6 | Payroll run failure recovery | Simulate partial payroll run failure at employee #2,500 | Remaining employees are not left in corrupted state; re-trigger processes remaining employees only (idempotency) |
| 4.7 | Attendance ingest source failure | Disconnect one biometric API source; observe muster impact | Muster shows "no punch" for affected device's employees; alert fires; `attendance_api_sources.last_fetch_status` = error |
| 4.8 | Slow API detection | `GET /attendance/muster` for a full month at 5k employees | Supabase query plan available via `/metrics`; slow query detected; response time logged |
| 4.9 | DB connection pool | 2,000 concurrent ESS home requests | No "too many connections" errors; Supabase pool handles the load |
| 4.10 | Backup / restore drill | Restore from latest Supabase backup into staging | Restore completes within RTO ≤ 4h; data consistent; `restore_drills` row recorded |
| 4.11 | Partition health (security_events) | Check `security_events` DEFAULT partition row count after 6 months of use | DEFAULT partition is empty (all writes land in correct monthly partition); if exhausted partitions → DEFAULT, alert |
| 4.12 | Queue depth monitoring | Inject 100 jobs; observe pending count trend | `GET /metrics` shows pending count rise and drain; no infinite-growing queue |
| 4.13 | WhatsApp poll retry (partial send) | Kill `send-pulse-poll` at employee #1,500 | On retry: employees 1–1,500 do NOT receive a duplicate; employees 1,501–5,000 receive message. (Currently: this will fail — no per-employee send log exists) |
| 4.14 | Module health dashboard | Check `/system/module-health` after full-system startup | All 5 modules (durable-queue, leave-scheduler, attendance-processor, payroll-engine, notification-service) show healthy |
| 4.15 | 90-day DLQ purge | Trigger `DELETE /system/jobs/durable/dead?days=90` | Dead jobs older than 90 days removed; recent dead jobs retained |

---

### Work Package 5 — Certification Scorecard

**Objective:** Produce a binary certification result with a structured pass/fail matrix.

**Certification categories:**

| Domain | Weight | Blockers (automatic Fail) |
|--------|--------|--------------------------|
| Core workflow scale | 30% | Payroll run HTTP timeout; muster silent truncation; leave accrual consistent DLQ |
| Data correctness | 25% | Any incorrect leave balance; any missing payslip; any muster data gap |
| Operational observability | 20% | No DLQ visibility; no module health detection; no scheduler heartbeat for any job |
| Multi-site functional | 15% | Cross-site data leak; wrong holiday calendar applied; attendance policy not differentiated |
| Performance (p95 SLAs) | 10% | Any p0 endpoint (payroll, muster, ESS home) > 2× SLA threshold |

**Certification output:**

| Result | Criteria |
|--------|----------|
| **Certified** | All blocker scenarios pass; weighted score ≥ 85%; no critical issues open |
| **Conditionally Certified** | No blockers; weighted score 70–84%; up to 3 medium issues with remediation commitment |
| **Not Yet Certified** | Any blocker fails; or weighted score < 70%; or any data-correctness failure |

---

## 3. Static Audit — Already Safe

These areas have been audited against the current build and are likely to hold at 5,000-employee scale without modification.

| Area | Verdict | Evidence |
|------|---------|---------|
| Employee list API (`GET /employees`) | Safe | Paginated (max 500), parallel IN-list enrichment (no N+1), tenant_id first |
| Employee search (`GET /employees/search`) | Safe | Hard `.limit(20)`, two queries total |
| Leave request admin list | Safe | Paginated (max 200, default 50), tenant_id indexed |
| Leave balance table | Safe | UNIQUE (tenant_id, employee_id, leave_type_id, year) covering index; small table |
| Approval pending count | Safe | COUNT-only HEAD query; no data transfer |
| ESS my-leave and self-service endpoints | Safe | All scoped to single employee_id |
| Payroll slip list (`GET /payroll/runs/:id/slips`) | Safe | Paginated (max 200), indexed on run_id |
| Payroll run export (`GET /payroll/runs/:id/export`) | Safe | Hard `EXPORT_LIMIT = 10,000`; returns 422 when exceeded |
| Payroll variance report | Safe | Hard `VARIANCE_LIMIT = 10,000` |
| Attendance ingestion (durable queue, chunked) | Safe | 500-row chunks per batch, upsert idempotent, 5-min idempotency key |
| Separation auth revocation (AF-001) | Safe | `ban_duration: '876000h'` on terminal state; non-fatal warn on auth failure |
| Holiday calendar resolution | Safe | Four-level priority (site > location > group > global) fully modelled |
| Shift / roster model | Safe | Complete: shifts, split-shifts, rosters, rotation groups, rotation policies, fatigue rules |
| ESS team endpoint | Safe | Explicit limits: 20 peers, 30 direct reports, 200 leave records |
| Durable queue: retry / DLQ infrastructure | Safe | Max 3 retries, exponential backoff, DB-backed DLQ, poison-job quarantine, retry-storm detection |
| Leave accrual idempotency | Safe | `cycleKey` UNIQUE constraint prevents duplicate ledger entries on re-run |
| Audit log trigger infrastructure | Safe | `fn_audit_immutable` blocks UPDATE/DELETE; triggers fire on all key tables |
| Security events partitioning (until 2027) | Safe | `PARTITION BY RANGE (occurred_at)` monthly partitions provisioned through Dec 2027 |
| Succession candidate endpoint (post-fix) | Safe | `readiness_level` z.enum validated; 409 on duplicate; 503 when AI key absent |
| Letters sanitization (post-fix) | Safe | All HTML render paths call `sanitizeHtml()`; `printLetter()` fix deployed |
| Tenant isolation (RLS + application layer) | Safe | Every table has `tenant_id = get_user_tenant_id()` RLS; application layer enforces `req.tenantId` |

---

## 4. Static Audit — Scale Risks

### 4.1 Database Layer

#### CRITICAL

**C1 — `audit_logs` missing composite index `(tenant_id, created_at DESC)`**
- Current: `idx_audit_tenant` is `(tenant_id)` alone; `idx_audit_timestamp` is `(created_at DESC)` with no tenant.
- Impact: Compliance dashboard query "show audit trail for tenant X in the last 30 days" scans all of tenant X's audit rows (potentially 1.5M+ at year 3) with no date pruning.
- Fix: `CREATE INDEX CONCURRENTLY idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);`
- Migration: `006_audit_logs.sql:14–16`

**C2 — `attendance_raw_logs`, `attendance_daily`, `attendance_punch_logs` not partitioned**
- `attendance_raw_logs`: 3.65M rows/year → 10.9M at year 3. Single heap, no range pruning.
- `attendance_daily`: 1.825M rows/year → 5.5M at year 3. All HR dashboards and report queries scan this heap.
- `attendance_punch_logs`: Parallel volume to `attendance_raw_logs`.
- Impact: By year 2, every monthly muster report and leave-attendance comparison scans millions of rows in a single table. Query time will degrade significantly without partition pruning.
- Fix: `PARTITION BY RANGE (date)` (annual or bi-annual) with `ATTACH PARTITION` for current + historical data. Auto-provision new partitions via `pg_cron` or a migration-based provisioning job.
- Migrations: `019_attendance.sql`, `043_attendance_punch_logs.sql`

**C3 — Cascade delete across 89+ tables; no soft-delete**
- Deleting a single `employees` row triggers cascades across at minimum 30 distinct tables.
- At 5,000-employee scale, a mass-separation operation (200 employees/month) with `DELETE FROM employees WHERE id = ANY(...)` for a batch will hold row-level locks on every dependent table for multiple minutes, generate enormous WAL volume, and likely timeout under Supabase's default 30-second query timeout.
- No `is_deleted / deleted_at` pattern exists. No archival mechanism for separated employees.
- Fix (short-term): Never batch-delete employees; set `employees.status = 'separated'` and apply the AF-001 auth revocation — do not DELETE rows. Document this as platform policy.
- Fix (long-term): Add `deleted_at TIMESTAMPTZ` + `is_deleted BOOLEAN DEFAULT false` columns; migrate all `DELETE` paths to soft-delete.

#### HIGH

**H1 — `attendance_daily` missing `(tenant_id, status, date DESC)` index**
- Dashboards showing "absent/late/present counts for tenant on a date range" do a post-filter scan across millions of rows.
- Fix: `CREATE INDEX CONCURRENTLY idx_ad_status_date ON attendance_daily (tenant_id, status, date DESC);`
- Migration: `019_attendance.sql`

**H2 — `employees` group indexes lack `tenant_id` prefix**
- `idx_employees_payroll_group`, `idx_employees_employment_category`, `idx_employees_statutory_group` (113b:133–135) are partial indexes without `tenant_id`. Cross-tenant planner scan is possible.
- Fix: Rebuild each as `(tenant_id, {column}) WHERE {column} IS NOT NULL`.

**H3 — `employees.joining_date` index has no `tenant_id` prefix**
- `idx_employees_joining` (`004_employees.sql:49`) is `(joining_date)` only.
- Fix: `CREATE INDEX CONCURRENTLY idx_employees_tenant_joining ON employees (tenant_id, joining_date);` and drop old index.

**H4 — No auto-provisioning for `security_events` and `trace_spans` partitions**
- Migration 348 explicitly acknowledges: "partition_maintenance scheduler job never implemented."
- Pre-created partitions run through Dec 2027. After that, writes land in DEFAULT partition with no range pruning.
- Fix: Implement the partition-maintenance scheduler job before Dec 2027 (practical deadline: mid-2027).

#### MEDIUM

**M1 — `payroll_runs` missing `(tenant_id, status)` index**
- Listing draft/failed runs for a tenant does a seq scan after tenant filter.
- Fix: `CREATE INDEX CONCURRENTLY idx_payroll_runs_status ON payroll_runs (tenant_id, status);`

**M2 — `payroll_slips` missing `(tenant_id, month DESC)` standalone index**
- Month-level bulk export cannot use existing indexes without employee_id.
- Fix: `CREATE INDEX CONCURRENTLY idx_payroll_slips_month ON payroll_slips (tenant_id, month DESC);`

**M3 — No autovacuum tuning on high-churn tables**
- Supabase defaults to `autovacuum_vacuum_scale_factor = 0.2`. For `attendance_daily` (1.825M rows/year), VACUUM will not trigger until 365,000 dead tuples accumulate — a realistic scenario given nightly batch status updates.
- Zero `ALTER TABLE ... SET (autovacuum_*)` statements exist in all 352 migrations.
- Fix: Add migration with aggressive autovacuum tuning for `audit_logs`, `attendance_daily`, `employee_leave_balance`, `payroll_slips`, and `payroll_run_employees` (scale_factor = 0.01; vacuum_cost_delay = 2ms).

**M4 — No retention / archival strategy for unbounded tables**
- `audit_logs`, `pii_access_log`, `payroll_explainability_ledger`, `event_log`, `platform_events`: no `expires_at`, no partitioning, no defined TTL. These grow unboundedly.
- Fix: Define retention policy per table (audit_logs: 7 years; pii_access_log: 5 years; others TBD) and implement either partitioned archival or a pg_cron TTL DELETE job.

**M5 — `pii_access_log` missing `(tenant_id, accessor_id, accessed_at DESC)` composite**
- Forensic query "what did accessor X access within tenant Y in the last 7 days" uses non-composite indexes.
- Fix: `CREATE INDEX CONCURRENTLY idx_pii_access_tenant_accessor ON pii_access_log (tenant_id, accessor_id, accessed_at DESC);`

---

### 4.2 Scheduler / Durable Queue

#### CRITICAL

**C4 — `leave-scheduler-tick`: all 6 sub-jobs share one 120-second durable job timeout**
- On the 1st of the month, monthly_accrual + carry_forward (at year-end) + co_expiry + event_grants + reconciliation all run sequentially within a single durable job execution.
- At 5,000 employees × 12 leave types, monthly_accrual alone requires O(60,000) DB operations. Conservative estimate: 60–120 seconds minimum. The combined tick will almost certainly timeout.
- On timeout the job retries up to 3 times (DLQ after 3). Each retry restarts from scratch (but idempotent writes skip already-done rows). If all 3 retries timeout, co_expiry and reconciliation may not run that day — silent leave balance errors.
- Fix: Split sub-jobs into independent durable queue jobs. Each gets its own timeout, retry counter, and DLQ entry. `leave-scheduler-tick` should only enqueue the sub-jobs, not execute them inline.

**C5 — `send-pulse-poll`: 5,000 serial WhatsApp API calls in a 120-second timeout**
- At 3,800 enrolled employees, each API call must complete in ≤ 32 ms average. Any latency spikes cause timeout.
- No per-employee send tracking: retry resends to all 3,800 employees, including those who already received it. This produces guaranteed duplicates on timeout.
- Fix:
  1. Add `pulse_send_log` table with UNIQUE `(question_id, employee_id)` to track per-employee send state.
  2. Chunk employees into batches of 100; enqueue each batch as a separate durable sub-job.
  3. Batch with `Promise.allSettled` at concurrency = 20 (within external API rate limits).

#### HIGH

**H5 — `monthly_accrual` and `yearly_accrual` O(N × M) sequential DB writes**
- Per-row iteration: N employees × M leave policies = potentially 50,000+ sequential DB round trips per run.
- No internal batching or chunking. Each iteration fires: ledger check → ledger insert → balance credit (2–3 DB calls minimum).
- Fix: Implement bulk-upsert for `leave_accrual_ledger` and `employee_leave_balance` using Postgres `INSERT ... ON CONFLICT DO UPDATE` arrays to reduce DB round trips from O(N×M) to O(N×M / batch_size).

**H6 — `fetchActiveEmployees()` called multiple times per tick (no shared cache)**
- Within one leave-scheduler-tick, up to 6 sub-jobs each call `fetchActiveEmployees()` independently, loading 5,000 employee rows 6 times per hour.
- Fix: Fetch employees once in the tick orchestrator; pass the array to all sub-jobs.

**H7 — `co_expiry` unbounded initial SELECT on `leave_accrual_ledger`**
- `coExpiryJob` selects all expired ledger rows with no LIMIT. On batch comp-off expiry events, this could return hundreds of thousands of rows into Node.js memory.
- Fix: Process in chunks of 1,000 rows using a cursor or `id > last_processed_id` pattern.

**H8 — Six schedulers write no heartbeat**
- digest-scheduler, poll-scheduler, SLA scanner, intelligence scanner, WO-credit reconciler, and absconding scanner have no `scheduler_heartbeats` entry. A silent crash is undetected.
- Fix: Add a `scheduler_heartbeats` write to each scheduler's main loop using `upsert` with the scheduler name, last_tick, and next_expected_tick.

**H9 — Intelligence scanner multi-pass over all 5,000 employees**
- Each 6-hour run performs multiple sequential passes (onboarding blockers, payroll blockers, mood trends, benefits alerts, etc.) over the full employee set.
- No per-batch checkpointing; if the job times out mid-run, the full scan restarts.
- Fix: Each intelligence check type should be a separate durable sub-job; add cursor-based pagination to the employee iteration.

---

### 4.3 API Query Patterns

#### CRITICAL

**C6 — `POST /payroll/runs`: blocking HTTP handler, PAYROLL_CONCURRENCY = 10**
- The entire payroll computation runs inside the HTTP request handler. At 5,000 employees:
  - 500 serial batch rounds (10 employees per `Promise.all` × 500 rounds)
  - ~5 DB calls per employee = ~2,500 sequential DB round trips
  - Conservative wall-clock: 100–250 seconds
  - Standard HTTP / load balancer timeout: 60 seconds → guaranteed timeout in production
- Fix:
  1. Return immediately with a `run_id` and HTTP 202 Accepted.
  2. Process the payroll run entirely in a durable background job with a 30-minute timeout.
  3. Raise `PAYROLL_CONCURRENCY` to 50–100 once off the request thread.
  4. Expose `GET /payroll/runs/:id/status` for polling.

**C7 — `GET /attendance/muster`: `attendance_daily` silently truncated at 50,000 rows**
- At 5,000 employees × 31 days = 155,000 rows. The current hard limit is 50,000.
- Result: the muster report silently shows approximately 1,600 employees' worth of data. The remaining 3,400 employees appear to have no attendance records. No error is returned.
- Fix: Raise limit to 200,000 (covering 5,000 × 40 days). Add a response header `X-Truncated: true` when the limit is hit. Long-term: stream the muster response in chunks.

#### HIGH

**H10 — `GET /helpdesk/tickets` (admin queue): no pagination, SELECT \***
- Returns every ticket ever created for the tenant in a single response. At 54,000 tickets (year 3), this is a guaranteed page timeout and a large payload.
- Fix: Add `page`/`limit` pagination (max 100); remove `SELECT *`; use explicit column list.

**H11 — `GET /helpdesk/stats`: post-fetch JS aggregation on full ticket corpus**
- Fetches all tickets for the tenant, then aggregates counts in JavaScript. Should be a single SQL `COUNT(*) FILTER (WHERE ...)` query.
- Fix: Replace with a single SQL aggregation query returning open_count, sla_breached_count, resolved_count, resolution_rate.

**H12 — `GET /attendance/who-is-in`: loads all 5,000 employees synchronously**
- No pagination; five parallel queries fan out from the full employee list.
- Fix: Add pagination (page/limit) or limit to the requesting HR admin's site by default with an "all sites" toggle that requires explicit opt-in.

**H13 — `GET /datasets/employees`: unbounded heavy multi-table JOIN**
- Two unbounded queries spanning employees + job_history + sites + employee_personal_info + departments + locations + grades + designations (8 tables). Post-fetch region/zone filter in JavaScript.
- Fix: Add server-side pagination; push region/zone filter into the SQL WHERE clause.

**H14 — `GET /reports/attendance-payroll-comparison`: five unbounded queries**
- employees (no limit) + attendance_daily for date range (no limit) + payroll_slips for run (no limit) + payroll_anomalies for run (no limit) + leaves for date range (no limit).
- Fix: Add per-query limits; consider materializing comparison data at payroll finalization time rather than computing it on every request.

**H15 — `GET /reports/muster-roll/export`: no export limit guard**
- At 5,000 × 31 days = 155,000 rows, this times out. No `EXPORT_LIMIT` guard like the payroll export.
- Fix: Mirror the payroll export pattern: `EXPORT_LIMIT = 200,000`; return 422 with a clear message if exceeded; stream the CSV in chunks.

**H16 — `GET /payroll/runs/blockers`: three unbounded queries**
- All active employees (no limit) + attendance_daily for the month (no limit) + employee_compensations (no limit).
- Fix: Add `.limit(5000)` guards on all three queries.

#### MEDIUM

**M6 — `GET /employees/org-tree`: silently truncates at 1,000 employees**
- At 5,000 employees, the org tree returned is incomplete with no indication to the user.
- Fix: Raise limit to 10,000; return `{ data: tree, truncated: true, total_count: N }` if limit is hit.

**M7 — `GET /ess/home`: birthday/anniversary scan limited to 500 colleagues**
- Silently misses 90% of the organisation's upcoming birthdays and anniversaries.
- Fix: Replace the "fetch 500 colleagues and filter" approach with a direct date-range query: `WHERE date_part('month', date_of_birth) = $month AND date_part('day', date_of_birth) = $day`.

**M8 — Report exports with post-fetch JS department filtering (salary-sheet, leave-register, payroll-register)**
- Fetch all data for the run/period, then filter by department in JavaScript. At scale, this fetches 5,000 records to return ~200.
- Fix: Push department filter into the SQL WHERE clause; add pagination on export results.

---

### 4.4 Multi-Site Functional Completeness

#### CRITICAL GAPS (functional blockers for multi-site customers)

**G1 — `attendance_policies` (grace/threshold) not site-assignable**
- `attendance_policies` is scoped to `(tenant_id)` only. Grace period, late cap, present threshold, and half-day threshold are tenant-wide.
- At 5,000 employees across 12 sites with 3 distinct policy variants (office, field, manufacturing), this requires **per-employee policy overrides** for ~4,600 employees — an operational nightmare.
- Fix: Add `site_id UUID NULL` to `attendance_policies`; create an `attendance_policy_resolution` function that checks site-level policy first, then falls back to tenant default.

**G2 — Manager hierarchy resolves only one level in the application layer**
- `manager-scope.ts` `getDirectReportIds()` does a flat `.eq('manager_id', managerEmployeeId)` query — one level only.
- For a 6-level org, a VP (Level 2) cannot see their full org of ~500 reports through any leave approval, OT approval, team-view, or succession interface. Only their 8–15 direct reports (Level 3) are visible.
- Fix: Implement a recursive CTE (`WITH RECURSIVE subordinates AS ...`) in `getDirectReportIds()` with a configurable `max_depth` parameter. Add a `(manager_id, tenant_id, status)` index to support the recursive join efficiently.

**G3 — No `site_id` on `attendance_devices`**
- Biometric devices are registered tenant-wide with no site binding. A punch from a device at Site A cannot be geo-attributed to Site A in `attendance_raw_logs`.
- Impact: Multi-site attendance reports cannot filter by "punches from Site A devices" — must JOIN through employees.site_id.
- Fix: Add `site_id UUID NULL REFERENCES sites(id)` to `attendance_devices` and `attendance_raw_logs`. Add `location_id` as a secondary identifier.

**G4 — No site_id on `attendance_daily`, `leave_requests`, or `payroll_slips`**
- Every multi-site report requires a JOIN to `employees.site_id`. No index-only scan is possible for site-scoped queries on these tables.
- Fix: Add `site_id UUID NULL` (denormalized from `employees.site_id` at insert time) with partial indexes to `attendance_daily`, `leave_requests`, and `payroll_slips`. This is a denormalization trade-off that eliminates a JOIN on every multi-site query.

#### HIGH GAPS

**G5 — No multi-legal entity model**
- One tenant = one legal entity. A holding company with multiple subsidiaries cannot model them within a single tenant.
- Current workaround: each subsidiary is a separate tenant — no cross-tenant consolidated reporting.
- This is a product architecture gap, not a code bug. Planned as a future capability but not yet in scope.

**G6 — Site-level RLS isolation does not exist**
- Manager RLS policy (`007_rls_policies.sql`) covers direct reports only — no `site_id` filter.
- A manager at Site A who has a direct report at Site B (transferred but not updated in the system) can see Site B employee records through the RLS policy.
- The application layer compensates via `req.tenantId` enforcement, but direct Supabase client access bypasses this.
- Fix (short-term): Document that direct Supabase client access is not supported; enforce API-layer-only access.
- Fix (long-term): Add site-scoped RLS policies for `hr_viewer` and `manager` roles.

**G7 — Cluster manager RBAC not implemented**
- Migration 274 comments: "Phase 4 will grant cluster managers RBAC visibility over their cluster's sites." Not implemented.
- Cluster managers currently need `hr_admin` role to see cross-site data — which gives them full tenant access.
- Impact: Cannot restrict a cluster manager to their cluster's 3 sites; must grant full hr_admin.

**G8 — No atomic inter-site transfer workflow**
- Transfers are modelled as two independent operations: `POST /employees/:id/job-history` + `POST /employees/:id/org-context`. There is no atomic transaction, no approval workflow, and `reason_for_change` is a free-text field (not an enum).
- Fix (short-term): Document that both calls must be made in sequence; add a `POST /employees/:id/transfer` endpoint that wraps both in a transaction.

**G9 — Geo-fence enforcement not implemented**
- `sites.latitude`, `sites.longitude`, `sites.geofence_radius_m` columns exist (migration 275) but there is no enforcement engine, no mobile punch validation table, and no audit log for geo-fence violations.
- Impact: "Factory employees must punch in from within 100m of the site" is a configuration option with no enforcement.
- Fix: Implement geo-fence validation in the mobile punch endpoint using Haversine distance formula; log violations to a `geofence_violations` table.

---

## 5. Consolidated Risk Register

| ID | Area | Severity | Finding | Phase C test | Estimated fix effort |
|----|------|----------|---------|-------------|---------------------|
| C1 | DB | Critical | `audit_logs` missing `(tenant_id, created_at)` composite index | WP4-4.8 | 1h (one migration) |
| C2 | DB | Critical | `attendance_raw_logs`, `attendance_daily`, `attendance_punch_logs` not partitioned | WP2-2.4, 2.5 | 3–5 days (migration + data move) |
| C3 | DB | Critical | Cascade delete across 89+ tables; no soft-delete | WP2-2.15, 2.16 | 5–10 days (architecture change) |
| C4 | Scheduler | Critical | `leave-scheduler-tick` all sub-jobs in 1×120s durable job | WP2-2.7, 2.8 | 3–4 days |
| C5 | Scheduler | Critical | `send-pulse-poll` serial WhatsApp, no per-employee send log | WP2-2.10, WP4-4.13 | 2–3 days |
| C6 | API | Critical | Payroll run in blocking HTTP handler, PAYROLL_CONCURRENCY=10 | WP2-2.1, 2.2 | 3–5 days |
| C7 | API | Critical | Muster silently truncated at 50,000 rows (155,000 needed) | WP2-2.4 | 0.5 day |
| G1 | Multi-site | Critical | Attendance policies not site-assignable | WP3-3.2 | 3–5 days |
| G2 | Multi-site | Critical | Manager hierarchy resolves only 1 level | WP3-3.5, 3.11 | 3–5 days (recursive CTE) |
| H1 | DB | High | `attendance_daily` missing status+date index | WP2-2.4 | 0.5 day |
| H2 | DB | High | `employees` group indexes lack `tenant_id` prefix | WP1-1.1 | 0.5 day |
| H3 | DB | High | `employees.joining_date` index no `tenant_id` | WP1-1.1 | 0.5 day |
| H4 | DB | High | No auto-partition provisioning after Dec 2027 | WP4-4.11 | 1 day |
| H5 | Scheduler | High | Monthly/yearly accrual O(N×M) sequential writes | WP2-2.7, 2.8 | 3–4 days |
| H6 | Scheduler | High | `fetchActiveEmployees()` called N times per tick | WP2-2.7 | 0.5 day |
| H7 | Scheduler | High | `co_expiry` unbounded initial SELECT | WP2-2.19 | 1 day |
| H8 | Scheduler | High | Six schedulers write no heartbeat | WP4-4.5 | 1 day |
| H9 | Scheduler | High | Intelligence scanner multi-pass, no checkpointing | WP2-2.17 | 2–3 days |
| H10 | API | High | Helpdesk admin ticket list: no pagination, SELECT * | WP2-2.14 | 1 day |
| H11 | API | High | Helpdesk stats: post-fetch JS aggregation | WP2-2.14 | 0.5 day |
| H12 | API | High | Who's-in dashboard: all 5k employees synchronous | WP2-2.5 | 1 day |
| H13 | API | High | `/datasets/employees`: unbounded JOIN, post-fetch filter | WP1-1.1 | 1–2 days |
| H14 | API | High | Attendance-payroll comparison: 5 unbounded queries | WP2-2.13 | 1–2 days |
| H15 | API | High | Muster-roll export: no export limit guard | WP2-2.5, 2.11 | 0.5 day |
| H16 | API | High | Payroll blockers: 3 unbounded queries | WP2-2.18 | 0.5 day |
| G3 | Multi-site | High | No `site_id` on biometric devices or raw_logs | WP3-3.4 | 2–3 days |
| G4 | Multi-site | High | No `site_id` on `attendance_daily`, `leave_requests`, `payroll_slips` | WP3-3.10 | 2–3 days (schema + backfill) |
| G5 | Multi-site | High | No multi-legal entity model | WP3-3.3 | Product decision required |
| G6 | Multi-site | High | No site-scoped RLS | WP3-3.10 | 3–5 days |
| G7 | Multi-site | High | Cluster manager RBAC not implemented | WP3-3.11 | 3–5 days |
| M1–M5 | DB | Medium | Missing indexes (payroll_runs status, payroll_slips month, pii_access_log composite) | — | 0.5 day each |
| M3 | DB | Medium | No VACUUM tuning on high-churn tables | WP4-4.8 | 0.5 day (migration) |
| M4 | DB | Medium | No retention/archival for unbounded tables | WP4 | 2–3 days |
| M6 | API | Medium | Org-tree silently truncates at 1,000 | WP3-3.12 | 0.5 day |
| M7 | API | Medium | ESS home birthday scan limited to 500 colleagues | WP3-3.13 | 0.5 day |
| M8 | API | Medium | Report exports post-fetch JS department filter | WP2-2.5 | 0.5–1 day each |
| G8 | Multi-site | Medium | No atomic transfer workflow | WP3-3.6 | 1–2 days |
| G9 | Multi-site | Medium | Geo-fence: columns exist but no enforcement | WP3-3.13 | 3–5 days |

**Risk count summary:**

| Severity | Count | Estimated total fix effort |
|----------|-------|--------------------------|
| Critical | 9 | ~25–40 engineering days |
| High | 20 | ~25–35 engineering days |
| Medium | 10 | ~8–12 engineering days |
| **Total** | **39** | **~58–87 engineering days** |

---

## 6. Suggested Sequencing

### Phase A (complete — this document)
Define the reference enterprise customer profile, validation buckets, success thresholds, and top 20 critical flows.

### Phase B (complete — this document)
Static audit of the current codebase against the Phase A plan. Identify which areas are already safe vs which are scale risks before any execution testing begins.

### Pre-Phase C — Remediation Sprint

Before running Phase C execution tests, address the **Critical** items. Testing an architecture with a blocking payroll HTTP handler or a muster that silently truncates will produce false failures that obscure real capacity data.

**Recommended pre-C remediation order:**

1. **C7** — Muster limit (0.5 day) — simplest fix, unblocks WP2 testing
2. **C6** — Payroll async handler (3–5 days) — required for WP2-2.1 to be meaningful
3. **C4** — Leave sub-job splitting (3–4 days) — required for WP2-2.7/2.8 to be meaningful
4. **C5** — WhatsApp per-employee send log + batching (2–3 days) — required for WP2-2.10
5. **H10/H11** — Helpdesk pagination and stats SQL (1.5 days) — quick wins before load testing
6. **H1, H2, H3, C1** — Missing indexes (1 day total — concurrent migrations) — run before seeding data
7. **G2** — Recursive CTE for manager hierarchy (3–5 days) — required for WP3-3.5

Items C2, C3, G1, G4, G5, G6 are longer-term architectural changes. Run Phase C while tracking them; accept them as "Conditionally Certified — remediation committed" items if all Critical functional tests pass.

### Phase C — Scenario and Load Validation
Execute Work Packages 1–4 in order:
1. WP1: Seed the 5,000-employee dataset
2. WP2: Core workflow scale (payroll, attendance, leave, ESS, reports)
3. WP3: Multi-site functional validation
4. WP4: Operational readiness (scheduler health, DLQ, backup/restore)

Capture all timings against the Phase A SLA thresholds. Record pass/fail per scenario.

### Phase D — Final Readiness Memo
Produce the certification scorecard (WP5) against Phase A criteria:
- Certified / Conditionally Certified / Not Yet Certified
- Remediation backlog with owner and deadline per item
- Launch recommendation for 5,000-employee customers

---

*Document prepared from static codebase analysis of `/home/user/hrms` (352 migrations, all route files).
No execution testing has been performed. Phase C execution will validate or refute the static findings.*
