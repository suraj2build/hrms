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

-- storage schema: minimal objects/buckets for migrations that reference them
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS storage.objects (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT,
  name      TEXT,
  owner     UUID
);
