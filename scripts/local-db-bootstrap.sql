-- ============================================================
-- local-db-bootstrap.sql
-- Create auth + storage schemas needed by Supabase migrations
-- Run ONCE before applying migrations in local dev (without Docker)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Auth schema (minimal GoTrue-compatible) ───────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id        UUID,
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aud                TEXT DEFAULT 'authenticated',
  role               TEXT DEFAULT 'authenticated',
  email              TEXT UNIQUE,
  encrypted_password TEXT,
  email_confirmed_at TIMESTAMPTZ DEFAULT now(),
  invited_at         TIMESTAMPTZ,
  confirmation_token TEXT DEFAULT '',
  confirmation_sent_at TIMESTAMPTZ,
  recovery_token     TEXT DEFAULT '',
  recovery_sent_at   TIMESTAMPTZ,
  email_change_token_new TEXT DEFAULT '',
  email_change       TEXT DEFAULT '',
  email_change_sent_at TIMESTAMPTZ,
  last_sign_in_at    TIMESTAMPTZ,
  raw_app_meta_data  JSONB DEFAULT '{}',
  raw_user_meta_data JSONB DEFAULT '{}',
  is_super_admin     BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  phone              TEXT,
  phone_confirmed_at TIMESTAMPTZ,
  phone_change       TEXT DEFAULT '',
  phone_change_token TEXT DEFAULT '',
  phone_change_sent_at TIMESTAMPTZ,
  email_change_token_current TEXT DEFAULT '',
  email_change_confirm_status SMALLINT DEFAULT 0,
  banned_until       TIMESTAMPTZ,
  reauthentication_token TEXT DEFAULT '',
  reauthentication_sent_at TIMESTAMPTZ,
  is_sso_user        BOOLEAN DEFAULT false,
  deleted_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth.sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  factor_id     UUID,
  aal           TEXT,
  not_after     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  instance_id UUID,
  id          BIGSERIAL PRIMARY KEY,
  token       TEXT UNIQUE,
  user_id     TEXT,
  revoked     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  parent      TEXT,
  session_id  UUID REFERENCES auth.sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  friendly_name   TEXT,
  factor_type     TEXT,
  status          TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  secret          TEXT
);

-- GoTrue helper functions used by RLS policies
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb->>'sub',
    ''
  )::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb->>'role',
    'anon'
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.email() RETURNS TEXT AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb->>'email';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb,
    '{}'::jsonb
  );
$$ LANGUAGE sql STABLE;

-- ── Storage schema (minimal Supabase Storage-compatible) ──────────────────────
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  owner             UUID,
  public            BOOLEAN DEFAULT false,
  avif_autodetection BOOLEAN DEFAULT false,
  file_size_limit   BIGINT,
  allowed_mime_types TEXT[],
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        TEXT REFERENCES storage.buckets(id),
  name             TEXT,
  owner            UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  metadata         JSONB,
  path_tokens      TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

CREATE TABLE IF NOT EXISTS storage.migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial storage migration entry (satisfies checks in migration 038)
INSERT INTO storage.migrations (id, name, hash) VALUES
  (0, 'create-migrations-table', 'abc'), (1, 'initialmigration', 'abc'),
  (2, 'pathtoken-column', 'abc'), (3, 'add-fail-on-public', 'abc'),
  (4, 'add-size-functions', 'abc'), (5, 'change-column-name', 'abc'),
  (6, 'add-oid', 'abc'), (7, 'bacfill-empty-folders', 'abc'),
  (8, 'add-team-rls-policies', 'abc'), (9, 'convid-to-binary', 'abc'),
  (10, 'text-search', 'abc')
ON CONFLICT (id) DO NOTHING;

-- Storage RLS (disabled for local dev since we bypass RLS via service role)
-- (keeping as no-op)

GRANT USAGE ON SCHEMA auth TO postgres;
GRANT USAGE ON SCHEMA storage TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO postgres;
