-- ============================================================
-- 470_dual_accrual_conflict_guard.sql
--
-- SYSTEM_AUDIT_2026-10-14 checkpoint 14 — closes two confirmed financial
-- defects (user-directed, not deferred):
--
-- (1) SCOPED-POLICY ACCRUAL GAP: runEngineMonthlyAccrual/runEngineYearlyCredit
--     (leave-entitlement-service.ts) only resolved scope_type='employee'
--     leave_policy_assignments. Department/work_location/site/default-scoped
--     assignments — a real, fully-supported configuration surface
--     (masters/leave-policy-assignments.ts's own scope_type check constraint
--     and SCOPE_PRIORITY map) — received ZERO monthly/yearly accrual credit.
--     resolve_engine_policy_rule() below is the canonical, effective-dated
--     scope resolver (employee > department > work_location > site >
--     default), callable from both SQL (the batch RPC below) and reused by
--     the TypeScript engine-accrual loop via the same priority order.
--
-- (2) TWO-SYSTEM DOUBLE CREDIT: leave_accrual_rules (System A,
--     accrual-engine.ts) and leave_policy_rules/leave_policy_assignments
--     (System B, leave-entitlement-service.ts) are two independent,
--     HR-admin-configurable systems for the same kind of monthly/quarterly
--     accrual rate, with no coordination. Reproduced (scripts/db/verify-
--     dual-accrual-system-overlap.mjs): an employee covered by BOTH gets
--     credited twice per period, regardless of which system's job runs
--     first. A CRUD-time mutual-exclusivity check alone cannot close this:
--     it cannot see a configuration that already existed before the check
--     was added, and it cannot protect against a configuration change
--     landing in the middle of an in-flight credit run. The authoritative
--     rule enforced here, INSIDE the same atomic transaction as the credit
--     itself: an employee+leave_type+period may be credited by AT MOST ONE
--     system. If BOTH systems have an active, applicable rule for the same
--     employee+leave_type as of the same date, NEITHER credits — the
--     ambiguity is recorded in leave_accrual_conflicts (visible, queryable)
--     instead of silently picking a winner or double-crediting. This also
--     catches pre-existing overlaps (created before this migration) the
--     first time either system's job touches them — no historical ledger
--     or balance data is touched; see the detection script run after this
--     migration applies for a one-time report of already-existing overlaps.
-- ============================================================

-- ── Conflict report table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_accrual_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  period          TEXT NOT NULL,  -- 'YYYY-MM' for monthly, 'YYYY' for yearly
  detected_by     TEXT NOT NULL CHECK (detected_by IN ('system_a_run', 'system_b_run', 'detection_scan')),
  system_a_rule_id UUID,  -- leave_accrual_rules.id, if that system had the applicable rule
  system_b_rule_id UUID,  -- leave_policy_rules.id, if that system had the applicable rule
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved        BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID,
  resolution_note TEXT,
  UNIQUE (tenant_id, employee_id, leave_type_id, period)
);

CREATE INDEX IF NOT EXISTS idx_leave_accrual_conflicts_unresolved
  ON leave_accrual_conflicts (tenant_id, resolved) WHERE resolved = false;

ALTER TABLE leave_accrual_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lac_conf_tenant_read ON leave_accrual_conflicts;
CREATE POLICY lac_conf_tenant_read ON leave_accrual_conflicts FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin', 'hr_admin'));

-- ── Canonical scope resolver — employee > department > work_location > site > default ──
-- Mirrors the EXACT priority order and effective-dating semantics already
-- used by the application-layer resolvers (resolveEffectiveDurationPolicy
-- in leave-duration.ts, resolveLifecyclePolicyForEmployee in
-- leave-accrual-lifecycle.ts) — this is the one place that logic now lives
-- for any caller (SQL or, via the TS wrapper, application code) that needs
-- "which leave_policy_rules row applies to this employee for this leave
-- type as of this date." employees.department_id/work_location_id/site_id
-- are kept in sync with job_history's current row by
-- trg_sync_employee_job_fields, so reading them directly (no job_history
-- join) gives the employee's CURRENT assignment — the same "current, not
-- historical-as-of" semantics the existing TS resolvers already use.
CREATE OR REPLACE FUNCTION resolve_engine_policy_rule(
  p_tenant_id     UUID,
  p_employee_id   UUID,
  p_leave_type_id UUID,
  p_as_of         DATE
) RETURNS TABLE(rule_id UUID, matched_scope_type TEXT, accrual_type TEXT, accrual_days_per_year NUMERIC)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_department_id     UUID;
  v_work_location_id  UUID;
  v_site_id           UUID;
  scope_rec           RECORD;
  assignment_rec       RECORD;
  rule_rec             RECORD;
