-- ISSUE-020: 30+ tables had write RLS policies scoped only to user_role
-- with no tenant_id constraint, allowing an hr_admin from Tenant A to
-- write to any row in Tenant B when the row ID was known.
--
-- Pattern being fixed:
--   USING (get_user_role() IN ('super_admin','hr_admin'))
-- Replaced with:
--   USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
--   WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
--
-- All 59 policies below are dropped and recreated. Read-only SELECT
-- policies are not touched.

-- ── helpers ───────────────────────────────────────────────────────────────────

-- Reusable inline: USING + WITH CHECK that gates by tenant AND role.

-- ── 010_masters_extended ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "wl_hr_write" ON work_locations;
CREATE POLICY "wl_hr_write" ON work_locations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "cc_hr_write" ON cost_centers;
CREATE POLICY "cc_hr_write" ON cost_centers FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "sh_hr_write" ON shifts;
CREATE POLICY "sh_hr_write" ON shifts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "it_hr_write" ON identity_types;
CREATE POLICY "it_hr_write" ON identity_types FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "rt_hr_write" ON relationship_types;
CREATE POLICY "rt_hr_write" ON relationship_types FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "dt_hr_write" ON document_types;
CREATE POLICY "dt_hr_write" ON document_types FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 011_salary_masters ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "sc_hr_write" ON salary_components;
CREATE POLICY "sc_hr_write" ON salary_components FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ss_hr_write" ON salary_structures;
CREATE POLICY "ss_hr_write" ON salary_structures FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ssc_hr_write" ON salary_structure_components;
CREATE POLICY "ssc_hr_write" ON salary_structure_components FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 021_attendance_guards ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "hr_lock_rw" ON attendance_processing_lock;
CREATE POLICY "hr_lock_rw" ON attendance_processing_lock FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "hr_runs_write" ON attendance_processing_runs;
CREATE POLICY "hr_runs_write" ON attendance_processing_runs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 033_leave_management ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "lt_hr_write" ON leave_types;
CREATE POLICY "lt_hr_write" ON leave_types FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "la_hr_all" ON leave_applications;
CREATE POLICY "la_hr_all" ON leave_applications FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 048_compensation_engine ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "cp_hr_write" ON compensation_policies;
CREATE POLICY "cp_hr_write" ON compensation_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 051_attendance_corrections ────────────────────────────────────────────────

DROP POLICY IF EXISTS "corr_hr_all" ON attendance_corrections;
CREATE POLICY "corr_hr_all" ON attendance_corrections FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 059_rosters ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "rosters_hr_write" ON rosters;
CREATE POLICY "rosters_hr_write" ON rosters FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 062_employee_org_assignments ──────────────────────────────────────────────

DROP POLICY IF EXISTS "eoa_hr_write" ON employee_org_assignments;
CREATE POLICY "eoa_hr_write" ON employee_org_assignments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 067_attendance_period_locks ───────────────────────────────────────────────

DROP POLICY IF EXISTS "period_lock_hr_write" ON attendance_period_locks;
CREATE POLICY "period_lock_hr_write" ON attendance_period_locks FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 071_regularisation_policy ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "reg_policy_hr_write" ON regularisation_policy;
CREATE POLICY "reg_policy_hr_write" ON regularisation_policy FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 078_compensation_revisions ────────────────────────────────────────────────

DROP POLICY IF EXISTS "comprev_hr_all" ON compensation_revisions;
CREATE POLICY "comprev_hr_all" ON compensation_revisions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 079_payroll_forecasts ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "forecast_hr_write" ON payroll_forecasts;
CREATE POLICY "forecast_hr_write" ON payroll_forecasts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 080_payroll_cost_snapshots ────────────────────────────────────────────────

