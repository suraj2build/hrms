# CognixHR — Phase C Launch Runbook

**Document type:** Operational Launch Control Document  
**Version:** 1.1 (post-validation corrections applied)  
**Prepared:** 4 July 2026  
**Branch:** `claude/cool-planck-k749sn`  
**Verdict:** APPROVED SUBJECT TO THIS RUNBOOK — all 12 GATE-1 items implemented; runbook corrected per validation pass

> **Correction log (v1.0 → v1.1)**  
> RB-01 H15 route path · RB-02 G2 smoke route · RB-03 C4 admin endpoint · RB-04 H11 field name · RB-05 C6 error code · RB-06 C6 409 condition · RB-07 G2 muster boundary note · RB-08 migration 359 ledger entry

---

## Stage 0 — Candidate Lock

### 0.1 Candidate Identity

| Field | Value |
|-------|-------|
| Branch | `claude/cool-planck-k749sn` |
| Target repo | `suraj2build/hrms` |
| Locked | 4 July 2026 |
| GATE-1 items closed | 12 / 12 |

### 0.2 Migration Ledger (Batches 0–3)

| Migration | Description | Batch |
|-----------|-------------|-------|
| `353_h1_attendance_status_date_index.sql` | `idx_ad_tenant_status_date ON attendance_daily (tenant_id, status, date DESC)` | 0 |
| `354_h2_employees_group_indexes.sql` | Drop + recreate 3 group FK indexes with `tenant_id` prefix | 0 |
| `355_h3_employees_joining_date_index.sql` | `idx_employees_tenant_joining (tenant_id, joining_date)` | 0 |
| `356_c1_audit_logs_composite_index.sql` | `idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC)` | 1 |
| `357_g2_recursive_manager_cte.sql` | Partial index `idx_employees_manager_tenant_status` + `get_all_subordinates()` RPC | 1 |
| `358_c6_payroll_run_queued_status.sql` | Adds `'queued'` to `payroll_runs_status_check` constraint | 2 |
| `359_c5b_pulse_send_log.sql` | `pulse_send_log` table with `UNIQUE (pulse_question_id, employee_id)` | 3 |

### 0.3 Known Verification Boundaries

> Read before executing Stage 2. These boundaries define what each smoke test actually proves.

- **G2 recursive scope** must be validated on routes wired to `get_all_subordinates`. The muster route (`GET /attendance/muster`) uses flat `job_history.eq('manager_id')` — depth-1 only. Do **not** use muster as a G2 recursive correctness surface. Use routes listed in Stage 2 §B-G2.
- **C4** is validated by observing `background_jobs` after a `leave-scheduler-tick` fires. There is no `/admin/jobs/enqueue` endpoint. The trigger path is described in Stage 2 §B-C4.
- **C6 duplicate-submit conflict (409)** fires only when an existing payroll run has status `queued` or `processing`. A run in `draft` status accepts a clean re-submit — no 409.

---

## Stage 1 — 5k Environment Build

### 1.1 Pre-conditions

