-- ============================================================================
-- 211_asset_management.sql
-- Lightweight Asset Management: asset master + employee asset ledger.
--
-- Categories live in the existing asset_categories master (do NOT duplicate).
-- assets.assigned_to is a denormalized pointer to the current holder for quick
-- lookups; employee_asset_ledger is the authoritative movement log.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── TABLE: assets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_code    TEXT          NOT NULL,
  category_id   UUID          REFERENCES asset_categories(id) ON DELETE SET NULL,
  name          TEXT          NOT NULL,
  serial_number TEXT,
  purchase_date DATE,
  purchase_cost NUMERIC(14,2),
  status        TEXT          NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','assigned','in_repair','damaged','lost','retired')),
  assigned_to   UUID          REFERENCES employees(id) ON DELETE SET NULL,  -- current holder (denormalized)
  notes         TEXT,
  created_by    UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_code)
);

-- ── TABLE: employee_asset_ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_asset_ledger (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id        UUID        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action          TEXT        NOT NULL CHECK (action IN ('assigned','returned','damaged','lost')),
  action_date     DATE        NOT NULL DEFAULT CURRENT_DATE,
  condition_notes TEXT,
  performed_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_assets_tenant_status        ON assets (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_assigned_to   ON assets (tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_eal_tenant_asset            ON employee_asset_ledger (tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_eal_tenant_employee         ON employee_asset_ledger (tenant_id, employee_id);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
ALTER TABLE assets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_asset_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_assets" ON assets;
CREATE POLICY "service_role_all_assets"
  ON assets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_deny_assets" ON assets;
CREATE POLICY "anon_deny_assets"
  ON assets FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "service_role_all_eal" ON employee_asset_ledger;
CREATE POLICY "service_role_all_eal"
  ON employee_asset_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_deny_eal" ON employee_asset_ledger;
CREATE POLICY "anon_deny_eal"
  ON employee_asset_ledger FOR ALL TO anon USING (false) WITH CHECK (false);