DROP POLICY IF EXISTS "dept_snap_hr_write" ON payroll_dept_snapshots;
CREATE POLICY "dept_snap_hr_write" ON payroll_dept_snapshots FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 089_governance_evolution ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "am_admin_write" ON approval_matrices;
CREATE POLICY "am_admin_write" ON approval_matrices FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ad_admin_write" ON approval_delegations;
CREATE POLICY "ad_admin_write" ON approval_delegations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "oo_admin_write" ON operational_overrides;
CREATE POLICY "oo_admin_write" ON operational_overrides FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "gr_admin_write" ON governance_rollbacks;
CREATE POLICY "gr_admin_write" ON governance_rollbacks FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 090_operational_incidents ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "oi_hr_write" ON operational_incidents;
CREATE POLICY "oi_hr_write" ON operational_incidents FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ie_hr_write" ON incident_escalations;
CREATE POLICY "ie_hr_write" ON incident_escalations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ite_hr_write" ON incident_timeline_events;
CREATE POLICY "ite_hr_write" ON incident_timeline_events FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ic_hr_write" ON incident_comments;
CREATE POLICY "ic_hr_write" ON incident_comments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 091_webhooks ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "wh_admin_write" ON webhooks;
CREATE POLICY "wh_admin_write" ON webhooks FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "wd_system_write" ON webhook_deliveries;
CREATE POLICY "wd_system_write" ON webhook_deliveries FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ir_admin_write" ON integration_registry;
CREATE POLICY "ir_admin_write" ON integration_registry FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ial_system_write" ON integration_audit_log;
CREATE POLICY "ial_system_write" ON integration_audit_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 096_esi_engine ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "esic_hr_write" ON esi_config;
CREATE POLICY "esic_hr_write" ON esi_config FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "esiet_hr_write" ON esi_eligibility_timeline;
CREATE POLICY "esiet_hr_write" ON esi_eligibility_timeline FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "esicc_hr_write" ON esi_contributions;
CREATE POLICY "esicc_hr_write" ON esi_contributions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 097_ptax_engine ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pts_hr_write" ON ptax_slabs;
CREATE POLICY "pts_hr_write" ON ptax_slabs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ptsc_hr_write" ON ptax_state_config;
CREATE POLICY "ptsc_hr_write" ON ptax_state_config FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ptct_hr_write" ON ptax_contributions;
CREATE POLICY "ptct_hr_write" ON ptax_contributions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 106_notification_templates ────────────────────────────────────────────────

DROP POLICY IF EXISTS "nc_hr_write" ON notification_channels;
CREATE POLICY "nc_hr_write" ON notification_channels FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "nt_hr_write" ON notification_templates;
CREATE POLICY "nt_hr_write" ON notification_templates FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "nl_hr_write" ON notification_log;
CREATE POLICY "nl_hr_write" ON notification_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 119_reconciliation ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "arr_hr_all" ON attendance_reconciliation_runs;
CREATE POLICY "arr_hr_all" ON attendance_reconciliation_runs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ari_hr_all" ON attendance_reconciliation_issues;
CREATE POLICY "ari_hr_all" ON attendance_reconciliation_issues FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "lrr_hr_all" ON leave_reconciliation_runs;
CREATE POLICY "lrr_hr_all" ON leave_reconciliation_runs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "lri_hr_all" ON leave_reconciliation_issues;
CREATE POLICY "lri_hr_all" ON leave_reconciliation_issues FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "afs_hr_all" ON attendance_freshness_snapshots;
CREATE POLICY "afs_hr_all" ON attendance_freshness_snapshots FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 153_rotation_policies ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "rotation_policies_hr_write" ON rotation_policies;
CREATE POLICY "rotation_policies_hr_write" ON rotation_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "rotation_policy_rules_hr_write" ON rotation_policy_rules;
CREATE POLICY "rotation_policy_rules_hr_write" ON rotation_policy_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 159_accrual_lifecycle_governance ─────────────────────────────────────────

DROP POLICY IF EXISTS "lat_hr_write" ON leave_accrual_tiers;
CREATE POLICY "lat_hr_write" ON leave_accrual_tiers FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "laf_hr_write" ON leave_accrual_freezes;
CREATE POLICY "laf_hr_write" ON leave_accrual_freezes FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ler_hr_write" ON leave_entitlement_releases;
CREATE POLICY "ler_hr_write" ON leave_entitlement_releases FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 163_replay_infrastructure ────────────────────────────────────────────────
-- lps_hr_write was originally FOR INSERT WITH CHECK only; preserved as-is.

DROP POLICY IF EXISTS "lps_hr_write" ON leave_policy_snapshots;
CREATE POLICY "lps_hr_write" ON leave_policy_snapshots
  FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin','hr_admin')
  );

-- ── 183_statutory_multi_code ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "statreg_hr_write" ON statutory_registrations;
CREATE POLICY "statreg_hr_write" ON statutory_registrations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "ptax_state_settings_hr_write" ON ptax_state_settings;
CREATE POLICY "ptax_state_settings_hr_write" ON ptax_state_settings FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 290_employee_education ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "edu_hr_all" ON employee_education;
CREATE POLICY "edu_hr_all" ON employee_education FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 295_asset_requests ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "asset_req_hr_all" ON asset_requests;
CREATE POLICY "asset_req_hr_all" ON asset_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── 301_operational_notes ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "opnotes_hr_all" ON operational_notes;
CREATE POLICY "opnotes_hr_all" ON operational_notes FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
