-- ═══════════════════════════════════════════════════════════════════════════
--  reconcile_live_schema.sql
--
--  ONE-SHOT, FULLY IDEMPOTENT schema reconciliation script.
--
--  Purpose:
--    The live production Supabase/PostgreSQL database was bootstrapped from an
--    OLDER/different schema. It is missing columns, has stale CHECK constraints,
--    and is missing whole tables — causing 500 errors one endpoint at a time.
--    This script brings the live DB into alignment with the HRMS app's expected
--    schema (migrations 001, 002, 066, 202, 203, 205, 206, 207).
--
--  Safety guarantees — safe to run on a DB that already has production data:
--    • Every table  uses CREATE TABLE IF NOT EXISTS.
--    • Every column uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
--    • CHECK constraints that must change are dropped (IF EXISTS) then re-added.
--    • NO table is ever dropped. NO column is ever dropped.
--    • NO data is ever DELETEd / TRUNCATEd.
--    • DROP NOT NULL is idempotent in PostgreSQL (no error if already nullable).
--    • RLS policies are created only for the brand-new tables (206, 207) and
--      are guarded by DROP POLICY IF EXISTS for safe re-runs.
--    • Ends with NOTIFY pgrst to reload PostgREST's schema cache.
--
--  Run once in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 1 — PROFILES RECONCILIATION
--    • Ensure `email` column exists (migration 203) and is nullable.
--    • Fix stale `role` CHECK constraint (old: owner/admin/manager/member/guest;
--      correct: super_admin/hr_admin/manager/employee).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. Ensure email column exists (migration 203) and backfill from auth.users.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Make email nullable to match migration 203 (live DB had it NOT NULL).
ALTER TABLE profiles
  ALTER COLUMN email DROP NOT NULL;

-- Backfill any NULL emails from auth.users (idempotent).
UPDATE profiles p
SET    email = u.email
FROM   auth.users u
WHERE  p.id = u.id
  AND  p.email IS NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email_tenant ON profiles(email, tenant_id);

-- 1b. Fix the `role` CHECK constraint.
-- Drop the conventional constraint name, AND defensively drop ANY check
-- constraint on the profiles table that references the `role` column
-- (covers the case where the live constraint has a non-conventional name).
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      rel ON rel.oid = con.conrelid
    JOIN   pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE  rel.relname = 'profiles'
      AND  nsp.nspname = 'public'
      AND  con.contype = 'c'
      AND  pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- Re-add the correct role CHECK constraint.
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','hr_admin','manager','employee'));


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 2 — TENANTS RECONCILIATION  (migration 202 + 001 base columns)
--    Adds all SaaS/licensing columns. Each is additive and idempotent.
--    NOTE: platform_admins / tenant_signup_requests (referenced by the FK
--    columns onboarded_by / signup_request_id) are created in SECTION 3, so
--    those two FK ADD COLUMNs are deferred to the end of SECTION 3.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ensure base columns from 001 that older bootstraps may lack.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country  TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- Licensing / billing columns from migration 202.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_issued_at   TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS license_expires_at  TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_email       TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS per_employee_rate   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes               TEXT;

-- status column + its CHECK constraint. Add column first (no inline CHECK so we
-- can manage the constraint name explicitly), then (re)attach the constraint.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trial';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      rel ON rel.oid = con.conrelid
    JOIN   pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE  rel.relname = 'tenants'
      AND  nsp.nspname = 'public'
      AND  con.contype = 'c'
      AND  pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('trial','active','expired','suspended','cancelled'));


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 3 — PLATFORM TABLES  (migration 202)
--    platform_admins, tenant_signup_requests, tenant_api_keys,
--    api_usage_log, tenant_billing_snapshots + their RLS.
--    (Owner-account seed DO block and plan-normalisation UPDATE are skipped.)
-- ═══════════════════════════════════════════════════════════════════════════

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

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  key_prefix    TEXT        NOT NULL,
  key_hash      TEXT        NOT NULL UNIQUE,
  scopes        TEXT[]      NOT NULL DEFAULT '{}',
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_by    UUID        REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON tenant_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON tenant_api_keys(key_hash) WHERE is_active = true;

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

-- tenant_billing_snapshots: payroll_run_id kept as a plain UUID (no FK) so this
-- script never fails if payroll_runs is absent on the drifted DB. The app does
-- not rely on DB-level FK enforcement here.
CREATE TABLE IF NOT EXISTS tenant_billing_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_run_id    UUID,
  snapshot_month    TEXT        NOT NULL,
  employee_count    INT         NOT NULL,
  per_employee_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_due        NUMERIC(12,2) GENERATED ALWAYS AS (employee_count * per_employee_rate) STORED,
  plan              TEXT        NOT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, payroll_run_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_tenant_month ON tenant_billing_snapshots(tenant_id, snapshot_month DESC);

