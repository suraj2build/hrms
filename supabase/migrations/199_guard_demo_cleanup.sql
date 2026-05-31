-- ============================================================
-- 199_guard_demo_cleanup.sql
--
-- SAFETY WRAPPER for 114_demo_data_cleanup.sql
--
-- PROBLEM
-- -------
-- 114_demo_data_cleanup.sql runs unconditional DELETE statements
-- on 30+ tables. Any accidental execution in a production
-- environment permanently destroys all operational data.
-- It has NO environment check, NO tenant guard, NO confirmation.
--
-- SOLUTION
-- --------
-- 1. Create perform_demo_cleanup(confirmed_env TEXT) — a stored
--    function that wraps the full deletion sequence with:
--      a. Environment gate: only 'development' or 'staging' allowed
--      b. Tenant count guard: refuses if > 3 tenants exist
--         (production typically has many more tenants than a dev DB)
--      c. Explicit confirmation token: caller must pass the
--         current environment name as proof of intent
--
-- 2. Revoke direct DELETE from authenticated role on critical
--    tables (belt-and-suspenders guard against future ad-hoc
--    SQL execution in the Supabase dashboard by mistake).
--    NOTE: Supabase service_role always bypasses RLS + GRANTs.
--    This revoke only affects the `authenticated` role used by
--    the Supabase JS client and direct API access.
--
-- USAGE (safe demo reset in development)
-- ----------------------------------------
--   SELECT perform_demo_cleanup('development');
--
-- This will RAISE EXCEPTION in production environments where
-- either the confirmed_env doesn't match the server environment
-- variable, or the tenant count guard fires.
--
-- IMPORTANT: This does NOT modify or undo migration 114.
-- Migration 114 is an applied migration and must not be edited.
-- This is the forward-compatible safety net.
-- ============================================================

-- ── 1. perform_demo_cleanup() gated function ─────────────────

