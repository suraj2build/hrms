-- ============================================================
-- 036_employee_leave_balance.sql
-- Per-employee leave balance tracking (per leave type, per year)
-- ============================================================

CREATE TABLE IF NOT EXISTS employee_leave_balance (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id   UUID         NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id UUID         NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  balance       DECIMAL(5,1) NOT NULL DEFAULT 0,
  year          INT          NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INT,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_leave_balance_emp_year
  ON employee_leave_balance (tenant_id, employee_id, year);

ALTER TABLE employee_leave_balance ENABLE ROW LEVEL SECURITY;

-- HR admins can do everything; all authenticated users in the same tenant can read their own
CREATE POLICY "elb_tenant_read" ON employee_leave_balance FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "elb_hr_write" ON employee_leave_balance FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Deduct balance on leave approval.
-- Uses GREATEST(0, ...) so balance never goes negative.
-- No-op if the balance row does not yet exist (HR can still grant ad-hoc).
CREATE OR REPLACE FUNCTION deduct_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE employee_leave_balance
  SET    balance    = GREATEST(0, balance - p_days),
         updated_at = now()
  WHERE  tenant_id     = p_tenant_id
    AND  employee_id   = p_employee_id
    AND  leave_type_id = p_leave_type_id
    AND  year          = p_year;
  -- If no row exists, silently do nothing.
END;
$$;
