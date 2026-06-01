-- ═══════════════════════════════════════════════════════════════════════════
--  TENANT DATA RESET SCRIPT  (v2 — updated for migrations 001-205)
--
--  Keeps: tenants row + super_admin profile + platform tables
--  Wipes: ALL operational data for the tenant
--
--  Usage:
--    1. Run:  SELECT id, name FROM tenants;   ← find your tenant UUID
--    2. Replace <YOUR_TENANT_ID> below
--    3. Paste into Supabase → SQL Editor → Run
--
--  Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid  UUID  := '<YOUR_TENANT_ID>';   -- ← REPLACE THIS
  v_tbl  TEXT;
  v_n    BIGINT;

  -- ── PASS 1: Transaction / leaf tables (child → parent order) ──────────────
  v_pass1 TEXT[] := ARRAY[
    -- Attendance transactions
    'attendance_raw_logs','attendance_punch_logs','attendance_logs',
    'attendance_daily','attendance_regularisation','attendance_corrections',
    'attendance_anomalies','attendance_exceptions','attendance_compute_log',
    'attendance_processing_runs','attendance_processing_lock',
    'attendance_policy_conflicts','attendance_retroactive_impacts',
    'attendance_risk_profiles','attendance_health_scores',
    'attendance_intelligence_snapshot','attendance_confidence',
    'attendance_inference_log','attendance_freshness_snapshots',
    'attendance_processing_states','attendance_reconciliation_issues',
    'attendance_reconciliation_runs',
    -- Work sessions
    'work_sessions','work_session_anomalies',
    -- Leave transactions
    'leave_applications','leave_requests','comp_off_requests',
    'leave_encashment_requests','leave_accrual_ledger','leave_accrual_runs',
    'leave_balance_ledger','leave_collision_log','employee_leave_balance',
    'leave_accrual_freezes','leave_event_grants','leave_entitlement_releases',
    'leave_reconciliation_issues','leave_reconciliation_reports',
    'leave_reconciliation_runs','leave_policy_snapshots',
    -- Payroll transactions
    'payroll_explainability_ledger','payroll_accounting_ledger',
    'payroll_variance_approvals','payroll_finalize_overrides',
    'payroll_freeze_log','maker_checker_log','payroll_run_employees',
    'payroll_run_events','payroll_run_failure_summary','payroll_run_blockers',
    'payroll_dept_snapshots','payroll_cost_snapshots','payroll_forecasts',
    'payroll_validation_results','payroll_validation_runs',
    'payroll_reconciliation_runs','payroll_slips','payroll_runs',
    'payroll_adjustments','payroll_cost_allocations','payroll_employee_snapshots',
    'payroll_financial_ledgers','payroll_gl_mappings','payroll_ledger_entries',
    'payroll_payout_reconciliation','payroll_period_states',
    'payroll_reconciliation_actions','payroll_replay_sessions',
    'payroll_run_snapshots','simulation_runs','retroactive_rebuild_queue',
    -- Statutory / Tax
    'epf_contributions','epf_eligibility_overrides',
    'esi_contributions','esi_eligibility_timeline',
    'ptax_contributions','tds_monthly_projections','tds_monthly_recovery',
    'declaration_proofs','tax_declarations','tax_regime_elections',
    'tax_declaration_components','tax_declaration_plan_items','tax_declaration_plans',
    'tax_projection_reconciliation','tds_bulk_operation_log',
    'tds_declaration_audit_log','tds_declaration_snapshots',
    'statutory_audit_log','statutory_registrations',
    'previous_employment_tax_details','hra_declarations',
    'employee_statutory_overrides',
    -- Pay inputs
    'advance_recoveries','advance_recovery_schedules','advance_salary_requests',
    'reimbursement_attachments','reimbursement_claims',
    'variable_payouts','variable_payout_batches',
    'arrear_payouts','arrear_records','arrear_batches',
    -- Compensation
    'employee_compensation_components','employee_compensations',
    'compensation_revisions','compensation_snapshots',
    -- Verification / Trust
    'verification_events','verification_records',
    'duplicate_detection_events','workforce_trust_scores',
    'workforce_graph_edges','workforce_event_timeline',
    'workforce_rebuild_events','workforce_reconciliation_issues',
    'workforce_reconciliation_runs',
    -- Governance / Compliance
    'compliance_evaluations','compliance_evidence_snapshots','compliance_controls',
    'compliance_revision_events','governance_drift_events',
    'governance_risk_scores','governance_rules',
    'governance_simulations','governance_rollbacks',
    -- Documents / Letters / Onboarding
    'documents','letter_approval_log','generated_letters',
    'letter_approval_chains','letter_templates',
    'onboarding_audit_log','onboarding_documents','onboarding_sessions',
    'draft_employee_fields','draft_employee_profiles',
    -- Approvals
    'approval_actions','approval_instances',
    'approval_delegations','approval_matrices',
    -- Employee sub-tables
    'employee_risk_flags','employee_personal_info','previous_employment',
    'employee_bank_statutory','employee_identity','employee_contracts',
    'employee_family','employee_nominations','emergency_contacts',
    'employee_addresses','employee_separation','employee_access_cards',
    'employee_passport_visa','employee_shifts','employee_org_assignments',
    'employee_overtime_policies','employee_attendance_policies',
    'employee_optional_holidays','employee_important_dates','job_history',
    -- Intelligence / Analytics snapshots
    'enterprise_health_snapshots','intelligence_compositions',
    'operational_health_signals','operational_heatmap_snapshots',
    'orchestration_activity_logs','automation_activity_logs',
    'decision_graph_nodes','decision_graph_edges',
    'sla_breach_events','replay_sessions',
    -- Platform events / observability (tenant-scoped)
    'platform_events','api_usage_log','upload_sessions',
    'muster_uploads','scheduler_job_log','background_jobs','background_job_results',
    -- Security / PII
    'pii_access_log','secret_access_audit','credential_rotation_log',
    'security_intelligence_events','erasure_requests','retention_enforcement_runs',
    'data_field_classifications'
  ];

  -- ── PASS 2: Config / master tables ────────────────────────────────────────
  v_pass2 TEXT[] := ARRAY[
    -- Leave config
    'leave_policy_versions','leave_policy_assignments','leave_policy_rules',
    'leave_policy_masters','leave_policies','leave_types','leave_accrual_tiers',
    'leave_scheduler_state',
    -- Payroll config
    'salary_structure_components','salary_structures','salary_components',
    'payroll_validation_rules','overtime_policies','compensation_policies',
    'incentive_templates','reimbursement_categories','payroll_groups',
    'payroll_statutory_settings','statutory_groups',
    -- Tax config
    'tds_governance_settings','hra_governance_settings',
    'it_standard_config','it_tax_slabs','ptax_state_settings','ptax_slabs',
    'epf_config','esi_config',
    -- Workforce / roster masters
    'roster_holiday_groups','roster_rotation_groups','roster_rotation_members',
    'roster_weekly_off_rules','rotation_policies','rotation_policy_rules',
    'shift_segments','shift_roster','rosters','shifts',
    'holiday_calendar','optional_holiday_pool','attendance_period_locks',
    'workforce_shift_balance','workforce_optimization_hints',
    'workforce_staffing_snapshots',
    -- Org structure
    'designations','grades','departments','work_locations',
    'cost_centers','sites','employment_categories','asset_categories',
    'important_date_types',
    -- System / Platform (tenant-scoped)
    'webhook_deliveries','webhooks','integration_audit_log','integration_registry',
    'notifications','hr_events','event_replay_queue','event_log',
    'event_retention_rules','operational_incidents','incident_escalations',
    'incident_timeline_events','incident_comments',
    'approval_workflow_config','regularisation_policy',
    'policy_evaluation_log','policy_change_log',
    'audit_logs','attendance_devices','tenant_api_keys',
    'tenant_billing_snapshots','scheduler_heartbeats'
  ];

