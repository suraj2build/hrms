# CognixHR — Pre-Phase C Remediation Execution Plan

**Document type:** Engineering execution plan — hand to engineering for immediate sprint
**Prepared:** 3 July 2026
**Scope:** 12 GATE-1 items from Phase B static audit
**Input:** `docs/CognixHR_PrePhaseC_Gate_Review.md`
**Branch target:** `claude/cool-planck-k749sn` (or a dedicated remediation branch)

---

## 1. Gate A vs Gate B Classification

Split of the 12 GATE-1 items into two sub-buckets.

### Gate A — Phase C run blockers

These will cause a guaranteed HTTP timeout, DLQ failure, or data truncation that makes the Phase C scenario physically unable to produce a valid result. Fix before any Phase C scenario is executed.

| ID | Finding | Why Gate A |
|----|---------|-----------|
| **C6** | Payroll blocking HTTP handler | 500 batch rounds at PAYROLL_CONCURRENCY=10 → ~250 s wall-clock. HTTP/load-balancer timeout is 60 s. WP2-2.1 auto-fails with 504 before a single slip is emitted. |
| **C4** | Leave-scheduler-tick: all sub-jobs in 120 s | 60,000 accrual DB ops at 5k employees × 12 types. 120 s is mathematically insufficient. Three DLQ timeouts and the month's leave accrual is silently skipped. |
| **C5** | WhatsApp: serial sends + no per-employee send log | 3,800 sequential API calls × minimum 40 ms each = ≥152 s. Durable job timeout 120 s. Guaranteed timeout + guaranteed duplicates on retry. |
| **C7** | Muster silently truncated at 50,000 rows | 5,000 employees × 31 days = 155,000 rows needed. `.limit(50_000)` is a hard ceiling with no error. WP2-2.4 "returns all 5,000 employees" is physically impossible without the fix. |
| **H10** | Helpdesk tickets: no pagination | At ≥18,000 tickets (year-1 volume), SELECT * with no range returns a multi-MB payload that timeouts at the API gateway (30 s). WP2-2.11 auto-fails. |
| **H11** | Helpdesk stats: post-fetch JS aggregation | Fetches every ticket row for the tenant before counting. Coupled to H10; same timeout at scale. |
| **H15** | Muster export: no limit guard | 155,000-row unbounded SELECT streams into Node.js memory. No `EXPORT_LIMIT` constant — unlike payroll export. WP2-2.11 CSV download times out. |

### Gate B — Phase C scenario correctness blockers

These items let the Phase C run complete but make the evidence semantically invalid — either by producing artificially slow timings that reflect a known missing index (not real capacity), or by routing data through a known broken path and recording a false "pass."

| ID | Finding | Why Gate B |
|----|---------|-----------|
| **G2** | Manager hierarchy resolves only 1 level | `getDirectReportIds()` returns only immediate direct reports. WP2-2.9 (300 concurrent leave submissions) appears to pass approval routing but is silently broken for 80% of the org. WP3-3.11 records a false "cluster manager can see site" — they cannot; they happen to have hr_admin in the test seed. |
| **H1** | `attendance_daily` missing `(tenant_id, status, date DESC)` index | WP2-2.4, 2.5, 2.6 query timings reflect a known missing index, not the database's actual capacity ceiling at 1.825M rows. Phase C scorecard would record a false performance failure. |
| **H2** | `employees` group indexes lack `tenant_id` prefix | Payroll-group fan-out queries in WP2-2.1, 2.2 may miss existing indexes. Artificially slow payroll group enumeration distorts the payroll run wall-clock. |
| **H3** | `employees.joining_date` no `tenant_id` prefix | ESS home birthday/anniversary scan (WP2-2.13) and intelligence scanner (WP2-2.17) may skip `idx_employees_joining`. Artificially slow; known-defect not capacity data. |
| **C1** | `audit_logs` missing `(tenant_id, created_at DESC)` composite | WP4-4.8 compliance dashboard times out on a 1.5M-row heap scan. Failure is a known missing index, not a query capacity limit. |

---

## 2. Twelve Execution Cards

### C6 — Payroll run: blocking HTTP handler

**Track:** C (complex logic)
**Gate:** A
**Effort:** 3–5 days

**Why it blocks Phase C**
At PAYROLL_CONCURRENCY = 10, processing 5,000 employees requires 500 serial `Promise.all` rounds × ~5 DB calls each = ~2,500 sequential DB round trips. Conservative wall-clock: 150–300 s. Every HTTP load balancer and API gateway enforces a 30–60 s timeout. WP2-2.1 returns HTTP 504 before a single payroll slip is emitted.

**Exact files**
- `apps/api/src/routes/payroll/index.ts`
  - `PAYROLL_CONCURRENCY = 10` — line 501
  - `runConcurrent()` helper — lines 503–506
  - `POST /payroll/runs` handler — line 526
  - Employee loop (dry-run) — line 704
  - Employee loop (live run) — line 839
- `apps/api/src/lib/durable-queue.ts`
  - `durableQueue.enqueue(type, payload, opts)` — line 274
  - Default timeout 120 s — line 296
- `apps/api/src/index.ts` — durable job handler registrations (add new handler here)

**Current broken behaviour**
`POST /payroll/runs` handler executes the entire computation synchronously. At 5,000 employees it exceeds 60 s and the request is terminated by the gateway with a 504 before any result is returned.

**Target fix shape — what must exist when done**
1. `POST /payroll/runs` returns `HTTP 202 Accepted` immediately with `{ run_id, status: 'queued' }`.
2. Handler enqueues a `'payroll-run'` durable job: `durableQueue.enqueue('payroll-run', { runId, tenantId, initiatedBy }, { timeoutMs: 1_800_000, maxRetries: 1, idempotencyKey: runId })`.
3. A new `runPayrollJob(supabase, runId, tenantId)` function (extracted from the current handler body) is registered as the `'payroll-run'` durable handler in `index.ts`.
4. `PAYROLL_CONCURRENCY` raised to `50` inside `runPayrollJob`.
5. New `GET /payroll/runs/:id` route extended with a `status` field (`queued | processing | completed | failed`), or a dedicated `GET /payroll/runs/:id/status` endpoint returning `{ run_id, status, progress: { processed, total }, started_at, completed_at, error }`.
6. `payroll_runs` table gains a `status` column (migration) and the job writes `status = 'processing'` on start, `'completed'` or `'failed'` on finish.

