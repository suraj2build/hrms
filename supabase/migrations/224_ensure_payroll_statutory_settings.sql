-- 224_ensure_payroll_statutory_settings.sql
-- Idempotent ensure for payroll_statutory_settings (originally migration 166).
-- On drifted production DBs where 166 wasn't applied, GET/PUT
-- /payroll/statutory/governance/settings 500s (table missing), which breaks the
-- Statutory Policy page and the new TDS enable toggle. This recreates the table +
-- columns + RLS idempotently so TDS settings can be read and saved.

CREATE TABLE IF NOT EXISTS payroll_statutory_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    pf_enabled          BOOLEAN NOT NULL DEFAULT true,
    esi_enabled         BOOLEAN NOT NULL DEFAULT true,
    pt_enabled          BOOLEAN NOT NULL DEFAULT false,
    tds_enabled         BOOLEAN NOT NULL DEFAULT false,
    tds_default_rate    DECIMAL(5,2) NOT NULL DEFAULT 0,
    tds_default_regime  TEXT NOT NULL DEFAULT 'new' CHECK (tds_default_regime IN ('old','new')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- Columns (in case an older/partial table exists)
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS pf_enabled         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS esi_enabled        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS pt_enabled         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS tds_enabled        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS tds_default_rate   DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS tds_default_regime TEXT NOT NULL DEFAULT 'new';
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE payroll_statutory_settings ADD COLUMN IF NOT EXISTS updated_by         UUID;

ALTER TABLE payroll_statutory_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_statutory_settings' AND policyname = 'statset_tenant_read') THEN
    CREATE POLICY "statset_tenant_read" ON payroll_statutory_settings
      FOR SELECT USING (tenant_id = get_user_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'payroll_statutory_settings' AND policyname = 'statset_hr_write') THEN
    CREATE POLICY "statset_hr_write" ON payroll_statutory_settings
      FOR ALL USING (get_user_role() IN ('super_admin', 'hr_admin'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
