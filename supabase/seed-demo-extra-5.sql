-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #5  (run AFTER seed-demo.sql)
--  Populates the LEAVE ACCRUAL / LEDGER admin pages that the core seed leaves
--  empty:
--    • leave_accrual_ledger  — per-employee monthly accrual credits (Jan–Jun 2026)
--                              + an annual carry-forward row per leave type. The
--                              Leave Accrual Ledger screen and the team / leave
--                              balances views read this for annual entitlement.
--    • leave_accrual_runs    — one monthly accrual-run record per month (Jan–Jun
--                              2026) summarising what each run credited.
--    • leave_balance_ledger  — signed balance movements (opening balance + the
--                              same monthly accrual credits), the immutable
--                              transaction log behind a balance.
--    • leave_accrual_rules   — one accrual rule per accruing leave type, the
--                              config the runs/ledger conceptually reference.
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
-- ============================================================================
begin;

-- Demo tenant + profile + employees use the fixed IDs from seed-demo.sql:
--   tenant  = d0000000-0000-0000-0000-000000000001
--   profile = d0000000-0000-0000-0000-0000000000a1
--   emp NN  = e0000000-0000-0000-0000-0000000000NN   (01..0c, all active)
--   leave types (from seed-demo.sql):
--     a8000000-…-01  Casual Leave  (CL, paid)
--     a8000000-…-02  Sick Leave    (SL, paid)
--     a8000000-…-03  Earned Leave  (EL, paid)
--     a8000000-…-04  Unpaid Leave  (LWP, not paid — no accrual)
--   employee_leave_balance is seeded in seed-demo.sql (CL 12 / SL 8 / EL 18 / LWP 0)
--   — NOT touched here. Annual entitlements below are tuned to be >= those caches.
--
-- New rows created by THIS file use fixed UUIDs prefixed `c5`. Year = 2026.

-- ── RESET (children before parents) ─────────────────────────────────────────
-- All four target tables carry tenant_id, so delete directly by tenant.
-- leave_balance_ledger has a self-FK (reversal_of) and is referenced by other
-- tables via ledger_entry_id (ON DELETE SET NULL), so a plain tenant delete is
-- safe. Done before leave_accrual_rules so any FK ordering is satisfied.
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'leave_accrual_ledger',
    'leave_balance_ledger',
    'leave_accrual_runs',
    'leave_accrual_rules'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;
end $$;

-- ============================================================================
--  1. LEAVE ACCRUAL RULES  (config: how each leave type accrues)
--     accrual_frequency ∈ ('monthly','quarterly','annually','on_joining')
--     CL: 1.0/mo, SL: 0.75/mo, EL: 1.5/mo  →  annual 12 / 9 / 18.
--     Earned Leave is encashable + carries forward; the others do not carry.
-- ============================================================================
insert into leave_accrual_rules (id, tenant_id, leave_type_id, accrual_frequency, days_per_period, prorate_on_joining, carry_forward_max, carry_forward_expiry_months, encashable, max_encashable_per_year, effective_from, is_active) values
 ('c5a00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','monthly', 1.00, true, 5.0,  3, false, 0,  '2026-01-01', true),
 ('c5a00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000002','monthly', 0.75, true, 0.0,  0, false, 0,  '2026-01-01', true),
 ('c5a00000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000003','monthly', 1.50, true, 30.0, 0, true,  15, '2026-01-01', true);

-- ============================================================================
--  2. LEAVE ACCRUAL LEDGER  (per-grant audit trail — drives annual entitlement)
--     accrual_type allowed (latest CHECK, migration 269): monthly, quarterly,
--       yearly, upfront, carry_forward, co_grant, manual, adjustment, wo_credit,
--       consumption, opening_balance, reversal, encashment.
--     Idempotency: uidx_accrual_ledger_idempotency is UNIQUE on
--       (tenant_id, employee_id, leave_type_id, year, accrual_type, accrued_on)
--       for monthly/…/carry_forward — so each monthly row uses a distinct
--       accrued_on (the 1st of its month) and the carry_forward row is dated
--       2026-01-01. The reset above also keeps re-runs clean.
--
--  2a. Carry-forward (one row per employee, per accruing leave type), dated
--      2026-01-01 — last year's unused balance rolled in. CL +2, SL +0, EL +6.
--      (SL has carry_forward_max 0, so no SL carry-forward row.)
-- ============================================================================
insert into leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, notes, cycle_period)
select 'd0000000-0000-0000-0000-000000000001', e.id, cf.lt, 2026, 'carry_forward', cf.days, date '2026-01-01',
       'Carry-forward of unused ' || cf.label || ' from 2025.', '2026'
from employees e
join (values
 ('a8000000-0000-0000-0000-000000000001'::uuid, 2.0, 'Casual Leave'),
 ('a8000000-0000-0000-0000-000000000003'::uuid, 6.0, 'Earned Leave')
) as cf(lt, days, label) on true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- 2b. Monthly accrual credits, Jan–Jun 2026 (6 cycles), per employee per
--     accruing leave type. accrued_on = 1st of each month (distinct per cycle);
--     cycle_period = 'YYYY-MM'. Monthly rates: CL 1.0, SL 0.75, EL 1.5.
insert into leave_accrual_ledger (tenant_id, employee_id, leave_type_id, year, accrual_type, days, accrued_on, notes, cycle_period, accrual_earning_basis)
select 'd0000000-0000-0000-0000-000000000001', e.id, r.lt, 2026, 'monthly', r.rate,
       (date '2026-01-01' + (m.n || ' months')::interval)::date,
       'Monthly accrual for ' || to_char(date '2026-01-01' + (m.n || ' months')::interval, 'Mon YYYY') || '.',
       to_char(date '2026-01-01' + (m.n || ' months')::interval, 'YYYY-MM'),
       'earned'