BEGIN
  SELECT e.department_id, e.work_location_id, e.site_id
  INTO v_department_id, v_work_location_id, v_site_id
  FROM employees e
  WHERE e.id = p_employee_id AND e.tenant_id = p_tenant_id;

  FOR scope_rec IN
    SELECT * FROM (VALUES
      ('employee',      p_employee_id),
      ('department',    v_department_id),
      ('work_location', v_work_location_id),
      ('site',          v_site_id),
      ('default',       NULL::UUID)
    ) AS scopes(scope_type, scope_id)
  LOOP
    IF scope_rec.scope_type <> 'default' AND scope_rec.scope_id IS NULL THEN
      CONTINUE;
    END IF;

    FOR assignment_rec IN
      SELECT lpa.policy_id
      FROM leave_policy_assignments lpa
      WHERE lpa.tenant_id = p_tenant_id
        AND lpa.scope_type = scope_rec.scope_type
        AND ((scope_rec.scope_id IS NULL AND lpa.scope_id IS NULL) OR lpa.scope_id = scope_rec.scope_id)
        AND (lpa.effective_from IS NULL OR lpa.effective_from <= p_as_of)
        AND (lpa.effective_to   IS NULL OR lpa.effective_to   >= p_as_of)
    LOOP
      SELECT lpr.id, lpr.accrual_type, lpr.accrual_days_per_year
      INTO rule_rec
      FROM leave_policy_rules lpr
      WHERE lpr.tenant_id = p_tenant_id
        AND lpr.policy_id = assignment_rec.policy_id
        AND lpr.leave_type_id = p_leave_type_id
        AND (lpr.effective_from IS NULL OR lpr.effective_from <= p_as_of)
        AND (lpr.effective_to   IS NULL OR lpr.effective_to   >= p_as_of)
      LIMIT 1;

      IF rule_rec.id IS NOT NULL THEN
        rule_id := rule_rec.id;
        matched_scope_type := scope_rec.scope_type;
        accrual_type := rule_rec.accrual_type;
        accrual_days_per_year := rule_rec.accrual_days_per_year;
        RETURN NEXT;
        RETURN;
      END IF;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;