**Recommended implementation approach**
1. Add migration `353b_payroll_run_status.sql`: `ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`. Update CHECK constraint to include `'queued'`, `'processing'`, `'completed'`, `'failed'`.
2. Extract lines 704–900 (the live computation block) from the handler into `async function runPayrollJob(supabase, runId, tenantId)`.
3. Replace the handler body: set `payroll_runs.status = 'queued'`, call `durableQueue.enqueue(...)`, return 202.
4. Register `durableQueue.register('payroll-run', async ({ runId, tenantId }) => runPayrollJob(supabase, runId, tenantId))` in `index.ts`.
5. Add `GET /payroll/runs/:id/status` route returning the `status` and progress fields.
6. Raise `PAYROLL_CONCURRENCY` to `50`.

**Dependencies / sequencing**
No upstream dependencies. Can start day 1. The frontend payroll-run trigger page will need a polling loop added — coordinate with any frontend engineer working in parallel, or stub the status endpoint first.

**Validation / closure proof**
- Trigger `POST /payroll/runs` for a 100-employee test tenant. Response is HTTP 202 with `run_id`. Within 60 s, `GET /payroll/runs/:id/status` returns `processing`. Within 30 min (for 5k), returns `completed`. All 5,000 `payroll_run_employees` rows exist.
- WP2-2.1 smoke test: HTTP 202 returned in < 1 s; 5,000 slips present after job completes.

**Workload packages unblocked**
WP2-2.1, WP2-2.2, WP2-2.14 (payroll blockers check)

---

### C4 — Leave-scheduler-tick: all sub-jobs in one 120 s timeout

**Track:** C (complex logic)
**Gate:** A
**Effort:** 3–4 days

**Why it blocks Phase C**
`tick()` at `leave-scheduler.ts:179` runs 7 sub-job functions sequentially inside a single durable job with a 120 s default timeout. At 5,000 employees × 12 leave types, `monthlyAccrualJob` alone requires O(60,000) DB operations. The combined tick will exceed 120 s. After 3 DLQ timeouts, the month's accrual does not run and leave balances for all 5,000 employees are incorrect. WP2-2.7 and WP2-2.8 are automatic certification blockers.

**Exact files**
- `apps/api/src/lib/leave-scheduler.ts`
  - `tick()` function — line 179 (sequential sub-job calls at lines 197, 220, 235, 257, 271, 288, 305)
  - `durableQueue.enqueue('leave-scheduler-tick', ...)` — line 365
- `apps/api/src/lib/leave-jobs.ts`
  - `monthlyAccrualJob` — line 269
  - `yearlyAccrualJob` — line 467
  - `carryForwardJob` — line 758
  - `coExpiryJob` — line 613
- `apps/api/src/lib/accrual-engine.ts`
  - `runMonthlyAccrual` — line 60
  - `processCarryForward` — line 235
- `apps/api/src/lib/leave-event-engine.ts`
  - `runEventGrantsForTenant` — line 347
- `apps/api/src/lib/leave-reconciliation.ts`
  - `runLeaveReconciliation` — line 131
- `apps/api/src/index.ts`
  - `durableQueue.register('leave-scheduler-tick', ...)` — line 541

**Current broken behaviour**
`tick()` calls all 6–7 sub-job functions inside the 120 s durable job window. Sub-jobs are awaited sequentially. A single timeout aborts all remaining sub-jobs with no partial completion record.

**Target fix shape — what must exist when done**
1. `tick()` becomes a **lightweight orchestrator** only: for each active tenant, it enqueues independent sub-jobs. It does not call any sub-job function directly.
2. Six new durable job types registered in `index.ts`:
   - `'leave-monthly-accrual'` — calls `monthlyAccrualJob` + `runMonthlyAccrual`; `timeoutMs: 300_000`
   - `'leave-yearly-accrual'` — calls `yearlyAccrualJob`; `timeoutMs: 300_000`
   - `'leave-carry-forward'` — calls `carryForwardJob` + `processCarryForward`; `timeoutMs: 300_000`
   - `'leave-co-expiry'` — calls `coExpiryJob`; `timeoutMs: 120_000`
   - `'leave-event-grants'` — calls `runEventGrantsForTenant`; `timeoutMs: 120_000`
   - `'leave-reconciliation'` — calls `runLeaveReconciliation`; `timeoutMs: 120_000`
3. Idempotency keys per sub-job: `leave-monthly-accrual-${tenantId}-${year}-${month}` etc. Prevents duplicate execution if tick fires twice.
4. `leave-scheduler-tick` durable job timeout stays at 120 s — it only enqueues jobs; it completes in seconds.
5. Each sub-job has its own retry counter (max 3) and DLQ entry independent of others.

**Recommended implementation approach**
1. In `tick()`, replace each `await monthlyAccrualJob(...)` block with `await durableQueue.enqueue('leave-monthly-accrual', { tenantId, year, month }, { timeoutMs: 300_000, idempotencyKey: `leave-monthly-accrual-${tenantId}-${year}-${month}` })`.
2. Repeat for all 6 sub-jobs.
3. In `index.ts`, add 6 new `durableQueue.register(...)` calls after line 541, each delegating to the appropriate function from `leave-jobs.ts`, `accrual-engine.ts`, etc.
4. Remove the inlined sub-job calls from `tick()`. `tick()` should be < 30 lines when done.

**Dependencies / sequencing**
No upstream dependencies. Can start day 1 in parallel with C6. Verify that `durableQueue.register` for the 6 new job types is idempotent on server restart (it should be — registrations are in-process only).

**Validation / closure proof**
- Trigger `leave-scheduler-tick` manually. Observe 6 independent rows in `background_jobs` for one tenant — not one row.
- Let the first sub-job complete. Observe that a timeout of the second sub-job does not re-enqueue or affect the first.
- WP2-2.7 smoke: trigger `leave-monthly-accrual` for a 500-employee seed tenant. Confirm all `leave_accrual_ledger` rows written within 5 min. Scale to 5,000-employee seed during Phase C.

**Workload packages unblocked**
WP2-2.7, WP2-2.8, WP2-2.19

---

### C5a — WhatsApp send-pulse-poll: remove serial send coupling

**Track:** C (external channel)
**Gate:** A
**Effort:** 1–2 days

**Why it blocks Phase C**
`dispatchWeeklyPoll()` in `poll-scheduler.ts:97` iterates over enrolled employees with a `for...of await` loop — one blocking API call per employee. At 3,800 employees × ≥40 ms per call = ≥152 s. The durable job timeout is 120 s. WP2-2.10 acceptance criterion (all 3,800 messages delivered, no timeout) is physically impossible without this fix.

**Exact files**
- `apps/api/src/lib/poll-scheduler.ts`
  - `dispatchWeeklyPoll()` — serial loop at line 97
  - Identifies enrolled employees above this function

**Current broken behaviour**
```typescript
// poll-scheduler.ts ~line 97 (current)
for (const employee of enrolledEmployees) {
  await sendWhatsAppMessage(employee.phone, payload)   // blocking serial call
}
```

