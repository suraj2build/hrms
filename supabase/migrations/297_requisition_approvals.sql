-- Migration 297: Multi-stage requisition approval
--
-- A requisition stays 'draft' while its approval steps are pending and flips to
-- 'open' only when every step is approved (so the existing status enum is
-- unchanged). Steps are seeded from a default chain on "submit for approval".

CREATE TABLE IF NOT EXISTS requisition_approvals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requisition_id  UUID        NOT NULL REFERENCES job_requisitions(id) ON DELETE CASCADE,
  step_order      INT         NOT NULL,
  label           TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  decided_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requisition_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_req_approvals_req ON requisition_approvals (tenant_id, requisition_id);

ALTER TABLE requisition_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "req_appr_hr_all" ON requisition_approvals FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "req_appr_self"   ON requisition_approvals FOR SELECT USING (tenant_id = get_user_tenant_id());
