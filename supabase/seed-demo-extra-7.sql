-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #7  (run AFTER seed-demo.sql)
--  Fills admin-config / detail pages the core seeds leave empty:
--    · NOTIFICATIONS    — notification_templates + notification_log
--    · HELPDESK detail  — helpdesk_ticket_comments on the existing demo tickets
--    · ASSET config     — asset_categories master
--    · OVERTIME policy  — overtime_policies + employee_overtime_policies
--    · STATUTORY config — epf_config, esi_config, ptax_slabs, ptax_state_settings
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql
--    and the other seed-demo-extra*.sql files; order vs. those is irrelevant —
--    this file touches different tables, except it ADDS comments to the
--    helpdesk_tickets already created by seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
--
--  NOTE: `notifications` and `hr_events` are seeded in seed-demo-extra-2.sql —
--  this file does NOT touch them. helpdesk_tickets are seeded in seed-demo.sql —
--  this file only ADDS comments, it never re-inserts tickets.
-- ============================================================================
begin;

-- Demo tenant + profile + employees use the fixed IDs from seed-demo.sql:
--   tenant  = d0000000-0000-0000-0000-000000000001
--   profile = d0000000-0000-0000-0000-0000000000a1   (Demo Admin / CHRO Priya = e01)
--   emp NN  = e0000000-0000-0000-0000-0000000000NN   (01..0c)
-- New rows created here use fixed UUIDs prefixed `c7`.

