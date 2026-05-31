-- ═══════════════════════════════════════════════════════════════════════════
--  202_saas_platform_owner.sql
--
--  SaaS Platform Owner Layer
--  ─────────────────────────
--  Creates the full owner/licensing infrastructure:
--    • platform_admins          — owner + co-admin accounts
--    • tenant_signup_requests   — self-registration request queue
--    • tenant_api_keys          — per-tenant scoped API keys (hashed)
--    • api_usage_log            — per-request usage tracking
--    • tenant_billing_snapshots — payroll headcount × rate = invoice amount
--    • tenants table additions  — status, trial, license, billing, rate
--
--  Also creates a DEFAULT OWNER LOGIN:
--    Email:    owner@platform.local
--    Password: Platform@Owner2024!
--  ⚠  CHANGE THE PASSWORD after first login.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. PLATFORM ADMINS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_admins (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'admin'
                           CHECK (role IN ('owner', 'admin')),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  invited_by   UUID        REFERENCES platform_admins(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_user  ON platform_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_admins_email ON platform_admins(email);

-- ── 2. TENANT SIGNUP REQUESTS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_signup_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT        NOT NULL,
  contact_name    TEXT        NOT NULL,
  contact_email   TEXT        NOT NULL,
  industry        TEXT,
  size_range      TEXT,
  country         TEXT        NOT NULL DEFAULT 'IN',
  message         TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     UUID        REFERENCES platform_admins(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  tenant_id       UUID        REFERENCES tenants(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signup_requests_status ON tenant_signup_requests(status, created_at DESC);

-- ── 3. ENHANCE TENANTS TABLE ─────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS status              TEXT        NOT NULL DEFAULT 'trial'
                                               CHECK (status IN ('trial','active','expired','suspended','cancelled')),
  ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS license_issued_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS license_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_email       TEXT,
  ADD COLUMN IF NOT EXISTS per_employee_rate   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_by        UUID        REFERENCES platform_admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signup_request_id   UUID        REFERENCES tenant_signup_requests(id) ON DELETE SET NULL;

-- Normalise plan values — ensure consistent naming
UPDATE tenants SET plan = 'standard'   WHERE plan NOT IN ('standard', 'enterprise');

-- ── 4. TENANT API KEYS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,                       -- "Production", "Dev"
  key_prefix    TEXT        NOT NULL,                       -- "sk_live_ab12cd34" (shown in UI)
  key_hash      TEXT        NOT NULL UNIQUE,                -- SHA-256 of full key (never stored plain)
  scopes        TEXT[]      NOT NULL DEFAULT '{}',          -- ['employees:read', 'attendance:write', ...]
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                                -- NULL = never expires
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID        REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant   ON tenant_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash     ON tenant_api_keys(key_hash) WHERE is_active = true;

-- ── 5. API USAGE LOG ─────────────────────────────────────────────────────────
-- Uses BIGSERIAL for fast inserts. Retention: 90 days (enforced by cleanup job).

CREATE TABLE IF NOT EXISTS api_usage_log (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     UUID        NOT NULL,
  api_key_id    UUID        REFERENCES tenant_api_keys(id) ON DELETE SET NULL,
  endpoint      TEXT        NOT NULL,
  method        TEXT        NOT NULL,
  status_code   SMALLINT,
  response_ms   INT,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_tenant_date ON api_usage_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_date        ON api_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_key         ON api_usage_log(api_key_id, created_at DESC);

-- ── 6. TENANT BILLING SNAPSHOTS ──────────────────────────────────────────────
-- Captured automatically on every payroll run finalization.
-- amount_due = employee_count × per_employee_rate (rate snapshotted at time of run)

CREATE TABLE IF NOT EXISTS tenant_billing_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_run_id    UUID        REFERENCES payroll_runs(id) ON DELETE SET NULL,
  snapshot_month    TEXT        NOT NULL,                   -- 'YYYY-MM'
  employee_count    INT         NOT NULL,
  per_employee_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_due        NUMERIC(12,2) GENERATED ALWAYS AS (employee_count * per_employee_rate) STORED,
  plan              TEXT        NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payroll_run_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_tenant_month ON tenant_billing_snapshots(tenant_id, snapshot_month DESC);

-- ── 7. RLS — platform tables are NOT tenant-scoped ───────────────────────────
-- All platform tables bypass normal tenant RLS.
-- Access is controlled purely at the API layer (platform_admin JWT check).

ALTER TABLE platform_admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_signup_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (idempotent re-run safety)
DROP POLICY IF EXISTS platform_admins_service_all          ON platform_admins;
DROP POLICY IF EXISTS signup_requests_service_all          ON tenant_signup_requests;
DROP POLICY IF EXISTS tenant_api_keys_service_all          ON tenant_api_keys;
DROP POLICY IF EXISTS api_usage_log_service_all            ON api_usage_log;
DROP POLICY IF EXISTS tenant_billing_snapshots_service_all ON tenant_billing_snapshots;

DROP POLICY IF EXISTS platform_admins_deny_anon          ON platform_admins;
DROP POLICY IF EXISTS signup_requests_deny_anon          ON tenant_signup_requests;
DROP POLICY IF EXISTS tenant_api_keys_deny_anon          ON tenant_api_keys;
DROP POLICY IF EXISTS api_usage_log_deny_anon            ON api_usage_log;
DROP POLICY IF EXISTS tenant_billing_snapshots_deny_anon ON tenant_billing_snapshots;

-- Service role (used by API) can do everything
CREATE POLICY platform_admins_service_all          ON platform_admins          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY signup_requests_service_all          ON tenant_signup_requests   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_api_keys_service_all          ON tenant_api_keys          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY api_usage_log_service_all            ON api_usage_log            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_billing_snapshots_service_all ON tenant_billing_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users cannot access platform tables via client (only API can)
CREATE POLICY platform_admins_deny_anon          ON platform_admins          FOR ALL TO anon      USING (false);
CREATE POLICY signup_requests_deny_anon          ON tenant_signup_requests   FOR ALL TO anon      USING (false);
CREATE POLICY tenant_api_keys_deny_anon          ON tenant_api_keys          FOR ALL TO anon      USING (false);
CREATE POLICY api_usage_log_deny_anon            ON api_usage_log            FOR ALL TO anon      USING (false);
CREATE POLICY tenant_billing_snapshots_deny_anon ON tenant_billing_snapshots FOR ALL TO anon      USING (false);

-- ── 8. DEFAULT OWNER LOGIN ───────────────────────────────────────────────────
--
--  Registers an existing Supabase auth user as the platform owner.
--
--  BEFORE running this migration:
--    1. Go to Supabase Dashboard → Authentication → Users → Add User
--    2. Email: owner@platform.local
--    3. Password: Platform@Owner2024!  (change after first login)
--    4. Check "Auto Confirm User"
--    5. Then run this migration — it will link that user to platform_admins
--
--  If the user does not yet exist this block prints a warning and skips.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_owner_id    UUID;
  v_owner_email TEXT := 'owner@platform.local';
BEGIN

  -- Look up the user created via Supabase Dashboard
  SELECT id INTO v_owner_id
  FROM auth.users
  WHERE email = v_owner_email
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE '════════════════════════════════════════════════════════════';
    RAISE NOTICE 'SKIPPED: owner@platform.local not found in auth.users.';
    RAISE NOTICE 'To create the owner account:';
    RAISE NOTICE '  1. Supabase Dashboard → Authentication → Users → Add User';
    RAISE NOTICE '  2. Email: owner@platform.local, Password: Platform@Owner2024!';
    RAISE NOTICE '  3. Check "Auto Confirm User"';
    RAISE NOTICE '  4. Re-run this migration';
    RAISE NOTICE '════════════════════════════════════════════════════════════';
    RETURN;
  END IF;

  -- Idempotent: remove any previous registration before re-inserting
  DELETE FROM platform_admins WHERE email = v_owner_email;

  -- Register as platform owner
  INSERT INTO platform_admins (user_id, name, email, role)
  VALUES (v_owner_id, 'Platform Owner', v_owner_email, 'owner');

  RAISE NOTICE '════════════════════════════════════════════';
  RAISE NOTICE 'Owner account registered successfully:';
  RAISE NOTICE '  Email: owner@platform.local';
  RAISE NOTICE '  ID:    %', v_owner_id;
  RAISE NOTICE '  ⚠  Change password after first login!';
  RAISE NOTICE '════════════════════════════════════════════';

END $$;
