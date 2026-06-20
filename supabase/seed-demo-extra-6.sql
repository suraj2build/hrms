-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #6  (run AFTER seed-demo.sql)
--  Populates the ROSTER / SHIFT admin pages the core seed leaves empty:
--    • extra shifts (Morning / Evening / Night) so the planner has variety
--    • shift_roster   — per-day shift overrides across the current week
--                       (this is what the admin "Shift Roster" planner reads)
--    • rosters        — one named weekly-off governance policy
--    • roster_weekly_off_rules — a Sat/Sun fixed weekly-off rule on that policy
--    • roster_rotation_groups + roster_rotation_members — one Day→Night rotation
--    • roster_holiday_groups   — one regional holiday calendar
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
--
--  Fixed IDs from seed-demo.sql that we reference:
--    tenant         = d0000000-0000-0000-0000-000000000001
--    employees NN   = e0000000-0000-0000-0000-0000000000NN   (01..0c)
--    General Shift  = a6000000-0000-0000-0000-000000000001
--  New rows created here use the c6... prefix.
-- ============================================================================
begin;

-- ── RESET (children before parents) ─────────────────────────────────────────
-- shift_roster references shifts via ON DELETE RESTRICT, so it MUST be cleared
-- before the c6 shifts. roster_weekly_off_rules → rosters, rotation_members →
-- rotation_groups, and rosters.holiday_group_id → roster_holiday_groups, so we
-- delete each child before its parent. Tables without tenant_id are handled via
-- a subquery on their tenant-scoped parent.
do $$
declare tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  -- shift_roster: clear ALL demo-tenant rows (none are seeded elsewhere)
  if to_regclass('shift_roster') is not null then
    delete from shift_roster where tenant_id = tid;
  end if;

  -- rotation members before their groups
  if to_regclass('roster_rotation_members') is not null then
    delete from roster_rotation_members where tenant_id = tid;
  end if;
  if to_regclass('roster_rotation_groups') is not null then
    delete from roster_rotation_groups where tenant_id = tid;
  end if;

  -- weekly-off rules before their rosters
  if to_regclass('roster_weekly_off_rules') is not null then
    delete from roster_weekly_off_rules where tenant_id = tid;
  end if;

  -- rosters reference holiday_group_id → clear rosters before holiday groups.
  -- Only remove THIS file's rosters (fixed c6... ids) so any real rosters or
  -- rosters created by other seeds are left untouched.
  if to_regclass('rosters') is not null then
    delete from rosters where tenant_id = tid and id::text like 'c6000000-%';
  end if;
  if to_regclass('roster_holiday_groups') is not null then
    delete from roster_holiday_groups where tenant_id = tid;
  end if;

  -- finally the c6 shifts (now unreferenced by shift_roster). General Shift
  -- (a6...) is seeded by seed-demo.sql and is intentionally left in place.
  if to_regclass('shifts') is not null then
    delete from shifts where tenant_id = tid and id::text like 'c6000000-%';
  end if;
end $$;

-- ============================================================================
--  1. EXTRA SHIFTS  (so the roster planner has more than General Shift)
--     Columns: id, tenant_id, name, code, start_time, end_time, work_hours,
--              is_night_shift, grace_minutes   (all real; is_active defaults true)
-- ============================================================================
insert into shifts (id, tenant_id, name, code, start_time, end_time, work_hours, is_night_shift, grace_minutes) values
 ('c6000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Morning Shift','MORN','06:00','14:30',8.0, false, 10),
 ('c6000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Evening Shift','EVEN','14:00','22:30',8.0, false, 10),
 ('c6000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Night Shift',  'NGHT','22:00','06:30',8.0, true,  15);

-- ============================================================================
--  2. SHIFT ROSTER  (per-day overrides — the admin "Shift Roster" planner)
--     One override per employee per day (UNIQUE tenant_id, employee_id, date).
--     We cover the CURRENT week Mon→Sun so the planner opens populated.
--     date_trunc('week', current_date) is the Monday of the current ISO week.
-- ============================================================================
-- Rotating-coverage employees (e03, e05, e06) cycle Morning/Evening/Night across
-- the week; a couple more (e08, e09) take fixed alternate shifts. The rest stay
-- on their standing General Shift (no override row needed).
insert into shift_roster (tenant_id, employee_id, date, shift_id) values
 -- Deepak (e03): Morning Mon–Wed, Evening Thu–Fri
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 0, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 1, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 2, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 3, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 4, 'c6000000-0000-0000-0000-000000000002'),
 -- Arjun (e05): Evening Mon–Wed, Night Thu–Fri
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 0, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 1, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 2, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 3, 'c6000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 4, 'c6000000-0000-0000-0000-000000000003'),
 -- Nandini (e06): Night Mon–Wed, Morning Thu–Fri
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', date_trunc('week', current_date)::date + 0, 'c6000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', date_trunc('week', current_date)::date + 1, 'c6000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', date_trunc('week', current_date)::date + 2, 'c6000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', date_trunc('week', current_date)::date + 3, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', date_trunc('week', current_date)::date + 4, 'c6000000-0000-0000-0000-000000000001'),
 -- Vikram (e08): fixed Evening Mon–Fri
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', date_trunc('week', current_date)::date + 0, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', date_trunc('week', current_date)::date + 1, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', date_trunc('week', current_date)::date + 2, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', date_trunc('week', current_date)::date + 3, 'c6000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', date_trunc('week', current_date)::date + 4, 'c6000000-0000-0000-0000-000000000002'),
 -- Kavya (e09): Morning Mon, Wed, Fri (covering alternate days), General otherwise
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', date_trunc('week', current_date)::date + 0, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', date_trunc('week', current_date)::date + 2, 'c6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', date_trunc('week', current_date)::date + 4, 'c6000000-0000-0000-0000-000000000001'),
 -- Saturday weekend cover on General Shift (Deepak + Arjun)
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', date_trunc('week', current_date)::date + 5, 'a6000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', date_trunc('week', current_date)::date + 5, 'a6000000-0000-0000-0000-000000000001');

