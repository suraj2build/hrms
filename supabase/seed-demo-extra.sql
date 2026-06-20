-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT (run AFTER seed-demo.sql)
--  Adds data to screens that the core seed leaves empty: attendance exceptions
--  (anomalies / regularisations / corrections), reimbursements, salary advances,
--  documents, benefits and letters.
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
-- ============================================================================
begin;

-- Demo tenant + profile + employees use the fixed IDs from seed-demo.sql:
--   tenant  = d0000000-0000-0000-0000-000000000001
--   profile = d0000000-0000-0000-0000-0000000000a1
--   emp NN  = e0000000-0000-0000-0000-0000000000NN   (01..0c)

-- ── RESET (children before parents) ─────────────────────────────────────────
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'attendance_anomalies','attendance_regularisation','attendance_corrections',
    'reimbursement_attachments','reimbursement_claims','reimbursement_categories',
    'advance_recovery_schedules','advance_salary_requests',
    'benefit_enrollments','benefit_plans',
    'generated_letters','letter_templates',
    'documents',
    'employee_onboarding_tasks','employee_onboarding_checklists',
    'onboarding_checklist_items','onboarding_checklist_templates',
    'separation_clearances','separation_ff_summary','employee_separation',
    'employee_nominations','employee_certifications'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;
end $$;

-- ============================================================================
--  1. ATTENDANCE EXCEPTIONS  (anomalies / regularisation / corrections)
-- ============================================================================
insert into attendance_anomalies (tenant_id, employee_id, date, type, message, severity, resolved, resolved_by, resolved_at) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', current_date - 5, 'late',            'Checked in at 10:42 — well past the 09:15 grace window.', 'medium', false, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', current_date - 4, 'no_punch',        'No punch recorded for the day.',                          'high',   false, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', current_date - 3, 'missing_out',     'Check-out punch missing — pay hours uncertain.',          'medium', false, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', current_date - 8, 'excessive_hours', 'Logged 13.5 hours — review for overtime / fatigue.',      'low',    false, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b', current_date - 2, 'no_punch',        'Biometric device offline at the Delhi site — no punch.',  'high',   false, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', current_date - 6, 'late',            'Late arrival 09:48.',                                     'low',    true,  'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004', current_date - 7, 'missing_out',     'Forgot to punch out — corrected via regularisation.',     'medium', true,  'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days');

insert into attendance_regularisation (tenant_id, employee_id, date, requested_check_in, requested_check_out, reason, status, approved_by, approved_at) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', current_date - 4, (current_date - 4) + time '09:00', (current_date - 4) + time '18:05', 'Biometric device was down at my site all day.', 'pending',  null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', current_date - 3, (current_date - 3) + time '09:10', (current_date - 3) + time '18:30', 'Forgot to punch out; was in office till 6:30pm.', 'pending', null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', current_date - 10,(current_date - 10) + time '09:05',(current_date - 10) + time '17:55','Client meeting offsite in the morning.', 'approved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '9 days');

insert into attendance_corrections (tenant_id, employee_id, date, corrected_in, corrected_out, reason, status, submitted_by, approved_by, approved_at, rejection_reason) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', current_date - 8, (current_date - 8) + time '09:02', (current_date - 8) + time '22:30', 'System captured a duplicate punch — correcting work hours.', 'pending',  'd0000000-0000-0000-0000-0000000000a1', null, null, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004', current_date - 7, (current_date - 7) + time '09:00', (current_date - 7) + time '18:00', 'Manual correction for the missing check-out.', 'applied', 'd0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days', null);

-- ============================================================================
--  2. REIMBURSEMENTS  (categories + claims across statuses)
-- ============================================================================
insert into reimbursement_categories (id, tenant_id, name, code, category_type, is_taxable, monthly_limit, annual_limit) values
 ('c1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Fuel & Conveyance','FUEL','fuel',   false, 8000,  96000),
 ('c1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Mobile & Internet','COMM','mobile', false, 2000,  24000),
 ('c1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Medical',          'MED', 'medical',false, 15000, 180000),
 ('c1000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Travel',           'TRVL','travel', false, null,  null);

