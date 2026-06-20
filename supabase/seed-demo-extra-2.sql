-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #2  (run AFTER seed-demo.sql)
--  Fills admin-facing pages the core seed leaves empty: overtime approvals,
--  comp-off approvals, loans (+schedule +payments), per-employee payroll cost,
--  the notification center, HRA declarations, variable pay (incentives) and the
--  audit trail.
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
--   most-recent payroll run = f0000000-0000-0000-0000-000000000002
--     (month = to_char(current_date - interval '1 month','YYYY-MM'))

-- ── RESET (children before parents) ─────────────────────────────────────────
-- Tables with a tenant_id are deleted directly. Tables without one
-- (loan_schedules, loan_payments) are deleted via their parent loan ids.
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  -- loan children first (these DO carry tenant_id, but delete before parent anyway)
  foreach t in array array[
    'loan_payments','loan_schedules','employee_loans',
    'overtime_requests','comp_off_requests',
    'payroll_run_employees',
    'notifications',
    'variable_payouts','variable_payout_batches','incentive_templates',
    'hra_declarations',
    'audit_logs'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;

  -- notifications reference hr_events; remove only the demo events this file seeds
  -- (fixed e9... ids), so we don't disturb any real event rows.
  if to_regclass('hr_events') is not null then
    delete from hr_events where tenant_id = tid
      and id::text like 'e9000000-0000-0000-0000-%';
  end if;
end $$;

-- ============================================================================
--  1. OVERTIME REQUESTS  (admin / manager Overtime approvals)
--     status ∈ ('PENDING','APPROVED','REJECTED','AUTO_APPROVED')
-- ============================================================================
insert into overtime_requests (tenant_id, employee_id, attendance_date, raw_ot_minutes, approved_minutes, status, requested_by, approved_by, approved_at, rate_type, extra_rate, is_weekend_day, is_holiday_day, notes) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', current_date - 3,  150, null, 'PENDING',       'd0000000-0000-0000-0000-0000000000a1', null,                                   null,                       'weekday', 1.5000, false, false, 'Release night — extended deployment window.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', current_date - 4,  210, null, 'PENDING',       'd0000000-0000-0000-0000-0000000000a1', null,                                   null,                       'weekday', 1.5000, false, false, 'Production incident bridge call.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', current_date - 7,  120, 120,  'APPROVED',      'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days',  'weekday', 1.5000, false, false, 'Approved as per OT policy.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', current_date - 9,  300, 240,  'APPROVED',      'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '8 days',  'weekend', 2.0000, true,  false, 'Weekend migration; capped at policy maximum.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', current_date - 12, 90,  90,   'AUTO_APPROVED', 'd0000000-0000-0000-0000-0000000000a1', null,                                   now() - interval '12 days', 'weekday', 1.5000, false, false, 'Within auto-approval threshold.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c', current_date - 15, 180, null, 'REJECTED',      'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '14 days', 'weekday', 1.5000, false, false, 'No prior approval; not eligible for OT this cycle.');

-- ============================================================================
--  2. COMP-OFF REQUESTS  (Comp-Off approvals)
--     worked_reason ∈ ('weekly_off','holiday');  status ∈ ('pending','approved','rejected')
-- ============================================================================
insert into comp_off_requests (tenant_id, employee_id, worked_date, worked_reason, leave_type_id, days_to_credit, status, reviewed_by, reviewed_at, notes, created_by) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', current_date - 6,  'weekly_off', 'a8000000-0000-0000-0000-000000000001', 1.0, 'pending',  null,                                   null,                       'Worked Saturday on the release.',            'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', current_date - 13, 'holiday',    'a8000000-0000-0000-0000-000000000001', 1.0, 'approved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '12 days', 'On-call duty on Republic Day.',              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', current_date - 20, 'weekly_off', 'a8000000-0000-0000-0000-000000000001', 0.5, 'approved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '19 days', 'Half-day support coverage on Sunday.',       'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', current_date - 9,  'weekly_off', 'a8000000-0000-0000-0000-000000000001', 1.0, 'rejected', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '8 days',  'Not pre-approved; regular WFH day.',          'd0000000-0000-0000-0000-0000000000a1');

