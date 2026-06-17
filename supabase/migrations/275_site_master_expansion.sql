-- ─────────────────────────────────────────────────────────────────────────────
-- 275_site_master_expansion.sql
-- Expand the thin sites master with grouping FKs (state/cluster/cost-center),
-- structured address + geo, India statutory registration IDs, and operational
-- defaults. All additive (ADD COLUMN IF NOT EXISTS) — no breaking change.
--
-- Already present (do NOT re-add): name, location, timezone, code, state_code,
-- site_type, city, region, zone, default_roster_id, default_shift_id,
-- default_rotation_policy_id, default_leave_policy_id, leave_policy_override_id,
-- holiday_group_id, created_at.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Identity & lifecycle ─────────────────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS short_name     TEXT,
  ADD COLUMN IF NOT EXISTS status         TEXT NOT NULL DEFAULT 'active',  -- active | inactive
  ADD COLUMN IF NOT EXISTS opening_date   DATE,
  ADD COLUMN IF NOT EXISTS parent_site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 2. Grouping FKs (state = statutory axis, cluster = operational axis) ─────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS state_id       UUID REFERENCES states(id)       ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cluster_id     UUID REFERENCES clusters(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;

-- ── 3. Structured address & geo ─────────────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS address_line1     TEXT,
  ADD COLUMN IF NOT EXISTS address_line2     TEXT,
  ADD COLUMN IF NOT EXISTS district          TEXT,
  ADD COLUMN IF NOT EXISTS pincode           TEXT,
  ADD COLUMN IF NOT EXISTS country           TEXT NOT NULL DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS latitude          NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER;

-- ── 4. India statutory registration IDs ─────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS gstin               TEXT,
  ADD COLUMN IF NOT EXISTS pf_registration_no  TEXT,
  ADD COLUMN IF NOT EXISTS esi_registration_no TEXT,
  ADD COLUMN IF NOT EXISTS pt_registration_no  TEXT,
  ADD COLUMN IF NOT EXISTS lwf_registration_no TEXT,
  ADD COLUMN IF NOT EXISTS shops_estab_reg_no  TEXT,
  ADD COLUMN IF NOT EXISTS factory_license_no  TEXT;

-- ── 5. Operations ───────────────────────────────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS contact_person       TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone        TEXT,
  ADD COLUMN IF NOT EXISTS contact_email        TEXT,
  ADD COLUMN IF NOT EXISTS sanctioned_headcount INTEGER;

-- ── 6. UDF placeholder (mechanism deferred) ─────────────────────────────────
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

-- ── 7. Indexes for the new grouping FKs ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sites_state_id    ON sites (state_id);
CREATE INDEX IF NOT EXISTS idx_sites_cluster_id  ON sites (cluster_id);
CREATE INDEX IF NOT EXISTS idx_sites_cost_center ON sites (cost_center_id);
CREATE INDEX IF NOT EXISTS idx_sites_parent      ON sites (parent_site_id);

-- ── 8. updated_at trigger (sites previously had only created_at) ─────────────
DROP TRIGGER IF EXISTS trg_sites_updated_at ON sites;
CREATE TRIGGER trg_sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 9. Back-compat: map legacy free-text state_code → state_id ───────────────
-- 166 added sites.state_code as free text. Where it matches a seeded GST code
-- for the same tenant, populate the new state_id FK. Non-matching values are
-- left for manual reconciliation.
UPDATE sites s
SET    state_id = st.id
FROM   states st
WHERE  s.state_id IS NULL
  AND  s.state_code IS NOT NULL
  AND  st.tenant_id = s.tenant_id
  AND  st.code = s.state_code;

COMMENT ON COLUMN sites.state_id   IS 'FK → states (statutory axis). Supersedes the legacy free-text state_code.';
COMMENT ON COLUMN sites.cluster_id IS 'FK → clusters (operational axis: Region → Cluster → Site).';
COMMENT ON COLUMN sites.custom_fields IS 'Reserved for user-defined fields (mechanism TBD).';