**Target fix shape — what must exist when done**
```typescript
// Chunked parallel sends
const CHUNK_SIZE = 100
const CONCURRENCY = 20
for (let i = 0; i < enrolledEmployees.length; i += CHUNK_SIZE) {
  const chunk = enrolledEmployees.slice(i, i + CHUNK_SIZE)
  // filter out already-sent (requires C5b send log)
  const unsent = await filterAlreadySent(supabase, questionId, chunk)
  await Promise.allSettled(
    unsent.slice(0, CONCURRENCY).map(emp => sendWhatsAppMessage(emp.phone, payload)
      .then(() => recordSend(supabase, questionId, emp.id))   // C5b write
    )
  )
}
```
At 20 concurrent calls × 40 ms average = one chunk in ~200 ms. 3,800 employees in 38 chunks × 200 ms = ~7.6 s total. Well within 120 s.

**Dependencies**
C5b must land alongside C5a — the `filterAlreadySent` and `recordSend` calls require the `pulse_send_log` table from C5b. Stage them in the same PR or merge C5b migration first.

**Validation / closure proof**
- Run `dispatchWeeklyPoll` against a 500-employee test tenant. Observe completion in < 30 s. No serial await in the loop.
- Check `pulse_send_log` rows are created for each employee.

**Workload packages unblocked**
WP2-2.10 (requires C5b simultaneously)

---

### C5b — WhatsApp send-pulse-poll: durable per-employee send log

**Track:** C (external channel)
**Gate:** A
**Effort:** 1 day

**Why it blocks Phase C**
Without a per-employee send log, retry after a timeout resends to all enrolled employees including those who already received the message. WP4-4.13 acceptance criterion ("employees 1–1,500 do NOT receive a duplicate; employees 1,501–3,800 receive message") is physically impossible without this fix. WP4-4.13 is an automatic certification blocker.

**Exact files / new artefacts**
- New migration: `supabase/migrations/353_pulse_send_log.sql`
- `apps/api/src/lib/poll-scheduler.ts` — add `filterAlreadySent()` and `recordSend()` helpers

**Current broken behaviour**
No `pulse_send_log` table exists anywhere in the codebase. The only dedup guard is at the `pulse_questions` level (one question per tenant per day) — not per-employee.

**Target fix shape — what must exist when done**

Migration `353_pulse_send_log.sql`:
```sql
CREATE TABLE IF NOT EXISTS pulse_send_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES pulse_questions(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_pulse_send_log_question
  ON pulse_send_log (question_id, tenant_id);
ALTER TABLE pulse_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pulse_send_log_tenant ON pulse_send_log
  USING (tenant_id = get_user_tenant_id());
```

In `poll-scheduler.ts`:
```typescript
async function filterAlreadySent(supabase, questionId, employees) {
  const { data } = await supabase
    .from('pulse_send_log')
    .select('employee_id')
    .eq('question_id', questionId)
    .in('employee_id', employees.map(e => e.id))
  const sent = new Set((data ?? []).map(r => r.employee_id))
  return employees.filter(e => !sent.has(e.id))
}

async function recordSend(supabase, questionId, employeeId, tenantId) {
  await supabase.from('pulse_send_log').insert(
    { question_id: questionId, employee_id: employeeId, tenant_id: tenantId },
    { ignoreDuplicates: true }   // idempotent on re-insert
  )
}
```

**Can C5b follow C5a?**
No — they must land together. C5a's `filterAlreadySent` and `recordSend` calls require the `pulse_send_log` table. Merge the migration (C5b) before or simultaneously with the send-loop changes (C5a). A single PR containing the migration + the code change is the safe approach.

**Dependencies**
Migration `353_pulse_send_log.sql` must be applied before the `poll-scheduler.ts` changes are deployed.

**Validation / closure proof**
- Run `dispatchWeeklyPoll` for 500 employees. Confirm 500 rows in `pulse_send_log`.
- Kill the job at employee 250. Re-run. Confirm: employees 1–250 receive nothing (log exists); employees 251–500 receive the message. `pulse_send_log` ends with 500 rows total.
- WP4-4.13: same test at 3,800-employee scale during Phase C.

**Workload packages unblocked**
WP4-4.13 (requires C5a simultaneously)

---

### C7 — Muster silently truncated at 50,000 rows

**Track:** B (HTTP / quick API fixes)
**Gate:** A
**Effort:** 0.5 day

**Why it blocks Phase C**
`GET /attendance/muster` in `muster.ts:101` applies `.limit(50_000)` to the `attendance_daily` query. At 5,000 employees × 31 days = 155,000 rows required, the response silently returns ~1,600 employees' records with no error. WP2-2.4 acceptance criterion "returns all 5,000 employees; no truncation" is physically impossible.

**Exact files**
- `apps/api/src/routes/attendance/muster.ts` — line 101: `.limit(50_000)`

**Current broken behaviour**
```typescript
.limit(50_000)   // muster.ts:101 — hard ceiling with no error on overflow
```

**Target fix shape — what must exist when done**
```typescript
const MUSTER_ROW_LIMIT = 200_000
// ...
const { data, count, error } = await supabase
  .from('attendance_daily')
  // ... filters ...
  .limit(MUSTER_ROW_LIMIT)

const truncated = (count ?? 0) > MUSTER_ROW_LIMIT || (data?.length ?? 0) === MUSTER_ROW_LIMIT
if (truncated) reply.header('X-Truncated', 'true')
```

**Note on PostgREST max-rows:** The Supabase PostgREST `max-rows` config may be set below 200,000. Verify via `supabase inspect db` or check `supabase/config.toml`. If PostgREST enforces a lower ceiling, replace the single query with a cursor-based chunked fetch (page through in chunks of 50,000 and merge in Node.js).

**Dependencies / sequencing**
None. Independent. First item to complete in Track B.

**Validation / closure proof**
- Seed 5,000 employees × 31 days = 155,000 `attendance_daily` rows. Call `GET /attendance/muster?date_from=...&date_to=...`.
- Response contains 155,000 rows. `X-Truncated` header absent.
- Remove 3 employees from seed, re-check — no phantom truncation.

**Workload packages unblocked**
WP2-2.4, WP2-2.6

---

### G2 — Manager hierarchy resolves only one level

**Track:** B (scenario correctness — but high complexity; may move to Track C)
**Gate:** B
**Effort:** 3–5 days

