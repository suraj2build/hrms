-- ============================================================
-- 201_fix_remaining_rls_antipatterns.sql
--
-- Step 15 (Wave 5): Fix the last inline-subquery RLS patterns
-- not covered by migration 196.
--
-- AFFECTED TABLES
-- ---------------
-- Migration 147 — advanced roster engine:
--   roster_holiday_groups, roster_weekly_off_rules, shift_segments,
--   roster_rotation_groups, roster_rotation_members
--   Pattern: (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())
--
-- Migration 157 — scheduler autonomy:
--   leave_reconciliation_reports
--   Pattern: (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
--
-- Migration 177 — tax governance hardening:
--   tax_projection_reconciliation (3 policies)
--   Pattern: (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
--            (SELECT role    FROM profiles WHERE id = auth.uid() LIMIT 1)
--
-- POLICY STANDARD
-- ---------------
-- Tenant filter : tenant_id = get_user_tenant_id()
-- Role filter   : get_user_role() IN ('super_admin', 'hr_admin')
-- ============================================================

-- ── 147: roster_holiday_groups ────────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation" ON roster_holiday_groups;
CREATE POLICY "tenant_isolation" ON roster_holiday_groups
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- ── 147: roster_weekly_off_rules ──────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation" ON roster_weekly_off_rules;
CREATE POLICY "tenant_isolation" ON roster_weekly_off_rules
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- ── 147: shift_segments ───────────────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation" ON shift_segments;
CREATE POLICY "tenant_isolation" ON shift_segments
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- ── 147: roster_rotation_groups ───────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation" ON roster_rotation_groups;
CREATE POLICY "tenant_isolation" ON roster_rotation_groups
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- ── 147: roster_rotation_members ──────────────────────────────
DROP POLICY IF EXISTS "tenant_isolation" ON roster_rotation_members;
CREATE POLICY "tenant_isolation" ON roster_rotation_members
  FOR ALL USING (tenant_id = get_user_tenant_id());


-- ── 157: leave_reconciliation_reports ────────────────────────
DROP POLICY IF EXISTS "tenant_isolation_recon_reports" ON leave_reconciliation_reports;
CREATE POLICY "tenant_isolation_recon_reports" ON leave_reconciliation_reports
  FOR ALL USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );


-- ── 177: tax_projection_reconciliation ───────────────────────
-- Replace all three policies:  tpr_select, tpr_insert_admin, tpr_update_admin
-- All used inline correlated subqueries for both tenant and role checks.

DROP POLICY IF EXISTS tpr_select       ON tax_projection_reconciliation;
DROP POLICY IF EXISTS tpr_insert_admin ON tax_projection_reconciliation;
DROP POLICY IF EXISTS tpr_update_admin ON tax_projection_reconciliation;

CREATE POLICY tpr_select ON tax_projection_reconciliation
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY tpr_insert_admin ON tax_projection_reconciliation
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );

CREATE POLICY tpr_update_admin ON tax_projection_reconciliation
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('hr_admin', 'super_admin')
  );