insert into reimbursement_claims (tenant_id, employee_id, category_id, expense_date, claimed_amount, approved_amount, description, status, submitted_at, reviewed_by, reviewed_at, paid_at, rejection_reason) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001', current_date - 20, 4500,  4500,  'Cab fares for client visits (3 trips).',          'paid',      now() - interval '18 days','d0000000-0000-0000-0000-0000000000a1', now() - interval '16 days', now() - interval '10 days', null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000002', current_date - 12, 1200,  1200,  'Monthly broadband bill (work-from-home).',        'approved',  now() - interval '8 days', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days',  null,                        null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','c1000000-0000-0000-0000-000000000003', current_date - 5,  6800,  null,  'Dental treatment — covered under medical policy.','submitted', now() - interval '3 days', null,                                    null,                        null,                        null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000004', current_date - 2,  15400, null,  'Flight + hotel for the Mumbai leadership offsite.','draft',     null,                       null,                                    null,                        null,                        null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001', current_date - 25, 3800,  3800,  'Fuel for the month (logbook attached).',          'paid',      now() - interval '22 days','d0000000-0000-0000-0000-0000000000a1', now() - interval '20 days', now() - interval '12 days', null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','c1000000-0000-0000-0000-000000000003', current_date - 15, 2300,  null,  'Pharmacy bills.',                                  'rejected',  now() - interval '13 days','d0000000-0000-0000-0000-0000000000a1', now() - interval '11 days', null,                        'Receipt illegible — please resubmit a clear copy.');

-- ============================================================================
--  3. SALARY ADVANCES  (loans & advances screen)
-- ============================================================================
insert into advance_salary_requests (tenant_id, employee_id, requested_amount, approved_amount, purpose, recovery_months, status, requested_date, approved_by, approved_at, disbursed_date, disbursed_amount) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009', 50000,  50000,  'Medical emergency in the family.', 5, 'recovering', current_date - 60, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '58 days', current_date - 55, 50000),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', 30000,  null,   'Home renovation.',                  3, 'pending',    current_date - 5,  null,                                    null,               null,               null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001', 100000, 100000, 'Down payment for a vehicle.',       10,'disbursed',  current_date - 12, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '10 days', current_date - 8,  100000);

-- ============================================================================
--  4. DOCUMENTS  (My Documents screen)
-- ============================================================================
insert into documents (tenant_id, employee_id, doc_type, name, storage_path, mime_type, expires_at, uploaded_by) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','offer_letter','Offer Letter.pdf',       'demo/documents/e01-offer.pdf',    'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','pan',         'PAN Card.pdf',           'demo/documents/e01-pan.pdf',      'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','contract',    'Employment Agreement.pdf','demo/documents/e01-contract.pdf', 'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','offer_letter','Offer Letter.pdf',       'demo/documents/e03-offer.pdf',    'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','certificate', 'Degree Certificate.pdf', 'demo/documents/e03-degree.pdf',   'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','offer_letter','Offer Letter.pdf',       'demo/documents/e05-offer.pdf',    'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','pan',         'PAN Card.pdf',           'demo/documents/e05-pan.pdf',      'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','contract',    'Employment Agreement.pdf','demo/documents/e06-contract.pdf', 'application/pdf', null,              'd0000000-0000-0000-0000-0000000000a1');

-- ============================================================================
--  5. BENEFITS  (plans + enrollments)
-- ============================================================================
insert into benefit_plans (id, tenant_id, name, plan_type, provider, description, coverage_amount, employee_cost, employer_cost, allows_dependents, is_active) values
 ('b6000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Group Health Insurance','health',   'Star Health',     'Family floater — ₹5L cover for self + dependents.', 500000,  0, 12000, true,  true),
 ('b6000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Group Term Life',       'term_life','HDFC Life',       'Term cover of 3x annual CTC.',                       5000000, 0, 3000,  false, true),
 ('b6000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Personal Accident Cover','accident', 'ICICI Lombard',   'Accidental death & permanent disability cover.',     2000000, 0, 1500,  false, true);

insert into benefit_enrollments (tenant_id, employee_id, plan_id, status) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000002','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','b6000000-0000-0000-0000-000000000001','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b6000000-0000-0000-0000-000000000001','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','b6000000-0000-0000-0000-000000000003','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','b6000000-0000-0000-0000-000000000001','enrolled'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','b6000000-0000-0000-0000-000000000002','enrolled');

