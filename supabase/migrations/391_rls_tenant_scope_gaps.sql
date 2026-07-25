-- ISSUE-149: 11 tenant-scoped tables had a real RLS gap. Two distinct patterns,
-- both leaving cross-tenant data reachable to any authenticated user who queries
-- Supabase directly (the app's own frontend already does this — apps/web/src/lib
-- /supabase/client.ts — bypassing the Fastify API's own tenant_id filtering, which
-- runs on the service-role key and never touches RLS).
--
-- Pattern B (7 tables) — RLS enabled, but every policy checks get_user_role()
-- ONLY, with no tenant_id constraint. Exact match for the bug ISSUE-020
-- (migration 347) already fixed on 30+ other tables: an hr_admin in Tenant A
-- passes the role check and can read/write Tenant B's rows if the id is known
-- or enumerable. Fixed with the same
--   USING (tenant_id = get_user_tenant_id() AND get_user_role() IN (...))
-- pattern migration 347 established.
--
--   employee_bank_statutory  (012_employee_extended.sql)  — bank account + PAN/UAN
--   employee_separation      (012_employee_extended.sql)  — exit/separation records
--   employee_access_cards    (012_employee_extended.sql)  — physical access cards
--   job_board_connectors     (300_job_board_postings.sql) — job-board API credentials
--   policy_change_log        (075_policy_governance.sql)  — HR policy audit trail
--   leave_accrual_runs       (072_leave_accrual_encashment.sql) — accrual batch runs
--   leave_job_log            (050_leave_accrual_ledger.sql) — leave scheduler log
--
-- Pattern A (4 tables) — RLS never enabled at all; zero policies, zero protection
-- beyond the service-role-only app path. A more severe variant of the same
-- underlying gap — these plausibly should have been part of the same "7" the
-- issue title counts, but were found to have RLS off entirely rather than a
-- role-only policy, so are fixed here as well rather than left half-done.
--
--   holiday_group_assignments (230_holiday_group_matrix.sql) — holiday↔group map
--   lwf_contributions         (229_lwf_tables.sql) — per-employee LWF deductions
--   lwf_state_config          (229_lwf_tables.sql) — per-employee LWF state override
--   lwf_state_settings        (229_lwf_tables.sql) — per-tenant LWF rates/config
--
-- Verified via repo-wide migration grep that none of the 9 role-only policies
-- below (employee table has 3, leave_accrual_runs has 2) were ever touched again
-- after their original CREATE, and none of the 4 pattern-A tables ever received
-- an ENABLE ROW LEVEL SECURITY / CREATE POLICY statement in any later migration.

-- ── Pattern B: add the missing tenant_id constraint ────────────────────────────

DROP POLICY IF EXISTS "ebs_hr_all" ON employee_bank_statutory;
CREATE POLICY "ebs_hr_all" ON employee_bank_statutory FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "es_hr_all" ON employee_separation;
CREATE POLICY "es_hr_all" ON employee_separation FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "eac_hr_all" ON employee_access_cards;
CREATE POLICY "eac_hr_all" ON employee_access_cards FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "jbc_hr_all" ON job_board_connectors;
CREATE POLICY "jbc_hr_all" ON job_board_connectors FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "pcl_hr_all" ON policy_change_log;
CREATE POLICY "pcl_hr_all" ON policy_change_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "lar_run_hr_read" ON leave_accrual_runs;
CREATE POLICY "lar_run_hr_read" ON leave_accrual_runs FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "lar_run_hr_insert" ON leave_accrual_runs;
CREATE POLICY "lar_run_hr_insert" ON leave_accrual_runs FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ljl_hr_read" ON leave_job_log;
CREATE POLICY "ljl_hr_read" ON leave_job_log FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ljl_hr_write" ON leave_job_log;
CREATE POLICY "ljl_hr_write" ON leave_job_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── Pattern A: enable RLS and add tenant-scoped policies ───────────────────────

-- holiday_group_assignments: GET /masters/holidays/group-matrix is readable by
-- any authenticated employee (masters/holidays.ts, `auth` = authenticate only);
-- writes go through POST /masters/holidays/group-assignments, which the route
-- itself already gates to hr_admin/super_admin.
ALTER TABLE holiday_group_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hga_tenant_read" ON holiday_group_assignments FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "hga_hr_write" ON holiday_group_assignments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- lwf_state_settings: only ever read/written via HR-admin-gated routes
-- (routes/payroll/statutory/lwf.ts GET/PUT /states use requireHrAdmin).
ALTER TABLE lwf_state_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lwfss_hr_all" ON lwf_state_settings FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- lwf_state_config: GET /state-config is authenticate-only (lwf.ts); PUT is
-- requireHrAdmin.
ALTER TABLE lwf_state_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lwfsc_tenant_read" ON lwf_state_config FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lwfsc_hr_write" ON lwf_state_config FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- lwf_contributions: GET /contributions is authenticate-only (lwf.ts); the
-- compute action is requireHrAdmin.
ALTER TABLE lwf_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lwfc_tenant_read" ON lwf_contributions FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "lwfc_hr_write" ON lwf_contributions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
