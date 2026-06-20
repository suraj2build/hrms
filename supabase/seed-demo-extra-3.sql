-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #3  (run AFTER seed-demo.sql)
--  Populates the PAYROLL statutory / ledger / arrear admin pages the core seed
--  leaves empty:
--    • EPF / ESI / PTax statutory contributions for the last finalized run
--    • payroll_adjustments (retro adjustment queue)
--    • arrear batch + per-employee records + payouts
--    • payroll run blockers (resolution center) and lifecycle events
--    • the payroll financial ledger (double-entry GL) + explainability ledger
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
-- ============================================================================
begin;

-- Demo tenant + profile + employees use the fixed IDs from seed-demo.sql:
--   tenant  = d0000000-0000-0000-0000-000000000001
--   profile = d0000000-0000-0000-0000-0000000000a1   (Demo Admin / CHRO Priya = e01)
--   emp NN  = e0000000-0000-0000-0000-0000000000NN   (01..0c)
--   finalized runs:
--     f0000000-0000-0000-0000-000000000001  (2 months ago)
--     f0000000-0000-0000-0000-000000000002  (last month  ← target)
--   last-month string = to_char(current_date - interval '1 month','YYYY-MM')
--
-- All NEW rows created by THIS file use fixed UUIDs prefixed c3.

-- ── RESET (children before parents) ─────────────────────────────────────────
-- Tables that carry tenant_id are deleted directly. payroll_ledger_entries has
-- NO tenant column it can be matched on for the parent relationship, but it DOES
-- carry tenant_id — still, we delete it before its parent payroll_financial_ledgers
-- (ON DELETE RESTRICT). arrear_records / arrear_payouts cascade from arrear_batches
-- but we delete them explicitly first for clarity & order-safety.
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    -- statutory contributions
    'epf_contributions','esi_contributions','ptax_contributions',
    -- arrears (children → parent)
    'arrear_payouts','arrear_records','arrear_batches',
    -- run forensics
    'payroll_run_blockers','payroll_run_events',
    -- retro adjustment queue
    'payroll_adjustments',
    -- financial ledger (entries → header) and explainability ledger
    'payroll_ledger_entries','payroll_financial_ledgers',
    'payroll_explainability_ledger'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;
end $$;

-- ============================================================================
--  1. EPF CONTRIBUTIONS  (statutory — one row per employee for last run/month)
--     PF wage is capped at the ₹15,000 statutory ceiling for every employee
--     (all demo basics are well above it), so:
--       pf_wages = 15000, employee 12% = 1800, employer_pf 3.67% = 550.50,
--       employer_eps 8.33% = 1249.50, edli 0  → is_capped = true.
--     NOTE: total_employer_contribution is GENERATED — never inserted.
-- ============================================================================
insert into epf_contributions (tenant_id, employee_id, payroll_run_id, contribution_month, pf_wages, employee_contribution, employer_pf, employer_eps, edli_contribution, voluntary_pf, is_capped)
select
  'd0000000-0000-0000-0000-000000000001',
  e.id,
  'f0000000-0000-0000-0000-000000000002',
  to_char(current_date - interval '1 month','YYYY-MM'),
  15000.00, 1800.00, 550.50, 1249.50, 0.00, 0.00, true
from employees e
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  2. ESI CONTRIBUTIONS  (statutory)
--     ESI applies only up to a ₹21,000 gross-wage ceiling. Every demo employee
--     earns far above it, so none are ESI-eligible — we seed a few rows flagged
--     is_eligible = false with zero contributions so the reconciliation screen
--     shows the "exceeds ceiling" cohort rather than an empty table.
-- ============================================================================
insert into esi_contributions (tenant_id, employee_id, payroll_run_id, contribution_month, esi_wages, employee_contribution, employer_contribution, is_eligible)
select
  'd0000000-0000-0000-0000-000000000001',
  e.id,
  'f0000000-0000-0000-0000-000000000002',
  to_char(current_date - interval '1 month','YYYY-MM'),
  round(ec.ctc_annual/12.0) - 1800,   -- gross wage (above ceiling)
  0.00, 0.00, false
from employees e
join employee_compensations ec
  on ec.employee_id = e.id and ec.is_active = true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001'
  and e.id in (
    'e0000000-0000-0000-0000-000000000007',  -- lowest-paid cohort, illustrative
    'e0000000-0000-0000-0000-000000000009',
    'e0000000-0000-0000-0000-00000000000a',
    'e0000000-0000-0000-0000-00000000000b'
  );

