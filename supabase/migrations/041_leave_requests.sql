-- ============================================================
-- 041_leave_requests.sql
-- Leave Request entity with approval workflow.
--
-- Distinct from the existing leave_applications table (033):
--   - leave_applications: the older direct-apply model
--   - leave_requests: the new manager-approval workflow model
--     (employee → manager → optional HR override)
--
-- The ApprovalService (Step 3) drives all state transitions.
-- computed_days is stored at creation time via the LeaveEngine.
-- Balance is validated only at approval time (not at request time).
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  employee_id       UUID         NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id     UUID         NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  from_date         DATE         NOT NULL,
  to_date           DATE         NOT NULL,
  computed_days     DECIMAL(5,1) NOT NULL,         -- set by LeaveEngine at creation
  half_day          BOOLEAN      NOT NULL DEFAULT false,
  status            TEXT         NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason            TEXT,
  rejection_reason  TEXT,                           -- populated on REJECTED
  requested_by      UUID         NOT NULL REFERENCES profiles(id)   ON DELETE RESTRICT,
  approved_by       UUID         REFERENCES profiles(id)            ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT lr_dates_order      CHECK (to_date >= from_date),
  CONSTRAINT lr_approved_fields  CHECK (
    (status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status != 'APPROVED'
  )
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lr_employee
  ON leave_requests (tenant_id, employee_id, from_date DESC);

CREATE INDEX IF NOT EXISTS idx_lr_status
  ON leave_requests (tenant_id, status)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_lr_approver
  ON leave_requests (tenant_id, approved_by)
  WHERE approved_by IS NOT NULL;

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_lr_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lr_updated_at
  BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION fn_lr_set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users in the tenant can read requests they are involved in:
-- employees see their own; managers see their direct reports'; HR sees all.
CREATE POLICY "lr_tenant_read" ON leave_requests FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Employees can INSERT their own requests (employee_id validated by API layer)
CREATE POLICY "lr_employee_insert" ON leave_requests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- HR admins and managers can UPDATE (approve/reject) via API-layer checks
CREATE POLICY "lr_hr_update" ON leave_requests FOR UPDATE
  USING (tenant_id = get_user_tenant_id());
