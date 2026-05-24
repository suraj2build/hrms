CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name   TEXT NOT NULL,
  record_id    UUID NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data     JSONB,
  new_data     JSONB,
  performed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant    ON audit_logs(tenant_id);
CREATE INDEX idx_audit_record    ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_timestamp ON audit_logs(created_at DESC);

-- Trigger function to auto-log employee changes
CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs(tenant_id, table_name, record_id, action, new_data)
    VALUES (NEW.tenant_id, 'employees', NEW.id, 'INSERT', row_to_json(NEW)::jsonb);
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs(tenant_id, table_name, record_id, action, old_data, new_data)
    VALUES (NEW.tenant_id, 'employees', NEW.id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs(tenant_id, table_name, record_id, action, old_data)
    VALUES (OLD.tenant_id, 'employees', OLD.id, 'DELETE', row_to_json(OLD)::jsonb);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER employees_audit
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION log_employee_changes();