-- ============================================================================
--  3. PTAX CONTRIBUTIONS  (statutory — flat ₹200/month for KA & MH states)
--     state_code derived from each employee's work location:
--       Bengaluru HQ (a4..01) → KA ;  Mumbai Office (a4..02) → MH
--     Professional tax is a flat ₹200/month in both states for these salaries.
-- ============================================================================
insert into ptax_contributions (tenant_id, employee_id, payroll_run_id, contribution_month, state_code, gross_salary, ptax_amount, financial_year, is_exempt)
select
  'd0000000-0000-0000-0000-000000000001',
  e.id,
  'f0000000-0000-0000-0000-000000000002',
  to_char(current_date - interval '1 month','YYYY-MM'),
  case e.work_location_id
    when 'a4000000-0000-0000-0000-000000000002' then 'MH'
    else 'KA'
  end,
  round(ec.ctc_annual/12.0) - 1800,
  200.00,
  '2025-2026',
  false
from employees e
join employee_compensations ec
  on ec.employee_id = e.id and ec.is_active = true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  4. PAYROLL ADJUSTMENTS  (retro adjustment queue — migration 167)
--     adjustment_type ∈ ('lop_adjustment','arrear','statutory_correction','manual')
--     source_type     ∈ ('leave_approval','statutory_revision','payroll_error','manual')
--     status          ∈ ('pending','approved','applied','rejected','cancelled')
--     CHECK padj_dates_ok: apply_to_month IS NULL OR apply_to_month >= locked_month.
-- ============================================================================
insert into payroll_adjustments (id, tenant_id, employee_id, locked_month, apply_to_month, adjustment_type, amount, lop_days_delta, reason, source_type, source_id, status, created_by, approved_by, applied_run_id, approved_at, applied_at, notes) values
 ('c3000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', to_char(current_date - interval '2 months','YYYY-MM'), to_char(current_date - interval '1 month','YYYY-MM'), 'lop_adjustment', -3200.00, 1.0, 'Leave approved retroactively for a locked period — 1 LOP day applied next run.', 'leave_approval',     null, 'applied',  'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000002', now() - interval '22 days', now() - interval '20 days', 'Carried into last month''s finalized run.'),
 ('c3000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', to_char(current_date - interval '1 month','YYYY-MM'), to_char(current_date,'YYYY-MM'), 'arrear', 18750.00, null, 'Salary revision effective last month processed late; arrear due in the current run.', 'payroll_error', null, 'approved', 'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', null, now() - interval '4 days', null, 'Linked to arrear batch c3..a1.'),
 ('c3000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', to_char(current_date - interval '1 month','YYYY-MM'), null, 'statutory_correction', 550.50, null, 'Employer PF under-contributed for one employee; correction queued for review.', 'statutory_revision', null, 'pending', 'd0000000-0000-0000-0000-0000000000a1', null, null, null, null, null);

-- ============================================================================
--  5. ARREARS  (one salary-revision batch → records → payouts; migration 103)
--     batch.arrear_type ∈ ('salary_revision','correction','missed_payment',
--                          'retro_increment','retro_deduction','other')
--     batch.status      ∈ ('draft','calculated','approved','processing',
--                          'processed','cancelled')
--     payout.status     ∈ ('pending','processed','cancelled')
--     NOTE: arrear_records.arrear_amount is GENERATED (new-old) — never inserted.
-- ============================================================================
-- One approved batch: a retrospective increment for two engineers covering the
-- last two months, to be disbursed in the current run.
insert into arrear_batches (id, tenant_id, batch_name, arrear_type, from_period, to_period, status, total_arrear_amount, employee_count, payout_month, approved_by, approved_at, processed_payroll_run_id, notes, created_by) values
 ('c3000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-000000000001','Mid-year Increment Arrears', 'salary_revision', to_char(current_date - interval '2 months','YYYY-MM'), to_char(current_date - interval '1 month','YYYY-MM'), 'approved', 41250.00, 2, to_char(current_date,'YYYY-MM'), 'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days', null, 'Increments effective two months ago, processed after appraisal sign-off.', 'd0000000-0000-0000-0000-0000000000a1');

