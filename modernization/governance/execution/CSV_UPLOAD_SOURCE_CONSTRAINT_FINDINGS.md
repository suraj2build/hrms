# CSV Upload Source Constraint — Investigation Findings

**Type:** Static code investigation (no DB queries executed)  
**Date:** 2026-05-11  
**Scope:** `attendance_punch_logs`, `upload.ts`, Supabase client configuration  
**Conclusion:** CSV upload feature has never successfully inserted rows in production.

---

## Evidence Chain

### Finding 1 — The CHECK constraint does not include `csv_upload`

**File:** `supabase/migrations/043_attendance_punch_logs.sql`, line 18–19

```sql
source  TEXT  NOT NULL DEFAULT 'manual'
        CHECK (source IN ('device', 'manual', 'mobile', 'web', 'kiosk', 'regularisation')),
```

`csv_upload` is not listed. Confirmed by grepping all 112 migration files
(`001_` through `112_`): no subsequent migration alters this constraint, drops it,
or adds `csv_upload`.

---

### Finding 2 — The upload route unconditionally uses `csv_upload` as the default source

**File:** `apps/api/src/routes/attendance/upload.ts`, lines 153–158

```typescript
const source = colIdx.source >= 0
  ? (fields[colIdx.source]?.trim() || 'csv_upload')
  : 'csv_upload'
```

Behaviour by input:

| CSV has `source` column? | Column value | Resolved source | Passes constraint? |
|---|---|---|---|
| No | — | `'csv_upload'` | ❌ No |
| Yes | `csv_upload` | `'csv_upload'` | ❌ No |
| Yes | _(empty)_ | `'csv_upload'` | ❌ No |
| Yes | `manual` | `'manual'` | ✅ Yes — timezone bug applies |
| Yes | `device` | `'device'` | ✅ Yes — timezone bug applies |

The sample CSV template (`apps/api/src/routes/attendance/sample-csv.ts`) explicitly
generates rows with `source = csv_upload` in every data row:

```typescript
`EMP001,${today},09:00,18:00,csv_upload`,
```

Any operator who downloaded the sample and used it as a template would have `csv_upload`
in their `source` column and would receive a constraint violation on upload.

---

### Finding 3 — The Supabase client uses the service role key but that does not bypass CHECK constraints

**File:** `apps/api/src/plugins/supabase.ts`, lines 13, 19–22

```typescript
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})
```

**File:** `apps/api/.env` (decoded JWT payload)

```json
{ "iss": "supabase", "ref": "kxvdlvarjvtqijzvmegk", "role": "service_role", ... }
```

The Supabase JS client with a service role key talks to PostgREST with the
`service_role` database role. This role:

- **Bypasses Row Level Security (RLS)** — via `SET row_security = off`
- **Does NOT bypass CHECK constraints** — these are enforced by PostgreSQL at the
  row level for every role, including superuser. No Supabase configuration changes this.

PostgREST propagates CHECK constraint violations as a `23514` error code back to the
JS client, which surfaces as `upsertErr`. The upload route catches this and returns
HTTP 500 `INSERT_FAILED`.

There is no per-request client switching in the auth flow. `fastify.supabase` (service
role) is the only client used for all DB operations throughout the API.

---

### Finding 4 — Single environment, no staging/production split

**File:** `FILEDETAIL.md`, line 6

```
Supabase project ID: kxvdlvarjvtqijzvmegk
```

**File:** `.env`, line 5

```
# DO NOT reference nsnwqpijofnmauksdahr — that project is archived/ignored.
# All running services (apps/api, apps/web) use their own .env files which
# already point to the correct project below.
```

There is one active Supabase project. The archived project (`nsnwqpijofnmauksdahr`) is
explicitly noted as ignored. All environments (development, any production-equivalent)
point to `kxvdlvarjvtqijzvmegk`.

---

### Finding 5 — No application-level tests exist

No `*.test.ts` files exist outside `node_modules`. The upload route has never been
exercised by an automated test. The constraint gap could not have been caught by CI.

---

### Finding 6 — The sample CSV comment documents the old (wrong) timezone behavior

**File:** `apps/api/src/routes/attendance/sample-csv.ts`, line 10

```typescript
 *   in_time       — HH:MM or HH:MM:SS  (treated as UTC; adjust for your timezone)
```

This comment describes the `buildTimestamp()` bug that was just fixed. After the fix,
times are interpreted as tenant-local time — the comment is now incorrect and misleading.

---

## Definitive Conclusions

### 1. Historical data impact: effectively zero

With the service role key and an enforced CHECK constraint, every CSV upload attempt
using the standard workflow (no `source` column, or `source = csv_upload`) would have
returned HTTP 500 `INSERT_FAILED`. Zero rows would have been inserted.

**The only scenario where rows could exist:** an operator who discovered the constraint
error, understood it, and manually edited their CSV to use `source = manual` or
`source = device`. This is possible but not the standard path. The verification
queries from `CSV_TIMEZONE_REMEDIATION_PLAN.md § Step 0a` confirm the true count.

### 2. The timezone fix is correct but blocked

The `localToUtc()` fix deployed in `upload.ts` is architecturally correct and will
produce accurate UTC timestamps when uploads eventually succeed. It cannot cause any
harm while the constraint is blocking inserts.