-- ============================================================================
--  6. LETTERS  (ESS-requestable templates + a couple issued letters)
-- ============================================================================
insert into letter_templates (id, tenant_id, name, code, category, letter_type, subject_template, body_html, requires_approval, approval_levels, is_active) values
 ('b7000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Salary Certificate',      'salary_certificate',      'ess_requestable','salary', 'Salary Certificate — {{employee_name}}',      '<p>This is to certify that {{employee_name}} ({{employee_code}}) is employed with {{company_name}}.</p>', false, 1, true),
 ('b7000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Employment Verification', 'employment_verification', 'ess_requestable','custom', 'Employment Verification — {{employee_name}}', '<p>This letter confirms the employment of {{employee_name}} as {{designation}}.</p>',                      false, 1, true);

insert into generated_letters (tenant_id, template_id, employee_id, subject, body_html, approval_status, current_level, issued_at, issued_by, created_by) values
 ('d0000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Salary Certificate — Priya Sharma',      '<p>This is to certify that Priya Sharma (SAAR001) is employed with Demo as Chief HR Officer.</p>', 'issued', 0, now() - interval '15 days','e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000003','Employment Verification — Deepak Chawla','<p>This letter confirms the employment of Deepak Chawla as Senior Software Engineer.</p>',         'issued', 0, now() - interval '8 days', 'e0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001');

-- ============================================================================
--  7. ONBOARDING  (template + checklist items + two in-flight employee journeys)
-- ============================================================================
insert into onboarding_checklist_templates (id, tenant_id, name, description, is_default, is_active) values
 ('f1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Standard New Hire Onboarding','Default 2-week onboarding journey for all new joiners.', true, true);

insert into onboarding_checklist_items (id, tenant_id, template_id, title, description, category, due_day_offset, assigned_to_role, is_mandatory, sort_order) values
 ('f2000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Collect signed offer letter & ID proofs','Signed offer, PAN, Aadhaar and address proof on file.', 'document_collection',  1, 'hr',      true, 1),
 ('f2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Issue laptop & peripherals',            'Allocate hardware as per role and record the asset.',  'it_setup',             1, 'it',      true, 2),
 ('f2000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Create email & system accounts',        'Provision email, SSO and core application access.',    'access_provisioning',  1, 'it',      true, 3),
 ('f2000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','HR induction & policy walkthrough',     'Cover leave, attendance, code of conduct and benefits.','induction',            2, 'hr',      true, 4),
 ('f2000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Statutory & compliance forms',          'PF, ESI and tax declaration forms completed.',         'compliance',           3, 'hr',      true, 5),
 ('f2000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Team introduction & buddy assignment',  'Introduce to the team and assign an onboarding buddy.','other',                5, 'manager', false,6);

insert into employee_onboarding_checklists (id, tenant_id, employee_id, template_id, status, start_date, target_completion_date, completed_at) values
 ('f3000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','f1000000-0000-0000-0000-000000000001','in_progress', current_date - 6, current_date + 8,  null),
 ('f3000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b','f1000000-0000-0000-0000-000000000001','not_started', current_date,     current_date + 14, null);

-- Rohan (in progress): first three done, induction underway, rest pending
insert into employee_onboarding_tasks (tenant_id, checklist_id, item_id, title, category, due_date, assigned_to_role, is_mandatory, status, completed_by, completed_at, sort_order) values
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Collect signed offer letter & ID proofs','document_collection',  current_date - 5, 'hr',      true, 'completed',   'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days', 1),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000002','Issue laptop & peripherals',            'it_setup',             current_date - 5, 'it',      true, 'completed',   'd0000000-0000-0000-0000-0000000000a1', now() - interval '4 days', 2),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000003','Create email & system accounts',        'access_provisioning',  current_date - 5, 'it',      true, 'completed',   'd0000000-0000-0000-0000-0000000000a1', now() - interval '4 days', 3),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000004','HR induction & policy walkthrough',     'induction',            current_date - 4, 'hr',      true, 'in_progress', null, null, 4),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000005','Statutory & compliance forms',          'compliance',           current_date - 3, 'hr',      true, 'pending',     null, null, 5),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000006','Team introduction & buddy assignment',  'other',                current_date - 1, 'manager', false,'pending',     null, null, 6);

