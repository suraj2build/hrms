-- ============================================================
-- 114_demo_data_cleanup.sql
--
-- PRODUCTION RESET: Remove ALL demo/sample/mock data rows.
-- Schema, triggers, functions, RLS policies, and admin
-- profiles are fully preserved.
--
-- Scope of deletion:
--   • All operational / transactional records
--   • All employee-linked records + employees themselves
--   • All master/configuration data rows
--     (departments, shifts, salary structures, leave types, etc.)
--   • Employee-role profiles only (admin/hr/manager preserved)
--   • System operational queues / logs
--
-- Preserved:
--   • tenants + tenant config
--   • profiles WHERE role != 'employee'
--   • Platform infrastructure: formula_registry,
--     notification_templates, approval_workflow_config,
--     worker_registry, queue_partitions, webhooks,
--     integration_registry, letter_templates,
--     payroll_validation_rules
--   • All database schema, indexes, functions, triggers, RLS
--
-- Deletion is ordered to respect FK constraints.
-- Multi-tenant safe: clears all tenants uniformly.
-- ============================================================

-- ── 1. AI Onboarding pipeline ─────────────────────────────────────────────────

DELETE FROM onboarding_audit_log;
DELETE FROM draft_employee_fields;
DELETE FROM draft_employee_profiles;
DELETE FROM onboarding_documents;
DELETE FROM onboarding_sessions;

-- ── 2. Import job records ─────────────────────────────────────────────────────

DELETE FROM import_job_rows;
DELETE FROM import_jobs;

-- ── 3. Reimbursements ────────────────────────────────────────────────────────

DELETE FROM reimbursement_attachments;
DELETE FROM reimbursement_claims;
DELETE FROM reimbursement_categories;

-- ── 4. Variable pay ───────────────────────────────────────────────────────────

DELETE FROM variable_payouts;
DELETE FROM variable_payout_batches;
DELETE FROM incentive_templates;

-- ── 5. Loans ─────────────────────────────────────────────────────────────────

DELETE FROM loan_payments;
DELETE FROM loan_schedules;
DELETE FROM employee_loans;

-- ── 6. Advances ───────────────────────────────────────────────────────────────

DELETE FROM advance_recoveries;
DELETE FROM advance_recovery_schedules;
DELETE FROM advance_salary_requests;

-- ── 7. Arrears ────────────────────────────────────────────────────────────────

DELETE FROM arrear_payouts;
DELETE FROM arrear_records;
DELETE FROM arrear_batches;

-- ── 8. TDS ────────────────────────────────────────────────────────────────────

DELETE FROM declaration_proofs;
DELETE FROM tax_declarations;
DELETE FROM tax_regime_elections;
DELETE FROM tds_monthly_projections;

-- ── 9. EPF / ESI / PT ─────────────────────────────────────────────────────────

DELETE FROM epf_contributions;
DELETE FROM epf_eligibility_overrides;
DELETE FROM epf_config;

DELETE FROM esi_contributions;
DELETE FROM esi_eligibility_timeline;
DELETE FROM esi_config;

DELETE FROM ptax_contributions;
DELETE FROM ptax_slabs;
DELETE FROM ptax_state_config;

-- ── 10. Calculation engine trace ─────────────────────────────────────────────

DELETE FROM calculation_trace_log;

-- ── 11. Payroll engine ────────────────────────────────────────────────────────

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

-- ── 12. Compensation ──────────────────────────────────────────────────────────

DELETE FROM compensation_snapshots;
DELETE FROM compensation_revisions;
DELETE FROM employee_compensation_components;
DELETE FROM employee_compensations;
DELETE FROM compensation_policies;

-- ── 13. Attendance ────────────────────────────────────────────────────────────

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

-- ── 14. Leave ─────────────────────────────────────────────────────────────────

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

-- ── 15. HR events, letters, inbox ────────────────────────────────────────────

DELETE FROM hr_events;
DELETE FROM letter_approval_log;
DELETE FROM letter_requests;
DELETE FROM generated_letters;
DELETE FROM notifications;
DELETE FROM notification_log;
DELETE FROM inbox_escalations;
DELETE FROM inbox_items;

-- ── 16. Incidents & governance ────────────────────────────────────────────────

DELETE FROM incident_comments;
DELETE FROM incident_timeline_events;
DELETE FROM incident_escalations;
DELETE FROM operational_incidents;
DELETE FROM governance_simulations;
DELETE FROM governance_rollbacks;
DELETE FROM operational_overrides;
DELETE FROM approval_matrices;
DELETE FROM approval_delegations;

-- ── 17. Approval instances ────────────────────────────────────────────────────

DELETE FROM approval_actions;
DELETE FROM approval_instances;

-- ── 18. Event log & orchestration queues ─────────────────────────────────────

DELETE FROM event_replay_queue;
DELETE FROM event_log;
DELETE FROM long_running_jobs;

-- ── 19. Overtime ──────────────────────────────────────────────────────────────

DELETE FROM overtime_requests;
DELETE FROM employee_overtime_policies;
DELETE FROM overtime_policies;

-- ── 20. Employee extended profile data ───────────────────────────────────────

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

-- ── 21. Employees ─────────────────────────────────────────────────────────────

DELETE FROM employees;

-- ── 22. Employee code sequences — reset counters ─────────────────────────────
-- Sequence infrastructure (table + function) is preserved;
-- only the counter rows are removed so SK0001 is issued next.

-- Table created in migration 115; guard against fresh-install ordering
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee_code_sequences'
  ) THEN
    DELETE FROM employee_code_sequences;
  END IF;
END;
$$;

-- ── 23. Org & site masters ────────────────────────────────────────────────────

DELETE FROM shift_roster;
DELETE FROM holiday_calendar;
DELETE FROM rosters;
DELETE FROM sites;
DELETE FROM work_locations;
DELETE FROM cost_centers;
DELETE FROM departments;
DELETE FROM designations;
DELETE FROM grades;

-- ── 24. Shift masters ────────────────────────────────────────────────────────

DELETE FROM shifts;

-- ── 25. Salary masters ────────────────────────────────────────────────────────

DELETE FROM salary_structure_components;
DELETE FROM salary_structures;
DELETE FROM salary_components;

-- ── 26. Leave type masters ────────────────────────────────────────────────────

DELETE FROM leave_types;

-- ── 27. Enterprise operational masters ───────────────────────────────────────

DELETE FROM payroll_groups;
DELETE FROM statutory_groups;
DELETE FROM employment_categories;
DELETE FROM asset_categories;

-- ── 28. Document / identity / relationship type masters ──────────────────────

DELETE FROM identity_types;
DELETE FROM document_types;
DELETE FROM relationship_types;

-- ── 29. Employee-role profiles ────────────────────────────────────────────────

DELETE FROM profiles WHERE role = 'employee';

-- ── 30. Webhook delivery history ─────────────────────────────────────────────

DELETE FROM webhook_deliveries;
DELETE FROM integration_audit_log;

-- ── 31. Idempotency keys & audit logs ────────────────────────────────────────

DELETE FROM idempotency_keys;
DELETE FROM audit_logs;

-- Done
DO $$ BEGIN
  RAISE NOTICE '114_demo_data_cleanup complete. Platform schema, admin accounts, and infrastructure preserved.';
END; $$;
