-- ============================================================
-- 028_employee_shifts.sql
-- Employee shift assignments with auto-close on new insert.
--
-- Rules:
--   · Only one row per employee may have is_current = true
--     (enforced by partial unique index).
--   · Inserting a new row with is_current = true automatically
--     flips the previous current row to is_current = false
--     via the AFTER INSERT trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_shifts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id    UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_id       UUID        NOT NULL REFERENCES shifts(id)    ON DELETE RESTRICT,
  effective_from DATE        NOT NULL,
  is_current     BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active shift per employee per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_shifts_current
  ON employee_shifts (tenant_id, employee_id)
  WHERE is_current = true;

-- Primary access pattern: employee history ordered newest-first
CREATE INDEX IF NOT EXISTS idx_employee_shifts_employee
  ON employee_shifts (tenant_id, employee_id, effective_from DESC);

-- ── Auto-close trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_close_previous_employee_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE employee_shifts
    SET    is_current = false
    WHERE  tenant_id   = NEW.tenant_id
      AND  employee_id = NEW.employee_id
      AND  id         != NEW.id
      AND  is_current  = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_close_previous_employee_shift
  AFTER INSERT ON employee_shifts
  FOR EACH ROW EXECUTE FUNCTION fn_close_previous_employee_shift();

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE employee_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es_tenant_read"
  ON employee_shifts FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "es_hr_write"
  ON employee_shifts FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));