**Why it blocks Phase C**
`getDirectReportIds()` at `manager-scope.ts:66–78` fires a flat `.eq('manager_id', managerEmployeeId)` query. In a 6-level org (CEO → BU Head → Regional Head → Manager → TL → Employee), a BU Head at Level 2 can only see their ~10 direct Level-3 reports — not the ~500 employees in their subtree. This silently corrupts WP2-2.9 (300 concurrent leave submissions appear routed correctly but are not for 80% of the org) and causes WP3-3.11 to record a false pass via the hr_admin fallback.

**Exact files**
- `apps/api/src/lib/manager-scope.ts` — `getDirectReportIds()` lines 66–78

**Current broken behaviour**
```typescript
// manager-scope.ts:66–78
export async function getDirectReportIds(supabase, tenantId, managerEmployeeId) {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('manager_id', managerEmployeeId)   // only one level
    .eq('status', 'active')
  return (data ?? []).map(e => e.id)
}
```

**Target fix shape — what must exist when done**
1. New Postgres function `get_all_subordinates(p_manager_id, p_tenant_id, p_max_depth)` in migration `354_recursive_manager_cte.sql`.
2. `getDirectReportIds()` updated to call `supabase.rpc('get_all_subordinates', { p_manager_id, p_tenant_id, p_max_depth: 10 })` and return the `id` column from results.
3. Optional `maxDepth` parameter added to the TypeScript function signature (defaults to 10).

Migration `354_recursive_manager_cte.sql`:
```sql
CREATE OR REPLACE FUNCTION get_all_subordinates(
  p_manager_id  UUID,
  p_tenant_id   UUID,
  p_max_depth   INT DEFAULT 10
) RETURNS TABLE (id UUID, depth INT)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH RECURSIVE subordinates AS (
    SELECT e.id, 1 AS depth
    FROM   employees e
    WHERE  e.manager_id = p_manager_id
      AND  e.tenant_id  = p_tenant_id
      AND  e.status     = 'active'
    UNION ALL
    SELECT e.id, s.depth + 1
    FROM   employees e
    JOIN   subordinates s ON e.manager_id = s.id
    WHERE  e.tenant_id = p_tenant_id
      AND  e.status    = 'active'
      AND  s.depth     < p_max_depth
  )
  SELECT id, depth FROM subordinates;
$$;

CREATE INDEX IF NOT EXISTS idx_employees_manager_tenant_status
  ON employees (tenant_id, manager_id)
  WHERE status = 'active';
```

**Cycle guard:** The `s.depth < p_max_depth` clause terminates traversal at max 10 levels, preventing infinite loops from any accidental cycle in `manager_id` data.

**Dependencies / sequencing**
Migration `354_recursive_manager_cte.sql` must be applied before the TypeScript change is deployed. Can be developed in parallel with Track C items.

**Validation / closure proof**
- Create a 6-level chain: A→B→C→D→E→F (6 employees). Call `getDirectReportIds(A)`. Confirm returns [B, C, D, E, F] — all 5 subordinates.
- Create a deliberate cycle (E.manager_id = B) in a test tenant. Confirm the function terminates at depth 10 and does not loop.
- WP3-3.5 smoke: leaf employee F submits leave; manager E sees it in approval queue.

**Workload packages unblocked**
WP2-2.9 (approval routing correctness), WP3-3.5, WP3-3.11

---

### H1 — `attendance_daily` missing `(tenant_id, status, date DESC)` index

**Track:** 0 (pre-seed migration — run before data seeding)
**Gate:** B
**Effort:** 2 h (migration authoring + verification)

**Why it blocks Phase C**
WP2-2.4, 2.5, 2.6 query `attendance_daily` heavily by tenant + date + status (present/absent/late). Existing indexes are `idx_ad_employee_date (tenant_id, employee_id, date DESC)` and `idx_ad_tenant_date (tenant_id, date DESC)`. Neither supports a status filter without a post-index heap scan over 1.825M rows. Phase C muster timings would reflect a known missing index, not true query capacity. The fix must land before Phase C data seeding so the index covers all rows from day one.

**Exact files**
- `supabase/migrations/019_attendance.sql` — existing attendance_daily indexes at lines 81–86
- New migration: `supabase/migrations/353_scale_indexes.sql`

**Target fix shape**
```sql
-- In 353_scale_indexes.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ad_tenant_status_date
  ON attendance_daily (tenant_id, status, date DESC);
```

**Dependencies / sequencing**
Must run before any `attendance_daily` rows are inserted into the Phase C seed dataset. Part of the Track 0 batch migration (`353_scale_indexes.sql` along with H2, H3, C1).

**Validation / closure proof**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'attendance_daily'
  AND indexname = 'idx_ad_tenant_status_date';
-- Must return 1 row before seeding begins.
```

**Workload packages unblocked**
WP2-2.4, WP2-2.5, WP2-2.6

---

### H2 — `employees` group indexes lack `tenant_id` prefix

**Track:** 0 (pre-seed migration)
**Gate:** B
**Effort:** 2 h (part of Track 0 batch migration)

**Why it blocks Phase C**
`idx_employees_payroll_group`, `idx_employees_employment_category`, `idx_employees_statutory_group` in `113b_enterprise_masters.sql:133–135` are partial indexes on `(payroll_group_id)`, `(employment_category_id)`, `(statutory_group_id)` with no `tenant_id` prefix. The Postgres planner may skip them for per-tenant payroll-group enumeration in favour of a `(tenant_id, status)` scan and post-filter. Payroll-group fan-out in WP2-2.1 would show artificially elevated timings.

**Exact files**
- `supabase/migrations/113b_enterprise_masters.sql` — lines 133–135 (existing partial indexes)
- New: `supabase/migrations/353_scale_indexes.sql`

**Target fix shape**
```sql
-- In 353_scale_indexes.sql
DROP INDEX IF EXISTS idx_employees_payroll_group;
DROP INDEX IF EXISTS idx_employees_employment_category;
DROP INDEX IF EXISTS idx_employees_statutory_group;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_payroll_group
  ON employees (tenant_id, payroll_group_id)
  WHERE payroll_group_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_employment_category
  ON employees (tenant_id, employment_category_id)
  WHERE employment_category_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_statutory_group
  ON employees (tenant_id, statutory_group_id)
  WHERE statutory_group_id IS NOT NULL;
```

**Dependencies / sequencing**
Same migration as H1 and H3. Run before seeding.

**Validation / closure proof**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'employees'
  AND indexname IN (
    'idx_employees_payroll_group',
    'idx_employees_employment_category',
    'idx_employees_statutory_group'
  );
-- Must return 3 rows. Confirm each contains 'tenant_id' in pg_indexes.indexdef.
```

**Workload packages unblocked**
WP2-2.1, WP2-2.2

---

### H3 — `employees.joining_date` index lacks `tenant_id` prefix

**Track:** 0 (pre-seed migration)
**Gate:** B
**Effort:** 1 h (part of Track 0 batch migration)

