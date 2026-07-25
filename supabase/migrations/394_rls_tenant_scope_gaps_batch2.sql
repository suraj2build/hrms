-- Fresh audit finding (auth/RBAC/multi-tenant security pass): the exact
-- same 'role-only, no tenant_id' RLS gap fixed for 11 tables in migration
-- 391 (ISSUE-149) exists on a much larger set of tables — confirmed by
-- checking each policy name never reappears in any later migration, and
-- confirming each table's tenant_id column is NOT NULL REFERENCES
-- tenants(id) (genuinely tenant-scoped, not a nullable/shared-platform
-- column like backup_checkpoints/scheduler_heartbeats/worker_registry,
-- which are deliberately excluded here along with the ~11 genuinely
-- global platform tables from migration 197 that have no tenant_id at
-- all — compliance_controls, chaos_scenarios/chaos_test_runs,
-- dr_scenarios, restore_drills, module_health, security_detection_rules,
-- business_event_types, data_field_classifications, it_standard_config,
-- it_tax_slabs).
--
-- Since fastify.supabase runs on the service-role key (bypasses RLS
-- entirely), the Fastify API's own tenant_id filtering is what actually
-- protects these tables today. RLS is what protects any OTHER access
-- path — and the frontend has its own Supabase client
-- (apps/web/src/lib/supabase/client.ts) that CAN reach PostgREST
-- directly with a user's JWT, bypassing the API layer entirely. An
-- hr_admin/super_admin at Tenant A using that path could read or write
-- every other tenant's rows in any of the tables below.
--
-- 127 write policies across 125 tables. Same fix pattern as
-- migration 347 (ISSUE-020) and migration 391 (ISSUE-149):
--   USING (tenant_id = get_user_tenant_id() AND get_user_role() IN (...))