ALTER FUNCTION resolve_engine_policy_rule(UUID, UUID, UUID, DATE) SET search_path = public;
REVOKE EXECUTE ON FUNCTION resolve_engine_policy_rule(UUID, UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION resolve_engine_policy_rule(UUID, UUID, UUID, DATE) TO service_role;

-- ── System A (leave_accrual_rules) batch credit — now conflict-aware ────
-- Same statement shape as migration 459's version, with one addition: an
-- employee whose (tenant, leave_type) is ALSO covered by an active
-- monthly/quarterly System B rule (via resolve_engine_policy_rule, checked
-- fresh inside this same transaction — not a pre-check the caller did
-- moments earlier) is excluded from crediting and reported into
-- leave_accrual_conflicts instead. A concurrent System B config change
-- landing mid-run is therefore seen correctly: this re-checks at the exact
-- moment of crediting, not against a stale snapshot.
-- RETURNS TABLE's column list is changing (added employees_conflicted), so
-- CREATE OR REPLACE alone would fail ("cannot change return type of
-- existing function") — drop the old shape first.
DROP FUNCTION IF EXISTS credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB);

CREATE OR REPLACE FUNCTION credit_monthly_accrual_batch(
  p_tenant_id       UUID,
  p_leave_type_id   UUID,
  p_year            INT,
  p_period_last_day DATE,
  p_run_period      TEXT,
  p_employee_days   JSONB
) RETURNS TABLE(employees_credited INT, total_days NUMERIC, employees_conflicted INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_credited INT;
  v_total    NUMERIC;
  v_conflicted INT;
BEGIN
  WITH input_rows AS (
    SELECT (elem->>'employee_id')::UUID AS employee_id,
           (elem->>'days')::NUMERIC     AS days
    FROM jsonb_array_elements(p_employee_days) elem
  ),
  conflict_check AS (
    SELECT ir.employee_id, ir.days,
           (SELECT r.rule_id FROM resolve_engine_policy_rule(p_tenant_id, ir.employee_id, p_leave_type_id, p_period_last_day) r
            WHERE r.accrual_type IN ('monthly', 'quarterly')) AS conflicting_rule_id
    FROM input_rows ir
    WHERE ir.days > 0
  ),
  conflicted AS (
    SELECT employee_id, conflicting_rule_id FROM conflict_check WHERE conflicting_rule_id IS NOT NULL
  ),
  conflict_ins AS (
    INSERT INTO leave_accrual_conflicts (tenant_id, employee_id, leave_type_id, period, detected_by, system_b_rule_id)
    SELECT p_tenant_id, c.employee_id, p_leave_type_id, p_run_period, 'system_a_run', c.conflicting_rule_id
    FROM conflicted c
    ON CONFLICT (tenant_id, employee_id, leave_type_id, period) DO NOTHING
    RETURNING employee_id
  ),
  todo AS (
    -- Idempotency (unchanged from migration 459) AND the new conflict exclusion.
    SELECT cc.employee_id, cc.days
    FROM conflict_check cc
    WHERE cc.conflicting_rule_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM leave_accrual_ledger al
        WHERE al.tenant_id     = p_tenant_id
          AND al.employee_id   = cc.employee_id
          AND al.leave_type_id = p_leave_type_id
          AND al.year          = p_year
          AND al.accrual_type  = 'monthly'
          AND al.accrued_on    = p_period_last_day
      )
  ),
  upserted_balance AS (
    INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance, updated_at)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, t.days, now()
    FROM todo t
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
    DO UPDATE SET balance    = employee_leave_balance.balance + EXCLUDED.balance,
                  updated_at = now()
    RETURNING employee_id, balance
  ),
  ledger_ins AS (
    INSERT INTO leave_balance_ledger (tenant_id, employee_id, leave_type_id, year, txn_type, delta, balance_after, notes)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, 'accrual', t.days, ub.balance,
           'Monthly accrual — ' || p_run_period
    FROM todo t
    JOIN upserted_balance ub ON ub.employee_id = t.employee_id
    RETURNING employee_id
  ),
  accrual_ins AS (
    INSERT INTO leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, notes)
    SELECT p_tenant_id, t.employee_id, p_leave_type_id, p_year, 'monthly', t.days, p_period_last_day, false,
           'Monthly accrual — ' || p_run_period
    FROM todo t
    ON CONFLICT (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
      WHERE accrual_type IN ('monthly','quarterly','yearly','upfront','carry_forward','co_grant','wo_credit','advance_accrual','prorated_accrual')
    DO NOTHING
    RETURNING days
  )
  -- A CTE chain's data-modifying members only execute if the primary query
  -- actually reads from them — `conflict_ins` was built on `conflicted` but
  -- nothing downstream of it was ever selected from, so the INSERT it
  -- defines silently never ran, and (separately) a follow-up `SELECT ...
  -- FROM conflicted` in its own statement couldn't see that name at all
  -- ("relation \"conflicted\" does not exist" — a CTE's scope is its own
  -- WITH-chain, not later statements in the function body; found via real
  -- HTTP: scripts/db/verify-accrual-scope-gap.mjs Part 2). Fixed by
  -- aggregating all three terminal CTEs (accrual_ins, conflict_ins) in ONE
  -- final SELECT in this same statement — a data-modifying CTE executes
  -- exactly once no matter how many scalar subqueries read from it here.
  SELECT
    (SELECT count(*)::INT             FROM accrual_ins),
    (SELECT coalesce(sum(days), 0)    FROM accrual_ins),
    (SELECT count(*)::INT             FROM conflict_ins)
  INTO v_credited, v_total, v_conflicted;

  RETURN QUERY SELECT v_credited, v_total, v_conflicted;
END;
$$;

ALTER FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB) SET search_path = public;
REVOKE EXECUTE ON FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credit_monthly_accrual_batch(UUID, UUID, INT, DATE, TEXT, JSONB) TO service_role;

