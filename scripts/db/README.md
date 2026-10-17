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

## `verify-g12-encashment-atomic.mjs`

Same approach, for migration 447's `assign_leave_encashment_to_payroll_run_atomic`,
`fn_finalize_leave_encashments_for_run`, `fn_revert_leave_encashments_for_rollback`,
and the replaced `reverse_leave_encashment_atomic` (G12 standalone leave
encashment, round 2). Migration 446's original `mark_leave_encashment_paid_atomic`
spliced the payout directly into an already-persisted `payroll_slips` row and
flipped status to `'paid'` immediately — unsafe, since `POST /payroll/runs`
explicitly permits deleting and recomputing every slip in a non-finalized
("draft") run on re-run, which would silently wipe the posting. Migration 447
fixes this by never mutating `payroll_slips` at assignment time: it records
intent only (`payroll_run_id`), leaves slip computation to the normal
generation pass (`fetchEncashmentPayout` + `applyEncashmentPayout`, verified
separately at the pure-function level in `payroll-engine.test.ts`), and only
flips to `'paid'` once the run is actually finalized. This script proves,
against a real Postgres instance: the happy-path assign, every refusal path
(`NOT_FOUND`/`RUN_NOT_FOUND`/`NO_PAYSLIP`/`RUN_NOT_DRAFT`/`ALREADY_ASSIGNED`/
`ALREADY_DECIDED`/`NOT_COMPUTED`), that the payout's source data survives a
simulated slip delete-and-recreate (the actual regeneration-survival
property migration 446 lacked), finalize/rollback's status transitions
scoped correctly to one run at a time, and reversal (including refusing once
the linked run is finalized).

```bash
createdb g12_verify
PGDATABASE=g12_verify psql -f scripts/db/bootstrap.sql
for f in supabase/migrations/*.sql; do PGDATABASE=g12_verify psql -v ON_ERROR_STOP=1 -f "$f"; done
PGDATABASE=g12_verify node scripts/db/verify-g12-encashment-atomic.mjs
```
