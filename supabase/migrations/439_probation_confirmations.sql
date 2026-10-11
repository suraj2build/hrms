-- ============================================================
-- 439_probation_confirmations.sql
--
-- Probation Confirmation workflow — today the only thing that exists is a
-- date column (job_history.confirmation_date) and a manager action
-- (POST /manager/team/lifecycle/confirmation-recommend) that fires a
-- generic HR-inbox notification with free text. There is no structured
-- decision, no captured manager feedback, and no status lifecycle — HR
-- has to manually create a new job_history row to actually confirm
-- someone, with nothing linking that edit back to the original due date
-- or the manager's input.
--
-- This table gives the manager → HR confirmation handoff a real record:
--   pending_hr  — manager has recommended confirm/extend with feedback;
--                 waiting on an HR decision. (The "is this employee due
--                 for confirmation at all" state before this is derived
--                 live from job_history + employment_categories.probation_days
--                 — see lifecycle-expiry.ts — and needs no row of its own.)
--   extended    — HR extended probation to a new date instead of confirming.
--   confirmed   — HR confirmed; job_history.confirmation_date is set in the
--                 same transaction as this row's status flips.
-- ============================================================

CREATE TABLE IF NOT EXISTS probation_confirmations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    job_history_id          UUID REFERENCES job_history(id) ON DELETE SET NULL,
    due_date                DATE NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending_hr'
                               CHECK (status IN ('pending_hr', 'extended', 'confirmed')),
    manager_recommendation  TEXT CHECK (manager_recommendation IN ('confirm', 'extend')),
    manager_feedback        TEXT,
    manager_recommended_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    manager_recommended_at  TIMESTAMPTZ,
    hr_decision             TEXT CHECK (hr_decision IN ('confirm', 'extend')),
    hr_decision_notes       TEXT,
    extended_to_date        DATE,
    decided_by              UUID REFERENCES profiles(id) ON DELETE SET NULL,
    decided_at              TIMESTAMPTZ,
    version                 INTEGER NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ,
    -- 'extend' must carry the new date; 'confirm' never does.
    CHECK (hr_decision IS DISTINCT FROM 'extend' OR extended_to_date IS NOT NULL),
    CHECK (hr_decision IS DISTINCT FROM 'confirm' OR extended_to_date IS NULL)
);

-- Only one OPEN cycle (awaiting an HR decision) per employee at a time —
-- mirrors the dedup the old inbox-notification check used to enforce, but
-- as a real DB constraint instead of an app-level best-effort query.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_probation_confirmations_open
  ON probation_confirmations (tenant_id, employee_id)
  WHERE status = 'pending_hr';

CREATE INDEX IF NOT EXISTS idx_probation_confirmations_tenant_status
  ON probation_confirmations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_probation_confirmations_employee
  ON probation_confirmations(employee_id);

DROP TRIGGER IF EXISTS trg_probation_confirmations_version ON probation_confirmations;
CREATE TRIGGER trg_probation_confirmations_version BEFORE UPDATE ON probation_confirmations
  FOR EACH ROW EXECUTE FUNCTION increment_version_column();

ALTER TABLE probation_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "probation_confirmations_hr_read" ON probation_confirmations
    FOR SELECT
    USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "probation_confirmations_hr_write" ON probation_confirmations
    FOR ALL
    USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));
