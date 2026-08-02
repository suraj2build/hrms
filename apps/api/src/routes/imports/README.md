# `/import` vs `/imports` — two distinct pipelines, not duplication

These look like the same thing (singular vs plural) but they are deliberately
separate systems with no entity-type overlap. Neither can silently produce a
different result for the same import — they don't handle the same data.

## `/import` — Universal Master Import Framework (live)

- Routes: `apps/api/src/routes/import/index.ts`
- Engine: `apps/api/src/lib/import-engine/`, `apps/api/src/lib/enterprise-import/`
  (see `docs/architecture/Enterprise_Import_Framework.md` for the full
  architecture — that doc's "Enterprise Import Framework" name refers to
  *this* pipeline, not the one below)
- Imports master/reference data: employees, departments, designations, shifts,
  salary components/structures, leave types, grades, cost centers, plus the
  manifest-driven `employee_salary_upload` flow.
- Model: CSV/XLSX rows POSTed as JSON (≤5000 rows), validate-then-run.
- Frontend: `apps/web/src/pages/import/ImportWorkspace.tsx` — reachable from
  the sidebar as "Master Import". This is the pipeline every real tenant uses.

## `/imports` — Enterprise Import Pipeline (dormant scaffolding)

- Routes: `apps/api/src/routes/imports/index.ts`
- Engine: `apps/api/src/lib/import-pipeline/`
- Model: durable-queue-based, chunked, dispatches to per-module handlers
  registered via `registerImportModule()` (`lib/import-pipeline/worker.ts`) —
  built for high-volume data imports (e.g. attendance) that don't fit the
  synchronous `/import` model.
- **Status: not wired up.** `registerImportModule()` is never called anywhere
  (`apps/api/src/index.ts:634` — "Pass 1: registry is empty; Pass 2 registers
  attendance" — Pass 2 was never done), so any job actually created here would
  fail immediately with "No import module registered." The frontend pages
  (`ImportHistory.tsx`, `ImportJobDetail.tsx`) are routed but have no sidebar
  entry and no UI ever calls `POST /imports` to create a job.

Both share the same `import_jobs` table by design — migration
`364_extend_import_jobs.sql` added the `module`/`import_type` columns
specifically so this pipeline could reuse the existing job-tracking
infrastructure alongside `/import`'s `master_type` column. `/import` never
reads or writes `module`/`import_type`, so there's no cross-pipeline
correctness risk today.

**If you're picking this pipeline up to finish it:** register at least one
module via `registerImportModule()` before `durableQueue.start()` in
`index.ts`, then wire a "Bulk Data Import" entry point into the frontend that
actually calls `POST /imports`. Until that happens, this pipeline is safe to
leave alone — it isn't reachable by any tenant.
