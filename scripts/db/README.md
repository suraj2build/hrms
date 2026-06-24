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