-- Ananya (not started): all tasks queued
insert into employee_onboarding_tasks (tenant_id, checklist_id, item_id, title, category, due_date, assigned_to_role, is_mandatory, status, completed_by, completed_at, sort_order) values
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001','Collect signed offer letter & ID proofs','document_collection',  current_date + 1, 'hr',      true, 'pending', null, null, 1),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000002','Issue laptop & peripherals',            'it_setup',             current_date + 1, 'it',      true, 'pending', null, null, 2),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000003','Create email & system accounts',        'access_provisioning',  current_date + 1, 'it',      true, 'pending', null, null, 3),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000004','HR induction & policy walkthrough',     'induction',            current_date + 2, 'hr',      true, 'pending', null, null, 4),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000005','Statutory & compliance forms',          'compliance',           current_date + 3, 'hr',      true, 'pending', null, null, 5),
 ('d0000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000006','Team introduction & buddy assignment',  'other',                current_date + 5, 'manager', false,'pending', null, null, 6);

-- ============================================================================
--  8. SEPARATION  (one in clearance, one in notice period) + clearances + F&F
-- ============================================================================
insert into employee_separation (id, tenant_id, employee_id, separation_type, initiated_by, notice_date, last_working_date, exit_reason, exit_interview_done, exit_interview_date, clearance_done, remarks, lifecycle_stage, approval_status, approved_by, approved_at, created_by) values
 ('f4000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','resignation','employee', current_date - 20, current_date + 10, 'Accepted a senior role at another firm.', false, null, false, 'Serving a 30-day notice period; clearances in progress.', 'clearance',     'approved', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '18 days', 'd0000000-0000-0000-0000-0000000000a1'),
 ('f4000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b','resignation','employee', current_date - 3,  current_date + 27, 'Relocating to another city for family reasons.', false, null, false, 'Resignation submitted; pending HR approval.',          'notice_period', 'pending',  null, null, 'd0000000-0000-0000-0000-0000000000a1');

-- Vikram's department clearances (HR & manager cleared, IT & finance pending)
insert into separation_clearances (tenant_id, separation_id, employee_id, department, status, cleared_by, cleared_at, remarks) values
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','hr',      'cleared', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days', 'Full & final documentation verified.'),
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','manager', 'cleared', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days', 'Knowledge transfer completed.'),
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','it',      'pending', null, null, null),
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','finance', 'pending', null, null, null),
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','admin',   'cleared', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '4 days', 'Access card and ID badge returned.');

-- Vikram's draft full-and-final settlement
insert into separation_ff_summary (tenant_id, separation_id, employee_id, last_payroll_amount, leave_encashment_amount, gratuity_amount, notice_period_deduction, other_deductions, other_additions, status, notes) values
 ('d0000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008', 78000, 42000, 165000, 0, 5200, 0, 'draft', 'Gratuity for 4+ years of service; one outstanding asset recovery pending.');

-- ============================================================================
--  9. NOMINATIONS  (PF / gratuity nominees)
-- ============================================================================
insert into employee_nominations (tenant_id, employee_id, scheme, nominee_name, dob, share_percentage, address, is_minor, guardian_name) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','pf',       'Aarav Sharma',  '1985-03-12', 100, 'Indiranagar, Bengaluru', false, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','gratuity', 'Aarav Sharma',  '1985-03-12', 100, 'Indiranagar, Bengaluru', false, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','pf',       'Meena Chawla',  '1990-07-25',  60, 'Andheri West, Mumbai',   false, null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','pf',       'Ishaan Chawla', '2016-09-01',  40, 'Andheri West, Mumbai',   true,  'Meena Chawla'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','gratuity', 'Pooja Singh',   '1992-11-30', 100, 'Sector 21, Gurugram',    false, null);

-- ============================================================================
--  10. CERTIFICATIONS  (professional credentials, mix of active & expired)
-- ============================================================================
insert into employee_certifications (tenant_id, employee_id, cert_name, cert_type, issuing_body, cert_number, issue_date, expiry_date, status, notes) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','SHRM-SCP',                              'certification','SHRM',                    'SHRM-2022-44817', '2022-05-15', '2025-05-15', 'active',  'Senior Certified Professional.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','AWS Certified Solutions Architect',     'certification','Amazon Web Services',     'AWS-SAA-99213',   '2023-06-01', '2026-06-01', 'active',  'Associate level.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','PMP',                                   'certification','Project Management Institute','PMP-7781234', '2021-09-20', '2024-09-20', 'expired', 'Renewal pending PDU submission.'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c','Certified Scrum Master',                'certification','Scrum Alliance',          'CSM-553120',      '2023-01-10', '2025-01-10', 'active',  null);

commit;

-- ============================================================================
--  DONE. Attendance exceptions, reimbursements, advances, documents, benefits,
--  letters, onboarding journeys, separations/F&F, nominations and
--  certifications now have demo data.
-- ============================================================================
