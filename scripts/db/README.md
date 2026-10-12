# Schema-drift guardrail

`check-schema-drift.mjs` prevents the class of bug that caused the June 2026 audit:
the API referencing table columns that don't exist in the database, producing
silent 500s on read and failed writes.

## What it does

1. **Applies every migration** in `supabase/migrations/` (after `bootstrap.sql`,
   which stands up the minimal Supabase `auth`/`storage`/roles scaffolding) to a
   throwaway Postgres, **continue-on-error**. Production's schema is the *partial*
   result of these migrations — some abort part-way — so this reproduces reality
   rather than an idealized clean apply.
   - A migration that fails and is **not** on the `KNOWN_FAILING` allowlist fails
     the run. That catches new migration breakage (e.g. a drop blocked by a
     dependency — the exact thing that caused the original drift).
2. **Introspects** `information_schema.columns`.
3. **Parses every Supabase query** in `apps/api/src` — `.select()`, filter clauses
   (`.eq/.in/.gte/...`), and `.insert/.update/.upsert` payloads — and asserts each
   referenced column exists on its table. Exits non-zero on any mismatch.

## Run locally

```bash
# needs a reachable Postgres via libpq env vars (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
createdb drift_check
PGDATABASE=drift_check npm run db:check-drift

# reuse an already-migrated DB and only re-run the code audit:
PGDATABASE=drift_check node scripts/db/check-schema-drift.mjs --skip-apply
```

CI runs this on every PR via `.github/workflows/ci.yml` against a `postgres:16`
service.

## Maintaining `KNOWN_FAILING`

When a migration is intentionally allowed to fail on a clean apply, add its filename
to the `KNOWN_FAILING` set in the script **with a one-line reason**. Keep it short —
every entry is schema the checker can't see, so it's a blind spot.

## `verify-fnf-mark-paid-atomic.mjs`

A one-off (not CI-wired, not a vitest file — `pg` client calls, run manually)
verification of `mark_fnf_paid_atomic` (migration 445): the Postgres function
`PATCH /employees/:id/separation-ff/mark-paid` delegates to so the status flip,
loan foreclosure, advance recovery (schedules + ledger + parent status) all
happen as one transaction. Proves, against a real Postgres instance — not a
mocked response — rollback on a detected source-balance drift, that a retry
after success can't double-deduct, and that a concurrent write (another
mark-paid call, or a payroll-run-style UPDATE on the same `loan_schedules`
row) genuinely blocks on the function's row locks rather than racing it.

```bash
createdb fnf_verify
PGDATABASE=fnf_verify psql -f scripts/db/bootstrap.sql
for f in supabase/migrations/*.sql; do PGDATABASE=fnf_verify psql -v ON_ERROR_STOP=1 -f "$f"; done
PGDATABASE=fnf_verify node scripts/db/verify-fnf-mark-paid-atomic.mjs
```