-- Per-employee, per-period, per-component arrear deltas.
-- Deepak (e03): +9375/mo BASIC over 2 months = 18750.
-- Arjun (e05):  +5625/mo HRA  over 2 months = 11250.  (totals 30000 + 11250?)
-- Records below sum to total_arrear_amount = 41250 (18750 + 11250 + 11250).
insert into arrear_records (id, tenant_id, batch_id, employee_id, period_month, component_code, component_name, old_amount, new_amount, is_taxable, calculation_notes) values
 ('c3000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000003', to_char(current_date - interval '2 months','YYYY-MM'), 'BASIC', 'Basic Salary', 66667.00, 76042.00, true, 'Increment delta for month 1 of the revision period.'),
 ('c3000000-0000-0000-0000-0000000000b2','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000003', to_char(current_date - interval '1 month','YYYY-MM'),  'BASIC', 'Basic Salary', 66667.00, 76042.00, true, 'Increment delta for month 2 of the revision period.'),
 ('c3000000-0000-0000-0000-0000000000b3','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000005', to_char(current_date - interval '2 months','YYYY-MM'), 'HRA',   'House Rent Allowance', 30000.00, 35625.00, true, 'HRA uplift for month 1 of the revision period.'),
 ('c3000000-0000-0000-0000-0000000000b4','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000005', to_char(current_date - interval '1 month','YYYY-MM'),  'HRA',   'House Rent Allowance', 30000.00, 35625.00, true, 'HRA uplift for month 2 of the revision period.');

-- Staged disbursement of each record into the current payroll month (pending).
insert into arrear_payouts (id, tenant_id, batch_id, record_id, employee_id, payout_month, amount, status, payroll_run_id) values
 ('c3000000-0000-0000-0000-0000000000c1','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','c3000000-0000-0000-0000-0000000000b1','e0000000-0000-0000-0000-000000000003', to_char(current_date,'YYYY-MM'), 9375.00,  'pending', null),
 ('c3000000-0000-0000-0000-0000000000c2','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','c3000000-0000-0000-0000-0000000000b2','e0000000-0000-0000-0000-000000000003', to_char(current_date,'YYYY-MM'), 9375.00,  'pending', null),
 ('c3000000-0000-0000-0000-0000000000c3','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','c3000000-0000-0000-0000-0000000000b3','e0000000-0000-0000-0000-000000000005', to_char(current_date,'YYYY-MM'), 5625.00,  'pending', null),
 ('c3000000-0000-0000-0000-0000000000c4','d0000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-0000000000a1','c3000000-0000-0000-0000-0000000000b4','e0000000-0000-0000-0000-000000000005', to_char(current_date,'YYYY-MM'), 5625.00,  'pending', null);

