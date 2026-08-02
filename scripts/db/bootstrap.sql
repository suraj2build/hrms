-- Minimal Supabase scaffolding so the app's migrations can apply against a plain
-- Postgres (used only by the schema-drift guardrail; production gets these from
-- Supabase itself). Intentionally just enough to satisfy references — not a faithful
-- reproduction of Supabase internals.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Roles referenced by GRANT / RLS
DO $$ BEGIN CREATE ROLE anon          NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role  NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- auth schema: users table + the helper functions used in RLS predicates
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);
CREATE OR REPLACE FUNCTION auth.uid()  RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION auth.jwt()  RETURNS JSONB LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

-- storage schema: minimal objects/buckets for migrations that reference them.
-- public/file_size_limit/allowed_mime_types and foldername() were added after
-- migrations 363/385/418 started relying on them (SYSCERT_AUDIT_2026-08-02.md
-- High #23) — this shim had fallen behind what later migrations assume.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                TEXT PRIMARY KEY,
  name              TEXT,
  public            BOOLEAN DEFAULT false,
  file_size_limit   BIGINT,
  allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name      TEXT,
  owner     UUID
);

-- Real Supabase Storage implementation: splits the object path on '/' and
-- returns every segment except the filename (the last element) — e.g.
-- 'tenant-id/employee-id/file.pdf' -> ARRAY['tenant-id', 'employee-id'].
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT)
RETURNS TEXT[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _parts TEXT[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END
$$;
