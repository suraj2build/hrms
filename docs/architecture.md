# Aurora HRMS — Architecture Overview

## System Topology

```
Browser (React + Vite)
  │
  ├─ ESS Portal   (/ess/*)           — employee self-service
  └─ Admin Shell  (/admin/* or /*)   — HR admin + manager views
        │
        ▼
  API Server (Fastify 4 + TypeScript)
  apps/api/src/
        │
        ├─ plugins/
        │    ├─ supabase.ts      — injects fastify.supabase (service-role Supabase client)
        │    ├─ auth.ts          — JWT verification → fastify.authenticate decorator
        │    └─ correlation.ts   — X-Correlation-Id / X-Request-At tracing headers
        │
        ├─ lib/
        │    ├─ permissions.ts      — 41 named permissions, hasPermission(), requirePermission()
        │    ├─ rbac.ts             — requireRole() pre-handler factory (legacy, still used)
        │    ├─ authorization.ts    — unified authorize() / authorizeOwn() / authorizeTeam()
        │    ├─ scope-evaluator.ts  — OrgScope evaluation (org-wide → dept → location → team → self)
        │    ├─ job-queue.ts        — in-process background job queue with retry + dead-letter
        │    ├─ leave-engine.ts     — shared date utils + balance validation
        │    ├─ attendance-processor.ts — daily attendance computation engine
        │    ├─ audit-service.ts    — writeAuditLogs() helper
        │    ├─ employee-profile.ts — 2-wave parallel fetch for full employee profile
        │    ├─ startup-health.ts   — required + optional module checks at boot
        │    └─ notification-service.ts — in-process notification fanout
        │
        └─ routes/
             ├─ system/            — /health /ready /system/jobs
             ├─ analytics/         — /analytics/dashboard /analytics/workforce/*
             ├─ employees/         — /employees/* + all sub-modules
             ├─ masters/           — /masters/departments /masters/shifts /masters/leave-types ...
             ├─ attendance/        — /attendance/* (ingest, process, fetch, corrections, leave, ...)
             ├─ payroll/           — /payroll/runs /payroll/runs/:id/slips
             ├─ letters/           — /letters/templates /letters/generate /letters/ess/*
             ├─ approvals/         — /approvals/workflows
             └─ notifications/     — /notifications
        │
        ▼
  Supabase (PostgreSQL + Auth + Storage)
  ├─ 80+ tables with row-level security (RLS) using get_user_tenant_id() + get_user_role()
  ├─ Storage buckets: employee-files (photos, docs, contracts)
  └─ Edge Functions: (none — all business logic in API server)
```

---

## Authentication Flow

```
Client → POST /auth/sign-in (Supabase Auth)
       ← JWT (access_token)

Client → GET /employees (with Authorization: Bearer <token>)
       → Fastify auth plugin verifies JWT signature
       → Queries profiles table: SELECT employee_id, role, tenant_id WHERE id = userId
       → Decorates request: req.userId, req.userRole, req.tenantId, req.employeeId
       → Proceeds to route handler
```

All routes except `/health`, `/ready`, and `POST /attendance/ingest` require a valid JWT.

---

## Multi-Tenancy

Every table has `tenant_id UUID NOT NULL REFERENCES tenants(id)`.

Row-Level Security (RLS) policies enforce tenant isolation at the database level:
```sql
CREATE POLICY "tenant_read" ON employees
  FOR SELECT USING (tenant_id = get_user_tenant_id());
```

The API layer also always adds `.eq('tenant_id', req.tenantId)` to every query as a defense-in-depth measure. The `tenant_id` on the request comes from the user's `profiles` row, which is set at invitation time and cannot be changed by the user.

---

## Authorization Layers

### Layer 1 — JWT Authentication
`fastify.authenticate` — verifies token, rejects with 401 if invalid.

### Layer 2 — Role/Permission Check
`authorize(permission)` from `lib/authorization.ts` — checks whether the user's role has the required permission via the permission matrix in `lib/permissions.ts`.

### Layer 3 — Organizational Scope
`ScopeEvaluator` from `lib/scope-evaluator.ts` — determines whether a user can access a *specific* employee's data based on org hierarchy:

```
org-wide   → super_admin, hr_admin can see everything
department → manager can see employees in same department
location   → manager can see employees at same work location
team       → manager can see direct reports
self       → employee can see their own records only
```

### Layer 4 — Database RLS
PostgreSQL RLS policies enforce tenant isolation even if application code has a bug.

---

## Background Jobs

`lib/job-queue.ts` — in-process lightweight job queue (no external broker).

### Why in-process?
- Zero infrastructure dependency (no Redis, no RabbitMQ)
- Suitable for moderate job volume (< 1,000 jobs/hour)
- Persistent across requests within the same process lifetime
- Observable via `GET /system/jobs`

### Job lifecycle
```
enqueue() → pending → running → completed (ring buffer, last 100)
                              ↘ failed → retry (exponential backoff)
                                       → dead-letter (exhausted retries)
```

### Failure categories
| Category | Patterns | Retry? |
|---|---|---|
| transient | network, 503, 429, rate limit, ECONNREFUSED | Yes |
| permanent | 404, 403, validation, duplicate, constraint | No |
| timeout | AbortError, "timed out" | Yes |
| unknown | anything else | Yes |

### Observability
```
GET /system/jobs           — queue snapshot + metrics by type
GET /system/jobs/dead      — dead-letter job list (admin only)
POST /system/jobs/dead/:id/retry  — manual retry (admin only)
DELETE /system/jobs/dead   — purge dead-letter queue (admin only)
```

---

## Request Tracing

Every HTTP request gets a correlation ID via `plugins/correlation.ts`:

```
Request → reads X-Correlation-Id header (or X-Request-Id)
        → if absent, generates UUID
        → attaches to req.correlationId
        → reflects X-Correlation-Id in response
        → attaches X-Request-At (ISO timestamp)
```

Structured log lines (pino) automatically include `correlationId` for full request tracing.

---

## Attendance Processing Pipeline

```
Device → POST /attendance/ingest (api_key auth, no JWT)
       → attendance_raw_logs (deduplication by device_log_id)
       
Admin  → POST /attendance/process (JWT + admin role)
       → acquireLock() — table lock + advisory lock (pg_try_advisory_lock)
       → Group raw logs by (employee_id, date)
       → Resolve shifts (shift_roster overrides → employee_shifts standing)
       → computeDaily() — late calc, OT, status derivation, payable flags
       → holiday / weekly-off priority chain
       → Upsert attendance_daily
       → writeAuditLogs() — source='system'
       → releaseLock()
       → Insert attendance_processing_runs (metrics, duration_ms, skipped_codes)
```

### Lock TTL
If a processing run crashes, the lock auto-expires after `lock_ttl_seconds` (default 900s). The next `POST /attendance/process` will detect the stale lock and force-take it.

---

## Key Data Models

| Domain | Primary Tables |
|---|---|
| Identity | tenants, profiles, employees |
| Job context | job_history, employee_compensations, employee_compensation_components |
| Attendance | attendance_raw_logs, attendance_daily, attendance_audit_log |
| Leave | leave_types, leave_applications, employee_leave_balance, leave_accrual_ledger |
| Roster | employee_shifts, shift_roster |
| Corrections | attendance_corrections (was: attendance_regularisation) |
| Anomalies | attendance_anomalies |
| Payroll | payroll_runs, payroll_employee_results, payroll_slip_components |
| Letters | letter_templates, letter_generations |
| Approvals | approval_workflows, approval_steps, approval_instances |

---

## Migration Numbering

Migrations follow sequential numbering: `001_…` → `080_…` (current).

| Range | Domain |
|---|---|
| 001–009 | Bootstrap: tenants, auth, employees, departments, documents |
| 010–016 | Sprint 2: extended masters, sub-tables, lean employees |
| 017–020 | Attendance v1: raw logs, daily, processing lock, runs |
| 021–031 | Attendance v2: advisory lock, audit log, payable flags, roster |
| 032–033 | Leave management: leave_types, leave_applications |
| 034–039 | Attendance v3: payable fraction, leave balance, constraint |
| 040–059 | Advanced features: anomalies, corrections, comp-off, OT, forensics |
| 060–074 | Payroll engine: structures, runs, results, slip components |
| 075–080 | Letters, ESS, period locks, accrual |