-- ============================================================================
--  3. LOANS  (employee_loans + loan_schedules + loan_payments)
--     loan_type ∈ ('personal','education','vehicle','home','emergency','other')
--     loan status ∈ (..'pending','approved','rejected','disbursed','active',
--                    'foreclosed','completed','cancelled',..)  [migration 233]
--     schedule status ∈ ('pending','paid','skipped','adjusted')
--     payment_type ∈ ('emi','prepayment','foreclosure','manual')
-- ============================================================================
-- Loan A: actively repaying (12-month vehicle loan, 2 EMIs already paid).
-- Loan B: a smaller emergency loan still pending approval.
insert into employee_loans (id, tenant_id, employee_id, loan_type, principal_amount, disbursed_amount, interest_rate_pct, tenure_months, emi_amount, outstanding_balance, status, purpose, disbursed_date, first_emi_month, approved_by, approved_at, created_by) values
 ('e1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','vehicle',   240000, 240000, 0, 12, 20000, 200000, 'active',  'Two-wheeler purchase.',          current_date - 70, to_char(current_date - interval '2 months','YYYY-MM'), 'd0000000-0000-0000-0000-0000000000a1', now() - interval '72 days', 'd0000000-0000-0000-0000-0000000000a1'),
 ('e1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','emergency',  60000, null,    0, 6,  10000, 60000,  'pending', 'Family medical emergency.',      null,              null,                                                      null,                                   null,                       'd0000000-0000-0000-0000-0000000000a1');

