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
