# HRMS deep DB audit — migrations, name & type mismatches (2026-06)

Method: all 299 migrations applied to a fresh local Postgres 16; schema introspected
WITH types; every `apps/api/src` query parsed (chain-walk + builder-var tracking)
and checked against the authoritative schema for SELECT, FILTER (`.eq/.gte/.in/.order/…`),
and INSERT/UPDATE payload columns. (The earlier pass only covered SELECT columns.)

## 1. Migration status — 6 of 299 fail on a clean apply

| Migration | Failure | Real bug? | Impact |
|-----------|---------|-----------|--------|
| `015_rls_extended` | `CREATE POLICY IF NOT EXISTS` — invalid SQL in Postgres | **YES** | All of 015's manager/self RLS policies never apply. API uses the service-role key (bypasses RLS) so pages still work, but direct PostgREST/client access would be unprotected/over-restricted. |
| `016_lean_employees` | `DROP COLUMN manager_id` blocked by a dependency → file aborts mid-way (no txn wrapper, so earlier drops commit) | **YES** | This IS the source of the employees column drift: `department_id`/`designation_id`/`grade_id` get dropped, but `manager_id`, `employment_type`, `work_location`, `address`, `emergency_contact`, `bank_details`, `confirmation_date` are NOT (they come after manager_id). `manager_id` is re-added intentionally by `040`. |
| `017_create_employee_with_job` | function params: non-default after default; also references dropped `jh.department_id` join | **YES, but superseded** | `063_create_employee_with_job_v2` drops & recreates this function, so prod uses v2. No live impact. |
| `038_storage_buckets` | `storage.buckets` missing | **NO** (env artifact) | Exists in real Supabase; fine on prod. |
| `068_leave_session_granularity` | `UPDATE leave_applications … WHERE half_day` — `leave_applications` has no `half_day` | **YES** | The half_day→session backfill for `leave_applications` is skipped (data backfill only; no crash). |
| `114_demo_data_cleanup` | references `employee_code_sequences` before `115` creates it | **YES (ordering)** | Demo-data cleanup only; negligible. |

**Net:** no "pending unapplied" migrations in the tracking sense, but 016's partial
failure is the root cause of the schema drift, and 015 is invalid SQL. Recommend
fixing 015 (`DROP POLICY IF EXISTS` + `CREATE POLICY`) and resolving 016's manager_id
dependency (it's a policy/constraint) so fresh deploys are clean.

## 2. Tables referenced by the API that exist in NO migration (every query 500s)

| Table used in code | Reality | Fix |
|--------------------|---------|-----|
| `attendance_punches` (work-session-engine `fetchPunches`, called) | real table is `attendance_punch_logs`; columns also differ (`punch_time`→`punched_at`, `punch_type`→`direction`, no `is_manual`/`location`) | needs table+column rewrite; confirm which attendance engine is live (attendance-engine.ts uses a different path) |
| `tax_governance_settings` (tds-bulk) | typo for `tds_governance_settings`; also `declaration_deadline`→`window_close_date` | rename table + column |
| `employee_trust_profiles` (executive dashboard) | real is `workforce_trust_scores`; `tenant_id`→`org_id`, `risk_level`→`severity` | rename + remap |
| `operational_notes` (POST note) | no such table anywhere | needs a migration or feature removal |
| `draft_bank_statutory` (onboarding trust) | no such table | needs a migration or feature removal |
| `employee_event_grants` (leave scheduler) | no such table | needs a migration or feature removal |

## 3. FILTER-clause column mismatches (cause query 500 / wrong results) — 51

Real (verified column absent). Renames:
- `employees.employment_status` → `status`  (health-index:274, risk:298, rosters:155/311/329)
- `employees.is_active` → `status='active'`  (roster-calendar:475)
- `employees.separation_date` → via `employee_separation.last_working_date`  (executive-intelligence:97/98/680/681)
- `employees.user_id` / `profile_id` → resolve employee via `profiles`  (letters ×12, certifications:63)
- `attendance_anomalies.status` / `is_resolved` → `resolved` (bool)  (context:161, payroll/index:1279, reports/export:434, workforce-intelligence:415)
- `attendance_period_locks.month` → `period_month`  (context:155)
- `assets.asset_category_id` → `category_id`  (asset-categories:101)
- `employee_identity.identity_type` → `identity_type_id`  (pre-joinee:933/952)
- `applications.application_id` → `id`  (recruitment:1320/1331)
- `loan_schedules.employee_id` / `advance_recovery_schedules.employee_id` → no such col; filter is redundant (already scoped by loan_id/advance_id) (ess-loans:117/135, payroll/index:447/471/1831/1853)
- `payroll_slips.pay_date` → no `pay_date` (tds-bulk:378/379)
- `workforce_trust_scores.tenant_id` → `org_id`  (readiness-engine:132)
- `attendance_raw_logs.employee_id` → `employee_code`  (forensics:96)
- `employee_bank_statutory.statutory_group_id` → moved to `employees.statutory_group_id`  (statutory-groups:117)
- `leave_job_log.created_at`, `leave_policies.is_active`, `leave_policy_rules.sequence`,
  `duplicate_detection_events.status`, `long_running_jobs.updated_at`,
  `attendance_processing_runs.status`, `workforce_optimization_hints.hint_date` → per-site (see code)

## 4. INSERT/UPDATE payload column mismatches — ~100

- `audit_logs` inserts use a **wrong shape** across `event-bus-automation.ts` (~40 sites),
  `digest-scheduler.ts`, importer, etc.: `new_values`→`new_data`, and several use
  `actor_id`/`entity_type`/`entity_id`/`metadata` which don't exist (should be
  `performed_by`/`table_name`/`record_id`, no `metadata`). These are fire-and-forget in
  try/catch → **audit trail silently not written** (no page crash, but compliance gap).
- `compensation_revisions.revised_ctc_annual` (import-engine) and others — see audit output.

## 5. Data-type mismatches

True value-vs-column type conflicts are largely a runtime concern (PostgREST coerces most
string↔uuid/numeric/date cases). The structural "type" problems found are the wrong-shape
inserts in §4 (e.g. audit_logs) and the wrong-table references in §2. No additional
hard type conflicts (e.g. boolean column compared to non-bool literal) were detected in the
static pass; confirming the rest needs integration tests against a seeded DB.