**Why it blocks Phase C**
`idx_employees_joining ON employees(joining_date)` in `004_employees.sql:49` has no `tenant_id` prefix. ESS home anniversary scan (WP2-2.13) and the intelligence scanner's onboarding-blocker pass (WP2-2.17) filter by `joining_date` within a tenant. Without the composite index, the planner scans all joining dates across tenants, then filters by tenant — a false performance reading at 5,000 employees.

**Exact files**
- `supabase/migrations/004_employees.sql` — line 49: `CREATE INDEX idx_employees_joining ON employees(joining_date);`
- New: `supabase/migrations/353_scale_indexes.sql`

**Target fix shape**
```sql
-- In 353_scale_indexes.sql
DROP INDEX IF EXISTS idx_employees_joining;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_employees_tenant_joining
  ON employees (tenant_id, joining_date);
```

**Dependencies / sequencing**
Same migration as H1 and H2. Run before seeding.

**Validation / closure proof**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'employees'
  AND indexname = 'idx_employees_tenant_joining';
```

**Workload packages unblocked**
WP2-2.13, WP2-2.17

---

### C1 — `audit_logs` missing composite index `(tenant_id, created_at DESC)`

**Track:** 0 (pre-seed migration)
**Gate:** B
**Effort:** 1 h (part of Track 0 batch migration)

**Why it blocks Phase C**
`audit_logs` has two separate indexes: `idx_audit_tenant (tenant_id)` at `006_audit_logs.sql:14` and `idx_audit_timestamp (created_at DESC)` at `006_audit_logs.sql:16`. A compliance dashboard query "give me all audit events for this tenant in the last 30 days" cannot use either index alone — it scans the full `(tenant_id)` index (potentially 1.5M rows) then date-filters in the heap. WP4-4.8 will fail the < 5 s SLA due to a known missing index, recording a false performance failure.

**Exact files**
- `supabase/migrations/006_audit_logs.sql` — lines 14–16 (existing indexes)
- New: `supabase/migrations/353_scale_indexes.sql`

**Target fix shape**
```sql
-- In 353_scale_indexes.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_tenant_time
  ON audit_logs (tenant_id, created_at DESC);
```

**Dependencies / sequencing**
Same migration as H1, H2, H3. Run before seeding.

**Validation / closure proof**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs'
  AND indexname = 'idx_audit_tenant_time';
```
Run `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM audit_logs WHERE tenant_id = $1 AND created_at > now() - interval '30 days'`. Confirm `Index Scan` on `idx_audit_tenant_time` (not `idx_audit_tenant` + filter).

**Workload packages unblocked**
WP4-4.8

---

### H10 — `GET /helpdesk/tickets`: no pagination, `SELECT *`

**Track:** B (HTTP / timeout blockers)
**Gate:** A
**Effort:** 1 day

**Why it blocks Phase C**
`helpdesk/index.ts:439–451` runs an unbounded `SELECT *, employees(...)` query with no `.limit()` or `.range()`. At ≥18,000 tickets (year-1 volume seeded in WP1), the response payload exceeds typical API gateway limits and times out. WP2-2.11 (helpdesk admin queue, target < 2 s) receives a 504 with no result.

**Exact files**
- `apps/api/src/routes/helpdesk/index.ts` — handler lines 426–454, query lines 439–451

**Current broken behaviour**
```typescript
// helpdesk/index.ts:439–451
const { data, error } = await q   // q has no .limit() or .range()
```

**Target fix shape — what must exist when done**
```typescript
// Accept page/limit query params
const page  = Math.max(1, parseInt(req.query.page as string)  || 1)
const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50))
const from  = (page - 1) * limit
const to    = from + limit - 1

const { data, count, error } = await q
  .range(from, to)
  .select('id, subject, status, priority, created_at, sla_due_at, employees(first_name, last_name, employee_code)',
          { count: 'exact' })

return reply.send({
  data,
  pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) }
})
```

**Note:** Remove `SELECT *` — use an explicit column list. `employees(first_name, last_name, employee_code)` is sufficient for the admin list view.

**Dependencies / sequencing**
None. Can run in parallel with C6 and C4. Pair with H11 in the same PR.

**Validation / closure proof**
- `GET /helpdesk/tickets?page=1&limit=50` with 18,000 tickets seeded. Response in < 500 ms. `pagination.total = 18000`, `data.length = 50`.
- `GET /helpdesk/tickets?page=360&limit=50`. Response in < 500 ms. `data.length <= 50`.

**Workload packages unblocked**
WP2-2.11

---

### H11 — `GET /helpdesk/stats`: post-fetch JavaScript aggregation

**Track:** B (HTTP / timeout blockers)
**Gate:** A
**Effort:** 0.5 day (part of same PR as H10)

**Why it blocks Phase C**
`helpdesk/index.ts:457–474` fetches all ticket rows (`SELECT status, sla_breached_at, resolution_breached_at`) for the tenant then does all counting in JavaScript. No limit, no aggregation in SQL. Same timeout risk as H10 at 18,000+ tickets. The stats sidebar on the helpdesk admin page fails.

**Exact files**
- `apps/api/src/routes/helpdesk/index.ts` — lines 457–474

**Current broken behaviour**
```typescript
// helpdesk/index.ts:457–474
const { data, error } = await fastify.supabase
  .from('helpdesk_tickets')
  .select('status, sla_breached_at, resolution_breached_at')
  .eq('tenant_id', req.tenantId)
// then ~10 lines of JavaScript filter/count
```

**Target fix shape — what must exist when done**
Replace the full-table fetch + JS aggregation with 4 parallel COUNT queries:
```typescript
const LIVE_STATUSES = ['open', 'in_progress', 'pending']   // confirm against DB enum

const [openRes, breachedRes, resolvedRes, closedRes] = await Promise.all([
  supabase.from('helpdesk_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId)
    .in('status', LIVE_STATUSES),
  supabase.from('helpdesk_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId)
    .in('status', LIVE_STATUSES)
    .not('sla_breached_at', 'is', null),
  supabase.from('helpdesk_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId)
    .eq('status', 'resolved'),
  supabase.from('helpdesk_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', req.tenantId)
    .eq('status', 'closed'),
])

return reply.send({
  open:               openRes.count ?? 0,
  sla_breached:       breachedRes.count ?? 0,
  resolved:           resolvedRes.count ?? 0,
  closed:             closedRes.count ?? 0,
  resolution_rate:    /* (resolved + closed) / total */ 0,
})
```

**Dependencies / sequencing**
Same PR as H10.

**Validation / closure proof**
- Seed 18,000 tickets with known status distribution. Call `GET /helpdesk/stats`. Response in < 200 ms. Counts match the seeded distribution exactly.

