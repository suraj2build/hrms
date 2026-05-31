-- ============================================================
-- 071_regularisation_policy.sql
-- Advanced Regularisation: submission windows, frequency limits,
-- SLA tracking, and per-request SLA metadata
-- ============================================================

-- ── Regularisation Policy ────────────────────────────────────────────────────
-- One policy per tenant (upsert pattern); HR admin manages it.

CREATE TABLE IF NOT EXISTS regularisation_policy (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  -- Submission window: how many days AFTER the attendance date can an employee submit?
  submission_window_days INT         NOT NULL DEFAULT 7,

  -- Frequency limit: max regularisation requests per employee per calendar month
  max_per_month         INT         NOT NULL DEFAULT 5,

  -- SLA: how many business hours HR has to resolve a pending request
  sla_hours             INT         NOT NULL DEFAULT 48,

  -- Auto-reject requests that stay pending past SLA?
  auto_reject_on_sla_breach BOOLEAN NOT NULL DEFAULT false,

  -- Who gets notified on SLA breach? (comma-separated emails or roles)
  sla_breach_notify     TEXT        NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE regularisation_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reg_policy_tenant_read" ON regularisation_policy;
CREATE POLICY "reg_policy_tenant_read" ON regularisation_policy FOR SELECT
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "reg_policy_hr_write" ON regularisation_policy;
CREATE POLICY "reg_policy_hr_write" ON regularisation_policy FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Extend attendance_regularisation with SLA metadata ───────────────────────

ALTER TABLE attendance_regularisation
  ADD COLUMN IF NOT EXISTS sla_deadline   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sla_breached   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT       NULL;

-- Index for SLA monitoring (find pending + breached)
CREATE INDEX IF NOT EXISTS idx_reg_sla
  ON attendance_regularisation (tenant_id, status, sla_deadline)
  WHERE status = 'pending';

-- ── Frequency tracking view ───────────────────────────────────────────────────
-- Counts regularisation requests per employee per year-month (used by API)

CREATE OR REPLACE VIEW regularisation_monthly_counts AS
SELECT
  tenant_id,
  employee_id,
  TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
  COUNT(*)                                              AS request_count
FROM attendance_regularisation
GROUP BY tenant_id, employee_id, DATE_TRUNC('month', created_at);

-- ── Updated_at trigger for regularisation_policy ─────────────────────────────

CREATE OR REPLACE FUNCTION update_regularisation_policy_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reg_policy_updated_at ON regularisation_policy;
CREATE TRIGGER trg_reg_policy_updated_at
  BEFORE UPDATE ON regularisation_policy
  FOR EACH ROW EXECUTE FUNCTION update_regularisation_policy_updated_at();