-- ============================================================================
--  3. ROSTER HOLIDAY GROUP  (regional holiday calendar)
--     Columns: id, tenant_id, name, code, description, state_code, is_active
-- ============================================================================
insert into roster_holiday_groups (id, tenant_id, name, code, description, state_code, is_active) values
 ('c6000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-000000000001','Karnataka Calendar','KA-HOL','Bengaluru HQ regional holiday calendar.', 'IN-KA', true);

-- ============================================================================
--  4. ROSTER  (named weekly-off governance policy)
--     pattern_json carries legacy weekly_off_days + the 5-week matrix the
--     /masters/rosters page reads. Sat/Sun off every week (standard 5-day week).
--     Columns: id, tenant_id, name, code, cycle_days, pattern_json, description,
--              is_active, holiday_group_id   (all real)
-- ============================================================================
insert into rosters (id, tenant_id, name, code, cycle_days, pattern_json, description, is_active, holiday_group_id) values
 ('c6000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-000000000001','Standard 5-Day Week','GEN-5DAY', 7,
  '{"weekly_off_days":[0,6],"matrix":{"week1":{"mon":"working","tue":"working","wed":"working","thu":"working","fri":"working","sat":"off","sun":"off"},"week2":{"mon":"working","tue":"working","wed":"working","thu":"working","fri":"working","sat":"off","sun":"off"},"week3":{"mon":"working","tue":"working","wed":"working","thu":"working","fri":"working","sat":"off","sun":"off"},"week4":{"mon":"working","tue":"working","wed":"working","thu":"working","fri":"working","sat":"off","sun":"off"},"week5":{"mon":"working","tue":"working","wed":"working","thu":"working","fri":"working","sat":"off","sun":"off"}}}'::jsonb,
  'Standard Monday–Friday working week with Saturday & Sunday off.', true, 'c6000000-0000-0000-0000-0000000000a1');

-- ============================================================================
--  5. ROSTER WEEKLY-OFF RULES  (rule-based off-day definition for the roster)
--     rule_type ∈ FIXED_WEEKLY_OFF | ALT_SATURDAY_OFF | FIRST_THIRD_SATURDAY
--                | ROTATIONAL_OFF | CYCLIC_PATTERN | CUSTOM_CALENDAR
--     Columns: id, tenant_id, roster_id, rule_type, rule_config, effective_from,
--              effective_to, priority
-- ============================================================================
insert into roster_weekly_off_rules (id, tenant_id, roster_id, rule_type, rule_config, effective_from, effective_to, priority) values
 ('c6000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-0000000000b1','FIXED_WEEKLY_OFF', '{"weekdays":[0,6]}'::jsonb, current_date - 90, null, 10);

-- ============================================================================
--  6. ROSTER ROTATION GROUP + MEMBERS  (Day→Evening→Night rotation)
--     rotation_type ∈ weekly | biweekly | monthly | custom
--     rotation_config: { shifts:[{shift_id,cohort_index}], cycle_weeks, start_date, auto_advance }
-- ============================================================================
insert into roster_rotation_groups (id, tenant_id, name, code, rotation_type, rotation_config, is_active) values
 ('c6000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-000000000001','Ops 24x7 Rotation','ROT-OPS','weekly',
  '{"shifts":[{"shift_id":"c6000000-0000-0000-0000-000000000001","cohort_index":0},{"shift_id":"c6000000-0000-0000-0000-000000000002","cohort_index":1},{"shift_id":"c6000000-0000-0000-0000-000000000003","cohort_index":2}],"cycle_weeks":3,"start_date":"2026-06-01","auto_advance":true}'::jsonb,
  true);

-- Three members, one per cohort slot (each gets a distinct starting shift).
insert into roster_rotation_members (id, tenant_id, rotation_group_id, employee_id, cohort_index, effective_from, effective_to) values
 ('c6000000-0000-0000-0000-0000000000e1','d0000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-0000000000d1','e0000000-0000-0000-0000-000000000003', 0, current_date - 30, null),
 ('c6000000-0000-0000-0000-0000000000e2','d0000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-0000000000d1','e0000000-0000-0000-0000-000000000005', 1, current_date - 30, null),
 ('c6000000-0000-0000-0000-0000000000e3','d0000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-0000000000d1','e0000000-0000-0000-0000-000000000006', 2, current_date - 30, null);

commit;

-- ============================================================================
--  DONE. Extra shifts, the shift_roster planner (current week), a named roster
--  policy with a fixed Sat/Sun weekly-off rule, a 3-shift rotation group with
--  members, and a regional holiday group now have demo data.
-- ============================================================================
