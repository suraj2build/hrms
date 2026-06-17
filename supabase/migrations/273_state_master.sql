-- ─────────────────────────────────────────────────────────────────────────────
-- 273_state_master.sql
-- State master (India-only). Geographic + statutory axis for sites: GST state
-- code, Professional Tax / Labour Welfare Fund applicability, min-wage zone.
--
-- Decisions (see docs/master-data-site-state-cluster-spec.md):
--   * India-only scope.
--   * Seeded PER TENANT (existing tenants seeded here; new tenants seeded by an
--     AFTER INSERT trigger). Tenants may edit flags afterwards.
--   * region is FREE TEXT.
--   * custom_fields jsonb reserved for the (deferred) UDF mechanism.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS states (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT        NOT NULL,                 -- GST state code, e.g. '27'
  name            TEXT        NOT NULL,                 -- e.g. 'Maharashtra'
  region          TEXT,                                 -- free text (North/South/…)
  country         TEXT        NOT NULL DEFAULT 'India',
  pt_applicable   BOOLEAN     NOT NULL DEFAULT false,   -- Professional Tax levied
  lwf_applicable  BOOLEAN     NOT NULL DEFAULT false,   -- Labour Welfare Fund applies
  lwf_frequency   TEXT,                                 -- monthly | half_yearly | annual | null
  min_wage_zone   TEXT,                                 -- optional default zone label
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  custom_fields   JSONB       NOT NULL DEFAULT '{}',    -- reserved for UDF (deferred)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_states_tenant ON states (tenant_id);

COMMENT ON TABLE  states                IS 'India state/UT master — statutory axis for sites (GST code, PT/LWF).';
COMMENT ON COLUMN states.code           IS 'GST (TIN) state code, 2-digit, e.g. 27 = Maharashtra.';
COMMENT ON COLUMN states.pt_applicable  IS 'Whether Professional Tax is levied in this state.';
COMMENT ON COLUMN states.lwf_applicable IS 'Whether Labour Welfare Fund contributions apply.';
COMMENT ON COLUMN states.custom_fields  IS 'Reserved for user-defined fields (mechanism TBD).';

-- ── 2. updated_at trigger ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_states_updated_at ON states;
CREATE TRIGGER trg_states_updated_at
  BEFORE UPDATE ON states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS states_tenant_select ON states;
CREATE POLICY states_tenant_select ON states
  FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS states_admin_insert ON states;
CREATE POLICY states_admin_insert ON states
  FOR INSERT WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

DROP POLICY IF EXISTS states_admin_update ON states;
CREATE POLICY states_admin_update ON states
  FOR UPDATE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

DROP POLICY IF EXISTS states_admin_delete ON states;
CREATE POLICY states_admin_delete ON states
  FOR DELETE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

-- ── 4. Seed function (idempotent, per tenant) ───────────────────────────────
-- SECURITY DEFINER so it can write regardless of the caller's RLS context
-- (runs during migration and from the tenants AFTER INSERT trigger).
CREATE OR REPLACE FUNCTION seed_states_for_tenant(p_tenant UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO states (tenant_id, code, name, region, pt_applicable, lwf_applicable, lwf_frequency)
  VALUES
    (p_tenant, '01', 'Jammu and Kashmir',                              'North',     false, false, NULL),
    (p_tenant, '02', 'Himachal Pradesh',                               'North',     false, false, NULL),
    (p_tenant, '03', 'Punjab',                                         'North',     false, true,  'monthly'),
    (p_tenant, '04', 'Chandigarh',                                     'North',     false, true,  'monthly'),
    (p_tenant, '05', 'Uttarakhand',                                    'North',     false, false, NULL),
    (p_tenant, '06', 'Haryana',                                        'North',     false, true,  'monthly'),
    (p_tenant, '07', 'Delhi',                                          'North',     false, false, NULL),
    (p_tenant, '08', 'Rajasthan',                                      'North',     false, false, NULL),
    (p_tenant, '09', 'Uttar Pradesh',                                  'North',     false, false, NULL),
    (p_tenant, '10', 'Bihar',                                          'East',      true,  false, NULL),
    (p_tenant, '11', 'Sikkim',                                         'East',      true,  false, NULL),
    (p_tenant, '12', 'Arunachal Pradesh',                              'Northeast', false, false, NULL),
    (p_tenant, '13', 'Nagaland',                                       'Northeast', false, false, NULL),
    (p_tenant, '14', 'Manipur',                                        'Northeast', false, false, NULL),
    (p_tenant, '15', 'Mizoram',                                        'Northeast', false, false, NULL),
    (p_tenant, '16', 'Tripura',                                        'Northeast', true,  false, NULL),
    (p_tenant, '17', 'Meghalaya',                                      'Northeast', true,  false, NULL),
    (p_tenant, '18', 'Assam',                                          'Northeast', true,  false, NULL),
    (p_tenant, '19', 'West Bengal',                                    'East',      true,  true,  'half_yearly'),
    (p_tenant, '20', 'Jharkhand',                                      'East',      true,  false, NULL),
    (p_tenant, '21', 'Odisha',                                         'East',      true,  false, NULL),
    (p_tenant, '22', 'Chhattisgarh',                                   'Central',   true,  true,  'half_yearly'),
    (p_tenant, '23', 'Madhya Pradesh',                                 'Central',   true,  true,  'half_yearly'),
    (p_tenant, '24', 'Gujarat',                                        'West',      true,  true,  'half_yearly'),
    (p_tenant, '26', 'Dadra and Nagar Haveli and Daman and Diu',       'West',      false, false, NULL),
    (p_tenant, '27', 'Maharashtra',                                    'West',      true,  true,  'half_yearly'),
    (p_tenant, '29', 'Karnataka',                                      'South',     true,  true,  'annual'),
    (p_tenant, '30', 'Goa',                                            'West',      false, true,  'half_yearly'),
    (p_tenant, '31', 'Lakshadweep',                                    'Islands',   false, false, NULL),
    (p_tenant, '32', 'Kerala',                                         'South',     true,  true,  'half_yearly'),
    (p_tenant, '33', 'Tamil Nadu',                                     'South',     true,  true,  'annual'),
    (p_tenant, '34', 'Puducherry',                                     'South',     true,  false, NULL),
    (p_tenant, '35', 'Andaman and Nicobar Islands',                    'Islands',   false, false, NULL),
    (p_tenant, '36', 'Telangana',                                      'South',     true,  false, NULL),
    (p_tenant, '37', 'Andhra Pradesh',                                 'South',     true,  false, NULL),
    (p_tenant, '38', 'Ladakh',                                         'North',     false, false, NULL),
    (p_tenant, '97', 'Other Territory',                                'Other',     false, false, NULL)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION seed_states_for_tenant(UUID) IS
  'Idempotently seeds the India state/UT master for a tenant (GST codes + PT/LWF defaults).';

-- ── 5. Auto-seed new tenants ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_seed_states_after_tenant_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM seed_states_for_tenant(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_states_after_tenant_insert ON tenants;
CREATE TRIGGER seed_states_after_tenant_insert
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_seed_states_after_tenant_insert();

-- ── 6. Seed all existing tenants ────────────────────────────────────────────
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM seed_states_for_tenant(t.id);
  END LOOP;
END;
$$;
