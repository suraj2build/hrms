-- ═══════════════════════════════════════════════════════════════════════════
--  h1_release_bundle.sql  —  Release Train H1 migrations, in execution order.
--  Apply ONCE in the Supabase SQL editor against the target DB. Fully idempotent
--  (every object guarded by IF [NOT] EXISTS / OR REPLACE) — safe to re-run.
--  Files: 252,253,254,255,260,260b,261,262,263,264,265,266,267,268,269,270.
--  After this completes, run supabase/verify_h1_staging.sql to validate.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 252_rls_tenant_hardening                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 252_rls_tenant_hardening.sql
--
-- Defense-in-depth: adds tenant_id scoping to three RLS policies
-- that previously checked role only. The application layer already
-- filters every query by req.tenantId, so there is no live data
-- bleed today, but these policies would become the primary guard
-- if the codebase ever moves from service-role to client JWT auth.
--
-- Affected tables: payroll_runs, payroll_slips,
--                  employee_compensations, employee_compensation_components
-- ============================================================

-- ── payroll_runs ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pr_hr_all" ON payroll_runs;
CREATE POLICY "pr_hr_all" ON payroll_runs FOR ALL
  USING  (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_slips ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ps_hr_all" ON payroll_slips;
CREATE POLICY "ps_hr_all" ON payroll_slips FOR ALL
  USING  (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_compensations ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ec_hr_all" ON employee_compensations;
CREATE POLICY "ec_hr_all" ON employee_compensations FOR ALL
  USING  (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_compensation_components ─────────────────────────────────────────
DROP POLICY IF EXISTS "ecc_hr_all" ON employee_compensation_components;
CREATE POLICY "ecc_hr_all" ON employee_compensation_components FOR ALL
  USING  (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 253_wo_credit                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
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


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 254_wo_credit_phase2                                       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 254_wo_credit_phase2.sql
--
-- WO-Credit Phase 2 — carry-over balance, manual redemption, LOP finalisation.
--
-- Leftover (unused) current-month WO credit is credited into a "Weekly Off
-- Credit" leave type via leave_accrual_ledger (with rollover expiry) so the
-- employee can redeem it manually in later months through the normal
-- leave-request flow. This needs the ledger's accrual_type CHECK to accept
-- the new 'wo_credit' value.
-- ============================================================

ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;

ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment',
    'wo_credit'        -- carried-over weekly-off credit (has rollover expiry)
  ));


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 255_wo_credit_holiday_pay                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 255_wo_credit_holiday_pay.sql
--
-- WO-Credit: configurable holiday-work extra-pay multiplier.
--
-- When holiday_work_reward = 'extra_pay', working a public holiday earns extra
-- pay. The rate is now configurable (default 1.0 × daily rate). At month-close
-- the finaliser computes the amount (extra_pay_days × daily_rate × multiplier)
-- and drops a PENDING payroll_adjustments row for the payroll team to apply.
-- ============================================================

ALTER TABLE wo_credit_structure
  ADD COLUMN IF NOT EXISTS holiday_pay_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.0
    CHECK (holiday_pay_multiplier > 0 AND holiday_pay_multiplier <= 10);

ALTER TABLE wo_credit_monthly
  ADD COLUMN IF NOT EXISTS extra_pay_amount NUMERIC(12,2) NOT NULL DEFAULT 0;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 260_attendance_daily_shift_attribution                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 260_attendance_daily_shift_attribution.sql
--
-- AHI-1: Persist shift attribution snapshot on attendance_daily.
--
-- The attendance engine resolves a shift at compute time but
-- previously discarded it after use. This means the exact shift
-- used to calculate late_minutes / overtime_minutes / work_hours
-- was unrecoverable after the fact — making recomputes non-
-- deterministic and payroll audits impossible.
--
-- These columns capture a snapshot of the resolved shift AT THE
-- MOMENT of computation. Because start_time/end_time are copied
-- (not FK-referenced) the record survives shift edits/deletions.
--
-- resolution_source identifies which layer of the priority chain
-- produced the shift:
--   shift_roster    → date-specific day override
--   rotation_policy → condition-based rule (Mon-Fri, Sat, Sun)
--   standing_shift  → employee_shifts effective as of date
--   site_default    → sites.default_shift_id (deprecated legacy)
-- ============================================================

ALTER TABLE attendance_daily
  ADD COLUMN IF NOT EXISTS expected_shift_id        UUID    REFERENCES shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift_start_time         TEXT,
  ADD COLUMN IF NOT EXISTS shift_end_time           TEXT,
  ADD COLUMN IF NOT EXISTS shift_grace_minutes      INT,
  ADD COLUMN IF NOT EXISTS shift_is_night_shift     BOOLEAN,
  ADD COLUMN IF NOT EXISTS shift_duration_minutes   INT,
  ADD COLUMN IF NOT EXISTS resolution_source        TEXT
    CHECK (resolution_source IN ('shift_roster','rotation_policy','standing_shift','site_default')),
  ADD COLUMN IF NOT EXISTS rotation_policy_id       UUID    REFERENCES rotation_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_condition_type  TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_shift_attribution
  ON attendance_daily (tenant_id, expected_shift_id, date DESC)
  WHERE expected_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_resolution_source
  ON attendance_daily (tenant_id, resolution_source, date DESC)
  WHERE resolution_source IS NOT NULL;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 260b_employee_shifts_temporal                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 260b_employee_shifts_temporal.sql
--
-- AHI-1: Add temporal validity to employee_shifts so historical
-- shift resolution can answer "which shift was in effect on date D?"
--
-- Previously, resolvers queried is_current = true — meaning any
-- shift change retroactively altered ALL past attendance recomputes.
-- With effective_to set by the auto-close trigger, resolvers can
-- now query effective_from <= date AND effective_to >= date
-- (or effective_to IS NULL for the current open record).
--
-- The auto-close trigger is updated to SET effective_to on the
-- closing row so the history is complete going forward.
-- Existing rows are left with effective_to = NULL; the resolver
-- falls back to is_current when effective_to is not set (safe).
-- ============================================================

ALTER TABLE employee_shifts
  ADD COLUMN IF NOT EXISTS effective_to DATE;

CREATE INDEX IF NOT EXISTS idx_emp_shift_temporal
  ON employee_shifts (tenant_id, employee_id, effective_from DESC, effective_to DESC);

-- ── Update auto-close trigger to also set effective_to ─────────────────────────

CREATE OR REPLACE FUNCTION fn_close_previous_employee_shift()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    -- Mark previous current row as closed: is_current=false and effective_to=yesterday
    UPDATE employee_shifts
    SET    is_current  = false,
           effective_to = (NEW.effective_from - INTERVAL '1 day')::DATE
    WHERE  tenant_id   = NEW.tenant_id
      AND  employee_id = NEW.employee_id
      AND  id         != NEW.id
      AND  is_current  = true;
  END IF;
  RETURN NEW;
END;
$$;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 261_attendance_shift_audit_log                             ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 261_attendance_shift_audit_log.sql
--
-- AHI-1: Shift attribution change audit log.
--
-- Written whenever a recompute changes expected_shift_id on an
-- existing attendance_daily row — tracks WHAT changed, WHO
-- triggered it, and WHY. Enables HR to answer:
-- "Did a shift change alter this employee's historical attendance?"
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance_shift_audit_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id           UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                  DATE        NOT NULL,

  old_shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  old_shift_start_time  TEXT,
  old_resolution_source TEXT,

  new_shift_id          UUID        REFERENCES shifts(id) ON DELETE SET NULL,
  new_shift_start_time  TEXT,
  new_resolution_source TEXT,

  change_reason         TEXT,
  changed_by            UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_audit_emp_date
  ON attendance_shift_audit_log (tenant_id, employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_shift_audit_date
  ON attendance_shift_audit_log (tenant_id, date DESC);

ALTER TABLE attendance_shift_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_audit_hr_read" ON attendance_shift_audit_log
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

CREATE POLICY "shift_audit_service_insert" ON attendance_shift_audit_log
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 262_attendance_period_lock_enforcement                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 262_attendance_period_lock_enforcement.sql
--
-- AHI-2: Attendance Period Protection — authoritative backstop.
--
-- The application layer checks attendance_period_locks in a handful
-- of routes (muster upload, regularisation) but NOT in the core write
-- paths: recompute, batch process, WO-credit reconciler, comp-off,
-- overtime. That meant a finalized payroll period could still be
-- silently overwritten — by an API call OR a background scheduler.
--
-- This trigger is the single enforcement point that EVERY write to
-- attendance_daily must pass, regardless of which code path (route,
-- service, or cron job) issued it.
--
-- Scope — it blocks writes ONLY in the terminal PAYROLL_FINALIZED state,
-- the point at which attendance is sealed and must never change again.
-- Earlier states (LOCKED, PAYROLL_PROCESSING) are deliberately allowed
-- at the DB level because the payroll finalize routine itself recomputes
-- stale employees AFTER attendance is locked but BEFORE the slips are
-- sealed (see payroll/index.ts — "recomputing stale employees before
-- lock"). Blocking those states here would break that legitimate path.
--
-- The stricter "any non-OPEN" policy — refusing casual edits the moment
-- attendance is merely closed (LOCKED) — lives in the application layer
-- (period-lock.ts + the route guards), where it returns a clean 409 and
-- does not interfere with the payroll engine's internal recompute.
-- This trigger is the hard floor that even the engine respects: payroll
-- never recomputes a period it has already finalized.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_block_locked_period_attendance_write()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_state TEXT;
  v_month TEXT;
BEGIN
  -- For DELETE, NEW is null — fall back to OLD.
  v_month := to_char(COALESCE(NEW.date, OLD.date), 'YYYY-MM');

  SELECT state INTO v_state
  FROM   attendance_period_locks
  WHERE  tenant_id    = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND  period_month = v_month;

  IF FOUND AND v_state = 'PAYROLL_FINALIZED' THEN
    RAISE EXCEPTION
      'PERIOD_FINALIZED: attendance for % is sealed (payroll finalized) and cannot be modified', v_month
      USING ERRCODE = 'check_violation',
            HINT    = 'Reverse the payroll finalization for this period before modifying attendance.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_locked_period_attendance ON attendance_daily;

CREATE TRIGGER trg_block_locked_period_attendance
  BEFORE INSERT OR UPDATE OR DELETE ON attendance_daily
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_locked_period_attendance_write();


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 263_payroll_finalization_lockdown                          ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 263_payroll_finalization_lockdown.sql
--
-- PI-1: Payroll Finalization Lockdown (closes audit findings C1, C2).
--
-- Finding C1: a finalized payroll run had NO write protection. The
-- POST /payroll/runs path upserts the run to 'processing', deletes all
-- slips, and recomputes — its only guard checked payroll_freeze_log, NOT
-- the run's finalized status. So re-running a finalized-but-unfrozen month
-- silently overwrote audited slips with new figures.
--
-- These triggers are the hard floor that no code path (route, service, or
-- ad-hoc query) can bypass. The application layer adds a clean 409 on top.
--
-- Scope is deliberately surgical so the LEGITIMATE break-glass paths keep
-- working:
--   • rollback  : finalized → draft     (super_admin) — allowed
--   • reopen    : finalized → reopened   (super_admin) — allowed
--   • freeze    : finalized → frozen                   — allowed
--   • snapshot/metadata writes that keep status='finalized'        — allowed
-- What is blocked is the destructive overwrite:
--   • finalized → processing  (the re-run upsert)      — BLOCKED
--   • DELETE of a finalized run                        — BLOCKED
--   • DELETE of slips belonging to a finalized run     — BLOCKED
-- (The rollback handler is reordered to flip the run to 'draft' BEFORE
--  deleting its slips, so the slip trigger permits that deletion.)
-- ============================================================

-- ── Run-level guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_block_finalized_payroll_run_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'finalized' THEN
      RAISE EXCEPTION
        'PAYROLL_FINALIZED: payroll run % is finalized and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation',
              HINT    = 'Roll the run back (super_admin) before removing it.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: block only the re-run transition that would enable an overwrite.
  IF OLD.status = 'finalized' AND NEW.status = 'processing' THEN
    RAISE EXCEPTION
      'PAYROLL_FINALIZED: run % is finalized and cannot be reset to processing / re-run', OLD.id
      USING ERRCODE = 'check_violation',
            HINT    = 'Use the rollback flow (super_admin) to reopen a finalized run before reprocessing.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_payroll_run_mutation ON payroll_runs;
CREATE TRIGGER trg_block_finalized_payroll_run_mutation
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_finalized_payroll_run_mutation();

-- ── Slip-level guard ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_block_finalized_payroll_slip_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_run_status TEXT;
BEGIN
  SELECT status INTO v_run_status FROM payroll_runs WHERE id = OLD.run_id;
  IF v_run_status = 'finalized' THEN
    RAISE EXCEPTION
      'PAYROLL_FINALIZED: slips of finalized payroll run % cannot be deleted', OLD.run_id
      USING ERRCODE = 'check_violation',
            HINT    = 'Roll the run back (super_admin) — which resets it to draft — before removing its slips.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_finalized_payroll_slip_delete ON payroll_slips;
CREATE TRIGGER trg_block_finalized_payroll_slip_delete
  BEFORE DELETE ON payroll_slips
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_finalized_payroll_slip_delete();


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 264_leave_ledger_idempotency                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 264_leave_ledger_idempotency.sql
--
-- LI-1: Leave ledger idempotency + the missing credit RPC.
-- Closes Enterprise Integrity findings C7 (comp-off/WO double-credit)
-- and L4 (credit_leave_balance RPC was called but never defined, so
-- the cached balance was silently never updated).
--
-- Note: full unification of the three balance stores (C6/L1) — making
-- the ledger the single source of truth with signed debit rows and a
-- derived cache — is a separate, backfill-bearing initiative and is NOT
-- attempted here. This migration hardens the ledger against duplicate
-- CREDITS and makes the cache-credit path actually work.
-- ============================================================

-- ── 1. Source linkage for traceability + idempotency ───────────────────────
ALTER TABLE leave_accrual_ledger
  ADD COLUMN IF NOT EXISTS source_request_id UUID;

-- ── 2. Extend the idempotency index to cover co_grant + wo_credit ──────────
-- Previously only monthly/quarterly/yearly/upfront/carry_forward were covered,
-- so comp-off (co_grant) and WO carry-over (wo_credit) had NO unique backstop —
-- ON CONFLICT had nothing to bind to and silently inserted duplicates.
DROP INDEX IF EXISTS uidx_accrual_ledger_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_idempotency
  ON leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
  WHERE accrual_type IN ('monthly','quarterly','yearly','upfront','carry_forward','co_grant','wo_credit');

-- A comp-off credit is uniquely identified by its originating request — the
-- strongest idempotency key (independent of accrued_on date drift).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_co_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'co_grant' AND source_request_id IS NOT NULL;

-- ── 3. Define the missing credit_leave_balance RPC ─────────────────────────
-- Idempotent-per-call upsert into the cached balance store. Callers invoke this
-- only after a NEW ledger row is written (the ledger is the integrity record;
-- the cache is a convenience mirror). Mirrors deduct_leave_balance (036).
CREATE OR REPLACE FUNCTION credit_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, p_days, p_year)
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
                updated_at = now();
END;
$$;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 265_master_data_audit                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 265_master_data_audit.sql
--
-- MDI-1: Audit trail for master-data changes (finding M3).
--
-- Previously NOT A SINGLE master table was audited — grades (CTC bands),
-- employment categories (PF/ESI/PT flags), shifts, leave types, etc. could
-- be edited or deleted with no who/when/what record. Combined with the
-- in-place-mutation problem, a change was both retroactive and untraceable.
--
-- This adds one generic trigger that records every INSERT/UPDATE/DELETE on
-- the org/comp/compliance master tables into the existing audit_logs table.
--
-- The function is written DEFENSIVELY: it derives tenant_id/record_id from
-- the row's JSONB and, if either is absent, returns WITHOUT auditing rather
-- than raising — so attaching it can never break a master's writes.
--
-- Actor attribution: performed_by is read best-effort from the session GUC
-- app.actor_id (NULL when unset). Full per-request actor capture would need
-- app-layer logAction and is a follow-up; this trigger guarantees uniform
-- what/when/before-after coverage for all masters, including future ones.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_audit_master_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor  UUID;
  v_old    JSONB;
  v_new    JSONB;
  v_tenant UUID;
  v_record UUID;
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('app.actor_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  v_tenant := COALESCE((v_new->>'tenant_id')::UUID, (v_old->>'tenant_id')::UUID);
  v_record := COALESCE((v_new->>'id')::UUID,        (v_old->>'id')::UUID);

  -- Cannot audit safely without tenant + record → never block the write.
  IF v_tenant IS NULL OR v_record IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO audit_logs (tenant_id, table_name, record_id, action, old_data, new_data, performed_by)
  VALUES (v_tenant, TG_TABLE_NAME, v_record, TG_OP, v_old, v_new, v_actor);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to the org / compensation / compliance master tables.
DO $$
DECLARE
  t TEXT;
  master_tables TEXT[] := ARRAY[
    'grades', 'designations', 'departments', 'sites', 'shifts',
    'work_locations', 'cost_centers', 'employment_categories', 'leave_types',
    'positions', 'rotation_policies', 'rosters', 'salary_components',
    'salary_structures'
  ];
BEGIN
  FOREACH t IN ARRAY master_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON %1$I ' ||
        'FOR EACH ROW EXECUTE FUNCTION fn_audit_master_change()', t);
    END IF;
  END LOOP;
END;
$$;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 266_rotation_rules_temporal                                ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 266_rotation_rules_temporal.sql
--
-- AHI-3: Temporal versioning for rotation_policy_rules.
-- Closes Enterprise Integrity findings C4 (rotation rules had no
-- effective_from/to, so the resolver read them live and editing a
-- condition→shift mapping retroactively changed past late/OT) and the
-- replay half of C5 (a recompute re-resolved against current rules).
--
-- Mirrors the AHI-1 employee_shifts temporal model (migration 260b):
--   • effective_from / effective_to define each rule version's validity
--   • the unified resolver picks the version effective ON the compute date
--   • existing rows are backfilled to an open window (always-effective),
--     so behaviour is unchanged until a rule is next edited
-- ============================================================

ALTER TABLE rotation_policy_rules
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to   DATE;

-- Backfill existing rules to an open window starting far in the past so the
-- temporal resolver matches them for every date (no behaviour change on deploy).
UPDATE rotation_policy_rules
   SET effective_from = COALESCE(effective_from, DATE '2000-01-01')
 WHERE effective_from IS NULL;

ALTER TABLE rotation_policy_rules
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;

-- Replace the hard "one shift per condition per policy" constraint with a
-- temporal one: only ONE OPEN (effective_to IS NULL) version per condition.
-- Historical (closed) versions accumulate for point-in-time resolution.
ALTER TABLE rotation_policy_rules
  DROP CONSTRAINT IF EXISTS rotation_policy_rules_rotation_policy_id_condition_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_rotation_rule_open_version
  ON rotation_policy_rules (rotation_policy_id, condition_type)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_rotation_rule_temporal
  ON rotation_policy_rules (rotation_policy_id, condition_type, effective_from DESC, effective_to DESC);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 267_job_history_org_snapshot                               ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 267_job_history_org_snapshot.sql
--
-- MDI / C8-M1: Snapshot org-attribute NAMES onto job_history at write time.
--
-- job_history (the system of record for an employee's grade/designation/
-- department/etc. over time) stored only foreign-key ids. Editing or merging a
-- master (e.g. renaming grade "L3"→"L5", or changing its CTC band) therefore
-- retroactively rewrote what every historical job row claimed — point-in-time
-- auditability was impossible.
--
-- A trigger snapshots the master's display name onto the row when the row is
-- written. The snapshot is then immutable: a later rename of the master does
-- NOT change it. On UPDATE the name is re-snapshotted ONLY when the underlying
-- id is repointed (a genuine reassignment), never on an unrelated edit.
--
-- Forward-fixing: existing rows keep NULL snapshot names (use the live FK as
-- before). Backfilling historical names and snapshotting org attributes onto
-- payroll slips are follow-ups.
-- ============================================================

ALTER TABLE job_history
  ADD COLUMN IF NOT EXISTS department_name    TEXT,
  ADD COLUMN IF NOT EXISTS designation_name   TEXT,
  ADD COLUMN IF NOT EXISTS grade_name         TEXT,
  ADD COLUMN IF NOT EXISTS work_location_name TEXT,
  ADD COLUMN IF NOT EXISTS cost_center_name   TEXT,
  ADD COLUMN IF NOT EXISTS shift_name         TEXT;

CREATE OR REPLACE FUNCTION fn_snapshot_job_history_names()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.department_id IS DISTINCT FROM OLD.department_id THEN
    NEW.department_name := (SELECT name FROM departments WHERE id = NEW.department_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.designation_id IS DISTINCT FROM OLD.designation_id THEN
    NEW.designation_name := (SELECT name FROM designations WHERE id = NEW.designation_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.grade_id IS DISTINCT FROM OLD.grade_id THEN
    NEW.grade_name := (SELECT name FROM grades WHERE id = NEW.grade_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.work_location_id IS DISTINCT FROM OLD.work_location_id THEN
    NEW.work_location_name := (SELECT name FROM work_locations WHERE id = NEW.work_location_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id THEN
    NEW.cost_center_name := (SELECT name FROM cost_centers WHERE id = NEW.cost_center_id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.shift_id IS DISTINCT FROM OLD.shift_id THEN
    NEW.shift_name := (SELECT name FROM shifts WHERE id = NEW.shift_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_job_history_names ON job_history;
CREATE TRIGGER trg_snapshot_job_history_names
  BEFORE INSERT OR UPDATE ON job_history
  FOR EACH ROW
  EXECUTE FUNCTION fn_snapshot_job_history_names();


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 268_leave_ledger_authority                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 268_leave_ledger_authority.sql
--
-- C6 (foundation): make leave_accrual_ledger the authoritative, complete record
-- of leave movement so the cached employee_leave_balance can become a derived
-- mirror rather than a competing source of truth.
--
-- Today leave APPROVAL only mutates the cache (deduct_leave_balance) and writes
-- NO ledger debit — so the ledger and the cache drift permanently and neither
-- can reproduce the displayed balance.
--
-- This migration:
--   1. Extends accrual_type to allow signed 'consumption' debits and a one-time
--      'opening_balance' reconciliation row.
--   2. Adds an idempotency unique for consumption rows (keyed by the leave
--      request that caused them).
--   3. Defines recompute_leave_balance() — derives the cache from the ledger.
--   4. Backfills an opening_balance row per (employee, leave_type, year) equal to
--      cache − Σ(existing ledger), so Σ(ledger) == current cache. From here on,
--      every credit and the new consumption debit keep them in lockstep.
--
-- Reads are NOT yet switched to the ledger (that is the final, flag-gated cutover
-- step, LEAVE_LEDGER_AUTHORITATIVE). After this migration the two are kept equal
-- by dual-write, so the cutover is a safe one-line flip.
-- ============================================================

-- ── 1. accrual_type — comprehensive superset (heals prior migration drift) ──
ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;
ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'quarterly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment', 'wo_credit',
    'consumption',      -- signed debit when leave is approved/consumed
    'opening_balance'   -- one-time reconciliation to current cached balance
  ));

-- ── 2. Consumption idempotency (one debit per leave request) ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_consumption_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'consumption' AND source_request_id IS NOT NULL;

-- ── 3. Derive the cached balance from the ledger ───────────────────────────
CREATE OR REPLACE FUNCTION recompute_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_year          INT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(days), 0) INTO v_balance
  FROM   leave_accrual_ledger
  WHERE  tenant_id = p_tenant_id AND employee_id = p_employee_id
    AND  leave_type_id = p_leave_type_id AND year = p_year
    AND  is_expired = false;

  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, v_balance, p_year)
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();
END;
$$;

-- ── 4. One-time opening-balance reconciliation ─────────────────────────────
-- opening_balance = current cache − Σ(existing non-expired ledger), so the
-- ledger total equals the balance employees see today. Idempotent: skipped where
-- an opening_balance row already exists for the key.
INSERT INTO leave_accrual_ledger
  (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, notes)
SELECT b.tenant_id, b.employee_id, b.leave_type_id, b.year, 'opening_balance',
       b.balance - COALESCE((
         SELECT SUM(l.days) FROM leave_accrual_ledger l
         WHERE l.tenant_id = b.tenant_id AND l.employee_id = b.employee_id
           AND l.leave_type_id = b.leave_type_id AND l.year = b.year
           AND l.is_expired = false
       ), 0),
       CURRENT_DATE, false, 'Opening balance reconciliation (migration 268)'
FROM   employee_leave_balance b
WHERE  NOT EXISTS (
  SELECT 1 FROM leave_accrual_ledger o
  WHERE o.tenant_id = b.tenant_id AND o.employee_id = b.employee_id
    AND o.leave_type_id = b.leave_type_id AND o.year = b.year
    AND o.accrual_type = 'opening_balance'
);


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 269_c6_p1_cutover_prep                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 269_c6_p1_cutover_prep.sql
--
-- C6-P1: Close all CRITICAL and BLOCKING findings from the C6 ledger
-- cutover readiness audit so the platform can safely enter shadow-read
-- validation.
--
-- Changes:
--   1. leave_applications — add 'cancelled' status (cancellation endpoint)
--   2. leave_accrual_ledger — add 'reversal' and 'encashment' accrual types
--   3. Reversal idempotency unique index
--   4. Encashment debit idempotency unique index
--   5. checked_deduct_leave_balance() — replaces the silent-clamp
--      deduct_leave_balance() for leave approval; returns BOOLEAN,
--      only deducts when balance >= requested days.
-- ============================================================

-- ── 1. leave_applications — add 'cancelled' status ────────────────────────────
ALTER TABLE leave_applications
  DROP CONSTRAINT IF EXISTS leave_applications_status_check;
ALTER TABLE leave_applications
  ADD CONSTRAINT leave_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- ── 2. leave_accrual_ledger — comprehensive accrual_type superset ─────────────
-- Adds 'reversal' (credit-back when an approved leave is cancelled) and
-- 'encashment' (debit when leave is encashed — mirrors leave_balance_ledger).
ALTER TABLE leave_accrual_ledger
  DROP CONSTRAINT IF EXISTS leave_accrual_ledger_accrual_type_check;
ALTER TABLE leave_accrual_ledger
  ADD CONSTRAINT leave_accrual_ledger_accrual_type_check
  CHECK (accrual_type IN (
    'monthly', 'quarterly', 'yearly', 'upfront', 'carry_forward',
    'co_grant', 'manual', 'adjustment', 'wo_credit',
    'consumption',       -- signed debit when leave is approved/consumed
    'opening_balance',   -- one-time reconciliation to current cached balance
    'reversal',          -- credit-back when a previously approved leave is cancelled
    'encashment'         -- debit when leave days are paid out (encashment approval)
  ));

-- ── 3. Reversal idempotency ────────────────────────────────────────────────────
-- One reversal row per leave application: prevents double-crediting on retry.
-- Uses the same source_request_id FK as the consumption row.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_reversal_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'reversal' AND source_request_id IS NOT NULL;

-- ── 4. Encashment debit idempotency ───────────────────────────────────────────
-- source_request_id holds the leave_encashment_requests.id UUID (different
-- FK domain from leave_applications, no collision risk as UUIDs are globally
-- unique). One debit per approved encashment request.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_accrual_ledger_encashment_request
  ON leave_accrual_ledger (tenant_id, source_request_id)
  WHERE accrual_type = 'encashment' AND source_request_id IS NOT NULL;

-- ── 5. checked_deduct_leave_balance ───────────────────────────────────────────
-- Atomically deducts p_days only when balance >= p_days. Returns TRUE if
-- deduction succeeded, FALSE if balance was insufficient.
--
-- Replaces deduct_leave_balance() (migration 036) in the leave approval path.
-- The old function used GREATEST(0, balance - p_days) which silently clamped
-- to zero when the requested days exceeded the balance, creating permanent
-- divergence between the ledger (which recorded the full debit) and the
-- cache (which clamped). This function is strict: no deduction, no ledger
-- write if the balance check fails.
CREATE OR REPLACE FUNCTION checked_deduct_leave_balance(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_days          NUMERIC,
  p_year          INT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE employee_leave_balance
  SET    balance    = balance - p_days,
         updated_at = now()
  WHERE  tenant_id     = p_tenant_id
    AND  employee_id   = p_employee_id
    AND  leave_type_id = p_leave_type_id
    AND  year          = p_year
    AND  balance       >= p_days;   -- strict check: no silent clamp
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  MIGRATION 270_leave_ledger_drift_log                                 ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
-- ============================================================
-- 270_leave_ledger_drift_log.sql
--
-- C6 Phase 1 (shadow-read validation): persist every detected divergence
-- between the cached employee_leave_balance and the authoritative
-- leave_accrual_ledger sum, so drift can be MONITORED over a multi-week
-- window with a query rather than scraped from logs.
--
-- Written by:
--   • the balance-read shadow comparison (source='balance_read') — passive,
--     fires on real ESS/admin balance reads while LEAVE_LEDGER_AUTHORITATIVE
--     is still OFF; and
--   • the reconciliation sweep (source='reconciliation_sweep') — the
--     /ledger-reconciliation endpoint run with ?record=true (e.g. nightly cron).
--
-- This table is INSTRUMENTATION ONLY. It never feeds a read path and is safe
-- to truncate. Service-role writes only (RLS on, no policies → denied to anon).
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_ledger_drift_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  employee_id    UUID NOT NULL,
  leave_type_id  UUID NOT NULL,
  year           INT  NOT NULL,
  cache_balance  NUMERIC,            -- NULL when ledger has a key the cache lacks
  ledger_balance NUMERIC NOT NULL,
  delta          NUMERIC NOT NULL,   -- ledger_balance − COALESCE(cache_balance,0)
  source         TEXT NOT NULL DEFAULT 'balance_read'
                 CHECK (source IN ('balance_read', 'reconciliation_sweep')),
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query the monitoring window per tenant, newest first.
CREATE INDEX IF NOT EXISTS idx_leave_drift_tenant_time
  ON leave_ledger_drift_log (tenant_id, detected_at DESC);

-- Find every employee/type that has ever drifted (distinct offenders).
CREATE INDEX IF NOT EXISTS idx_leave_drift_key
  ON leave_ledger_drift_log (tenant_id, employee_id, leave_type_id, year);

-- Lock down: service-role only (matches the rest of the internal tables).
ALTER TABLE leave_ledger_drift_log ENABLE ROW LEVEL SECURITY;