- [ ] Supabase project provisioned (separate from production)
- [ ] All 7 migrations in §0.2 applied in sequence — verify with `SELECT id FROM schema_migrations ORDER BY id`
- [ ] Env vars set: `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (or leave unset for mock mode — outbox-only, no live HTTP)
- [ ] API server deployed from `claude/cool-planck-k749sn`

### 1.2 Data Seed Targets

| Entity | Count |
|--------|-------|
| Tenants | ≥ 1 active |
| Employees | 5,000 active, with phone numbers |
| Sites / departments | ≥ 5 sites, ≥ 10 departments |
| Leave records | Year-1 full dataset |
| Attendance records | Year-1 full dataset (≈ 1.825 M rows in `attendance_daily`) |
| Payroll runs | At least 1 completed run for the current month |
| Helpdesk tickets | ≥ 500 with varied status and SLA states |

### 1.3 Manager Hierarchy

Seed at minimum 3 levels of hierarchy (employee → manager → skip-level) across at least 2 sites. This is required for G2 recursive-CTE smoke in Stage 2.

---

## Stage 2 — Gate Smoke Execution

Run all checks in Section A before Section B. Section A failures block all further execution.

### Section A — Database and Schema

**A-1 Migration completeness**
```sql
SELECT id FROM schema_migrations WHERE id IN (353,354,355,356,357,358,359) ORDER BY id;
-- Expect: 7 rows
```

**A-2 pulse_send_log constraint**
```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'pulse_send_log';
-- Expect: PRIMARY KEY + UNIQUE (pulse_question_id, employee_id)
```

**A-3 get_all_subordinates function**
```sql
SELECT proname FROM pg_proc WHERE proname = 'get_all_subordinates';
-- Expect: 1 row
```

**A-4 payroll_runs_status_check includes 'queued'**
```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'payroll_runs_status_check';
-- Expect: check includes 'queued'
```

**A-5 background_jobs idempotency key constraint**
```sql
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'background_jobs' AND constraint_type = 'UNIQUE';
-- Expect: row for idempotency_key (globally unique, no partial condition)
```

---

### Section B — API and Runtime

All API calls use a valid tenant-scoped auth token unless stated otherwise.

---

#### B-H1 Attendance status index

```
GET /attendance/muster?month=YYYY-MM
```
- Assert: response time < 2 s at 1.8 M row dataset
- Assert: HTTP 200, `data` array present

---

#### B-H11 Helpdesk stats

```
GET /helpdesk/stats
```
Expected response shape:
```json
{
  "data": {
    "total": <number>,
    "open": <number>,
    "breached": <number>,
    "resolution_breached": <number>,
    "by_status": { "<status>": <count>, ... }
  }
}
```
> **Note:** Field is `breached`, **not** `sla_breached`. A test asserting `sla_breached` will silently pass undefined.

---

#### B-H15 Muster-roll export

```
GET /reports/muster-roll/export?month=YYYY-MM
```
> **Note:** Route is `/reports/muster-roll/export`. The path `/reports/export/attendance` does not exist and returns 404.

- Assert: HTTP 200 for normal-size export
- Assert: `Content-Type: text/csv` or `application/octet-stream`
- Assert: when row count exceeds 200,000: HTTP 422 with body `{ "code": "EXPORT_TOO_LARGE" }`
- Assert: when truncated at muster level: response header `X-Truncated: true`

---

#### B-G2 Recursive manager scope

> **Verification surface:** The `get_all_subordinates` CTE must be tested on a route that actually calls it. The following routes are wired to the recursive function: leave-requests, regularisation, comp-off, overtime, ess/signals, ess/home, manager/team-helpdesk, manager/team-leave-context, manager/team-payroll-cost.

Use a manager token for a user with at least 2 levels of direct and indirect reports.

```
GET /manager/team-helpdesk
```
- Assert: HTTP 200
- Assert: response includes employees from both depth-1 (direct reports) and depth-2 (grandreports) — verify at least one employee_id from depth-2 is present
- Assert: employees from a different site/branch not in the org-tree are absent

> **Muster boundary:** `GET /attendance/muster` scopes by `job_history.manager_id` (depth-1 only). Do not use muster output to verify recursive CTE correctness.

---

#### B-C4 Leave scheduler sub-job fan-out

The leave scheduler does not have an admin trigger endpoint. Trigger via one of these two paths:

**Path A — startup probe (preferred in staging)**
Restart the API server. The scheduler runs `setTimeout(enqueue, 5_000)` at startup. If the server starts during a Monday 09:00–09:59 window:
1. Wait 10 seconds after startup
2. Query `background_jobs`:
```sql
SELECT type, status, idempotency_key FROM background_jobs
WHERE type LIKE 'leave-%'
ORDER BY created_at DESC LIMIT 10;
```
Assert: 6 rows with types `leave-yearly-accrual`, `leave-monthly-accrual`, `leave-carry-forward`, `leave-co-expiry`, `leave-event-grants`, `leave-reconciliation`

**Path B — direct insert (any time)**
```sql
INSERT INTO background_jobs (id, type, payload, status, idempotency_key)
VALUES (gen_random_uuid(), 'leave-scheduler-tick', '{}', 'queued',
        'leave-scheduler-tick:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'))
