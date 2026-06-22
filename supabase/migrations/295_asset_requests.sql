-- Migration 295: Asset requests (ESS request → HR approve → allocate)
--
-- Lets an employee request an asset from ESS; HR approves/rejects and, on
-- approval, allocates an actual asset (which assigns it via the existing
-- asset workflow and marks the request fulfilled).

CREATE TABLE IF NOT EXISTS asset_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id        UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category_id        UUID        REFERENCES asset_categories(id) ON DELETE SET NULL,
  item_name          TEXT,                       -- free-text when no category fits
  reason             TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','fulfilled','cancelled')),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by         UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  decision_remarks   TEXT,
  fulfilled_asset_id UUID        REFERENCES assets(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_requests_tenant   ON asset_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_requests_employee ON asset_requests (tenant_id, employee_id);

ALTER TABLE asset_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asset_req_hr_all" ON asset_requests FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "asset_req_self"   ON asset_requests FOR SELECT USING (tenant_id = get_user_tenant_id());