from employees e
join (values
 ('a8000000-0000-0000-0000-000000000001'::uuid, 1.00),
 ('a8000000-0000-0000-0000-000000000002'::uuid, 0.75),
 ('a8000000-0000-0000-0000-000000000003'::uuid, 1.50)
) as r(lt, rate) on true
cross join generate_series(0, 5) as m(n)
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  3. LEAVE ACCRUAL RUNS  (monthly accrual-run history — Jan–Jun 2026)
--     status ∈ ('success','partial','failed').  UNIQUE (tenant_id, run_period,
--     leave_type_id) — leave_type_id NULL (one consolidated run per month).
--     Each run credited all 12 employees across CL+SL+EL:
--       per employee = 1.0 + 0.75 + 1.5 = 3.25 days  →  ×12 = 39.00 days/run.
-- ============================================================================
insert into leave_accrual_runs (tenant_id, run_period, leave_type_id, employees_credited, total_days_credited, status, ran_at)
select 'd0000000-0000-0000-0000-000000000001',
       to_char(date '2026-01-01' + (m.n || ' months')::interval, 'YYYY-MM'),
       null, 12, 39.00, 'success',
       (date '2026-01-01' + (m.n || ' months')::interval)::timestamptz + time '02:00'
from generate_series(0, 5) as m(n);

-- ============================================================================
--  4. LEAVE BALANCE LEDGER  (immutable signed transaction log)
--     txn_type allowed (latest CHECK, migration 158): accrual, carry_forward,
--       manual_credit, deduction, encashment, expiry, opening_balance,
--       event_grant, reversal, payroll_adjustment, correction, lop_recovery.
--     delta = signed movement; balance_after = running balance after the row.
--     Per employee per accruing leave type we record, in order:
--       1) opening_balance  (carry-forward seed from 2025)
--       2..7) six monthly accrual credits (Jan–Jun 2026)
--     running balance_after is computed deterministically from opening + rate*k.
--     Opening balances: CL 2.0, SL 0.0, EL 6.0 (mirrors the carry-forward rows).
-- ============================================================================
-- 4a. Opening balance rows (one per employee per accruing leave type).
insert into leave_balance_ledger (tenant_id, employee_id, leave_type_id, year, txn_type, delta, balance_after, notes, created_by, created_at)
select 'd0000000-0000-0000-0000-000000000001', e.id, ob.lt, 2026, 'opening_balance', ob.open, ob.open,
       'Opening balance carried into FY2026.', 'd0000000-0000-0000-0000-0000000000a1',
       date '2026-01-01' + time '00:05'
from employees e
join (values
 ('a8000000-0000-0000-0000-000000000001'::uuid, 2.00),
 ('a8000000-0000-0000-0000-000000000002'::uuid, 0.00),
 ('a8000000-0000-0000-0000-000000000003'::uuid, 6.00)
) as ob(lt, open) on true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- 4b. Monthly accrual rows with running balance_after = opening + rate*(n+1).
insert into leave_balance_ledger (tenant_id, employee_id, leave_type_id, year, txn_type, delta, balance_after, notes, created_by, created_at, payroll_period)
select 'd0000000-0000-0000-0000-000000000001', e.id, r.lt, 2026, 'accrual', r.rate,
       r.open + r.rate * (m.n + 1),
       'Monthly accrual for ' || to_char(date '2026-01-01' + (m.n || ' months')::interval, 'Mon YYYY') || '.',
       'd0000000-0000-0000-0000-0000000000a1',
       (date '2026-01-01' + (m.n || ' months')::interval)::timestamptz + time '02:05',
       to_char(date '2026-01-01' + (m.n || ' months')::interval, 'YYYY-MM')
from employees e
join (values
 ('a8000000-0000-0000-0000-000000000001'::uuid, 1.00, 2.00),
 ('a8000000-0000-0000-0000-000000000002'::uuid, 0.75, 0.00),
 ('a8000000-0000-0000-0000-000000000003'::uuid, 1.50, 6.00)
) as r(lt, rate, open) on true
cross join generate_series(0, 5) as m(n)
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

commit;

-- ============================================================================
--  DONE. Leave accrual rules, the accrual ledger (carry-forward + Jan–Jun 2026
--  monthly credits), monthly accrual runs and the signed balance ledger now
--  have demo data.
--
--  Annual entitlement (carry-forward + 12 monthly credits) reconciles to:
--    Casual Leave : 2 + 12*1.00 = 14.0  (>= 12 cached)
--    Sick Leave   : 0 +  9.00   =  9.0  (>=  8 cached)   [9 = 12*0.75]
--    Earned Leave : 6 + 12*1.50 = 24.0  (>= 18 cached)
--  (only Jan–Jun rows are seeded here; the annual figure is the full-year rate.)
-- ============================================================================