**Workload packages unblocked**
WP2-2.11

---

### H15 — `GET /reports/muster-roll/export`: no limit guard

**Track:** B (HTTP / timeout blockers)
**Gate:** A
**Effort:** 0.5 day

**Why it blocks Phase C**
`reports/export.ts:576–586` executes an unbounded `attendance_daily` query with no `.limit()`. At 155,000 rows (5,000 employees × 31 days), the result set streams entirely into Node.js memory before writing the CSV response. At Supabase's default response size limits this will time out at the HTTP layer. WP2-2.11 (muster CSV download, acceptance: "file complete") fails.

**Exact files**
- `apps/api/src/routes/reports/export.ts`
  - Route registration — line 527
  - `attendance_daily` query — lines 576–582 (no `.limit()`)
  - Employee query — lines 553–566 (no `.limit()`)
- Note: `EXPORT_LIMIT = 10_000` exists in `payroll/index.ts:2251` — mirror this pattern here.

**Current broken behaviour**
```typescript
// export.ts:576–582
const { data: attendance } = await supabase
  .from('attendance_daily')
  .select('...')
  .eq('tenant_id', req.tenantId)
  // ... date filters ...
  // ← no .limit() call
```

**Target fix shape — what must exist when done**
```typescript
const MUSTER_EXPORT_LIMIT = 200_000

const { data: attendance, error: attErr } = await supabase
  .from('attendance_daily')
  .select('...')
  .eq('tenant_id', req.tenantId)
  .gte('date', from)
  .lte('date', to)
  .limit(MUSTER_EXPORT_LIMIT)

if ((attendance?.length ?? 0) >= MUSTER_EXPORT_LIMIT) {
  return reply.status(422).send({
    error: 'EXPORT_TOO_LARGE',
    message: `Muster export exceeds ${MUSTER_EXPORT_LIMIT} rows. Reduce the date range.`,
    limit: MUSTER_EXPORT_LIMIT,
  })
}
```

Apply the same guard to the employee query (lines 553–566) with limit 10,000.

**Dependencies / sequencing**
None. Independent. Can be done same day as C7.

**Validation / closure proof**
- Seed 155,000 `attendance_daily` rows. Call export for the full month. Response is a CSV with 155,000 data rows and HTTP 200 (within the 200k guard).
- Seed 210,000 rows (5,000 × 42 days). Call export for 42-day window. Response is HTTP 422 with `EXPORT_TOO_LARGE`.

**Workload packages unblocked**
WP2-2.11

---

## 3. Track-Based Execution Plan

### Track 0 — Pre-seed migration and index work

**Items:** C1, H1, H2, H3
**Duration:** 1 day
**Parallelism:** Single engineer; migrations are sequential but fast

These are all `CREATE INDEX CONCURRENTLY` or index DROP+REBUILD operations on empty tables. They must be applied **before** any Phase C data seeding begins. On empty tables each migration completes in seconds.

Batch all four into a single migration file `supabase/migrations/353_scale_indexes.sql`. Apply in one `supabase db push` or manual `psql` run against the Phase C database.

```
Day 1:
  - Author and apply 353_scale_indexes.sql
  - Verify all 5 indexes present via pg_indexes queries
  - Gate: no seeding begins until this verification passes
```

**Sequencing:** Must complete before WP1 data seeding starts. No engineer-parallelism required.

---

### Track 1 — HTTP / timeout blockers (quick API fixes)

**Items:** C7, H10, H11, H15
**Duration:** 2 days
**Parallelism:** One engineer; items are independent and can be done sequentially within 2 days

These are all self-contained handler changes with no shared state or schema dependencies. C7, H15 each take half a day. H10 + H11 together take 1 day in one PR.

```
Day 1:
  Eng B: C7 — muster limit (0.5d)
  Eng B: H15 — muster export limit (0.5d)

Day 2:
  Eng B: H10 + H11 — helpdesk pagination + stats SQL (1d, single PR)
```

**Sequencing:** No dependencies. Can start day 1 in parallel with Track 0.

---

### Track 2 — Scenario correctness blocker

**Items:** G2
**Duration:** 3–5 days
**Parallelism:** One engineer; Track 2 is independent of Tracks 0, 1, and 3

G2 is the recursive CTE + Postgres function + TypeScript `getDirectReportIds()` update. Higher complexity than Track 1 but fully isolated: it only touches `manager-scope.ts` and a new migration.

```
Days 3–7 (Eng B, after Track 1 is done):
  - Author 354_recursive_manager_cte.sql
  - Update getDirectReportIds() in manager-scope.ts
  - Write cycle-safe tests (6-level chain, deliberate-cycle tenant)
```

**Sequencing:** Track 1 must be complete before Eng B picks this up so H10/H11 are not dropped mid-stream. If Track 1 finishes early, G2 can start on day 2.

---

### Track 3 — External channel / scheduling hardening

**Items:** C4, C5a, C5b
**Duration:** 4–6 days
**Parallelism:** C4 and C5 (a+b) can run in parallel if two engineers are available

**C4** (leave sub-job split) touches `leave-scheduler.ts`, `index.ts`, and conceptually all leave sub-job functions. It requires careful registration of 6 new durable job types.

**C5a + C5b** (WhatsApp batching + send log) touches `poll-scheduler.ts` and a new migration. Must land together (C5b migration before C5a code deployment).

```
Days 3–6 (Eng A, after C6 or in parallel with C6 if scoped separately):
  C4: Split leave-scheduler-tick into 6 independent sub-jobs
  C5a + C5b (migration + code): WhatsApp batching + pulse_send_log
```

If 2 engineers are available: one takes C4, one takes C5a+C5b simultaneously.

---

### Track C (parallel, heavyweight)

**Items:** C6
**Duration:** 3–5 days
**Parallelism:** Dedicated Eng A; can run in parallel with all other tracks after Track 0

C6 is the most complex single item. It requires:
- Extracting the payroll computation into a standalone function
- Adding a durable job type and handler
- Adding a status endpoint
- A schema migration for `payroll_runs.status`
- Raising concurrency from 10 to 50
- Coordination with the frontend (polling required)

```
Days 2–6 (Eng A):
  - Day 2: Author 353b_payroll_run_status.sql migration; extract runPayrollJob()
  - Day 3: Wire durable job handler in index.ts; raise PAYROLL_CONCURRENCY
  - Day 4: Add GET /payroll/runs/:id/status endpoint; 202 return in handler
  - Day 5: Integration test; validate 5,000-employee completion time
```

---

### Two-engineer parallel execution summary

