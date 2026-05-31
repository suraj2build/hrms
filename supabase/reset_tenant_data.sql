-- ═══════════════════════════════════════════════════════════════════════════
--  TENANT DATA RESET SCRIPT
--  Keeps: tenants row + super_admin profile.
--  Wipes: everything else for the tenant.
--
--  1. Replace <YOUR_TENANT_ID> with your real UUID
--  2. Paste into Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid  UUID  := '<YOUR_TENANT_ID>';   -- ← REPLACE THIS
  v_tbl  TEXT;
  v_n    BIGINT;

  -- Tables deleted in order (child → parent). Missing tables are skipped.
  v_pass1 TEXT[] := ARRAY[
    -- Attendance
    'attendance_raw_logs','attendance_punch_logs','attendance_logs',
    'attendance_daily','attendance_regularisation','attendance_corrections',
    'attendance_anomalies','attendance_exceptions','attendance_compute_log',
    'attendance_processing_runs','attendance_processing_lock',
    'attendance_policy_conflicts','attendance_retroactive_impacts',
    'attendance_risk_profiles','attendance_health_scores',
    'attendance_intelligence_snapshot','attendance_confidence',
    'attendance_inference_log',
    -- Leave transactions
    'leave_applications','leave_requests','comp_off_requests',
    'leave_encashment_requests','leave_accrual_ledger','leave_accrual_runs',
    'leave_balance_ledger','leave_collision_log','employee_leave_balance',
    -- Payroll transactions
    'payroll_explainability_ledger','payroll_accounting_ledger',
    'payroll_variance_approvals','payroll_finalize_overrides',
    'payroll_freeze_log','maker_checker_log','payroll_run_employees',
    'payroll_run_events','payroll_run_failure_summary','payroll_run_blockers',
    'payroll_dept_snapshots','payroll_cost_snapshots','payroll_forecasts',
    'payroll_validation_results','payroll_validation_runs',
    'payroll_reconciliation_runs','payroll_slips','payroll_runs',
    -- Statutory / Tax
    'epf_contributions','epf_eligibility_overrides',
    'esi_contributions','esi_eligibility_timeline',
    'ptax_contributions','tds_monthly_projections',
    'declaration_proofs','tax_declarations','tax_regime_elections',
    -- Pay inputs
    'advance_recoveries','advance_recovery_schedules','advance_salary_requests',
    'reimbursement_attachments','reimbursement_claims',
    'variable_payouts','variable_payout_batches',
    'arrear_payouts','arrear_records','arrear_batches',
    -- Compensation
    'employee_compensation_components','employee_compensations',
    'compensation_revisions','compensation_snapshots',
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
    'employee_optional_holidays','job_history'
  ];

  v_pass2 TEXT[] := ARRAY[
    -- Leave config
    'leave_policy_versions','leave_policy_assignments','leave_policy_rules',
    'leave_policy_masters','leave_policies','leave_types',
    -- Payroll config
    'salary_structure_components','salary_structures','salary_components',
    'payroll_validation_rules','overtime_policies','compensation_policies',
    'incentive_templates','reimbursement_categories',
    -- Workforce masters
    'shift_roster','rosters','shifts','holiday_calendar',
    'optional_holiday_pool','attendance_period_locks',
    'workforce_shift_balance','workforce_optimization_hints',
    'workforce_staffing_snapshots',
    -- Org structure
    'designations','grades','departments','work_locations','cost_centers','sites',
    -- Statutory config
    'epf_config','esi_config','ptax_slabs','ptax_state_config',
    'payroll_statutory_settings',
    -- System / Platform
    'webhook_deliveries','webhooks','integration_audit_log','integration_registry',
    'notifications','hr_events','event_replay_queue','event_log',
    'event_retention_rules','operational_incidents','incident_escalations',
    'incident_timeline_events','incident_comments',
    'approval_workflow_config','regularisation_policy',
    'policy_evaluation_log','policy_change_log',
    'governance_simulations','governance_rollbacks',
    'audit_logs','attendance_devices'
  ];

BEGIN
  -- Safety check
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_tid) THEN
    RAISE EXCEPTION 'Tenant % not found. Run: SELECT id,name FROM tenants;', v_tid;
  END IF;

  RAISE NOTICE 'Starting reset for tenant: %', v_tid;

  -- Break circular FK references
  UPDATE employees   SET manager_id = NULL WHERE tenant_id = v_tid;
  UPDATE departments SET head_id    = NULL WHERE tenant_id = v_tid;

  -- Pass 1: child/transaction tables
  FOREACH v_tbl IN ARRAY v_pass1 LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE  table_schema = 'public' AND table_name = v_tbl
    ) THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', v_tbl) USING v_tid;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pass 1 complete (transactions + employee sub-tables)';

  -- Delete employees
  DELETE FROM employees WHERE tenant_id = v_tid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Employees deleted: %', v_n;

  -- Delete non-admin profiles (keep super_admin login)
  DELETE FROM profiles WHERE tenant_id = v_tid AND role != 'super_admin';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Non-admin profiles deleted: %', v_n;

  -- Pass 2: config + master tables
  FOREACH v_tbl IN ARRAY v_pass2 LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE  table_schema = 'public' AND table_name = v_tbl
    ) THEN
      EXECUTE format('DELETE FROM %I WHERE tenant_id = $1', v_tbl) USING v_tid;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pass 2 complete (config + masters)';

  -- Reset employee code sequence to 0
  UPDATE employee_code_sequences
  SET    last_number = 0, updated_at = now()
  WHERE  tenant_id = v_tid;

  RAISE NOTICE '══════════════════════════════════';
  RAISE NOTICE 'Reset complete for tenant: %', v_tid;
  RAISE NOTICE 'Kept: tenants row + super_admin login';
  RAISE NOTICE '══════════════════════════════════';

END $$;
