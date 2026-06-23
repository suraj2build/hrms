# API ↔ Schema column-mismatch audit — RESOLVED ✅

A static auditor cross-referenced every `.from(table).select(...)` in
`apps/api/src` against the **authoritative schema** (all ~300 migrations applied
to a local Postgres, then introspected via information_schema).

**Initial finding: 127 column mismatches across 37 tables. All now resolved (0 remaining).**

Fix strategy (response field names preserved throughout via PostgREST aliases):
- **Renames** — aliased to the real column (e.g. `severity`→`conflict_severity`,
  `pan`→`pan_number`, `punch_time`→`timestamp`); filter/order clauses updated too.
- **Structural moves** — the *lean-employees* migration moved org fields
  (`department_id`/`designation_id`/`manager_id`) to `job_history` and separation
  to `employee_separation`; rerouted via embeds + flatten so downstream is unchanged.
- **Denormalised attendance** — `attendance_daily` shift data read from its
  denormalised `shift_*` columns instead of a non-existent `shift_roster` embed.
- **Computed** — derived values rebuilt in JS (`work_minutes`, `resolution_hours`,
  OT minutes↔hours, `absent_count`).
- **Genuinely-absent** columns dropped with graceful degradation (documented inline).

Re-run the auditor any time; current result:
```
SELECT column mismatches: 0
```

Verified: API `tsc --noEmit` clean; 107/107 tests green.