-- ── RESET (children before parents) ─────────────────────────────────────────
-- Tables carrying tenant_id are deleted directly. helpdesk_ticket_comments
-- carries tenant_id too, but is scoped to THIS file's `c7...` comment rows so
-- we never disturb comments created elsewhere.
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  -- helpdesk comments: delete only the demo comments this file seeds (c7... ids)
  if to_regclass('helpdesk_ticket_comments') is not null then
    delete from helpdesk_ticket_comments
      where tenant_id = tid and id::text like 'c7000000-0000-0000-0000-%';
  end if;

  -- overtime: per-employee assignments reference the policy → delete first
  foreach t in array array[
    'employee_overtime_policies','overtime_policies',
    'notification_log','notification_templates',
    'asset_categories',
    'ptax_state_settings','ptax_slabs',
    'esi_config','epf_config'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;
end $$;

-- ============================================================================
--  1. NOTIFICATION TEMPLATES  (Settings → Notifications → Templates)
--     category ∈ ('attendance','leave','payroll','compliance','escalation',
--                 'incident','approval','general','onboarding')   [mig 237]
--     severity ∈ ('info','warning','error','critical')
--     channel literals in available_channels mirror notification_channels:
--       ('in_app','email','sms','whatsapp','slack','teams')
-- ============================================================================
insert into notification_templates (id, tenant_id, template_code, template_name, category, severity, subject, body_template, available_channels, placeholders, has_action_cta, cta_label, cta_route, is_active) values
 ('c7100000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','LEAVE_APPROVED','Leave Approved','leave','info','Your leave has been approved','Hi {{employee_name}}, your {{leave_type}} leave from {{from_date}} to {{to_date}} has been approved.','{in_app,email}','{employee_name,leave_type,from_date,to_date}', true, 'View Leave', '/ess/leave', true),
 ('c7100000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','PAYSLIP_READY','Payslip Ready','payroll','info','Your payslip for {{month}} is ready','Hi {{employee_name}}, your payslip for {{month}} is now available to download.','{in_app,email}','{employee_name,month}', true, 'View Payslip', '/ess/payslips', true),
 ('c7100000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','DOC_EXPIRING','Document Expiring Soon','compliance','warning','A document is expiring on {{expiry_date}}','Hi {{employee_name}}, your document "{{document_name}}" expires on {{expiry_date}}. Please upload a renewed copy.','{in_app,email}','{employee_name,document_name,expiry_date}', true, 'Upload Document', '/ess/documents', true),
 ('c7100000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','LEAVE_REQUEST','New Leave Request','approval','info','{{employee_name}} requested leave','{{employee_name}} has requested {{leave_type}} leave ({{days}} day(s)) pending your approval.','{in_app,email}','{employee_name,leave_type,days}', true, 'Review Request', '/admin/leave/approvals', true),
 ('c7100000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','ATT_MISSING_PUNCH','Missing Punch Alert','attendance','warning','Missing punch on {{date}}','Hi {{employee_name}}, we did not record a check-out for {{date}}. Please regularise your attendance.','{in_app}','{employee_name,date}', true, 'Regularise', '/ess/attendance', true),
 ('c7100000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','ONBOARDING_WELCOME','Welcome Onboard','onboarding','info','Welcome to {{company_name}}!','Hi {{employee_name}}, welcome aboard! Your onboarding checklist is ready — complete the pending tasks to get started.','{in_app,email}','{employee_name,company_name}', true, 'Start Onboarding', '/ess/onboarding', true);

-- ============================================================================
--  2. NOTIFICATION LOG  (Settings → Notifications → Delivery log)
--     status ∈ ('pending','sent','delivered','failed','bounced')
--     channel is free text but mirrors the channel literals above.
--     This table is DISTINCT from `notifications` (the in-app bell center).
-- ============================================================================
insert into notification_log (id, tenant_id, template_id, recipient_employee_id, recipient_profile_id, channel, subject, body, status, sent_at, delivered_at, failed_at, failure_reason, external_message_id, correlation_id) values
 ('c7200000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', null, 'email', 'Your leave has been approved', 'Hi Deepak Chawla, your Casual Leave from 2026-06-10 to 2026-06-11 has been approved.', 'delivered', now() - interval '5 days', now() - interval '5 days' + interval '12 seconds', null, null, 'resend_msg_aa01', 'leave-e03-approved'),
 ('c7200000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000005', null, 'email', 'Your payslip for last month is ready', 'Hi Arjun Rampal, your payslip is now available to download.', 'delivered', now() - interval '20 days', now() - interval '20 days' + interval '8 seconds', null, null, 'resend_msg_aa02', 'payslip-batch'),
 ('c7200000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000006', null, 'in_app', 'Your payslip for last month is ready', 'Hi Nandini Gupta, your payslip is now available to download.', 'sent', now() - interval '20 days', null, null, null, null, 'payslip-batch'),
 ('c7200000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000008', null, 'email', 'A document is expiring on 2026-07-05', 'Hi Vikram Singh, your document "PAN Card.pdf" expires on 2026-07-05. Please upload a renewed copy.', 'sent', now() - interval '2 days', null, null, null, 'resend_msg_aa04', null),
 ('c7200000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000007', null, 'email', 'Missing punch on 2026-06-17', 'Hi Ayesha Ahmed, we did not record a check-out for 2026-06-17. Please regularise your attendance.', 'bounced', now() - interval '3 days', null, now() - interval '3 days' + interval '30 seconds', 'Mailbox full (SMTP 552).', null, null),
 ('c7200000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000004', null, 'd0000000-0000-0000-0000-0000000000a1', 'in_app', 'Kavya Nair requested leave', 'Kavya Nair has requested Sick Leave (1 day(s)) pending your approval.', 'delivered', now() - interval '1 day', now() - interval '1 day' + interval '2 seconds', null, null, null, null),
 ('c7200000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','c7100000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-00000000000b', null, 'sms', 'Missing punch on 2026-06-18', 'Hi Ananya Iyer, we did not record a check-out for 2026-06-18.', 'failed', now() - interval '1 day', null, now() - interval '1 day' + interval '15 seconds', 'SMS gateway timeout.', null, null);

-- ============================================================================
--  3. HELPDESK TICKET COMMENTS  (HR Helpdesk → ticket thread)
--     author_role ∈ ('employee','hr');  is_internal hides notes from employee.
--     Tickets were seeded WITHOUT fixed ids in seed-demo.sql, so we resolve
--     them by (tenant_id, subject) — those subjects are unique in the demo set.
--     All authors must be a profiles.id; only the demo admin profile exists,
--     so every comment is authored by the admin (role varies for realism).
-- ============================================================================
insert into helpdesk_ticket_comments (id, tenant_id, ticket_id, author_id, author_role, body, is_internal, created_at)
select v.id, 'd0000000-0000-0000-0000-000000000001', t.id, 'd0000000-0000-0000-0000-0000000000a1', v.author_role, v.body, v.is_internal, v.created_at
from (values
  ('c7000000-0000-0000-0000-000000000001'::uuid, 'Payslip not visible for last month', 'employee'::text, 'I still cannot see last month''s payslip in the ESS portal.'::text, false, now() - interval '4 days'),
  ('c7000000-0000-0000-0000-000000000002'::uuid, 'Payslip not visible for last month', 'hr',       'Thanks for flagging — the payroll run was finalised late. Payslips are now published; please refresh and check again.', false, now() - interval '3 days'),
  ('c7000000-0000-0000-0000-000000000003'::uuid, 'Payslip not visible for last month', 'hr',       'Internal: confirmed slip generated for SAAR003 in the previous run; no further action needed once the user refreshes.', true, now() - interval '3 days'),
  ('c7000000-0000-0000-0000-000000000004'::uuid, 'Update bank account details', 'employee', 'Attaching a cancelled cheque for the new account — please update before the next payroll cycle.', false, now() - interval '6 days'),
  ('c7000000-0000-0000-0000-000000000005'::uuid, 'Update bank account details', 'hr',       'Received. We are verifying the account details with Finance and will confirm shortly.', false, now() - interval '5 days'),
  ('c7000000-0000-0000-0000-000000000006'::uuid, 'Laptop running slow', 'hr',       'A RAM upgrade has been approved and the asset is scheduled for service. Marking this resolved.', false, now() - interval '2 days')
) as v(id, subject, author_role, body, is_internal, created_at)
join helpdesk_tickets t
  on t.tenant_id = 'd0000000-0000-0000-0000-000000000001' and t.subject = v.subject;

-- ============================================================================
--  4. ASSET CATEGORIES  (Assets → Categories master)
--     depreciation_method ∈ ('straight_line','declining_balance','none')
-- ============================================================================
insert into asset_categories (id, tenant_id, code, name, description, depreciation_method, useful_life_years, salvage_value_pct, requires_return, is_trackable, is_active) values
 ('c7300000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','LAPTOP','Laptop','Portable work computers issued to employees.', 'straight_line',     4, 10.00, true,  true,  true),
 ('c7300000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','MONITOR','Monitor','External displays and docking peripherals.',  'straight_line',     5,  5.00, true,  true,  true),
 ('c7300000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','PHONE','Mobile Phone','Company-issued smartphones.',           'declining_balance', 3, 15.00, true,  true,  true),
 ('c7300000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','ACCESS_CARD','Access Card','Office access / ID cards.',          'none',              0,  0.00, true,  true,  true);

-- ============================================================================
--  5. OVERTIME POLICY  (Attendance → Overtime → Policy config)
--     calculation_mode ∈ ('threshold','shift_end','fixed_rate')
--     rate_type        ∈ ('flat','multiplier')
--     extra_rate > 0;  caps respect the column CHECK ranges.
-- ============================================================================
insert into overtime_policies (id, tenant_id, name, description, calculation_mode, ot_start_after_minutes, max_ot_minutes_per_day, max_ot_minutes_per_week, max_ot_minutes_per_month, requires_approval, auto_approve_below_min, rate_type, extra_rate, weekend_rate, holiday_rate, rounding_minutes, is_default, is_active) values
 ('c7400000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Standard OT Policy','Default overtime policy: OT after 30 min past shift, 1.5x weekday / 2x weekend & holiday, auto-approve under 60 min.', 'threshold', 30, 240, 1200, 4800, true, 60, 'multiplier', 1.5000, 2.0000, 2.0000, 15, true, true);

-- A couple of employees explicitly assigned to the policy (one per employee).
insert into employee_overtime_policies (id, tenant_id, employee_id, ot_policy_id, effective_from) values
 ('c7410000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','c7400000-0000-0000-0000-000000000001', current_date - 90),
 ('c7410000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','c7400000-0000-0000-0000-000000000001', current_date - 90),
 ('c7410000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','c7400000-0000-0000-0000-000000000001', current_date - 60);

-- ============================================================================
--  6. STATUTORY CONFIG  (Settings → Statutory: EPF / ESI / P-Tax)
--     One open-ended (effective_to IS NULL) row per tenant for EPF & ESI — the
--     partial unique index allows exactly one such row.  Values mirror the
--     migration defaults (statutory FY 2025-26). GENERATED columns are never
--     inserted; both *_contributions tables are left untouched.
-- ============================================================================
insert into epf_config (id, tenant_id, employee_contribution_pct, employer_pf_pct, employer_eps_pct, wage_ceiling, is_wage_ceiling_applicable, allow_voluntary_pf, include_hra_in_pf_wages, pf_account_number, establishment_code, effective_from, effective_to, edli_rate_pct, edli_cap, edli_floor, admin_charges_pct) values
 ('c7500000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001', 12.00, 3.67, 8.33, 15000.00, true, true, false, 'KA/BNG/0012345/000', 'BNGCG0012345000', '2024-04-01', null, 0.50, 75.00, 25.00, 0.50);

insert into esi_config (id, tenant_id, employee_contribution_pct, employer_contribution_pct, wage_ceiling, effective_from, effective_to) values
 ('c7510000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001', 0.75, 3.25, 21000.00, '2024-04-01', null);

-- P-Tax slabs for Karnataka (HQ state). frequency / deduction_month use the
-- migration defaults (NOT NULL DEFAULT 'monthly' / null) so are omitted.
-- monthly_income_to = NULL means the open-ended top slab ("and above").
--
-- financial_year format: MUST be "YYYY-YY" (e.g. "2025-26"), matching
-- monthToFY() in apps/api/src/lib/statutory/statutory-governance.ts and the
-- format already used correctly by it_tax_slabs ("2024-25", "2025-26"). A
-- previous "YYYY-YYYY" value here ("2025-2026") never matched that query,
-- silently zeroing ptaxSlabs for every employee/month and leaving PT
-- permanently unresolvable — found via live payroll UAT (see
-- docs/UAT_LIVE_AUDIT.md UAT-022). Both the current and next FY are seeded
-- so payroll for the demo tenant's "current" month resolves without
-- requiring a manual annual slab-rollover step (Karnataka's PT slab
-- structure is unchanged across FY2025-26/FY2026-27).
insert into ptax_slabs (id, tenant_id, state_code, financial_year, gender, monthly_income_from, monthly_income_to, monthly_ptax, annual_ptax, is_active) values
 ('c7520000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','KA','2025-26','all',     0.00, 24999.99,   0.00,    0.00, true),
 ('c7520000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','KA','2025-26','all', 25000.00,     null, 200.00, 2400.00, true),
 ('c7520000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','KA','2026-27','all',     0.00, 24999.99,   0.00,    0.00, true),
 ('c7520000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','KA','2026-27','all', 25000.00,     null, 200.00, 2400.00, true);

-- P-Tax state enablement (Settings → Statutory → P-Tax states).
insert into ptax_state_settings (id, tenant_id, state_code, enabled, updated_by, registration_number, registration_date) values
 ('c7530000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','KA', true,  'd0000000-0000-0000-0000-0000000000a1', 'PT-KA-2024-778812', '2024-04-01'),
 ('c7530000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','MH', false, 'd0000000-0000-0000-0000-0000000000a1', null,                null);

commit;

-- ============================================================================
--  DONE. Notification templates + delivery log, helpdesk ticket comments,
--  asset categories, overtime policy (+ employee assignments) and statutory
--  config (EPF / ESI / P-Tax) now have demo data.
-- ============================================================================
