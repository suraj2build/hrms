-- Migration 334: Formal Award Programs, Rounds, Nominations, Spot Awards

CREATE TABLE IF NOT EXISTS formal_awards (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                     TEXT        NOT NULL,
  description              TEXT,
  frequency                TEXT        NOT NULL DEFAULT 'monthly'
    CHECK (frequency IN ('monthly','quarterly','annual','ad_hoc')),
  award_type               TEXT        NOT NULL DEFAULT 'custom'
    CHECK (award_type IN ('employee_of_month','spot_award','long_service','peer_choice','store_of_month','custom')),
  monetary_value           NUMERIC(10,2),
  monetary_description     TEXT,
  eligible_group           TEXT,
  is_active                BOOLEAN     NOT NULL DEFAULT true,
  requires_nomination      BOOLEAN     NOT NULL DEFAULT true,
  auto_long_service        BOOLEAN     NOT NULL DEFAULT false,
  milestone_years          INTEGER[],
  created_by               UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS award_rounds (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  award_id            UUID        NOT NULL REFERENCES formal_awards(id) ON DELETE CASCADE,
  period_label        TEXT        NOT NULL,
  period_start        DATE,
  period_end          DATE,
  status              TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','review','closed','cancelled')),
  winner_employee_id  UUID        REFERENCES employees(id) ON DELETE SET NULL,
  winner_notes        TEXT,
  declared_at         TIMESTAMPTZ,
  declared_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_by          UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS award_nominations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  round_id      UUID        NOT NULL REFERENCES award_rounds(id) ON DELETE CASCADE,
  nominee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nominated_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  justification TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','shortlisted','winner','not_selected')),
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, nominee_id)
);

CREATE TABLE IF NOT EXISTS spot_awards (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_employee_id   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  award_name       TEXT        NOT NULL,
  message          TEXT,
  monetary_value   NUMERIC(10,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_formal_awards_tenant ON formal_awards(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_award_rounds_award ON award_rounds(tenant_id, award_id, status);
CREATE INDEX IF NOT EXISTS idx_award_nominations_round ON award_nominations(tenant_id, round_id, status);
CREATE INDEX IF NOT EXISTS idx_spot_awards_tenant ON spot_awards(tenant_id, created_at);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_formal_awards_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_formal_awards_ts ON formal_awards;
CREATE TRIGGER trg_formal_awards_ts BEFORE UPDATE ON formal_awards FOR EACH ROW EXECUTE FUNCTION update_formal_awards_ts();
DROP TRIGGER IF EXISTS trg_award_rounds_ts ON award_rounds;
CREATE TRIGGER trg_award_rounds_ts BEFORE UPDATE ON award_rounds FOR EACH ROW EXECUTE FUNCTION update_formal_awards_ts();

-- RLS
ALTER TABLE formal_awards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_nominations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_awards        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "formal_awards_admin"     ON formal_awards;
CREATE POLICY "formal_awards_admin"     ON formal_awards     FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "award_rounds_admin"      ON award_rounds;
CREATE POLICY "award_rounds_admin"      ON award_rounds      FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "award_nominations_admin" ON award_nominations;
CREATE POLICY "award_nominations_admin" ON award_nominations FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
DROP POLICY IF EXISTS "spot_awards_read"        ON spot_awards;
CREATE POLICY "spot_awards_read"        ON spot_awards       FOR SELECT USING (tenant_id = get_user_tenant_id());
DROP POLICY IF EXISTS "spot_awards_admin"       ON spot_awards;
DROP POLICY IF EXISTS "spot_awards_insert"      ON spot_awards;
CREATE POLICY "spot_awards_insert"      ON spot_awards       FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- Seed default formal awards for existing tenants
INSERT INTO formal_awards (tenant_id, name, description, frequency, award_type, monetary_value, monetary_description, eligible_group, requires_nomination, auto_long_service)
SELECT t.id,
       a.name, a.description, a.frequency::text, a.award_type::text,
       a.monetary_value, a.monetary_description, a.eligible_group, true, a.auto_ls
FROM tenants t
CROSS JOIN (VALUES
  ('Star Employee of the Month',   'Best performing employee each month per store',   'monthly',   'employee_of_month', 500,  'Gift voucher (Rs.500)',   'All store employees',       false),
  ('Store of the Month',           'Best performing store each month',                'monthly',   'store_of_month',    NULL, 'Trophy + Announcement',  'All stores',                false),
  ('Long Service Award – 1 Year',  'Recognising 1 year of service',                  'annual',    'long_service',      1000, 'Certificate + Rs.1,000 voucher', 'All employees',      true),
  ('Long Service Award – 3 Years', 'Recognising 3 years of committed service',       'annual',    'long_service',      3000, 'Certificate + Rs.3,000 voucher', 'All employees',      true),
  ('Long Service Award – 5 Years', 'Recognising 5 years of exceptional loyalty',     'annual',    'long_service',      5000, 'Certificate + Rs.5,000 voucher', 'All employees',      true)
) AS a(name, description, frequency, award_type, monetary_value, monetary_description, eligible_group, auto_ls)
ON CONFLICT (tenant_id, name) DO NOTHING;
