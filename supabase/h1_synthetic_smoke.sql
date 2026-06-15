-- ═══════════════════════════════════════════════════════════════════════════
--  h1_synthetic_smoke.sql — C6 Phase-D synthetic leave-lifecycle smoke.
--
--  PURPOSE
--    Prove on STAGING that the leave dual-write keeps the cache
--    (employee_leave_balance) and the authoritative ledger (Σ leave_accrual_ledger
--    non-expired days) in lockstep across the full lifecycle — accrual, approve/
--    consume, over-balance rejection, idempotent replay, cancel/reversal,
--    encashment. This is the synthetic stand-in for real activity while the
--    staging DB has no production data.
--
--  PRECONDITION
--    Migration 271 (uidx_accrual_ledger_request + matching onConflict) MUST be
--    applied first — otherwise the consumption/reversal/encashment ledger upserts
--    cannot infer their ON CONFLICT target and silently drift.
--
--  SAFETY
--    100% transactional. Everything (fixture + ledger + balances) is created and
--    then ROLLED BACK — zero residue on the database. The scorecard SELECT runs
--    BEFORE the ROLLBACK so its result is returned to you.
--    Run the whole file as a single batch in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Precondition: migration 271 applied ──────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.uidx_accrual_ledger_request') IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: migration 271 not applied '
      '(index uidx_accrual_ledger_request is missing). Apply 271 before running this smoke.';
  END IF;
END $$;

CREATE TEMP TABLE _smoke (
  step   int,
  label  text,
  cache  numeric,
  ledger numeric,
  drift  numeric,
  pass   boolean
) ON COMMIT DROP;

DO $$
DECLARE
  v_t   uuid;
  v_e   uuid;
  v_l   uuid;
  v_y   int  := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_app uuid := gen_random_uuid();   -- a leave application (consume + cancel)
  v_enc uuid := gen_random_uuid();   -- an encashment request
  v_ok  boolean;
  c numeric; g numeric; n int;
BEGIN
  -- Fixture (rolled back at the end).
  INSERT INTO tenants(name, slug)
    VALUES ('H1 Shadow Smoke', 'h1-smoke-' || substr(gen_random_uuid()::text,1,8))
    RETURNING id INTO v_t;
  INSERT INTO employees(tenant_id, employee_code, first_name, last_name, email, joining_date)
    VALUES (v_t, 'SMK-001', 'Smoke', 'Test',
            'smoke-' || substr(gen_random_uuid()::text,1,8) || '@example.test', CURRENT_DATE)
    RETURNING id INTO v_e;
  INSERT INTO leave_types(tenant_id, name, is_paid)
    VALUES (v_t, 'EL-SMOKE', true)
    RETURNING id INTO v_l;

  -- S1 — opening accrual +12, cache derived from ledger via recompute.
  INSERT INTO leave_accrual_ledger(tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired)
    VALUES (v_t, v_e, v_l, v_y, 'opening_balance', 12, CURRENT_DATE, false);
  PERFORM recompute_leave_balance(v_t, v_e, v_l, v_y);
  SELECT balance INTO c FROM employee_leave_balance WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (1,'opening accrual +12', c, g, c-g, c=12 AND abs(c-g)<=0.01);

  -- S2 — approve/consume 3: checked_deduct (cache) + consumption ledger row.
  v_ok := checked_deduct_leave_balance(v_t, v_e, v_l, 3, v_y);
  INSERT INTO leave_accrual_ledger(tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, source_request_id)
    VALUES (v_t, v_e, v_l, v_y, 'consumption', -3, CURRENT_DATE, false, v_app)
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;
  SELECT balance INTO c FROM employee_leave_balance WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (2,'approve/consume 3 (ok='||v_ok||')', c, g, c-g, v_ok AND c=9 AND abs(c-g)<=0.01);

  -- S3 — over-balance attempt 100: rejected, no change (strict, no silent clamp).
  v_ok := checked_deduct_leave_balance(v_t, v_e, v_l, 100, v_y);
  SELECT balance INTO c FROM employee_leave_balance WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (3,'over-balance 100 rejected (ok='||v_ok||')', c, g, c-g, (v_ok=false) AND c=9 AND abs(c-g)<=0.01);

  -- S4 — idempotent replay (duplicate approval event): same source_request_id ignored.
  INSERT INTO leave_accrual_ledger(tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, source_request_id)
    VALUES (v_t, v_e, v_l, v_y, 'consumption', -3, CURRENT_DATE, false, v_app)
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;
  SELECT count(*) INTO n FROM leave_accrual_ledger WHERE tenant_id=v_t AND accrual_type='consumption' AND source_request_id=v_app;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (4,'idempotent re-consume (consumption rows='||n||')', 9, g, 9-g, n=1 AND abs(9-g)<=0.01);

  -- S5 — cancel/reversal +3: reversal row (coexists with consumption) + credit cache.
  INSERT INTO leave_accrual_ledger(tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, source_request_id)
    VALUES (v_t, v_e, v_l, v_y, 'reversal', 3, CURRENT_DATE, false, v_app)
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;
  PERFORM credit_leave_balance(v_t, v_e, v_l, 3, v_y);
  SELECT balance INTO c FROM employee_leave_balance WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (5,'cancel/reversal +3 (coexists w/ consumption)', c, g, c-g, c=12 AND abs(c-g)<=0.01);

  -- S6 — encashment 2: checked_deduct (cache) + encashment ledger debit.
  v_ok := checked_deduct_leave_balance(v_t, v_e, v_l, 2, v_y);
  INSERT INTO leave_accrual_ledger(tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, is_expired, source_request_id)
    VALUES (v_t, v_e, v_l, v_y, 'encashment', -2, CURRENT_DATE, false, v_enc)
    ON CONFLICT (tenant_id, accrual_type, source_request_id) DO NOTHING;
  SELECT balance INTO c FROM employee_leave_balance WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y;
  SELECT COALESCE(SUM(days),0) INTO g FROM leave_accrual_ledger WHERE tenant_id=v_t AND leave_type_id=v_l AND year=v_y AND is_expired=false;
  INSERT INTO _smoke VALUES (6,'encashment 2 (ok='||v_ok||')', c, g, c-g, v_ok AND c=10 AND abs(c-g)<=0.01);
END $$;

-- Scorecard (returned to you before the rollback discards everything).
SELECT step, label, cache, ledger, drift,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result
FROM _smoke ORDER BY step;

SELECT CASE WHEN bool_and(pass) THEN 'ALL PASS — ledger/cache consistent across lifecycle, zero drift'
            ELSE 'FAILURES PRESENT — investigate before enabling shadow' END AS verdict,
       count(*) FILTER (WHERE NOT pass) AS failures
FROM _smoke;

ROLLBACK;   -- zero residue: fixture, ledger and balances are all discarded.