-- ── System B (engine, leave_policy_rules) single-employee credit — now
-- conflict-aware ──────────────────────────────────────────────────────────
-- Same shape as migration 469's version, with the symmetric check: if
-- System A (leave_accrual_rules) has an active monthly/quarterly row for
-- this (tenant, leave_type) as of the accrual date, this credit is blocked
-- and reported instead of applied — checked fresh inside this same
-- transaction, so a concurrent activation of a System A rule is seen
-- correctly rather than racing a stale pre-check.
-- Drop the old 10-arg signature (migration 469) BEFORE creating the new
-- 11-arg one — the new p_period argument changes the signature, and
-- leaving both defined simultaneously would make a call with exactly 10
-- named args ambiguous between "the old function" and "the new function
-- using its default for p_period" (the same overload-ambiguity class
-- fixed in migration 468).
DROP FUNCTION IF EXISTS credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION credit_engine_accrual_atomic(
  p_tenant_id    UUID,
  p_employee_id  UUID,
  p_leave_type_id UUID,
  p_accrual_type TEXT,
  p_days         NUMERIC,
  p_year         INT,
  p_accrued_on   DATE,
  p_expires_on   DATE DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_max_balance  NUMERIC DEFAULT NULL,
  p_period       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ledger_id UUID;
  v_new_balance NUMERIC;
  v_conflicting_rule_id UUID;
  v_conflict_freqs TEXT[];
BEGIN
  -- This function credits both the monthly/quarterly engine path and the
  -- yearly/upfront one, so the System A frequency it must treat as a
  -- conflict depends on which kind of credit this call is: a 'monthly'/
  -- 'quarterly' engine rule only competes with a System A rule of the SAME
  -- cadence (System A's 'annually'/'on_joining' rows fire at a different
  -- time and can't double the SAME period's credit), and symmetrically for
  -- 'yearly'/'upfront'.
  v_conflict_freqs := CASE
    WHEN p_accrual_type IN ('monthly', 'quarterly') THEN ARRAY['monthly', 'quarterly']
    ELSE ARRAY['annually', 'on_joining']
  END;

  SELECT lar.id INTO v_conflicting_rule_id
  FROM leave_accrual_rules lar
  WHERE lar.tenant_id = p_tenant_id
    AND lar.leave_type_id = p_leave_type_id
    AND lar.is_active = true
    AND lar.accrual_frequency = ANY(v_conflict_freqs)
    AND lar.effective_from <= p_accrued_on
    AND (lar.effective_to IS NULL OR lar.effective_to >= p_accrued_on)
  LIMIT 1;

  IF v_conflicting_rule_id IS NOT NULL THEN
    INSERT INTO leave_accrual_conflicts (tenant_id, employee_id, leave_type_id, period, detected_by, system_a_rule_id)
    VALUES (p_tenant_id, p_employee_id, p_leave_type_id, coalesce(p_period, p_accrued_on::TEXT), 'system_b_run', v_conflicting_rule_id)
    ON CONFLICT (tenant_id, employee_id, leave_type_id, period) DO NOTHING;
    RETURN jsonb_build_object('skipped', true, 'conflict', true, 'ledger_id', NULL, 'balance', NULL);
  END IF;

  BEGIN
    INSERT INTO leave_accrual_ledger (
      tenant_id, employee_id, leave_type_id, accrual_type, days, year,
      accrued_on, expires_on, is_expired, notes
    ) VALUES (
      p_tenant_id, p_employee_id, p_leave_type_id, p_accrual_type, p_days, p_year,
      p_accrued_on, p_expires_on, false, p_notes
    )
    RETURNING id INTO v_ledger_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('skipped', true, 'conflict', false, 'ledger_id', NULL, 'balance', NULL);
  END;

  INSERT INTO employee_leave_balance (tenant_id, employee_id, leave_type_id, year, balance, updated_at)
  VALUES (p_tenant_id, p_employee_id, p_leave_type_id, p_year,
          CASE WHEN p_max_balance IS NOT NULL THEN LEAST(p_days, p_max_balance) ELSE p_days END,
          now())
  ON CONFLICT (tenant_id, employee_id, leave_type_id, year)
  DO UPDATE SET
    balance = CASE
      WHEN p_max_balance IS NOT NULL THEN LEAST(employee_leave_balance.balance + p_days, p_max_balance)
      ELSE employee_leave_balance.balance + p_days
    END,
    updated_at = now()
  RETURNING balance INTO v_new_balance;

  RETURN jsonb_build_object('skipped', false, 'conflict', false, 'ledger_id', v_ledger_id, 'balance', v_new_balance);
END;
$$;

ALTER FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC, TEXT) SET search_path = public;
REVOKE EXECUTE ON FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION credit_engine_accrual_atomic(UUID, UUID, UUID, TEXT, NUMERIC, INT, DATE, DATE, TEXT, NUMERIC, TEXT) TO service_role;