```
         Day 1    Day 2    Day 3    Day 4    Day 5    Day 6    Day 7    Day 8
Eng A    Track 0  C6       C6       C6       C6       C4       C4       C4
         (shared)
Eng B    Track 0  C7+H15  H10+H11  G2       G2       C5a/C5b  C5a/C5b  --
         (shared)
```

Track 0 (1 day): Both engineers can contribute to migration authoring; effectively 1 day of work shared.
Eng A critical path: C6 (4d) → C4 (3d) = 7d after Track 0.
Eng B critical path: Track 1 (2d) → G2 (3d) → C5 (2d) = 7d after Track 0.
Total wall-clock: **Track 0 (1d) + 7d parallel tracks = 8 working days** (best case) to **10–12 working days** (realistic with review cycles).

---

## 4. Critical Path and Timeline Estimate

### Estimates

| Scenario | Duration | Wall-clock |
|----------|----------|-----------|
| **Best case** | All items at lower effort bound, no review delays, migrations apply cleanly | **8–9 working days** (1.5–2 weeks) |
| **Realistic** | Some review cycles on C6 and C4, one unexpected refactor find, G2 cycle-guard testing takes extra day | **12–14 working days** (~2.5 weeks) |
| **Worst case** | C6 triggers frontend scope creep, C4 requires durable queue API changes, PostgREST max-rows blocks C7 | **18–22 working days** (4–4.5 weeks) |

### Critical path item: C6

C6 is on the critical path for Eng A and contains the highest hidden scope risk. The payroll run handler is ~1,300 lines total (`index.ts:526–~1850`). The extract of `runPayrollJob()` must correctly handle:
- Dry-run vs live-run branching (both at lines 704 and 839)
- Retry-failed employees path (line 2756)
- All intermediate DB state (payroll_run_employees status tracking)
- Frontend currently blocks on the sync response — this needs frontend coordination

If the frontend must be updated to poll (which it must for WP2-2.1 to work), add 1–2 days for frontend changes.

**Most likely timeline blowup: C6** (risk: frontend polling scope expands; partial-failure resume logic is more complex than expected).

### Deceptively small but risky item: C7

Changing `.limit(50_000)` to `.limit(200_000)` in `muster.ts:101` is 1 line of code. The risk:
- Supabase PostgREST has a server-level `max-rows` setting. If it is currently set to 50,000 (which would explain why the code has `.limit(50_000)`), changing only the client-side `.limit()` will have zero effect — PostgREST will still cap at its server config.
- Investigate: run `SELECT current_setting('pgrst.max_rows')` or check `supabase/config.toml` for `[db.pool]` or PostgREST overrides before assuming this is a 0.5-day fix.
- If PostgREST max-rows is the actual cap, the fix becomes cursor-based chunked fetching in Node.js — a 1.5-day change.

**Deceptively small but risky: C7** — may require PostgREST config investigation before it's fixable at the code layer.

### Hidden refactor risk: C4

The leave scheduler sub-job split looks mechanical but contains two hidden risks:
1. **Job type registration on hot server restart.** The 6 new `durableQueue.register(...)` calls in `index.ts` must be idempotent. If a previous registration for a type exists from a prior server start, the durable queue must handle re-registration without error. Verify `durable-queue.ts` register semantics.
2. **Orchestrator idempotency under double-tick.** The leave scheduler cron fires daily. If a tick job fires twice (retry after a crash), the orchestrator now enqueues sub-jobs twice. The per-sub-job idempotency keys (`leave-monthly-accrual-${tenantId}-${year}-${month}`) are critical. Any sub-job key that is not unique for the day will cause double accrual. Verify key format covers month granularity exactly.

---

## 5. Phase C Candidate Freeze Checklist

All items must be checked `[x]` before Phase C scenario runs begin. This list is intended to be executed by the release engineer on the Phase C database.

### Section 1 — Migrations and schema

- [ ] `353_scale_indexes.sql` applied: `SELECT COUNT(*) FROM pg_indexes WHERE indexname IN ('idx_ad_tenant_status_date', 'idx_employees_payroll_group', 'idx_employees_employment_category', 'idx_employees_statutory_group', 'idx_employees_tenant_joining', 'idx_audit_tenant_time')` returns **6**.
- [ ] `353_pulse_send_log.sql` applied: `SELECT to_regclass('public.pulse_send_log')` returns non-null.
- [ ] `353b_payroll_run_status.sql` applied: `SELECT column_name FROM information_schema.columns WHERE table_name = 'payroll_runs' AND column_name = 'status'` returns 1 row.
- [ ] `354_recursive_manager_cte.sql` applied: `SELECT proname FROM pg_proc WHERE proname = 'get_all_subordinates'` returns 1 row.
- [ ] `idx_employees_manager_tenant_status` index present: `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_employees_manager_tenant_status'` returns 1 row.

### Section 2 — Fresh seed after all fixes

- [ ] **All Track 0 migrations were applied before seeding.** Confirm migration timestamp on `353_scale_indexes.sql` is earlier than the earliest `attendance_daily` row inserted.
- [ ] 5,000 employee rows present: `SELECT COUNT(*) FROM employees WHERE status = 'active'` = 5000.
- [ ] 12 sites populated; all employees have `site_id` set.
- [ ] 1.825M `attendance_daily` rows present: `SELECT COUNT(*) FROM attendance_daily` ≥ 1,825,000.
- [ ] 60,000 `leave_accrual_ledger` rows present (12 types × 5,000 employees).
- [ ] 5,000 `payroll_run_employees` rows for at least one completed payroll run.

### Section 3 — Compile and lint gates

- [ ] `pnpm build` (or equivalent) exits 0 with no TypeScript errors.
- [ ] `pnpm lint` exits 0.
- [ ] `pnpm test` (unit tests) exits 0.

### Section 4 — Workload-specific smoke tests

Run against the Phase C database before starting any WP2–WP4 scenarios.

**C6 — Payroll async:**
- [ ] `POST /payroll/runs` returns HTTP 202 with `{ run_id, status: 'queued' }` in < 2 s.
- [ ] `GET /payroll/runs/{run_id}/status` returns `processing` within 30 s of the POST.
- [ ] For a 100-employee test tenant, `GET /payroll/runs/{run_id}/status` returns `completed` within 5 min. All 100 `payroll_run_employees` rows present.

**C4 — Leave sub-job split:**
- [ ] Trigger `leave-scheduler-tick`. Within 10 s, `SELECT COUNT(*) FROM background_jobs WHERE job_type LIKE 'leave-%' AND status = 'pending'` ≥ 6 for the test tenant.
- [ ] `leave-scheduler-tick` job itself completes in < 30 s (it only enqueues; it no longer runs sub-jobs inline).