### 3. The feature has been silently broken since it was first deployed

The upload route, sample CSV template, and source constraint were written by different
contributors without cross-checking the allowed source values. The route returns a
user-visible HTTP 500 whenever an upload is attempted, which operators may have
interpreted as a server error unrelated to the content of their CSV.

---

## Affected Environments

| Environment | Supabase project | Status |
|---|---|---|
| Development / current | `kxvdlvarjvtqijzvmegk` | Constraint gap confirmed in migrations |
| Production (if separate) | Unknown — no separate config found | Assumed same project |
| Archived | `nsnwqpijofnmauksdahr` | Ignored per `.env` comment |

---

## Production Impact Assessment

| Area | Impact |
|---|---|
| `attendance_punch_logs` data | None — no csv_upload rows inserted |
| `attendance_daily` data | None — no recomputes triggered by CSV upload |
| Payroll / LOP | None — no incorrect attendance from CSV path |
| Operator experience | All CSV upload attempts return HTTP 500; feature is unusable |
| Historical remediation | Not required — nothing to correct |

The `CSV_TIMEZONE_REMEDIATION_PLAN.md` is correct in its preparation but the execution
phases (2, 3, 4) are a no-op. The plan document should be retained for use after
the constraint is fixed and CSV uploads are actively used.

---

## Whether the Remediation Migration Is Required

| Migration | Required? | Reason |
|---|---|---|
| `113_punch_logs_csv_source.sql` (add `csv_upload` to constraint) | **Yes — blocking** | Without this, the upload feature produces HTTP 500 on every attempt. This is the single highest-priority fix. |
| `114_punch_tz_correction_log.sql` (correction tracking table) | Not now | No data to correct. Deploy if and when CSV uploads are confirmed to have been in use. |
| Phases 2–4 correction SQL | Not now | No rows to correct. |

---

## Recommended Next Safe Action

### Action 1 — Required immediately (unblocks the feature)

Deploy `supabase/migrations/113_punch_logs_csv_source.sql`:

```sql
-- 113_punch_logs_csv_source.sql
-- Add 'csv_upload' to attendance_punch_logs source constraint.
-- Required for the CSV bulk-upload feature to function.
-- The route has been returning HTTP 500 on every attempt due to this gap.

ALTER TABLE attendance_punch_logs
  DROP CONSTRAINT IF EXISTS attendance_punch_logs_source_check;

ALTER TABLE attendance_punch_logs
  ADD CONSTRAINT attendance_punch_logs_source_check
  CHECK (source IN (
    'device', 'manual', 'mobile', 'web',
    'kiosk', 'regularisation', 'csv_upload'
  ));
```

This is a DDL-only change. It does not modify any data. It does not affect any
existing rows. Safe to deploy at any time.

### Action 2 — Fix the sample CSV comment (misleading after the timezone fix)

**File:** `apps/api/src/routes/attendance/sample-csv.ts`, line 10

```typescript
// BEFORE (wrong — describes the old bug)
 *   in_time       — HH:MM or HH:MM:SS  (treated as UTC; adjust for your timezone)

// AFTER (correct)
 *   in_time       — HH:MM or HH:MM:SS  (tenant local time — e.g. 09:00 IST, not UTC)
```

### Action 3 — Run the verification query after deploying Action 1

After deploying migration 113 and attempting a test upload, confirm the constraint
fix worked and the timezone fix is operating correctly:

```sql
-- Confirm csv_upload rows now exist after first successful upload
SELECT source, COUNT(*), MIN(punched_at), MAX(punched_at)
FROM attendance_punch_logs
WHERE source = 'csv_upload'
GROUP BY source;

-- Confirm constraint definition now includes csv_upload
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'attendance_punch_logs'::regclass
  AND contype = 'c';
```

### Action 4 — Verify timezone correctness on first real upload

After migration 113 is deployed, perform a controlled test upload with a known
employee and date. Confirm the stored `punched_at` is in UTC matching the expected
offset:

```sql
-- For IST tenant: a CSV row of "09:00" should store as "03:30:00+00"
SELECT punched_at, direction, source
FROM attendance_punch_logs
WHERE source = 'csv_upload'
ORDER BY created_at DESC
LIMIT 10;
```

### Action 5 — Monitor for first real payroll cycle after fix

Once the feature is unblocked and in use, the first payroll cycle for any month
containing CSV-uploaded attendance is the first real validation of the full timezone
fix. Run the payroll summary before finalizing and spot-check employees whose
attendance came from CSV uploads.

---

## Summary Table

| Question | Answer |
|---|---|
| Does the CHECK constraint include `csv_upload`? | **No** — missing from migration 043, never added |
| Does the service role key bypass CHECK constraints? | **No** — only bypasses RLS |
| Do csv_upload rows exist in the database? | **Almost certainly zero** — verify with Step 0a query |
| Has the timezone bug caused payroll harm? | **No** — feature was broken before any data could be stored |
| Is the timezone fix correct? | **Yes** — `localToUtc()` is the right approach |
| Is the historical remediation plan required for execution? | **No** — no data to correct |
| Is migration 113 required? | **Yes — immediately** — the feature is completely broken without it |
| Is the sample-csv.ts comment correct? | **No** — documents the old wrong behavior; needs update |
