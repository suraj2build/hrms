-- Migration 303: employee_event_grants
--
-- Event-based leave grants (e.g. bereavement, marriage) issued to an employee
-- against an event date type, with a validity window. Referenced by
-- routes/attendance/leave-scheduler-status.ts.

CREATE TABLE IF NOT EXISTS employee_event_grants (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id    UUID        NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id  UUID        REFERENCES leave_types(id)          ON DELETE SET NULL,
  date_type_id   UUID,
  grant_date     DATE        NOT NULL,
  reference_date DATE,
  expiry_date    DATE,
  days_granted   NUMERIC     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','consumed','expired','cancelled')),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_grants_emp    ON employee_event_grants (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_event_grants_status ON employee_event_grants (tenant_id, status);

ALTER TABLE employee_event_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_grants_hr_all" ON employee_event_grants;
DROP POLICY IF EXISTS "event_grants_self"   ON employee_event_grants;
CREATE POLICY "event_grants_hr_all" ON employee_event_grants FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "event_grants_self"   ON employee_event_grants FOR SELECT USING (tenant_id = get_user_tenant_id());