**C5 — WhatsApp idempotency:**
- [ ] Run `dispatchWeeklyPoll` for a 50-employee test tenant. `pulse_send_log` shows 50 rows after run.
- [ ] Kill the job at employee 25 (simulate timeout). Re-run. `pulse_send_log` still shows 50 rows total. Employees 1–25 not re-sent (verify via WhatsApp test sink or mock).

**C7 — Muster no truncation:**
- [ ] `GET /attendance/muster?date_from=YYYY-MM-01&date_to=YYYY-MM-31` with 5,000 employees seeded. Response `data.length` = 155,000 (or the actual 5,000-employee count × days). No `X-Truncated` header.

**G2 — Manager hierarchy depth:**
- [ ] Create a 6-level employee chain in the test tenant. Call the leave-approval endpoint as the Level 1 employee. Confirm the Level 2–5 managers each see the request in their approval queue.
- [ ] `SELECT id FROM get_all_subordinates('{level_1_id}', '{tenant_id}', 10)` returns 5 rows (levels 2–6).

**H10 + H11 — Helpdesk pagination:**
- [ ] `GET /helpdesk/tickets?page=1&limit=50` with 18,000 tickets seeded: HTTP 200, `pagination.total = 18000`, `data.length = 50`, response in < 500 ms.
- [ ] `GET /helpdesk/stats`: HTTP 200, response in < 200 ms, counts add up to total tickets.

**H15 — Muster export:**
- [ ] `GET /reports/muster-roll/export?month=YYYY-MM` for 5,000 employees × 31 days: HTTP 200, CSV download completes, row count = 155,000.
- [ ] Same endpoint for 42-day window (exceeds 200k guard): HTTP 422 with `{ error: 'EXPORT_TOO_LARGE' }`.

### Section 5 — Background job health

- [ ] All registered durable job types appear in `SELECT DISTINCT job_type FROM background_jobs`: confirm `leave-monthly-accrual`, `leave-yearly-accrual`, `leave-carry-forward`, `leave-co-expiry`, `leave-event-grants`, `leave-reconciliation`, `payroll-run` are all registered.
- [ ] No jobs in `status = 'dead'` that are not from intentional test runs: `SELECT COUNT(*) FROM background_jobs WHERE status = 'dead'` = 0 (or explained).
- [ ] `leave-scheduler-tick` last run: `SELECT MAX(updated_at) FROM background_jobs WHERE job_type = 'leave-scheduler-tick' AND status = 'completed'` within the last 25 hours.

### Section 6 — Queue and scheduler health

- [ ] Durable queue drain check: `SELECT COUNT(*) FROM background_jobs WHERE status IN ('pending', 'running')` = 0 (all pre-Phase C jobs have completed).
- [ ] No retry storm active: `SELECT COUNT(*) FROM retry_storm_incidents WHERE resolved_at IS NULL` = 0.
- [ ] No poison-job quarantine entries from test runs: `SELECT COUNT(*) FROM background_jobs WHERE status = 'quarantined'` = 0.

### Section 7 — WhatsApp path

- [ ] WhatsApp API credentials present in environment: `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set (or WhatsApp mock endpoint configured for Phase C).
- [ ] `pulse_send_log` table is empty before Phase C polling scenarios begin: `SELECT COUNT(*) FROM pulse_send_log` = 0.

### Section 8 — No known Gate A / Gate B blockers remaining

- [ ] All 7 Gate A items (C4, C5, C6, C7, H10, H11, H15) have PRs merged and deployed.
- [ ] All 5 Gate B items (C1, G2, H1, H2, H3) have migrations applied and TypeScript changes deployed.
- [ ] No open Gate A or Gate B items in the engineering tracker.

### Section 9 — Phase C candidate tag

- [ ] All 12 GATE-1 items merged to the remediation branch.
- [ ] `pnpm build` exits 0 on the candidate commit.
- [ ] Git tag created: `git tag phase-c-candidate-$(date +%Y%m%d)` on the candidate commit.
- [ ] Tag pushed: `git push origin --tags`.
- [ ] Phase C database snapshot taken (Supabase backup or pg_dump) to establish a clean baseline for re-runs.

---

## 6. Top 3 Risks Before Phase C Starts

### Risk 1 — C6 frontend scope expansion (HIGH probability, HIGH impact)

The payroll run page currently blocks on the synchronous HTTP response. Moving to async 202 means the UI must poll `GET /payroll/runs/:id/status` before showing completion. This is a frontend change not captured in the C6 execution card. If the frontend team is not engaged early, C6 backend lands but the UI cannot be smoke-tested end-to-end, delaying the checklist closure.

**Mitigation:** On day 1, identify the frontend payroll-run trigger component and agree on the polling contract before backend work starts. Add a 1-day frontend buffer to the C6 estimate.

---

### Risk 2 — C7 PostgREST max-rows configuration is the real ceiling (MEDIUM probability, HIGH impact)

The `.limit(50_000)` in `muster.ts` may be there *because* PostgREST's `max-rows` server config is 50,000. If so, changing the client `.limit()` to 200,000 has zero effect — PostgREST will silently cap it at the server-side value. This turns a 0.5-day fix into a 1.5-day fix requiring either a PostgREST config change (which affects all queries platform-wide) or a cursor-based chunked fetch in Node.js.

**Mitigation:** Before writing code for C7, run `SELECT current_setting('pgrst.max_rows', true)` on the Phase C database and check `supabase/config.toml`. If max-rows ≤ 50,000, implement cursor-based fetching and re-estimate to 1.5 days.

---

### Risk 3 — C4 leave sub-job orchestrator creates double-accrual under concurrent tick fires (MEDIUM probability, VERY HIGH impact)

After C4, the `leave-scheduler-tick` orchestrator enqueues 6 sub-jobs. If the cron fires twice within the idempotency window (unlikely but possible on scheduler restart), and the idempotency key format has a granularity bug (e.g., missing the month component), two sets of sub-jobs enqueue and both execute. `monthlyAccrualJob` processes each employee twice, creating double entries in `leave_accrual_ledger`. The `cycleKey` UNIQUE constraint would prevent duplicate ledger rows, but the balance credit in `employee_leave_balance` may not be idempotent — resulting in 2× leave balances for 5,000 employees.

**Mitigation:** Before merging C4, write an explicit unit test: fire `leave-scheduler-tick` twice within 5 seconds for the same tenant and same month. Confirm `background_jobs` contains exactly 6 sub-job rows (not 12). Confirm `leave_accrual_ledger` count for that tenant/month matches expected 60,000 (not 120,000).

---

*This document is the engineering execution plan. Hand directly to the sprint team.
Source documents: `docs/CognixHR_PrePhaseC_Gate_Review.md`, `docs/CognixHR_5000_Employee_MultiSite_Readiness_Plan.md`*