-- Amortisation schedule for Loan A (interest-free → principal == emi). 12 EMIs;
-- the first two are paid, the rest pending.
insert into loan_schedules (id, tenant_id, loan_id, installment_number, due_month, principal_component, interest_component, emi_amount, status, paid_amount, payroll_run_id, paid_at) values
 ('e2000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 1,  to_char(current_date - interval '2 months','YYYY-MM'), 20000, 0, 20000, 'paid',    20000, 'f0000000-0000-0000-0000-000000000001', now() - interval '50 days'),
 ('e2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 2,  to_char(current_date - interval '1 month','YYYY-MM'),  20000, 0, 20000, 'paid',    20000, 'f0000000-0000-0000-0000-000000000002', now() - interval '20 days'),
 ('e2000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 3,  to_char(current_date,                       'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 4,  to_char(current_date + interval '1 month',  'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 5,  to_char(current_date + interval '2 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 6,  to_char(current_date + interval '3 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 7,  to_char(current_date + interval '4 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 8,  to_char(current_date + interval '5 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 9,  to_char(current_date + interval '6 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 10, to_char(current_date + interval '7 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 11, to_char(current_date + interval '8 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null),
 ('e2000000-0000-0000-0000-00000000000c','d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001', 12, to_char(current_date + interval '9 months', 'YYYY-MM'), 20000, 0, 20000, 'pending', null,  null,                                   null);

-- The two EMI payments actually recorded against Loan A.
insert into loan_payments (tenant_id, loan_id, schedule_id, employee_id, payroll_run_id, payment_month, amount, principal_paid, interest_paid, payment_type, notes, created_by) values
 ('d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000001', to_char(current_date - interval '2 months','YYYY-MM'), 20000, 20000, 0, 'emi', 'EMI 1 of 12 recovered via payroll.', 'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002', to_char(current_date - interval '1 month','YYYY-MM'),  20000, 20000, 0, 'emi', 'EMI 2 of 12 recovered via payroll.', 'd0000000-0000-0000-0000-0000000000a1');

-- ============================================================================
--  4. PAYROLL RUN EMPLOYEES  (Team Payroll Cost / admin payroll)
--     One row per employee for the MOST RECENT existing run (f0...02).
--     gross / net / tds are derived from each employee's CTC with the SAME math
--     used by seed-demo.sql's payroll_slips so the numbers reconcile.
--     A couple of rows carry OT cost / LOP / volatility for realism.
-- ============================================================================
insert into payroll_run_employees (tenant_id, payroll_run_id, employee_id, month, gross_pay, net_pay, ot_cost, lop_deduction, volatility_index)
select
  'd0000000-0000-0000-0000-000000000001',
  'f0000000-0000-0000-0000-000000000002',
  ec.employee_id,
  pr.month,
  v.gross,
  v.gross - v.deductions - x.lop,
  x.ot,
  x.lop,
  x.vol
from employee_compensations ec
join payroll_runs pr on pr.id = 'f0000000-0000-0000-0000-000000000002'
join (values
 ('e0000000-0000-0000-0000-000000000001'::uuid, 0,     0,    1.20),
 ('e0000000-0000-0000-0000-000000000002'::uuid, 0,     0,    0.80),
 ('e0000000-0000-0000-0000-000000000003'::uuid, 3000,  0,    2.10),
 ('e0000000-0000-0000-0000-000000000004'::uuid, 0,     0,    0.50),
 ('e0000000-0000-0000-0000-000000000005'::uuid, 4500,  0,    3.40),
 ('e0000000-0000-0000-0000-000000000006'::uuid, 1800,  0,    1.10),
 ('e0000000-0000-0000-0000-000000000007'::uuid, 0,     2300, 4.60),
 ('e0000000-0000-0000-0000-000000000008'::uuid, 6000,  0,    2.90),
 ('e0000000-0000-0000-0000-000000000009'::uuid, 1500,  0,    0.70),
 ('e0000000-0000-0000-0000-00000000000a'::uuid, 0,     0,    0.30),
 ('e0000000-0000-0000-0000-00000000000b'::uuid, 0,     0,    0.40),
 ('e0000000-0000-0000-0000-00000000000c'::uuid, 0,     0,    1.00)
) as x(emp, ot, lop, vol) on x.emp = ec.employee_id
cross join lateral (select
  round(ec.ctc_annual/12.0) - 1800            as gross,         -- earnings (= CTC/12 - employer PF)
  2000 + round(ec.ctc_annual/12.0 * 0.08)     as deductions     -- PF(EE) 1800 + PT 200 + TDS 8%
) v
where ec.tenant_id = 'd0000000-0000-0000-0000-000000000001' and ec.is_active = true;

-- ============================================================================
--  5. NOTIFICATIONS  (notification center)
--     notifications.event_id is NOT NULL → seed parent hr_events first.
--     recipient_id is a profiles.id (only the demo admin profile exists), so all
--     notifications target the demo admin — mixed read/unread.
-- ============================================================================
insert into hr_events (id, tenant_id, event_type, payload, actor_id, target_type, target_id, created_at) values
 ('e9000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','leave.requested',    '{"employee":"Deepak Chawla"}', 'd0000000-0000-0000-0000-0000000000a1','employee','e0000000-0000-0000-0000-000000000003', now() - interval '2 hours'),
 ('e9000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','overtime.requested', '{"employee":"Arjun Rampal"}',  'd0000000-0000-0000-0000-0000000000a1','employee','e0000000-0000-0000-0000-000000000005', now() - interval '1 day'),
 ('e9000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','reimbursement.submitted','{"employee":"Ayesha Ahmed"}', 'd0000000-0000-0000-0000-0000000000a1','employee','e0000000-0000-0000-0000-000000000007', now() - interval '3 days'),
 ('e9000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','payroll.locked',     '{"month":"last"}',             'd0000000-0000-0000-0000-0000000000a1','all',     null,                                   now() - interval '20 days'),
 ('e9000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','loan.requested',     '{"employee":"Nandini Gupta"}', 'd0000000-0000-0000-0000-0000000000a1','employee','e0000000-0000-0000-0000-000000000006', now() - interval '4 hours');

insert into notifications (tenant_id, recipient_id, event_id, title, body, link, is_read, read_at, created_at) values
 ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','e9000000-0000-0000-0000-000000000001','New leave request',        'Deepak Chawla applied for Casual Leave (2 days).',             '/admin/leave/approvals',          false, null,                       now() - interval '2 hours'),
 ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','e9000000-0000-0000-0000-000000000002','Overtime approval pending','Arjun Rampal logged 3h 30m of overtime awaiting review.',      '/admin/attendance/overtime',      false, null,                       now() - interval '1 day'),
 ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','e9000000-0000-0000-0000-000000000003','Reimbursement submitted',  'Ayesha Ahmed submitted a medical claim of ₹6,800.',           '/admin/reimbursements',           true,  now() - interval '2 days',  now() - interval '3 days'),
 ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','e9000000-0000-0000-0000-000000000004','Payroll finalised',        'Last month''s payroll run has been finalised and locked.',     '/admin/payroll',                  true,  now() - interval '19 days', now() - interval '20 days'),
 ('d0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1','e9000000-0000-0000-0000-000000000005','New loan application',     'Nandini Gupta requested an emergency loan of ₹60,000.',        '/admin/loans',                    false, null,                       now() - interval '4 hours');

-- ============================================================================
--  6. HRA DECLARATIONS  (HRA / tax)
--     status ∈ ('draft','submitted','verified','rejected','superseded')
--     plan_id left NULL (optional FK to tax_declaration_plans).
-- ============================================================================
insert into hra_declarations (tenant_id, employee_id, financial_year, from_month, to_month, monthly_rent, landlord_name, landlord_pan, landlord_address, city, is_metro, pan_verified, status, verification_notes) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','2025-2026', '2025-04', '2026-03', 35000, 'Suresh Patil',  'ABCPP1234K', '12 Hill Road, Bandra West, Mumbai', 'Mumbai',    true,  true,  'verified',  'Rent receipts and PAN verified.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','2025-2026', '2025-04', '2026-03', 22000, 'Lakshmi Rao',   'XYZPR5678L', '88 5th Cross, Indiranagar, Bengaluru', 'Bengaluru', true,  false, 'submitted', null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','2025-2026', '2025-04', '2026-03', 14000, 'Mohan Kumar',   null,         'Flat 4B, JP Nagar, Bengaluru',         'Bengaluru', true,  false, 'draft',     null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b','2025-2026', '2025-04', '2026-03', 9000,  'Anita Desai',   'LMNPD9012M', '23 Gandhi Nagar, Pune',                'Pune',      false, false, 'rejected',  'Landlord PAN required for annual rent above ₹1L.');

-- ============================================================================
--  7. VARIABLE PAY  (incentives / bonus)
--     template_type ∈ ('performance','sales','referral','spot_award','project',
--                      'quarterly','annual','festival','retention','other')
--     batch status  ∈ ('draft','in_review','approved','processing','processed','cancelled')
--     payout status ∈ ('pending','approved','processed','cancelled')
-- ============================================================================
insert into incentive_templates (id, tenant_id, name, code, template_type, is_taxable, is_active, requires_approval, description) values
 ('ea000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Quarterly Performance Bonus','Q-PERF','performance', true, true, true, 'Discretionary quarterly performance incentive.'),
 ('ea000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Spot Award',                 'SPOT',  'spot_award',  true, true, false,'On-the-spot recognition award.');

insert into variable_payout_batches (id, tenant_id, template_id, batch_name, payout_month, status, total_amount, employee_count, approved_by, approved_at, notes, created_by) values
 ('eb000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000001','Q4 Performance Bonus', to_char(current_date - interval '1 month','YYYY-MM'), 'approved', 175000, 3, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '18 days', 'Top performers for the quarter.', 'd0000000-0000-0000-0000-0000000000a1'),
 ('eb000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','ea000000-0000-0000-0000-000000000002','Spot Awards — current',to_char(current_date,                      'YYYY-MM'), 'draft',    25000,  1, null,                                   null,                       'Pending HR review.',               'd0000000-0000-0000-0000-0000000000a1');

insert into variable_payouts (tenant_id, batch_id, employee_id, payout_month, amount, is_taxable, performance_period, performance_notes, status) values
 ('d0000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', to_char(current_date - interval '1 month','YYYY-MM'), 75000, true, 'Q4 FY25', 'Led the platform release end-to-end.', 'approved'),
 ('d0000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', to_char(current_date - interval '1 month','YYYY-MM'), 60000, true, 'Q4 FY25', 'Resolved critical production incidents.', 'approved'),
 ('d0000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', to_char(current_date - interval '1 month','YYYY-MM'), 40000, true, 'Q4 FY25', 'Consistent delivery throughout the quarter.', 'approved'),
 ('d0000000-0000-0000-0000-000000000001','eb000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000009', to_char(current_date,                      'YYYY-MM'), 25000, true, 'Current month', 'Outstanding marketing campaign results.', 'pending');

-- ============================================================================
--  8. AUDIT LOGS  (Audit Trail)
--     action ∈ ('INSERT','UPDATE','DELETE')  [the ONLY allowed values].
--     record_id references real seeded rows; performed_by = demo admin profile;
--     on_behalf_of = employees.id when the admin acted on someone's record.
-- ============================================================================
insert into audit_logs (tenant_id, table_name, record_id, action, old_data, new_data, performed_by, on_behalf_of, created_at) values
 ('d0000000-0000-0000-0000-000000000001','leave_requests','e0000000-0000-0000-0000-000000000005','UPDATE', '{"status":"PENDING"}',  '{"status":"APPROVED"}',                          'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000005', now() - interval '11 days'),
 ('d0000000-0000-0000-0000-000000000001','overtime_requests','e0000000-0000-0000-0000-000000000008','UPDATE', '{"status":"PENDING"}', '{"status":"APPROVED","approved_minutes":240}',   'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000008', now() - interval '8 days'),
 ('d0000000-0000-0000-0000-000000000001','employee_loans','e1000000-0000-0000-0000-000000000001','INSERT', null,                    '{"loan_type":"vehicle","principal_amount":240000}', 'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000003', now() - interval '72 days'),
 ('d0000000-0000-0000-0000-000000000001','payroll_runs','f0000000-0000-0000-0000-000000000002','UPDATE', '{"status":"draft"}',     '{"status":"finalized"}',                         'd0000000-0000-0000-0000-0000000000a1', null,                                  now() - interval '20 days'),
 ('d0000000-0000-0000-0000-000000000001','employees','e0000000-0000-0000-0000-00000000000a','UPDATE', '{"status":"onboarding"}', '{"status":"active"}',                            'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-00000000000a', now() - interval '5 days'),
 ('d0000000-0000-0000-0000-000000000001','hra_declarations','e0000000-0000-0000-0000-000000000003','UPDATE', '{"status":"submitted"}', '{"status":"verified"}',                       'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000003', now() - interval '6 days'),
 ('d0000000-0000-0000-0000-000000000001','reimbursement_claims','e0000000-0000-0000-0000-000000000009','UPDATE', '{"status":"submitted"}','{"status":"rejected"}',                     'd0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000009', now() - interval '11 days');

commit;

-- ============================================================================
--  DONE. Overtime & comp-off approvals, loans (+schedule +payments), per-employee
--  payroll cost, notifications, HRA declarations, variable pay and the audit trail
--  now have demo data.
-- ============================================================================