-- RLS for platform tables (not tenant-scoped; controlled at API layer).
ALTER TABLE platform_admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_signup_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_snapshots ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY platform_admins_service_all          ON platform_admins          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY signup_requests_service_all          ON tenant_signup_requests   FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_api_keys_service_all          ON tenant_api_keys          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY api_usage_log_service_all            ON api_usage_log            FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_billing_snapshots_service_all ON tenant_billing_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY platform_admins_deny_anon          ON platform_admins          FOR ALL TO anon USING (false);
CREATE POLICY signup_requests_deny_anon          ON tenant_signup_requests   FOR ALL TO anon USING (false);
CREATE POLICY tenant_api_keys_deny_anon          ON tenant_api_keys          FOR ALL TO anon USING (false);
CREATE POLICY api_usage_log_deny_anon            ON api_usage_log            FOR ALL TO anon USING (false);
CREATE POLICY tenant_billing_snapshots_deny_anon ON tenant_billing_snapshots FOR ALL TO anon USING (false);

-- Deferred tenants FK columns (now that referenced platform tables exist).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarded_by      UUID REFERENCES platform_admins(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_request_id UUID REFERENCES tenant_signup_requests(id) ON DELETE SET NULL;


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 4 — HR EVENTS + NOTIFICATIONS  (migration 066)
--    Fixes /notifications 500 when these tables are missing.
--    RLS policies depend on helper fns get_user_tenant_id() / get_user_role(),
--    which exist in the base schema. Policies are guarded for safe re-runs.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  actor_id      UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  target_type   TEXT        NULL,
  target_id     UUID        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_events_tenant_type
  ON hr_events (tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_events_target
  ON hr_events (tenant_id, target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  recipient_id  UUID        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  event_id      UUID        NOT NULL REFERENCES hr_events(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  link          TEXT        NULL,
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (tenant_id, recipient_id, is_read, created_at DESC);

ALTER TABLE hr_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_hr_read"   ON hr_events;
DROP POLICY IF EXISTS "events_hr_insert" ON hr_events;
DROP POLICY IF EXISTS "notif_own_read"   ON notifications;
DROP POLICY IF EXISTS "notif_own_update" ON notifications;
DROP POLICY IF EXISTS "notif_hr_insert"  ON notifications;

-- These policies depend on helper functions get_user_tenant_id()/get_user_role().
-- If those functions are absent on the drifted DB, skip the policies gracefully
-- (the API uses service_role which bypasses RLS, so notifications still work).
DO $$
BEGIN
  CREATE POLICY "events_hr_read" ON hr_events FOR SELECT
    USING (
      tenant_id = get_user_tenant_id()
      AND (
        get_user_role() IN ('super_admin', 'hr_admin', 'manager')
        OR target_id = auth.uid()
      )
    );
  CREATE POLICY "events_hr_insert" ON hr_events FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());
  CREATE POLICY "notif_own_read" ON notifications FOR SELECT
    USING (tenant_id = get_user_tenant_id() AND recipient_id = auth.uid());
  CREATE POLICY "notif_own_update" ON notifications FOR UPDATE
    USING (tenant_id = get_user_tenant_id() AND recipient_id = auth.uid());
  CREATE POLICY "notif_hr_insert" ON notifications FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'Skipped hr_events/notifications RLS — helper functions missing (service_role bypasses RLS anyway)';
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 5 — PAYROLL_GROUPS RECONCILIATION  (migration 205)
--    • Add cycle_start_day (1–28).
--    • Fix cutoff_day CHECK (was 1–28, must be 1–31).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE payroll_groups
  ADD COLUMN IF NOT EXISTS cycle_start_day INTEGER NOT NULL DEFAULT 1
    CHECK (cycle_start_day BETWEEN 1 AND 28);

-- Fix cutoff_day constraint. Drop the conventional name plus any stale check
-- constraint referencing cutoff_day, then add the correct 1–31 constraint.
ALTER TABLE payroll_groups DROP CONSTRAINT IF EXISTS payroll_groups_cutoff_day_check;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM   pg_constraint con
    JOIN   pg_class      rel ON rel.oid = con.conrelid
    JOIN   pg_namespace  nsp ON nsp.oid = rel.relnamespace
    WHERE  rel.relname = 'payroll_groups'
      AND  nsp.nspname = 'public'
      AND  con.contype = 'c'
      AND  pg_get_constraintdef(con.oid) ILIKE '%cutoff_day%'
  LOOP
    EXECUTE format('ALTER TABLE public.payroll_groups DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE payroll_groups
  ADD CONSTRAINT payroll_groups_cutoff_day_check CHECK (cutoff_day BETWEEN 1 AND 31);


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 6 — ONBOARDING + SEPARATION TABLES  (migration 206)
--    employee_separation is referenced by separation_clearances /
--    separation_ff_summary and is assumed to exist in the base schema.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_checklist_templates (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  description    TEXT,
  is_default     BOOLEAN     NOT NULL DEFAULT false,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_checklist_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_onboarding_checklist_templates" ON onboarding_checklist_templates;
DROP POLICY IF EXISTS "anon_deny_onboarding_checklist_templates"        ON onboarding_checklist_templates;
CREATE POLICY "service_role_all_onboarding_checklist_templates"
  ON onboarding_checklist_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_onboarding_checklist_templates"
  ON onboarding_checklist_templates FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_templates_tenant
  ON onboarding_checklist_templates(tenant_id);

CREATE TABLE IF NOT EXISTS onboarding_checklist_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id      UUID        NOT NULL REFERENCES onboarding_checklist_templates(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        CHECK (category IN ('it_setup','document_collection','access_provisioning','induction','compliance','other')),
  due_day_offset   INT         NOT NULL DEFAULT 1,
  assigned_to_role TEXT        CHECK (assigned_to_role IN ('hr','it','manager','admin','employee')),
  is_mandatory     BOOLEAN     NOT NULL DEFAULT true,
  sort_order       INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_onboarding_checklist_items" ON onboarding_checklist_items;
DROP POLICY IF EXISTS "anon_deny_onboarding_checklist_items"        ON onboarding_checklist_items;
CREATE POLICY "service_role_all_onboarding_checklist_items"
  ON onboarding_checklist_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_onboarding_checklist_items"
  ON onboarding_checklist_items FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_items_tenant
  ON onboarding_checklist_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_items_template
  ON onboarding_checklist_items(template_id);

CREATE TABLE IF NOT EXISTS employee_onboarding_checklists (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id             UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  template_id             UUID        REFERENCES onboarding_checklist_templates(id) ON DELETE SET NULL,
  status                  TEXT        NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started','in_progress','completed')),
  start_date              DATE,
  target_completion_date  DATE,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);

ALTER TABLE employee_onboarding_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_employee_onboarding_checklists" ON employee_onboarding_checklists;
DROP POLICY IF EXISTS "anon_deny_employee_onboarding_checklists"        ON employee_onboarding_checklists;
CREATE POLICY "service_role_all_employee_onboarding_checklists"
  ON employee_onboarding_checklists FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_employee_onboarding_checklists"
  ON employee_onboarding_checklists FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_checklists_tenant
  ON employee_onboarding_checklists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_checklists_employee
  ON employee_onboarding_checklists(employee_id);

CREATE TABLE IF NOT EXISTS employee_onboarding_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_id     UUID        NOT NULL REFERENCES employee_onboarding_checklists(id) ON DELETE CASCADE,
  item_id          UUID        REFERENCES onboarding_checklist_items(id) ON DELETE SET NULL,
  title            TEXT        NOT NULL,
  description      TEXT,
  category         TEXT        CHECK (category IN ('it_setup','document_collection','access_provisioning','induction','compliance','other')),
  due_date         DATE,
  assigned_to_role TEXT        CHECK (assigned_to_role IN ('hr','it','manager','admin','employee')),
  is_mandatory     BOOLEAN     NOT NULL DEFAULT true,
  status           TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','skipped')),
  completed_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at     TIMESTAMPTZ,
  notes            TEXT,
  sort_order       INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE employee_onboarding_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_employee_onboarding_tasks" ON employee_onboarding_tasks;
DROP POLICY IF EXISTS "anon_deny_employee_onboarding_tasks"        ON employee_onboarding_tasks;
CREATE POLICY "service_role_all_employee_onboarding_tasks"
  ON employee_onboarding_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_employee_onboarding_tasks"
  ON employee_onboarding_tasks FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_tasks_tenant
  ON employee_onboarding_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_onboarding_tasks_checklist
  ON employee_onboarding_tasks(checklist_id);

CREATE TABLE IF NOT EXISTS separation_clearances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_id  UUID        NOT NULL REFERENCES employee_separation(id) ON DELETE CASCADE,
  department     TEXT        NOT NULL
                   CHECK (department IN ('it','finance','manager','admin','hr')),
  status         TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','cleared','rejected')),
  cleared_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  cleared_at     TIMESTAMPTZ,
  remarks        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, separation_id, department)
);

ALTER TABLE separation_clearances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_separation_clearances" ON separation_clearances;
DROP POLICY IF EXISTS "anon_deny_separation_clearances"        ON separation_clearances;
CREATE POLICY "service_role_all_separation_clearances"
  ON separation_clearances FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_separation_clearances"
  ON separation_clearances FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_separation_clearances_tenant
  ON separation_clearances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_separation_clearances_separation
  ON separation_clearances(separation_id);

CREATE TABLE IF NOT EXISTS separation_ff_summary (
  id                        UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  separation_id             UUID           NOT NULL UNIQUE REFERENCES employee_separation(id) ON DELETE CASCADE,
  employee_id               UUID           NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_payroll_amount       NUMERIC(14,2)  NOT NULL DEFAULT 0,
  leave_encashment_amount   NUMERIC(14,2)  NOT NULL DEFAULT 0,
  gratuity_amount           NUMERIC(14,2)  NOT NULL DEFAULT 0,
  notice_period_deduction   NUMERIC(14,2)  NOT NULL DEFAULT 0,
  other_deductions          NUMERIC(14,2)  NOT NULL DEFAULT 0,
  other_additions           NUMERIC(14,2)  NOT NULL DEFAULT 0,
  net_payable               NUMERIC(14,2)  GENERATED ALWAYS AS (
                              last_payroll_amount
                              + leave_encashment_amount
                              + gratuity_amount
                              + other_additions
                              - notice_period_deduction
                              - other_deductions
                            ) STORED,
  status                    TEXT           NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','approved','paid')),
  approved_by               UUID           REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at               TIMESTAMPTZ,
  paid_at                   TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

ALTER TABLE separation_ff_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_separation_ff_summary" ON separation_ff_summary;
DROP POLICY IF EXISTS "anon_deny_separation_ff_summary"        ON separation_ff_summary;
CREATE POLICY "service_role_all_separation_ff_summary"
  ON separation_ff_summary FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_separation_ff_summary"
  ON separation_ff_summary FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_tenant
  ON separation_ff_summary(tenant_id);
CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_separation
  ON separation_ff_summary(separation_id);
CREATE INDEX IF NOT EXISTS idx_separation_ff_summary_employee
  ON separation_ff_summary(employee_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 7 — PRE-ONBOARDING TABLES  (migration 207)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pre_joinee_invitations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token             TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  first_name        TEXT        NOT NULL,
  last_name         TEXT        NOT NULL,
  email             TEXT        NOT NULL,
  phone             TEXT,
  designation       TEXT,
  department        TEXT,
  joining_date      DATE        NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'expired')),
  created_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  employee_id       UUID        REFERENCES employees(id) ON DELETE SET NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS pre_joinee_submissions (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id               UUID        NOT NULL UNIQUE REFERENCES pre_joinee_invitations(id) ON DELETE CASCADE,
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dob                         DATE,
  gender                      TEXT,
  blood_group                 TEXT,
  marital_status              TEXT,
  nationality                 TEXT        DEFAULT 'Indian',
  address_line1               TEXT,
  address_line2               TEXT,
  city                        TEXT,
  state                       TEXT,
  pincode                     TEXT,
  emergency_contact_name      TEXT,
  emergency_contact_phone     TEXT,
  emergency_contact_relation  TEXT,
  bank_name                   TEXT,
  bank_account_number         TEXT,
  bank_ifsc                   TEXT,
  bank_account_type           TEXT        DEFAULT 'savings',
  pan_number                  TEXT,
  aadhaar_number              TEXT,
  uan_number                  TEXT,
  documents_uploaded          BOOLEAN     NOT NULL DEFAULT false,
  declaration_accepted        BOOLEAN     NOT NULL DEFAULT false,
  submitted_at                TIMESTAMPTZ,
  reviewed_by                 UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMPTZ,
  review_notes                TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pji_tenant_id  ON pre_joinee_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pji_token      ON pre_joinee_invitations (token);
CREATE INDEX IF NOT EXISTS idx_pji_email      ON pre_joinee_invitations (email);
CREATE INDEX IF NOT EXISTS idx_pji_status     ON pre_joinee_invitations (status);
CREATE INDEX IF NOT EXISTS idx_pjs_tenant_id     ON pre_joinee_submissions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pjs_invitation_id ON pre_joinee_submissions (invitation_id);

ALTER TABLE pre_joinee_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_joinee_submissions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_pji" ON pre_joinee_invitations;
DROP POLICY IF EXISTS "anon_deny_pji"        ON pre_joinee_invitations;
DROP POLICY IF EXISTS "service_role_all_pjs" ON pre_joinee_submissions;
DROP POLICY IF EXISTS "anon_deny_pjs"        ON pre_joinee_submissions;

CREATE POLICY "service_role_all_pji"
  ON pre_joinee_invitations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_pji"
  ON pre_joinee_invitations FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "service_role_all_pjs"
  ON pre_joinee_submissions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "anon_deny_pjs"
  ON pre_joinee_submissions FOR ALL TO anon USING (false) WITH CHECK (false);


-- ═══════════════════════════════════════════════════════════════════════════
--  SECTION 8 — RELOAD POSTGREST SCHEMA CACHE
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