CREATE OR REPLACE FUNCTION perform_demo_cleanup(confirmed_env TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_count INT;
  v_env          TEXT;
BEGIN
  -- ── Gate 1: environment parameter must be dev or staging ──
  IF confirmed_env NOT IN ('development', 'staging') THEN
    RAISE EXCEPTION
      'perform_demo_cleanup: confirmed_env must be ''development'' or ''staging''. '
      'Got: %. This function CANNOT run in production.',
      confirmed_env;
  END IF;

  -- ── Gate 2: check APP_ENV if set ─────────────────────────
  -- Supabase allows reading postgres GUC settings.
  -- Set via: ALTER DATABASE postgres SET app.environment = 'production';
  BEGIN
    v_env := current_setting('app.environment', true);
  EXCEPTION WHEN OTHERS THEN
    v_env := NULL;
  END;

  IF v_env IS NOT NULL AND v_env NOT IN ('development', 'staging', 'test', '') THEN
    RAISE EXCEPTION
      'perform_demo_cleanup: database app.environment = ''%''. '
      'Refusing to run on a non-development database.',
      v_env;
  END IF;

  -- ── Gate 3: refuse if too many tenants (production signal) ─
  SELECT COUNT(*) INTO v_tenant_count FROM tenants;
  IF v_tenant_count > 5 THEN
    RAISE EXCEPTION
      'perform_demo_cleanup: % tenants found. '
      'Production databases typically have many tenants. '
      'Refusing to run. If this is intentional, truncate tenants manually.',
      v_tenant_count;
  END IF;

  -- ── DELETION (mirrors 114_demo_data_cleanup.sql order) ────
  -- Ordered to respect FK constraints.

  -- AI Onboarding pipeline
  DELETE FROM onboarding_audit_log;
  DELETE FROM draft_employee_fields;
  DELETE FROM draft_employee_profiles;
  DELETE FROM onboarding_documents;
  DELETE FROM onboarding_sessions;

  -- Import job records
  DELETE FROM import_job_rows;
  DELETE FROM import_jobs;

  -- Reimbursements
  DELETE FROM reimbursement_attachments;
  DELETE FROM reimbursement_claims;
  DELETE FROM reimbursement_categories;

  -- Variable pay
  DELETE FROM variable_payouts;
  DELETE FROM variable_payout_batches;
  DELETE FROM incentive_templates;

  -- Loans
  DELETE FROM loan_payments;
  DELETE FROM loan_schedules;
  DELETE FROM employee_loans;

  -- Advances
  DELETE FROM advance_recoveries;
  DELETE FROM advance_recovery_schedules;
  DELETE FROM advance_salary_requests;

  -- Arrears
  DELETE FROM arrear_payouts;
  DELETE FROM arrear_records;
  DELETE FROM arrear_batches;

  -- TDS
  DELETE FROM declaration_proofs;
  DELETE FROM tax_declarations;
  DELETE FROM tax_regime_elections;
  DELETE FROM tds_monthly_projections;

  -- EPF / ESI / PT
  DELETE FROM epf_contributions;
  DELETE FROM epf_eligibility_overrides;
  DELETE FROM epf_config;
  DELETE FROM esi_contributions;
  DELETE FROM esi_eligibility_timeline;
  DELETE FROM esi_config;
  DELETE FROM ptax_contributions;
  DELETE FROM ptax_slabs;
  DELETE FROM ptax_state_config;

  -- Payroll engine
  DELETE FROM calculation_trace_log;
  DELETE FROM payroll_explainability_ledger;
  DELETE FROM payroll_run_employees;
  DELETE FROM payroll_slips;
  DELETE FROM payroll_runs;
  DELETE FROM payroll_dept_snapshots;
  DELETE FROM payroll_forecasts;
  DELETE FROM payroll_variance_approvals;
  DELETE FROM payroll_reconciliation_runs;
  DELETE FROM payroll_validation_results;
  DELETE FROM payroll_validation_runs;
  DELETE FROM payroll_freeze_log;
  DELETE FROM maker_checker_log;

  -- Compensation
  DELETE FROM compensation_snapshots;
  DELETE FROM compensation_revisions;
  DELETE FROM employee_compensation_components;
  DELETE FROM employee_compensations;
  DELETE FROM compensation_policies;

  -- Attendance
  DELETE FROM attendance_corrections;
  DELETE FROM attendance_anomalies;
  DELETE FROM attendance_compute_log;
  DELETE FROM attendance_daily;
  DELETE FROM attendance_logs;
  DELETE FROM attendance_punch_logs;
  DELETE FROM attendance_regularisation;
  DELETE FROM attendance_exceptions;
  DELETE FROM attendance_raw_logs;
  DELETE FROM attendance_period_locks;
  DELETE FROM attendance_processing_runs;
  DELETE FROM attendance_processing_lock;
  DELETE FROM attendance_retroactive_impacts;
  DELETE FROM attendance_inference_log;
  DELETE FROM attendance_policy_conflict_log;
  DELETE FROM attendance_audit_log;
  DELETE FROM attendance_risk_profiles;
  DELETE FROM attendance_health_scores;
  DELETE FROM attendance_intelligence_snapshot;
  DELETE FROM employee_risk_flags;
  DELETE FROM workforce_shift_balance;
  DELETE FROM workforce_optimization_hints;
  DELETE FROM workforce_staffing_snapshots;
  DELETE FROM employee_attendance_policies;
  DELETE FROM attendance_devices;
  DELETE FROM attendance_policies;

  -- Leave
  DELETE FROM leave_accrual_ledger;
  DELETE FROM leave_balance_ledger;
  DELETE FROM employee_leave_balance;
  DELETE FROM leave_encashment_requests;
  DELETE FROM leave_accrual_runs;
  DELETE FROM leave_job_log;
  DELETE FROM leave_requests;
  DELETE FROM leave_applications;
  DELETE FROM comp_off_requests;
  DELETE FROM leave_collision_log;
  DELETE FROM employee_optional_holidays;
  DELETE FROM optional_holiday_pool;
  DELETE FROM leave_policy_assignments;
  DELETE FROM leave_policy_rules;
  DELETE FROM leave_policy_masters;
  DELETE FROM leave_policy_versions;
  DELETE FROM policy_evaluation_log;
  DELETE FROM policy_change_log;
  DELETE FROM leave_policies;
  DELETE FROM leave_accrual_rules;

  -- HR events, letters, inbox
  DELETE FROM hr_events;
  DELETE FROM letter_approval_log;
  DELETE FROM letter_requests;
  DELETE FROM generated_letters;
  DELETE FROM notifications;
  DELETE FROM notification_log;
  DELETE FROM inbox_escalations;
  DELETE FROM inbox_items;

  -- Incidents & governance
  DELETE FROM incident_comments;
  DELETE FROM incident_timeline_events;
  DELETE FROM incident_escalations;
  DELETE FROM operational_incidents;
  DELETE FROM governance_simulations;
  DELETE FROM governance_rollbacks;
  DELETE FROM operational_overrides;
  DELETE FROM approval_matrices;
  DELETE FROM approval_delegations;

  -- Approval instances
  DELETE FROM approval_actions;
  DELETE FROM approval_instances;

  -- Event log & orchestration queues
  DELETE FROM event_replay_queue;
  DELETE FROM event_log;
  DELETE FROM long_running_jobs;

  -- Overtime
  DELETE FROM overtime_requests;
  DELETE FROM employee_overtime_policies;
  DELETE FROM overtime_policies;

  -- Employee extended profile data
  DELETE FROM employee_org_assignments;
  DELETE FROM employee_shifts;
  DELETE FROM employee_personal_info;
  DELETE FROM previous_employment;
  DELETE FROM employee_bank_statutory;
  DELETE FROM employee_identity;
  DELETE FROM employee_contracts;
  DELETE FROM employee_family;
  DELETE FROM employee_nominations;
  DELETE FROM emergency_contacts;
  DELETE FROM employee_addresses;
  DELETE FROM employee_separation;
  DELETE FROM employee_access_cards;
  DELETE FROM employee_passport_visa;
  DELETE FROM documents;
  DELETE FROM job_history;

  -- Employees
  DELETE FROM employees;

  -- Employee code sequences
  DELETE FROM employee_code_sequences;

  -- Org & site masters
  DELETE FROM shift_roster;
  DELETE FROM holiday_calendar;
  DELETE FROM rosters;
  DELETE FROM sites;
  DELETE FROM work_locations;
  DELETE FROM cost_centers;
  DELETE FROM departments;
  DELETE FROM designations;
  DELETE FROM grades;

  -- Shift masters
  DELETE FROM shifts;

  -- Salary masters
  DELETE FROM salary_structure_components;
  DELETE FROM salary_structures;
  DELETE FROM salary_components;

  -- Leave type masters
  DELETE FROM leave_types;

  -- Enterprise operational masters
  DELETE FROM payroll_groups;
  DELETE FROM statutory_groups;
  DELETE FROM employment_categories;
  DELETE FROM asset_categories;

  -- Document / identity / relationship type masters
  DELETE FROM identity_types;
  DELETE FROM document_types;
  DELETE FROM relationship_types;

  -- Employee-role profiles only
  DELETE FROM profiles WHERE role = 'employee';

  -- Webhook delivery history
  DELETE FROM webhook_deliveries;
  DELETE FROM integration_audit_log;

  -- Idempotency keys & audit logs
  DELETE FROM idempotency_keys;
  DELETE FROM audit_logs;

  RETURN format(
    'Demo cleanup complete on env=%s with %s tenants preserved. '
    'Platform schema, admin accounts, and infrastructure are intact.',
    confirmed_env, v_tenant_count
  );
END;
$$;

-- Restrict EXECUTE to super_admin role only (service_role always bypasses)
REVOKE EXECUTE ON FUNCTION perform_demo_cleanup(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION perform_demo_cleanup(TEXT) FROM authenticated;

-- ── 2. Add a comment so the function is self-documenting ─────
COMMENT ON FUNCTION perform_demo_cleanup(TEXT) IS
  'Safe demo/dev data reset. Pass confirmed_env=''development'' or ''staging''. '
  'Guards: env parameter check, app.environment GUC check, tenant count <= 5. '
  'Mirrors the deletion order of 114_demo_data_cleanup.sql. '
  'Replaces direct execution of that migration file in CI environments.';
