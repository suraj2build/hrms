-- ============================================================
-- 434_ensure_service_role_grants.sql
--
-- Defensive fix for a local-dev-only issue: some Supabase CLI
-- versions' bundled role bootstrap (roles.sql, shipped with the
-- CLI itself — not part of this repo) leave `service_role` with
-- the SAME limited table privileges as `anon`/`authenticated`
-- (missing SELECT/INSERT/UPDATE/DELETE), instead of full access +
-- RLS bypass. Confirmed live via `\dp tenants`:
--   service_role=Dxtm/postgres   (missing r/a/w — no SELECT/INSERT/UPDATE)
-- apps/api's Fastify server always connects as service_role
-- (apps/api/src/plugins/supabase.ts) — with grants missing, every
-- single query fails with "permission denied for table X",
-- including the startup health check itself.
--
-- A real hosted Supabase project already grants this correctly as
-- part of the platform's own bootstrap — this migration is a no-op
-- there (GRANT/ALTER ROLE are both idempotent). It only matters for
-- local `supabase start` stacks that hit this CLI-version bug.
-- ============================================================

-- Deliberately scoped to `public` only — the schema this repo's migrations
-- own and the one the observed bug hit. `auth`/`storage` are owned by
-- Supabase's own internal roles (supabase_auth_admin / supabase_storage_admin);
-- the migration-running role may not be permitted to GRANT on tables it
-- doesn't own there, and this repo's migrations never need to touch them.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'ALTER ROLE service_role BYPASSRLS';
    EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role';
    EXECUTE 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role';
    EXECUTE 'GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role';
  END IF;
END
$$;