BEGIN
  -- ── Safety check ────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_tid) THEN
    RAISE EXCEPTION 'Tenant % not found. Run: SELECT id, name FROM tenants;', v_tid;
  END IF;

  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE 'Starting reset for tenant: %', v_tid;
  RAISE NOTICE '══════════════════════════════════════════════';

  -- ── Break circular FK references ────────────────────────────────────────
  UPDATE employees   SET manager_id = NULL WHERE tenant_id = v_tid;
  UPDATE departments SET head_id    = NULL WHERE tenant_id = v_tid;

  -- ── Pass 1: transaction + leaf tables ───────────────────────────────────
  FOREACH v_tbl IN ARRAY v_pass1 LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', v_tbl) USING v_tid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        RAISE NOTICE '  ✓ %-45s  % rows', v_tbl, v_n;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pass 1 complete (transactions + employee sub-tables)';

  -- ── Delete employees ─────────────────────────────────────────────────────
  DELETE FROM employees WHERE tenant_id = v_tid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  ✓ employees deleted: %', v_n;

  -- ── Delete non-admin profiles (keep super_admin login) ──────────────────
  DELETE FROM profiles WHERE tenant_id = v_tid AND role NOT IN ('super_admin','hr_admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '  ✓ non-admin profiles deleted: %', v_n;

  -- ── Pass 2: config + master tables ──────────────────────────────────────
  FOREACH v_tbl IN ARRAY v_pass2 LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', v_tbl) USING v_tid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        RAISE NOTICE '  ✓ %-45s  % rows', v_tbl, v_n;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pass 2 complete (config + masters)';

  -- ── Reset employee code sequence ─────────────────────────────────────────
  UPDATE employee_code_sequences
  SET    last_number = 0, updated_at = now()
  WHERE  tenant_id = v_tid;

  RAISE NOTICE '══════════════════════════════════════════════';
  RAISE NOTICE 'Reset COMPLETE for tenant: %', v_tid;
  RAISE NOTICE 'Kept  : tenants row + super_admin/hr_admin profiles';
  RAISE NOTICE 'Wiped : all employees, attendance, payroll, leave,';
  RAISE NOTICE '        statutory, compensation, masters, config';
  RAISE NOTICE '══════════════════════════════════════════════';

END $$;