-- ── advance_recoveries ─────────────────────────────────────────
DROP POLICY IF EXISTS "arec_hr_write" ON advance_recoveries;
CREATE POLICY "arec_hr_write" ON advance_recoveries FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── advance_recovery_schedules ─────────────────────────────────────────
DROP POLICY IF EXISTS "arsch_hr_write" ON advance_recovery_schedules;
CREATE POLICY "arsch_hr_write" ON advance_recovery_schedules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── advance_salary_requests ─────────────────────────────────────────
DROP POLICY IF EXISTS "asr_hr_write" ON advance_salary_requests;
CREATE POLICY "asr_hr_write" ON advance_salary_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── approval_workflow_config ─────────────────────────────────────────
DROP POLICY IF EXISTS "awc_hr_write" ON approval_workflow_config;
CREATE POLICY "awc_hr_write" ON approval_workflow_config FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── arrear_batches ─────────────────────────────────────────
DROP POLICY IF EXISTS "ab_hr_write" ON arrear_batches;
CREATE POLICY "ab_hr_write" ON arrear_batches FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── arrear_payouts ─────────────────────────────────────────
DROP POLICY IF EXISTS "ap_hr_write" ON arrear_payouts;
CREATE POLICY "ap_hr_write" ON arrear_payouts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── arrear_records ─────────────────────────────────────────
DROP POLICY IF EXISTS "ar_hr_write" ON arrear_records;
CREATE POLICY "ar_hr_write" ON arrear_records FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── attendance_exceptions ─────────────────────────────────────────
DROP POLICY IF EXISTS "attendance_exceptions_hr_write" ON attendance_exceptions;
CREATE POLICY "attendance_exceptions_hr_write" ON attendance_exceptions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── attendance_intelligence_snapshot ─────────────────────────────────────────
DROP POLICY IF EXISTS "intel_hr_write" ON attendance_intelligence_snapshot;
CREATE POLICY "intel_hr_write" ON attendance_intelligence_snapshot FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── attendance_policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "ap_hr_write" ON attendance_policies;
CREATE POLICY "ap_hr_write" ON attendance_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── attendance_punch_logs ─────────────────────────────────────────
DROP POLICY IF EXISTS "pl_hr_delete" ON attendance_punch_logs;
CREATE POLICY "pl_hr_delete" ON attendance_punch_logs FOR DELETE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "pl_hr_update" ON attendance_punch_logs;
CREATE POLICY "pl_hr_update" ON attendance_punch_logs FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── attendance_regularisation ─────────────────────────────────────────
DROP POLICY IF EXISTS "reg_hr_all" ON attendance_regularisation;
CREATE POLICY "reg_hr_all" ON attendance_regularisation FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── bgv_cases ─────────────────────────────────────────
DROP POLICY IF EXISTS "bgv_case_hr_all" ON bgv_cases;
CREATE POLICY "bgv_case_hr_all" ON bgv_cases FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── bgv_checks ─────────────────────────────────────────
DROP POLICY IF EXISTS "bgv_check_hr_all" ON bgv_checks;
CREATE POLICY "bgv_check_hr_all" ON bgv_checks FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── calculation_trace_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "ctl_hr_write" ON calculation_trace_log;
CREATE POLICY "ctl_hr_write" ON calculation_trace_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── clearance_departments ─────────────────────────────────────────
DROP POLICY IF EXISTS "clr_dept_hr_all" ON clearance_departments;
CREATE POLICY "clr_dept_hr_all" ON clearance_departments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── comp_off_requests ─────────────────────────────────────────
DROP POLICY IF EXISTS "co_hr_write" ON comp_off_requests;
CREATE POLICY "co_hr_write" ON comp_off_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── compensation_revisions ─────────────────────────────────────────
DROP POLICY IF EXISTS "cr_hr_write" ON compensation_revisions;
CREATE POLICY "cr_hr_write" ON compensation_revisions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── compensation_snapshots ─────────────────────────────────────────
DROP POLICY IF EXISTS "cs_hr_write" ON compensation_snapshots;
CREATE POLICY "cs_hr_write" ON compensation_snapshots FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── component_calculation_configs ─────────────────────────────────────────
DROP POLICY IF EXISTS "ccc_hr_write" ON component_calculation_configs;
CREATE POLICY "ccc_hr_write" ON component_calculation_configs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── declaration_proofs ─────────────────────────────────────────
DROP POLICY IF EXISTS "dp_hr_write" ON declaration_proofs;
CREATE POLICY "dp_hr_write" ON declaration_proofs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── draft_bank_statutory ─────────────────────────────────────────
DROP POLICY IF EXISTS "draft_bank_hr_all" ON draft_bank_statutory;
CREATE POLICY "draft_bank_hr_all" ON draft_bank_statutory FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── draft_employee_fields ─────────────────────────────────────────
DROP POLICY IF EXISTS "def_hr_write" ON draft_employee_fields;
CREATE POLICY "def_hr_write" ON draft_employee_fields FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── draft_employee_profiles ─────────────────────────────────────────
DROP POLICY IF EXISTS "dep_hr_write" ON draft_employee_profiles;
CREATE POLICY "dep_hr_write" ON draft_employee_profiles FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── emergency_contacts ─────────────────────────────────────────
DROP POLICY IF EXISTS "emc_hr_all" ON emergency_contacts;
CREATE POLICY "emc_hr_all" ON emergency_contacts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_addresses ─────────────────────────────────────────
DROP POLICY IF EXISTS "ea_hr_all" ON employee_addresses;
CREATE POLICY "ea_hr_all" ON employee_addresses FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_attendance_policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "eap_hr_write" ON employee_attendance_policies;
CREATE POLICY "eap_hr_write" ON employee_attendance_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_contracts ─────────────────────────────────────────
DROP POLICY IF EXISTS "ecnt_hr_all" ON employee_contracts;
CREATE POLICY "ecnt_hr_all" ON employee_contracts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_event_grants ─────────────────────────────────────────
DROP POLICY IF EXISTS "event_grants_hr_all" ON employee_event_grants;
CREATE POLICY "event_grants_hr_all" ON employee_event_grants FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_family ─────────────────────────────────────────
DROP POLICY IF EXISTS "ef_hr_all" ON employee_family;
CREATE POLICY "ef_hr_all" ON employee_family FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_identity ─────────────────────────────────────────
DROP POLICY IF EXISTS "ei_hr_all" ON employee_identity;
CREATE POLICY "ei_hr_all" ON employee_identity FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_important_dates ─────────────────────────────────────────
DROP POLICY IF EXISTS "eid_hr_write" ON employee_important_dates;
CREATE POLICY "eid_hr_write" ON employee_important_dates FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_leave_balance ─────────────────────────────────────────
DROP POLICY IF EXISTS "elb_hr_write" ON employee_leave_balance;
CREATE POLICY "elb_hr_write" ON employee_leave_balance FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_loans ─────────────────────────────────────────
DROP POLICY IF EXISTS "el_hr_write" ON employee_loans;
CREATE POLICY "el_hr_write" ON employee_loans FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_nominations ─────────────────────────────────────────
DROP POLICY IF EXISTS "enom_hr_all" ON employee_nominations;
CREATE POLICY "enom_hr_all" ON employee_nominations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_optional_holidays ─────────────────────────────────────────
DROP POLICY IF EXISTS "eoh_hr_delete" ON employee_optional_holidays;
CREATE POLICY "eoh_hr_delete" ON employee_optional_holidays FOR DELETE
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_overtime_policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "eotp_hr_write" ON employee_overtime_policies;
CREATE POLICY "eotp_hr_write" ON employee_overtime_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_passport_visa ─────────────────────────────────────────
DROP POLICY IF EXISTS "pv_hr_write" ON employee_passport_visa;
CREATE POLICY "pv_hr_write" ON employee_passport_visa FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_personal_info ─────────────────────────────────────────
DROP POLICY IF EXISTS "epi_hr_all" ON employee_personal_info;
CREATE POLICY "epi_hr_all" ON employee_personal_info FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_risk_flags ─────────────────────────────────────────
DROP POLICY IF EXISTS "risk_hr_write" ON employee_risk_flags;
CREATE POLICY "risk_hr_write" ON employee_risk_flags FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_shifts ─────────────────────────────────────────
DROP POLICY IF EXISTS "es_hr_write" ON employee_shifts;
CREATE POLICY "es_hr_write" ON employee_shifts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employee_statutory_overrides ─────────────────────────────────────────
DROP POLICY IF EXISTS "eso_hr_write" ON employee_statutory_overrides;
CREATE POLICY "eso_hr_write" ON employee_statutory_overrides FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── epf_config ─────────────────────────────────────────
DROP POLICY IF EXISTS "epfc_hr_write" ON epf_config;
CREATE POLICY "epfc_hr_write" ON epf_config FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── epf_contributions ─────────────────────────────────────────
DROP POLICY IF EXISTS "epfct_hr_write" ON epf_contributions;
CREATE POLICY "epfct_hr_write" ON epf_contributions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── epf_eligibility_overrides ─────────────────────────────────────────
DROP POLICY IF EXISTS "epfeo_hr_write" ON epf_eligibility_overrides;
CREATE POLICY "epfeo_hr_write" ON epf_eligibility_overrides FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── escalation_rules ─────────────────────────────────────────
DROP POLICY IF EXISTS "er_hr_write" ON escalation_rules;
CREATE POLICY "er_hr_write" ON escalation_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── event_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "el_system_write" ON event_log;
CREATE POLICY "el_system_write" ON event_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── event_replay_queue ─────────────────────────────────────────
DROP POLICY IF EXISTS "erq_admin_write" ON event_replay_queue;
CREATE POLICY "erq_admin_write" ON event_replay_queue FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── event_retention_rules ─────────────────────────────────────────
DROP POLICY IF EXISTS "err_admin_write" ON event_retention_rules;
CREATE POLICY "err_admin_write" ON event_retention_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── exit_interview_questions ─────────────────────────────────────────
DROP POLICY IF EXISTS "eiq_hr_all" ON exit_interview_questions;
CREATE POLICY "eiq_hr_all" ON exit_interview_questions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── exit_interview_responses ─────────────────────────────────────────
DROP POLICY IF EXISTS "eir_hr_all" ON exit_interview_responses;
CREATE POLICY "eir_hr_all" ON exit_interview_responses FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── exit_interview_templates ─────────────────────────────────────────
DROP POLICY IF EXISTS "eit_hr_all" ON exit_interview_templates;
CREATE POLICY "eit_hr_all" ON exit_interview_templates FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── fbp_bill_attachments ─────────────────────────────────────────
DROP POLICY IF EXISTS "fbp_att_hr" ON fbp_bill_attachments;
CREATE POLICY "fbp_att_hr" ON fbp_bill_attachments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── fbp_bill_submissions ─────────────────────────────────────────
DROP POLICY IF EXISTS "fbp_sub_hr" ON fbp_bill_submissions;
CREATE POLICY "fbp_sub_hr" ON fbp_bill_submissions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── fbp_reconciliations ─────────────────────────────────────────
DROP POLICY IF EXISTS "fbp_recon_hr" ON fbp_reconciliations;
CREATE POLICY "fbp_recon_hr" ON fbp_reconciliations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── feed_comments ─────────────────────────────────────────
DROP POLICY IF EXISTS "feed_comments_hr_all" ON feed_comments;
CREATE POLICY "feed_comments_hr_all" ON feed_comments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── feed_posts ─────────────────────────────────────────
DROP POLICY IF EXISTS "feed_posts_hr_all" ON feed_posts;
CREATE POLICY "feed_posts_hr_all" ON feed_posts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── feed_reactions ─────────────────────────────────────────
DROP POLICY IF EXISTS "feed_reactions_hr_all" ON feed_reactions;
CREATE POLICY "feed_reactions_hr_all" ON feed_reactions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── feed_reports ─────────────────────────────────────────
DROP POLICY IF EXISTS "feed_reports_hr_all" ON feed_reports;
CREATE POLICY "feed_reports_hr_all" ON feed_reports FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── formula_registry ─────────────────────────────────────────
DROP POLICY IF EXISTS "fr_hr_write" ON formula_registry;
CREATE POLICY "fr_hr_write" ON formula_registry FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── holiday_calendar ─────────────────────────────────────────
DROP POLICY IF EXISTS "hr_write" ON holiday_calendar;
CREATE POLICY "hr_write" ON holiday_calendar FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── import_job_chunks ─────────────────────────────────────────
DROP POLICY IF EXISTS "ijc_hr_write" ON import_job_chunks;
CREATE POLICY "ijc_hr_write" ON import_job_chunks FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── import_job_errors ─────────────────────────────────────────
DROP POLICY IF EXISTS "ije_hr_write" ON import_job_errors;
CREATE POLICY "ije_hr_write" ON import_job_errors FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── import_job_metrics ─────────────────────────────────────────
DROP POLICY IF EXISTS "ijm_hr_write" ON import_job_metrics;
CREATE POLICY "ijm_hr_write" ON import_job_metrics FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── import_job_rows ─────────────────────────────────────────
DROP POLICY IF EXISTS "ijr_hr_write" ON import_job_rows;
CREATE POLICY "ijr_hr_write" ON import_job_rows FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── import_jobs ─────────────────────────────────────────
DROP POLICY IF EXISTS "ij_hr_write" ON import_jobs;
CREATE POLICY "ij_hr_write" ON import_jobs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── important_date_types ─────────────────────────────────────────
DROP POLICY IF EXISTS "idt_hr_write" ON important_date_types;
CREATE POLICY "idt_hr_write" ON important_date_types FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── inbox_escalations ─────────────────────────────────────────
DROP POLICY IF EXISTS "ie_hr_write" ON inbox_escalations;
CREATE POLICY "ie_hr_write" ON inbox_escalations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── inbox_items ─────────────────────────────────────────
DROP POLICY IF EXISTS "ii_hr_write" ON inbox_items;
CREATE POLICY "ii_hr_write" ON inbox_items FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── incentive_templates ─────────────────────────────────────────
DROP POLICY IF EXISTS "it_hr_write" ON incentive_templates;
CREATE POLICY "it_hr_write" ON incentive_templates FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── job_board_postings ─────────────────────────────────────────
DROP POLICY IF EXISTS "jbp_hr_all" ON job_board_postings;
CREATE POLICY "jbp_hr_all" ON job_board_postings FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_accrual_ledger ─────────────────────────────────────────
DROP POLICY IF EXISTS "lal_hr_write" ON leave_accrual_ledger;
CREATE POLICY "lal_hr_write" ON leave_accrual_ledger FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_accrual_rules ─────────────────────────────────────────
DROP POLICY IF EXISTS "lar_hr_write" ON leave_accrual_rules;
CREATE POLICY "lar_hr_write" ON leave_accrual_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_encashment_requests ─────────────────────────────────────────
DROP POLICY IF EXISTS "ler_hr_all" ON leave_encashment_requests;
CREATE POLICY "ler_hr_all" ON leave_encashment_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_event_grants ─────────────────────────────────────────
DROP POLICY IF EXISTS "leg_hr_write" ON leave_event_grants;
CREATE POLICY "leg_hr_write" ON leave_event_grants FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "lp_hr_write" ON leave_policies;
CREATE POLICY "lp_hr_write" ON leave_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_policy_assignments ─────────────────────────────────────────
DROP POLICY IF EXISTS "lpa_hr_write" ON leave_policy_assignments;
CREATE POLICY "lpa_hr_write" ON leave_policy_assignments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_policy_masters ─────────────────────────────────────────
DROP POLICY IF EXISTS "lpm_hr_write" ON leave_policy_masters;
CREATE POLICY "lpm_hr_write" ON leave_policy_masters FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_policy_rules ─────────────────────────────────────────
DROP POLICY IF EXISTS "lpr_hr_write" ON leave_policy_rules;
CREATE POLICY "lpr_hr_write" ON leave_policy_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── leave_policy_versions ─────────────────────────────────────────
DROP POLICY IF EXISTS "lpv_hr_all" ON leave_policy_versions;
CREATE POLICY "lpv_hr_all" ON leave_policy_versions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── loan_payments ─────────────────────────────────────────
DROP POLICY IF EXISTS "lp_hr_write" ON loan_payments;
CREATE POLICY "lp_hr_write" ON loan_payments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── loan_schedules ─────────────────────────────────────────
DROP POLICY IF EXISTS "ls_hr_write" ON loan_schedules;
CREATE POLICY "ls_hr_write" ON loan_schedules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── long_running_jobs ─────────────────────────────────────────
DROP POLICY IF EXISTS "lrj_hr_write" ON long_running_jobs;
CREATE POLICY "lrj_hr_write" ON long_running_jobs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── maker_checker_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "mcl_hr_write" ON maker_checker_log;
CREATE POLICY "mcl_hr_write" ON maker_checker_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── onboarding_audit_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "oal_hr_write" ON onboarding_audit_log;
CREATE POLICY "oal_hr_write" ON onboarding_audit_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── onboarding_documents ─────────────────────────────────────────
DROP POLICY IF EXISTS "od_hr_write" ON onboarding_documents;
CREATE POLICY "od_hr_write" ON onboarding_documents FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── onboarding_sessions ─────────────────────────────────────────
DROP POLICY IF EXISTS "os_hr_write" ON onboarding_sessions;
CREATE POLICY "os_hr_write" ON onboarding_sessions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── optional_holiday_pool ─────────────────────────────────────────
DROP POLICY IF EXISTS "ohp_hr_write" ON optional_holiday_pool;
CREATE POLICY "ohp_hr_write" ON optional_holiday_pool FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── overtime_policies ─────────────────────────────────────────
DROP POLICY IF EXISTS "otp_hr_write" ON overtime_policies;
CREATE POLICY "otp_hr_write" ON overtime_policies FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── overtime_requests ─────────────────────────────────────────
DROP POLICY IF EXISTS "otr_hr_all" ON overtime_requests;
CREATE POLICY "otr_hr_all" ON overtime_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_adjustments ─────────────────────────────────────────
DROP POLICY IF EXISTS "padj_hr_write" ON payroll_adjustments;
CREATE POLICY "padj_hr_write" ON payroll_adjustments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_explainability_ledger ─────────────────────────────────────────
DROP POLICY IF EXISTS "pel_hr_write" ON payroll_explainability_ledger;
CREATE POLICY "pel_hr_write" ON payroll_explainability_ledger FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_finalize_overrides ─────────────────────────────────────────
DROP POLICY IF EXISTS "pfo_hr_write" ON payroll_finalize_overrides;
CREATE POLICY "pfo_hr_write" ON payroll_finalize_overrides FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_freeze_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "pfl_hr_write" ON payroll_freeze_log;
CREATE POLICY "pfl_hr_write" ON payroll_freeze_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_reconciliation_runs ─────────────────────────────────────────
DROP POLICY IF EXISTS "prec_hr_write" ON payroll_reconciliation_runs;
CREATE POLICY "prec_hr_write" ON payroll_reconciliation_runs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_run_employees ─────────────────────────────────────────
DROP POLICY IF EXISTS "pre_hr_all" ON payroll_run_employees;
CREATE POLICY "pre_hr_all" ON payroll_run_employees FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_statutory_settings ─────────────────────────────────────────
DROP POLICY IF EXISTS "statset_hr_write" ON payroll_statutory_settings;
CREATE POLICY "statset_hr_write" ON payroll_statutory_settings FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_validation_results ─────────────────────────────────────────
DROP POLICY IF EXISTS "pvres_hr_write" ON payroll_validation_results;
CREATE POLICY "pvres_hr_write" ON payroll_validation_results FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_validation_rules ─────────────────────────────────────────
DROP POLICY IF EXISTS "pvr_hr_write" ON payroll_validation_rules;
CREATE POLICY "pvr_hr_write" ON payroll_validation_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

