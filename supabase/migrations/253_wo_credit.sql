-- ============================================================
-- 253_wo_credit.sql
--
-- Retail Weekly-Off (WO) Credit — Phase 1 (config + tagging + reconciliation).
--
-- Retail staff have no fixed weekly-off. They EARN floating offs from worked
-- days (a configurable present-days → WO ladder), capped at the month's Sundays.
-- The reconciler auto-applies the current month's credit to off-days FIFO;
-- leftover credit carries over (Phase 2). Tagged via the roster they're on.
--
-- New:
--   wo_credit_structure  — the policy (ladder cap, expiry, holiday-work reward)
--   wo_credit_ladder     — the configurable present-days → WO rows
--   wo_credit_monthly    — per-employee monthly snapshot (the HR review grid)
-- Wire:
--   rosters.wo_credit_structure_id — the applicability tag (employees on a
--                                    roster with this set follow the WO model)
--   attendance_daily.computed_source += 'wo_credit' — so reconciler-applied
--                                    weekly-offs are protected from engine overwrite
--
-- All additive, tenant-scoped, RLS-enabled, idempotent.
-- ============================================================

-- ── Structure (policy) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wo_credit_structure (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT         NOT NULL,
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  -- Cap on credit earned per month. 'sundays' = number of Sundays in the month.
  monthly_cap          TEXT         NOT NULL DEFAULT 'sundays'
                       CHECK (monthly_cap IN ('sundays', 'none')),
  -- Carried-over (unused) credit expiry in days.
  rollover_expiry_days INT          NOT NULL DEFAULT 60 CHECK (rollover_expiry_days > 0),
  -- What working a public holiday earns (always counts as a present day too):
  --   wo_credit → an extra WO credit;  extra_pay → an extra payable day.
  holiday_work_reward  TEXT         NOT NULL DEFAULT 'wo_credit'
                       CHECK (holiday_work_reward IN ('wo_credit', 'extra_pay')),
  -- Terminal disposition of an uncovered, unsettled absence at month-close.
  overflow_terminal    TEXT         NOT NULL DEFAULT 'lop'
                       CHECK (overflow_terminal IN ('lop')),
  -- The leave-type bucket carried credit accrues into (Phase 2 balance/redeem).
  wo_leave_type_id     UUID         REFERENCES leave_types(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_wo_structure_tenant ON wo_credit_structure (tenant_id);

ALTER TABLE wo_credit_structure ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_structure_iso ON wo_credit_structure;
CREATE POLICY wo_structure_iso ON wo_credit_structure
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE OR REPLACE FUNCTION trg_wo_structure_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_wo_structure_updated_at ON wo_credit_structure;
CREATE TRIGGER trg_wo_structure_updated_at BEFORE UPDATE ON wo_credit_structure
  FOR EACH ROW EXECUTE FUNCTION trg_wo_structure_updated_at();

-- ── Ladder (configurable present-days → WO rows) ──────────────────────────────
CREATE TABLE IF NOT EXISTS wo_credit_ladder (
  id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id  UUID  NOT NULL REFERENCES wo_credit_structure(id) ON DELETE CASCADE,
  present_days  INT   NOT NULL CHECK (present_days > 0),
  wo_credit     INT   NOT NULL CHECK (wo_credit >= 0),
  UNIQUE (structure_id, present_days)
);

CREATE INDEX IF NOT EXISTS idx_wo_ladder_structure ON wo_credit_ladder (structure_id);

ALTER TABLE wo_credit_ladder ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_ladder_iso ON wo_credit_ladder;
-- Ladder rows have no tenant_id; scope through the parent structure.
CREATE POLICY wo_ladder_iso ON wo_credit_ladder
  USING (EXISTS (
    SELECT 1 FROM wo_credit_structure s
    WHERE s.id = wo_credit_ladder.structure_id AND s.tenant_id = get_user_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM wo_credit_structure s
    WHERE s.id = wo_credit_ladder.structure_id AND s.tenant_id = get_user_tenant_id()
  ));

-- ── Tag rosters with a structure (the applicability switch) ───────────────────
ALTER TABLE rosters
  ADD COLUMN IF NOT EXISTS wo_credit_structure_id UUID
    REFERENCES wo_credit_structure(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rosters_wo_structure
  ON rosters (tenant_id, wo_credit_structure_id) WHERE wo_credit_structure_id IS NOT NULL;

-- ── Monthly snapshot (the HR review grid + audit) ─────────────────────────────
CREATE TABLE IF NOT EXISTS wo_credit_monthly (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id          UUID         NOT NULL,
  structure_id         UUID         REFERENCES wo_credit_structure(id) ON DELETE SET NULL,
  year                 INT          NOT NULL,
  month                INT          NOT NULL CHECK (month BETWEEN 1 AND 12),
  worked_days          INT          NOT NULL DEFAULT 0,
  holiday_worked_days  INT          NOT NULL DEFAULT 0,
  sundays_in_month     INT          NOT NULL DEFAULT 0,
  earned_credit        INT          NOT NULL DEFAULT 0,
  auto_applied         INT          NOT NULL DEFAULT 0,
  pending_absent_days  INT          NOT NULL DEFAULT 0,
  leave_applied_days   INT          NOT NULL DEFAULT 0,
  lop_days             INT          NOT NULL DEFAULT 0,
  extra_pay_days       INT          NOT NULL DEFAULT 0,
  carried_in           INT          NOT NULL DEFAULT 0,
  carried_out          INT          NOT NULL DEFAULT 0,
  status               TEXT         NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'finalized')),
  reconciled_at        TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_wo_monthly_tenant_period
  ON wo_credit_monthly (tenant_id, year, month);

ALTER TABLE wo_credit_monthly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wo_monthly_iso ON wo_credit_monthly;
CREATE POLICY wo_monthly_iso ON wo_credit_monthly
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Allow reconciler-applied weekly-offs to be protected from engine recompute ─
ALTER TABLE attendance_daily
  DROP CONSTRAINT IF EXISTS attendance_daily_computed_source_check;
ALTER TABLE attendance_daily
  ADD CONSTRAINT attendance_daily_computed_source_check
  CHECK (computed_source IN ('engine', 'leave_approval', 'regularization', 'manual', 'wo_credit'));