ON CONFLICT (idempotency_key) DO NOTHING;
```
Wait ≤ 10 seconds (poll interval is 5,000 ms, batch size 5). Then:
```sql
SELECT type, status FROM background_jobs
WHERE type LIKE 'leave-%' AND created_at > now() - interval '30 seconds'
ORDER BY created_at;
```
Assert: 6 sub-job rows present. Idempotency check: re-run the insert — no new rows should appear.

---

#### B-C5 Pulse send dedup

Trigger a test weekly poll dispatch for a tenant with ≥ 50 employees:

```sql
-- Insert a pulse question directly to trigger sendPollToEmployees path
INSERT INTO pulse_questions (tenant_id, question, options, status, starts_at, ends_at)
VALUES ('<tenant_id>', 'How are you feeling at work this week?',
        '["1 - Great","2 - OK","3 - Not Good"]', 'active', now(), now() + interval '7 days');
```

After the scheduler runs:
```sql
SELECT COUNT(*) FROM pulse_send_log WHERE tenant_id = '<tenant_id>';
-- Expect: row count equals number of active employees with phone numbers

-- C5b dedup: run the dispatch again (or simulate a retry). Count must not increase.
SELECT COUNT(*) FROM pulse_send_log WHERE tenant_id = '<tenant_id>';
-- Expect: same count as before
```

---

#### B-C6 Payroll async dispatch

**Happy path:**
```
POST /payroll/runs
{ "month": "YYYY-MM", "tenant_id": "<uuid>" }
```
Assert: HTTP 202
```json
{
  "run_id": "<uuid>",
  "job_id": "<uuid>",
  "status": "queued",
  "message": "<string>"
}
```

**Duplicate detection — queued/processing state:**
While the job is still `queued` or `processing` in `background_jobs`, re-submit the same month:
```
POST /payroll/runs
{ "month": "YYYY-MM", "tenant_id": "<uuid>" }
```
Assert: HTTP 409
```json
{ "code": "RUN_IN_PROGRESS" }
```
> **Note:** Error code is `RUN_IN_PROGRESS`, **not** `ALREADY_PROCESSING`.

**Re-submit after draft — no conflict:**
If the existing run has status `draft`, re-submitting the same month must return 202 (not 409).

---

#### B-C7 Muster row cap

```
GET /attendance/muster?month=YYYY-MM
```
With a tenant having > 200,000 attendance rows for the month:
- Assert: response contains exactly 200,000 rows (not more)
- Assert: response header `X-Truncated: true` is present

---

### Section C — Scheduler Heartbeat

```
GET /system/scheduler-health
```
Assert: HTTP 200, array of `scheduler_heartbeats` rows. Confirm at least one row with `updated_at` within the last 2 hours (confirms scheduler loop is alive).

---

## Stage 3 — Baseline Capture

Before launching workloads, record:

| Metric | Value |
|--------|-------|
| `attendance_daily` row count | |
| `audit_logs` row count | |
| `background_jobs` pending count | |
| API p95 response time (idle) | |
| DB connection pool utilisation (idle) | |

Store as `phase-c-baseline.json`. All Phase C pass/fail assertions are relative to this baseline.

---

## Stage 4 — Workload Launch Sequence

Launch workloads in this order. Each workload must complete and record results before the next starts.

| # | Workload | Key SLA | GATE-1 items exercised |
|---|----------|---------|----------------------|
| 1 | WP2-2.4 Muster render (5k employees, 1 month) | < 2 s p95 | H1, C7 |
| 2 | WP2-2.5 Muster export (5k employees, 1 month CSV) | < 30 s, no 422 | H15 |
| 3 | WP4-4.8 Compliance / audit log query (30-day window) | < 5 s p95 | C1 |
| 4 | WP3-3.x Manager team views (depth-2 org, 50-report tree) | < 3 s p95 | G2 |
| 5 | WP5-5.x Helpdesk stats + ticket list (500-ticket corpus) | < 2 s p95 | H10, H11 |
| 6 | WP6-6.x Payroll run (5k employees, concurrent second submit) | 202 + 409 correct | C6 |
| 7 | WP1-1.x Leave scheduler Monday tick (6 sub-jobs) | All 6 enqueued < 10 s | C4 |
| 8 | WP7-7.x Pulse poll dispatch + retry dedup (5k employees) | No duplicates in pulse_send_log | C5a, C5b |

---

## Go/No-Go Control Sheet

Evaluate after all Stage 4 workloads complete.

### Hard blockers (any single failure = NO-GO)

- [ ] Any GATE-1 smoke check in Section B failed
- [ ] Any Stage 4 workload breaches its stated SLA at the 5k dataset scale
- [ ] `pulse_send_log` duplicate count > 0 on retry (C5b failure)
- [ ] Payroll 409 does not fire for `queued`/`processing` state (C6 failure)
- [ ] Leave scheduler sub-job count ≠ 6 (C4 fan-out failure)
- [ ] `X-Truncated: true` absent when muster row count ≥ 200,000 (C7 failure)

### Documented known gaps (not blockers)

- Muster manager scope is depth-1 only — deep org trees show direct reports only in muster view. Accepted per Gate Review classification.
- `attendance_daily` not partitioned (C2: GATE-2). Year-1 volume tested; year-2 partitioning required.
- `pulse_questions` creation is not atomic under concurrent workers — duplicate question rows possible in a multi-process Monday 09:00 race. Risk is cosmetic (duplicate poll, not data loss); accepted for Phase C.
- `background_jobs.idempotency_key` uniqueness blocks re-enqueue for completed daily leave sub-jobs permanently. This is by design; verified in C4 dedup analysis. No replay drill required.

### Verdict recording

| Field | Value |
|-------|-------|
| Date/time | |
| Operator | |
| All Section A checks | PASS / FAIL |
| All Section B checks | PASS / FAIL |
| All Stage 4 SLAs | PASS / FAIL |
| Known gaps accepted | YES |
| **Verdict** | **GO / NO-GO** |

---

## Operator Brief (single page)

**What you are running:** CognixHR Phase C — 5,000-employee multi-site load certification against a fresh Supabase environment seeded with year-1 data.

**What was fixed before this run:** 12 GATE-1 items across DB indexing (H1–H3, C1), recursive manager scope (G2), muster cap (C7), payroll async dispatch (C6), leave scheduler fan-out (C4), pulse poll parallelism and dedup (C5a/C5b), helpdesk pagination and stats (H10/H11), muster export (H15).

**Execution path:** Stage 0 → lock candidate → Stage 1 → build environment → Stage 2 → smoke all GATE-1 items → Stage 3 → record baseline → Stage 4 → run workloads in sequence → Go/No-Go.

**Stop conditions:** Any hard blocker in the Go/No-Go Control Sheet. Do not attempt to patch and continue mid-run — stop, record the failure, fix in a new branch, re-run from Stage 0.

**Key routes and their corrections from prior drafts:**
- Muster export: `GET /reports/muster-roll/export` (not `/reports/export/attendance`)
- Helpdesk stats field: `breached` (not `sla_breached`)
- Payroll conflict code: `RUN_IN_PROGRESS` (not `ALREADY_PROCESSING`)
- G2 verification route: `GET /manager/team-helpdesk` (not `GET /employees?scope=reports`)
- C4 trigger: direct `background_jobs` insert or Monday startup probe (no `/admin/jobs/enqueue`)

**Contacts:** Operator should have DB access (Supabase dashboard or psql) and API token for the test tenant before starting Stage 2.
