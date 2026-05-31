CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'starter',
  logo_url    TEXT,
  industry    TEXT,
  size_range  TEXT,
  country     TEXT NOT NULL DEFAULT 'IN',
  settings    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
