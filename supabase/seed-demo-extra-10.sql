-- seed-demo-extra-10.sql
-- ESS 2.0 Phase 1: Context panel demo data
--   · dob on demo employees → birthdays show in the right context panel
--   · joining_date tweak for 2 employees → work anniversaries in next 7 days
--
-- Idempotent: safe to re-run. Uses CURRENT_DATE arithmetic so birthday/
-- anniversary items always appear "soon" regardless of when you run it.
--
-- Tenant: d0000000-0000-0000-0000-000000000001 (demo)

begin;

-- ── 0. Ensure dob column exists on employees ──────────────────────────────────
-- Migration 016 dropped it; letters route + context panel use it.
-- ADD COLUMN IF NOT EXISTS is idempotent — safe to re-run.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dob DATE;

-- ── 1. Birthdays (dob) ────────────────────────────────────────────────────────
-- Set dob on 4 demo employees so their birthday MM-DD falls in the next 1-5 days.
-- Year is set ~25-32 years ago (irrelevant for the MM-DD match logic).
-- These employees' dob is NOT used by payroll/leave — purely profile data.

UPDATE employees
SET dob = (CURRENT_DATE + INTERVAL '1 day') - INTERVAL '30 years'    -- birthday tomorrow
WHERE id = 'e0000000-0000-0000-0000-000000000002'   -- Rahul Verma
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

UPDATE employees
SET dob = (CURRENT_DATE + INTERVAL '3 days') - INTERVAL '27 years'   -- birthday in 3 days
WHERE id = 'e0000000-0000-0000-0000-000000000003'   -- Deepak Chawla
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

UPDATE employees
SET dob = CURRENT_DATE - INTERVAL '32 years'                          -- birthday TODAY
WHERE id = 'e0000000-0000-0000-0000-000000000009'   -- Kavya Nair
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

UPDATE employees
SET dob = (CURRENT_DATE + INTERVAL '5 days') - INTERVAL '29 years'   -- birthday in 5 days
WHERE id = 'e0000000-0000-0000-0000-000000000006'   -- Nandini Gupta
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ── 2. Work anniversaries (joining_date) ─────────────────────────────────────
-- Adjust joining_date for 2 employees so their work-anniversary MM-DD falls
-- in the next 2-4 days. We keep the year realistic (2021/2022).
-- IMPORTANT: this only changes joining_date, which affects tenure display but
-- NOT any seeded payroll/leave rows (those use hardcoded month ranges).

UPDATE employees
SET joining_date = (CURRENT_DATE + INTERVAL '2 days') - INTERVAL '5 years'   -- 5yr anniversary in 2 days
WHERE id = 'e0000000-0000-0000-0000-000000000005'   -- Arjun Rampal
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

UPDATE employees
SET joining_date = (CURRENT_DATE + INTERVAL '4 days') - INTERVAL '4 years'   -- 4yr anniversary in 4 days
WHERE id = 'e0000000-0000-0000-0000-00000000000c'   -- Karan Patel
  AND tenant_id = 'd0000000-0000-0000-0000-000000000001';

commit;