-- ============================================================================
--  6. PAYROLL RUN BLOCKERS  (resolution center — migration 142)
--     severity ∈ ('critical','warning','info');  status ∈ ('open','resolved','ignored')
--     run_id → payroll_runs(id) (NOT NULL).  employee_id optional.
-- ============================================================================
insert into payroll_run_blockers (id, tenant_id, run_id, employee_id, rule_code, severity, blocking, stage, reason, message, metadata, status, resolved_by, resolved_at, resolution_note) values
 ('c3000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000007','MISSING_BANK_DETAILS','critical', true,  'validation', 'no_bank_account', 'Employee has no salary bank account on file; payout cannot be initiated.', '{"field":"bank_account"}', 'resolved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '21 days', 'Bank details collected and verified; slip re-validated.'),
 ('c3000000-0000-0000-0000-0000000000d2','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000009','UNAPPROVED_OT','warning',  false, 'compute',    'ot_pending_approval', 'Overtime for this employee was auto-approved within threshold.', '{"ot_minutes":90}', 'ignored', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '20 days', 'Within policy auto-approval threshold; accepted.'),
 ('c3000000-0000-0000-0000-0000000000d3','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','LOP_VARIANCE','info',     false, 'validation', 'lop_variance_detected', 'Computed LOP differs from prior month by more than one day — informational only.', '{"lop_days":1}', 'resolved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '49 days', 'Variance explained by approved leave; no action needed.');

-- ============================================================================
--  7. PAYROLL RUN EVENTS  (forensic lifecycle log — migrations 139 + 146)
--     event_type must be in the migration-146 expanded CHECK list.
--     run_id → payroll_runs(id) (ON DELETE SET NULL); append-only.
-- ============================================================================
insert into payroll_run_events (id, tenant_id, run_id, event_type, employee_id, month, payload, error_details, created_at) values
 ('c3000000-0000-0000-0000-0000000000e1','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','run_started',   null, to_char(current_date - interval '1 month','YYYY-MM'), '{"employee_count":12}', null, now() - interval '22 days'),
 ('c3000000-0000-0000-0000-0000000000e2','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','slip_computed',  'e0000000-0000-0000-0000-000000000003', to_char(current_date - interval '1 month','YYYY-MM'), '{"gross_pay":163667,"net_pay":150334}', null, now() - interval '22 days'),
 ('c3000000-0000-0000-0000-0000000000e3','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','run_completed',  null, to_char(current_date - interval '1 month','YYYY-MM'), '{"slips_computed":12,"failures":0}', null, now() - interval '22 days' + interval '4 minutes'),
 ('c3000000-0000-0000-0000-0000000000e4','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','blocker_resolved','e0000000-0000-0000-0000-000000000007', to_char(current_date - interval '1 month','YYYY-MM'), '{"rule_code":"MISSING_BANK_DETAILS"}', null, now() - interval '21 days'),
 ('c3000000-0000-0000-0000-0000000000e5','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','run_finalized',  null, to_char(current_date - interval '1 month','YYYY-MM'), '{"finalized_by":"Demo Admin"}', null, now() - interval '20 days'),
 ('c3000000-0000-0000-0000-0000000000e6','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','ledger_posted',  null, to_char(current_date - interval '1 month','YYYY-MM'), '{"ledger":"c3..f1","balanced":true}', null, now() - interval '19 days');

-- ============================================================================
--  8. PAYROLL FINANCIAL LEDGER  (double-entry GL — migration 146)
--     The admin "Payroll Ledger" page reads payroll_financial_ledgers (header)
--     + payroll_ledger_entries (rows). snapshot_id is left NULL (optional FK;
--     no snapshot rows exist in the demo).
--     ledger_type   ∈ ('payroll','accrual','reversal','payout','adjustment')
--     ledger_status ∈ ('draft','balanced','pending_approval','posted','reversed','archived')
--     entry_type    ∈ (see migration 146 CHECK list)
--     entry_category∈ ('expense','liability','asset','equity')
--     A balanced posted ledger: total_debit = total_credit = 2,100,000.
-- ============================================================================
insert into payroll_financial_ledgers (id, tenant_id, run_id, snapshot_id, ledger_month, ledger_type, ledger_status, total_debit, total_credit, currency, submitted_by, submitted_at, approved_by, approved_at, posted_at, posted_by, notes, created_by) values
 ('c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002', null, to_char(current_date - interval '1 month','YYYY-MM'), 'payroll', 'posted', 2100000.00, 2100000.00, 'INR', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '20 days', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '19 days', now() - interval '19 days', 'd0000000-0000-0000-0000-0000000000a1', 'Payroll journal for last month — balanced and posted to GL.', 'd0000000-0000-0000-0000-0000000000a1');

-- Double-entry rows. Debits (expenses) = 2,100,000; credits (liabilities) = 2,100,000.
--   Salary Expense (debit)        1,800,000
--   Employer PF Expense (debit)     300,000   → total debit 2,100,000
--   Net Payable (credit)          1,650,000
--   EPF Employee Payable (credit)    21,600
--   EPF Employer Payable (credit)   300,000
--   PT Payable (credit)               2,400
--   TDS Payable (credit)            126,000   → total credit 2,100,000
insert into payroll_ledger_entries (id, ledger_id, tenant_id, entry_type, entry_category, employee_id, gl_account_code, gl_account_name, debit_amount, credit_amount, currency, description, source_component_code, source_component_name, accounting_date, journal_reference) values
 ('c3000000-0000-0000-0000-00000000fa01','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','salary_expense',        'expense',   null, '5000', 'Salary Expense',          1800000.00, 0.00,       'INR', 'Gross salary for the month (all employees).', 'BASIC',    'Salary Earnings',          (current_date - interval '1 month')::date, 'PAY-LEDGER-0001'),
 ('c3000000-0000-0000-0000-00000000fa02','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','pf_employer',           'expense',   null, '5100', 'Employer PF Contribution', 300000.00, 0.00,       'INR', 'Employer provident fund contribution.', 'PF_ER', 'Provident Fund (Employer)', (current_date - interval '1 month')::date, 'PAY-LEDGER-0002'),
 ('c3000000-0000-0000-0000-00000000fa03','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','net_payable',           'liability', null, '2100', 'Payroll Payable',         0.00,       1650000.00, 'INR', 'Net pay credited to payroll payable.', 'NET_PAY', 'Net Pay',                  (current_date - interval '1 month')::date, 'PAY-LEDGER-0003'),
 ('c3000000-0000-0000-0000-00000000fa04','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','pf_employee',           'liability', null, '2110', 'EPF Employee Payable',    0.00,       21600.00,   'INR', 'Employee PF deductions payable to EPFO.', 'PF_EE', 'Provident Fund (Employee)', (current_date - interval '1 month')::date, 'PAY-LEDGER-0004'),
 ('c3000000-0000-0000-0000-00000000fa05','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','pf_employer',           'liability', null, '2111', 'EPF Employer Payable',    0.00,       300000.00,  'INR', 'Employer PF contribution payable to EPFO.', 'PF_ER', 'Provident Fund (Employer)', (current_date - interval '1 month')::date, 'PAY-LEDGER-0005'),
 ('c3000000-0000-0000-0000-00000000fa06','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','pt_payable',            'liability', null, '2140', 'Professional Tax Payable',0.00,       2400.00,    'INR', 'Professional tax payable to the state.', 'PT', 'Professional Tax',            (current_date - interval '1 month')::date, 'PAY-LEDGER-0006'),
 ('c3000000-0000-0000-0000-00000000fa07','c3000000-0000-0000-0000-0000000000f1','d0000000-0000-0000-0000-000000000001','tds_payable',           'liability', null, '2130', 'TDS Payable',             0.00,       126000.00,  'INR', 'Income-tax (TDS) deductions payable.', 'TDS', 'TDS (Income Tax)',            (current_date - interval '1 month')::date, 'PAY-LEDGER-0007');

-- ============================================================================
--  9. PAYROLL EXPLAINABILITY LEDGER  (employee-facing "why" trail)
--     Created by migration 077, extended by 193. The REAL columns are:
--       month CHAR(7) NOT NULL, event_type (077 CHECK list), event_description,
--       impact_type, impact_amount, before_value/after_value TEXT,
--       source_entity_type/id, created_by  +  (193) payroll_run_id, ledger_date,
--       source_module, is_payroll_impacting, correlation_id, causation_event_id.
--     event_type ∈ ('attendance_recomputed','correction_approved','leave_deducted',
--       'ot_added','policy_changed','retro_adjustment','payable_days_changed',
--       'lop_applied','payroll_computed','payroll_finalized','anomaly_resolved',
--       'manual_note')
--     source_module ∈ ('attendance','leave','compensation','statutory','advance',
--       'loan','reimbursement','variable_pay','arrear','tds','manual')
-- ============================================================================
insert into payroll_explainability_ledger (id, tenant_id, employee_id, payroll_run_id, month, ledger_date, event_type, event_description, impact_type, impact_amount, before_value, after_value, source_module, source_entity_type, source_entity_id, is_payroll_impacting, created_by) values
 ('c3000000-0000-0000-0000-00000000ed01','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000002', to_char(current_date - interval '1 month','YYYY-MM'), (current_date - interval '1 month')::date, 'lop_applied',       'One day of loss-of-pay applied for a retro-approved leave in the prior locked period.', 'lop', -3200.00, '22 payable days', '21 payable days', 'leave', 'payroll_adjustment', 'c3000000-0000-0000-0000-000000000001', true, 'd0000000-0000-0000-0000-0000000000a1'),
 ('c3000000-0000-0000-0000-00000000ed02','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002', to_char(current_date - interval '1 month','YYYY-MM'), (current_date - interval '1 month')::date, 'retro_adjustment',  'Increment arrear approved for the revision period; to be disbursed in the current run.', 'gross_change', 18750.00, 'CTC unchanged', 'Arrear due ₹18,750', 'arrear', 'arrear_batch', 'c3000000-0000-0000-0000-0000000000a1', true, 'd0000000-0000-0000-0000-0000000000a1'),
 ('c3000000-0000-0000-0000-00000000ed03','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002', to_char(current_date - interval '1 month','YYYY-MM'), (current_date - interval '1 month')::date, 'payroll_finalized', 'Payroll run finalized and locked for the month.', 'net_change', 0.00, 'draft', 'finalized', 'compensation', 'payroll_run', 'f0000000-0000-0000-0000-000000000002', false, 'd0000000-0000-0000-0000-0000000000a1'),
 ('c3000000-0000-0000-0000-00000000ed04','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000002', to_char(current_date - interval '1 month','YYYY-MM'), (current_date - interval '1 month')::date, 'anomaly_resolved',  'Missing bank details blocker resolved before payout initiation.', null, null, 'blocked', 'cleared', 'manual', 'payroll_run_blocker', 'c3000000-0000-0000-0000-0000000000d1', false, 'd0000000-0000-0000-0000-0000000000a1');

commit;

-- ============================================================================
--  DONE. EPF / ESI / PTax statutory contributions, the retro adjustment queue,
--  an arrear batch (+records +payouts), payroll run blockers & lifecycle events,
--  the double-entry financial ledger and the explainability ledger now have demo
--  data for the last finalized run (f0…02).
-- ============================================================================
