-- ============================================================
-- 067_attendance_period_locks.sql
-- Attendance period lock states for payroll freeze workflow.
-- States: OPEN → LOCKED → PAYROLL_PROCESSING → PAYROLL_FINALIZED
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_period_locks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month    TEXT        NOT NULL,  -- 'YYYY-MM' format
  state           TEXT        NOT NULL DEFAULT 'OPEN'
    CHECK (state IN ('OPEN', 'LOCKED', 'PAYROLL_PROCESSING', 'PAYROLL_FINALIZED')),
  locked_by       UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  locked_at       TIMESTAMPTZ NULL,
  lock_reason     TEXT        NULL,
  unlocked_by     UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  unlocked_at     TIMESTAMPTZ NULL,
  unlock_reason   TEXT        NULL,
  payroll_started_by UUID     NULL REFERENCES profiles(id) ON DELETE SET NULL,
  payroll_started_at TIMESTAMPTZ NULL,
  finalized_by    UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  finalized_at    TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_period_locks_tenant
  ON attendance_period_locks (tenant_id, period_month DESC);

ALTER TABLE attendance_period_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "period_lock_read" ON attendance_period_locks;
CREATE POLICY "period_lock_read" ON attendance_period_locks FOR SELECT
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "period_lock_hr_write" ON attendance_period_locks;
CREATE POLICY "period_lock_hr_write" ON attendance_period_locks FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- Helper function: check if a period is locked (any non-OPEN state)
CREATE OR REPLACE FUNCTION is_period_locked(p_tenant_id UUID, p_month TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_state TEXT;
BEGIN
  SELECT state INTO v_state
  FROM attendance_period_locks
  WHERE tenant_id = p_tenant_id AND period_month = p_month;

  RETURN FOUND AND v_state != 'OPEN';
END;
$$;
