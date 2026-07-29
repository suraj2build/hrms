-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 406 — work_sessions missing unique constraint (fixes broken upsert)
--
-- POST /attendance/sessions/pair (apps/api/src/routes/attendance/work-sessions.ts)
-- upserts into work_sessions with:
--   onConflict: 'employee_id,tenant_id,session_start'
--
-- Migration 148 created work_sessions with only plain (non-unique) indexes, so
-- that upsert's ON CONFLICT target never matched a real constraint — every call
-- with at least one session row raised Postgres error 42P10 ("there is no
-- unique or exclusion constraint matching the ON CONFLICT specification"),
-- making the endpoint fail on its primary use case 100% of the time. Since the
-- upsert always errored, no other insert path exists into this table (verified
-- via repo-wide grep — all other work_sessions writes are reads), so there is
-- no pre-existing duplicate data to reconcile before adding the constraint.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE work_sessions
  ADD CONSTRAINT work_sessions_employee_tenant_start_key
  UNIQUE (employee_id, tenant_id, session_start);