DROP POLICY IF EXISTS "pvr_super_admin_write" ON payroll_validation_rules;
CREATE POLICY "pvr_super_admin_write" ON payroll_validation_rules FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_validation_runs ─────────────────────────────────────────
DROP POLICY IF EXISTS "pvrun_hr_write" ON payroll_validation_runs;
CREATE POLICY "pvrun_hr_write" ON payroll_validation_runs FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── payroll_variance_approvals ─────────────────────────────────────────
DROP POLICY IF EXISTS "pva_hr_write" ON payroll_variance_approvals;
CREATE POLICY "pva_hr_write" ON payroll_variance_approvals FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── policy_evaluation_log ─────────────────────────────────────────
DROP POLICY IF EXISTS "pel_hr_all" ON policy_evaluation_log;
CREATE POLICY "pel_hr_all" ON policy_evaluation_log FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── previous_employment ─────────────────────────────────────────
DROP POLICY IF EXISTS "pe_hr_all" ON previous_employment;
CREATE POLICY "pe_hr_all" ON previous_employment FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── queue_partitions ─────────────────────────────────────────
DROP POLICY IF EXISTS "qp_system_write" ON queue_partitions;
CREATE POLICY "qp_system_write" ON queue_partitions FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── recognition ─────────────────────────────────────────
DROP POLICY IF EXISTS "recognition_hr_all" ON recognition;
CREATE POLICY "recognition_hr_all" ON recognition FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── recognition_badges ─────────────────────────────────────────
DROP POLICY IF EXISTS "recbadge_hr_all" ON recognition_badges;
CREATE POLICY "recbadge_hr_all" ON recognition_badges FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── recognition_budgets ─────────────────────────────────────────
DROP POLICY IF EXISTS "recbudget_hr_all" ON recognition_budgets;
CREATE POLICY "recbudget_hr_all" ON recognition_budgets FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── reimbursement_attachments ─────────────────────────────────────────
DROP POLICY IF EXISTS "ra_hr_write" ON reimbursement_attachments;
CREATE POLICY "ra_hr_write" ON reimbursement_attachments FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── reimbursement_categories ─────────────────────────────────────────
DROP POLICY IF EXISTS "rcat_hr_write" ON reimbursement_categories;
CREATE POLICY "rcat_hr_write" ON reimbursement_categories FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── reimbursement_claims ─────────────────────────────────────────
DROP POLICY IF EXISTS "rcl_hr_write" ON reimbursement_claims;
CREATE POLICY "rcl_hr_write" ON reimbursement_claims FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── requisition_approvals ─────────────────────────────────────────
DROP POLICY IF EXISTS "req_appr_hr_all" ON requisition_approvals;
CREATE POLICY "req_appr_hr_all" ON requisition_approvals FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── shift_roster ─────────────────────────────────────────
DROP POLICY IF EXISTS "sro_hr_write" ON shift_roster;
CREATE POLICY "sro_hr_write" ON shift_roster FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── sites ─────────────────────────────────────────
DROP POLICY IF EXISTS "sites_hr_write" ON sites;
CREATE POLICY "sites_hr_write" ON sites FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── statutory_filing_closures ─────────────────────────────────────────
DROP POLICY IF EXISTS "stat_closure_hr" ON statutory_filing_closures;
CREATE POLICY "stat_closure_hr" ON statutory_filing_closures FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── tax_declarations ─────────────────────────────────────────
DROP POLICY IF EXISTS "td_hr_write" ON tax_declarations;
CREATE POLICY "td_hr_write" ON tax_declarations FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── tax_regime_elections ─────────────────────────────────────────
DROP POLICY IF EXISTS "tre_hr_write" ON tax_regime_elections;
CREATE POLICY "tre_hr_write" ON tax_regime_elections FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── tds_declaration_snapshots ─────────────────────────────────────────
DROP POLICY IF EXISTS "tds_snap_hr_write" ON tds_declaration_snapshots;
CREATE POLICY "tds_snap_hr_write" ON tds_declaration_snapshots FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── tds_monthly_projections ─────────────────────────────────────────
DROP POLICY IF EXISTS "tmp_hr_write" ON tds_monthly_projections;
CREATE POLICY "tmp_hr_write" ON tds_monthly_projections FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── variable_payout_batches ─────────────────────────────────────────
DROP POLICY IF EXISTS "vpb_hr_write" ON variable_payout_batches;
CREATE POLICY "vpb_hr_write" ON variable_payout_batches FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── variable_payouts ─────────────────────────────────────────
DROP POLICY IF EXISTS "vp_hr_write" ON variable_payouts;
CREATE POLICY "vp_hr_write" ON variable_payouts FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── wfh_requests ─────────────────────────────────────────
DROP POLICY IF EXISTS "wfh_hr_all" ON wfh_requests;
CREATE POLICY "wfh_hr_all" ON wfh_requests FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── workforce_event_timeline ─────────────────────────────────────────
DROP POLICY IF EXISTS "wet_hr_insert" ON workforce_event_timeline;
CREATE POLICY "wet_hr_insert" ON workforce_event_timeline FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── workforce_optimization_hints ─────────────────────────────────────────
DROP POLICY IF EXISTS "woh_hr_write" ON workforce_optimization_hints;
CREATE POLICY "woh_hr_write" ON workforce_optimization_hints FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── workforce_shift_balance ─────────────────────────────────────────
DROP POLICY IF EXISTS "wsb_hr_write" ON workforce_shift_balance;
CREATE POLICY "wsb_hr_write" ON workforce_shift_balance FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── workforce_staffing_snapshots ─────────────────────────────────────────
DROP POLICY IF EXISTS "wss_hr_write" ON workforce_staffing_snapshots;
CREATE POLICY "wss_hr_write" ON workforce_staffing_snapshots FOR ALL
  USING    (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'))
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

