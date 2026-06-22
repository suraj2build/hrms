-- Migration 296: Proactive Work-From-Home requests (request → approval)
--
-- Complements the existing post-facto 'wfh' regularisation type: an employee
-- requests WFH for a date range in advance; their manager/HR approves.

CREATE TABLE IF NOT EXISTS wfh_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id      UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_date        DATE        NOT NULL,
  to_date          DATE        NOT NULL,
  days             INT         NOT NULL DEFAULT 1,
  reason           TEXT,
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at       TIMESTAMPTZ,
  decision_remarks TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wfh_tenant_status ON wfh_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wfh_employee      ON wfh_requests (tenant_id, employee_id);

ALTER TABLE wfh_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wfh_hr_all" ON wfh_requests FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "wfh_self"   ON wfh_requests FOR SELECT USING (tenant_id = get_user_tenant_id());
