-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #8  (run AFTER seed-demo.sql)
--  Populates tables the ANALYTICS / INTELLIGENCE admin screens read but that the
--  core demo seed (and extras 1–7) leave empty:
--    · leave_requests            (extra approved/pending/rejected leaves for analytics)
--    · sites (+ employee→site links + headcount-by-site attribution)
--    · intelligence_digest       (Workforce Digest screen)
--    · workforce_staffing_snapshots + workforce_optimization_hints
--    · lwf_contributions         (Labour Welfare Fund — last finalized run)
--    · statutory_registrations   (PF / ESI / PT / — registration master)
--    · operational_incidents     (ops-health screen)
--    · onboarding pre-joinee funnel (sessions/documents/invitations/submissions/
--      draft profiles) so onboarding analytics populate
--    · attendance_exceptions     (exception analytics — distinct from anomalies)
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
--
--  Fixed IDs from seed-demo.sql:
--    tenant   = d0000000-0000-0000-0000-000000000001
--    profile  = d0000000-0000-0000-0000-0000000000a1   (Demo Admin / CHRO Priya = e01)
--    emp NN   = e0000000-0000-0000-0000-0000000000NN   (01..0c)
--    leave_types a8000000-…-0000000000N  (01 Casual, 02 Sick, 03 Earned, 04 Unpaid)
--    work_locations a4000000-…-01 (Bengaluru/KA), …-02 (Mumbai/MH)
--    finalized runs f0000000-…-01 (2 months ago) and …-02 (last month)
--  NEW rows in this file use fixed UUIDs prefixed c8.
-- ============================================================================
begin;

-- ── RESET (children before parents) ─────────────────────────────────────────
-- Every table here carries tenant_id and is deleted directly EXCEPT
-- pre_joinee_submissions (no tenant_id at delete-safety level — it has one, but
-- we delete it via its parent invitation to keep FK order clean) and
-- onboarding_documents / draft_employee_profiles (deleted via their session ids).
do $$
declare t text; tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  -- onboarding children (have tenant_id, but delete before their sessions anyway)
  foreach t in array array[
    'pre_joinee_submissions','pre_joinee_invitations',
    'draft_employee_profiles','onboarding_documents','onboarding_sessions',
    'attendance_exceptions',
    'operational_incidents',
    'statutory_registrations',
    'lwf_contributions',
    'workforce_optimization_hints','workforce_staffing_snapshots',
    'intelligence_digest'
  ] loop
    if to_regclass(t) is not null then
      execute format('delete from %I where tenant_id = $1', t) using tid;
    end if;
  end loop;

  -- leave_requests is shared with the core seed — only remove THIS file's rows
  -- (c85-prefixed) so the core seed's leave_requests are left intact.
  if to_regclass('leave_requests') is not null then
    delete from leave_requests
    where tenant_id = tid and id::text like 'c8500000-%';
  end if;

  -- Un-attribute the employees this file links to demo sites (so re-running is
  -- clean and the core seed's null site_id is restorable). Only clears the demo
  -- site ids this file assigns.
  if to_regclass('employees') is not null and to_regclass('sites') is not null then
    update employees set site_id = null
    where tenant_id = tid
      and site_id in (
        'c8000000-0000-0000-0000-000000000001',
        'c8000000-0000-0000-0000-000000000002',
        'c8000000-0000-0000-0000-000000000003',
        'c8000000-0000-0000-0000-000000000004'
      );
  end if;

  -- sites are a parent of statutory_registrations (already deleted above) and of
  -- the employee site_id link (already nulled above), so delete them last.
  if to_regclass('sites') is not null then
    delete from sites where tenant_id = tid;
  end if;
end $$;

-- ============================================================================
--  1. LEAVE REQUESTS  (041, canonical)  — extra approved/pending/rejected leaves
--     for richer leave analytics. status UPPERCASE; computed_days + requested_by
--     are NOT NULL; APPROVED requires approved_by + approved_at (lr CHECK).
--     c85-prefixed ids so the reset only clears this file's rows, not the core
--     seed's leave_requests.
-- ============================================================================
insert into leave_requests (id, tenant_id, employee_id, leave_type_id, from_date, to_date, computed_days, half_day, status, reason, rejection_reason, requested_by, approved_by, approved_at) values
 ('c8500000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','a8000000-0000-0000-0000-000000000001', current_date - 40, current_date - 39, 2.0, false,'APPROVED','Personal errand.',               null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '42 days'),
 ('c8500000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','a8000000-0000-0000-0000-000000000002', current_date - 32, current_date - 31, 2.0, false,'APPROVED','Viral fever — bed rest advised.',null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '33 days'),
 ('c8500000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','a8000000-0000-0000-0000-000000000003', current_date - 25, current_date - 21, 5.0, false,'APPROVED','Family vacation.',               null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '27 days'),
 ('c8500000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006','a8000000-0000-0000-0000-000000000001', current_date - 18, current_date - 18, 0.5, true, 'APPROVED','Half-day for bank work.',        null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '19 days'),
 ('c8500000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','a8000000-0000-0000-0000-000000000002', current_date - 12, current_date - 11, 2.0, false,'APPROVED','Sick leave.',                    null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '13 days'),
 ('c8500000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','a8000000-0000-0000-0000-000000000003', current_date - 7,  current_date - 5,  3.0, false,'APPROVED','Short personal trip.',           null,                          'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '9 days'),
 ('c8500000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c','a8000000-0000-0000-0000-000000000001', current_date + 4,  current_date + 4,  1.0, false,'PENDING', 'Festival at home.',              null,                          'd0000000-0000-0000-0000-0000000000a1', null,                                   null),
 ('c8500000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000007','a8000000-0000-0000-0000-000000000003', current_date + 9,  current_date + 13, 5.0, false,'PENDING', 'Pre-planned annual leave.',      null,                          'd0000000-0000-0000-0000-0000000000a1', null,                                   null),
 ('c8500000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','a8000000-0000-0000-0000-000000000004', current_date - 3,  current_date - 3,  1.0, false,'REJECTED','Leave without pay — no balance.','No leave balance available.','d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '2 days');

-- ============================================================================
--  2. SITES  (057 + 248 dims + 166 state_code)  mirroring the demo work locations
--     + link employees to a site so SUP.headcount.by_site attributes correctly.
--     The intelligence /org/headcount-by-site route maps employees.site_id →
--     sites.id (employees.site_id added in migration 060), so we set site_id.
-- ============================================================================
insert into sites (id, tenant_id, name, location, timezone, site_type, city, region, zone, state_code) values
 ('c8000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Bengaluru HQ',    'Koramangala, Bengaluru', 'Asia/Kolkata','office',   'Bengaluru','South','Bengaluru Metro','KA'),
 ('c8000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Mumbai Office',   'Bandra Kurla Complex, Mumbai','Asia/Kolkata','office','Mumbai',  'West', 'Mumbai Metro',   'MH'),
 ('c8000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Delhi Sales Hub', 'Connaught Place, New Delhi','Asia/Kolkata','office','New Delhi','North','NCR',            'DL'),
 ('c8000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Pune Warehouse',  'Hinjawadi, Pune','Asia/Kolkata','warehouse','Pune',     'West', 'Pune',           'MH');

-- Attribute each active employee to a site (mirrors their work_location; the two
-- Mumbai-located employees go to the Mumbai office, the rest to Bengaluru HQ; a
-- couple spread to Delhi/Pune for a richer by-site rollup).
update employees set site_id = 'c8000000-0000-0000-0000-000000000002'
 where tenant_id = 'd0000000-0000-0000-0000-000000000001'
   and id in ('e0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000008');
update employees set site_id = 'c8000000-0000-0000-0000-000000000003'
 where tenant_id = 'd0000000-0000-0000-0000-000000000001'
   and id = 'e0000000-0000-0000-0000-00000000000a';
update employees set site_id = 'c8000000-0000-0000-0000-000000000004'
 where tenant_id = 'd0000000-0000-0000-0000-000000000001'
   and id = 'e0000000-0000-0000-0000-000000000006';
update employees set site_id = 'c8000000-0000-0000-0000-000000000001'
 where tenant_id = 'd0000000-0000-0000-0000-000000000001'
   and site_id is null;

-- ============================================================================
--  3. STATUTORY REGISTRATIONS  (166 + 183)  — tenant/site PF / ESI / PT codes
--     statutory_type ∈ ('epf','esi','ptax'). is_default flags the primary code.
-- ============================================================================
insert into statutory_registrations (id, tenant_id, site_id, statutory_type, registration_number, state_code, effective_from, is_active, notes, created_by, code_label, is_default, pf_sub_code) values
 ('c8100000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001',null,                                   'epf',  'KABNG1234567000', 'KA', date '2019-04-01', true, 'Primary EPF establishment.',           'd0000000-0000-0000-0000-0000000000a1','Bengaluru HQ', true,  '000'),
 ('c8100000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001',null,                                   'esi',  '53000123450000101','KA', date '2019-04-01', true, 'Primary ESI code.',                    'd0000000-0000-0000-0000-0000000000a1','Bengaluru HQ', true,  null),
 ('c8100000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001', 'ptax','KAPT0012345',     'KA', date '2019-04-01', true, 'Karnataka Professional Tax (PTRC).',   'd0000000-0000-0000-0000-0000000000a1','Karnataka PT', true,  null),
 ('c8100000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000002', 'ptax','MHPT0098765',     'MH', date '2020-06-01', true, 'Maharashtra Professional Tax (PTRC).', 'd0000000-0000-0000-0000-0000000000a1','Maharashtra PT',false, null);

-- ============================================================================
--  4. INTELLIGENCE DIGEST  (213)  — Workforce Digest screen reads this.
--     period_type defaults 'monthly'; UNIQUE (tenant_id, period_type, period_start).
-- ============================================================================
insert into intelligence_digest (tenant_id, period_type, period_start, period_end, narrative, metrics, generated_at) values
 ('d0000000-0000-0000-0000-000000000001','monthly',
   date_trunc('month', current_date - interval '1 month')::date,
   (date_trunc('month', current_date)::date - 1),
   'Total active headcount stands at 12 employees. 1 new joiner and 0 exits in the period. Attendance is healthy at 98% present; 2 attendance exceptions are open. 6 leave applications were approved. Payroll for the period finalised on schedule with no blockers.',
   '{"headcount":12,"joiners":1,"exits":0,"net_change":1,"attendance_present_pct":98,"open_exceptions":2,"leaves_approved":6,"probation_backlog":0}'::jsonb,
   now() - interval '20 days'),
 ('d0000000-0000-0000-0000-000000000001','monthly',
   date_trunc('month', current_date)::date,
   (date_trunc('month', current_date + interval '1 month')::date - 1),
   'Total active headcount stands at 12 employees across 4 sites. 0 new joiners and 0 exits so far this month. 2 leave applications are pending approval and 1 onboarding session is in HR review. No critical operational incidents are open.',
   '{"headcount":12,"sites":4,"joiners":0,"exits":0,"net_change":0,"leaves_pending":2,"onboarding_in_review":1,"open_incidents":1}'::jsonb,
   now() - interval '1 day');

-- ============================================================================
--  5. WORKFORCE STAFFING SNAPSHOTS + OPTIMIZATION HINTS  (086)
--     snapshot UNIQUE (tenant_id, department_id, snapshot_date); staffing_pressure
--     ∈ ('low','normal','elevated','critical'); hint_type / severity per CHECK.
-- ============================================================================
insert into workforce_staffing_snapshots (tenant_id, department_id, site_id, snapshot_date, required_headcount, scheduled_headcount, present_headcount, coverage_ratio, ot_headcount, understaffed, overstaffed, staffing_pressure, computed_at) values
 ('d0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001', current_date - 2, 6, 6, 5, 0.8333, 2, true,  false, 'elevated', now() - interval '2 days'),
 ('d0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','c8000000-0000-0000-0000-000000000002', current_date - 2, 2, 2, 2, 1.0000, 0, false, false, 'normal',   now() - interval '2 days'),
 ('d0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000005','c8000000-0000-0000-0000-000000000004', current_date - 2, 2, 1, 1, 0.5000, 1, true,  false, 'critical', now() - interval '2 days'),
 ('d0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001', current_date - 1, 6, 6, 6, 1.0000, 1, false, false, 'normal',   now() - interval '1 day'),
 ('d0000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000003','c8000000-0000-0000-0000-000000000001', current_date - 1, 2, 2, 2, 1.0000, 0, false, false, 'low',      now() - interval '1 day');

insert into workforce_optimization_hints (tenant_id, employee_id, department_id, period_start, period_end, hint_type, severity, title, explanation, affected_dates, metric_value, threshold_value, payroll_impact, resolved, created_at) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000001', current_date - 14, current_date - 1, 'ot_concentration',  'high',   'Overtime concentrated on one engineer', 'Arjun Rampal accounts for 62% of Engineering overtime this fortnight — redistribute on-call to avoid burnout.', array[(current_date - 4)::text, (current_date - 9)::text], 62.00, 40.00, 8200.00, false, now() - interval '1 day'),
 ('d0000000-0000-0000-0000-000000000001',null,                                   'a1000000-0000-0000-0000-000000000005', current_date - 7,  current_date - 1, 'staffing_pressure', 'critical','Operations site understaffed',          'Pune Warehouse ran at 50% coverage on the latest snapshot day — schedule additional cover or approve OT.', array[(current_date - 2)::text], 0.50, 0.85, 0.00, false, now() - interval '2 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000008','a1000000-0000-0000-0000-000000000005', current_date - 30, current_date - 16,'weekend_imbalance', 'medium', 'Weekend shifts skewed',                 'Vikram Singh worked 3 of the last 4 weekend shifts at the Mumbai office — rotate weekend duty.', array[(current_date - 18)::text, (current_date - 25)::text], 3.00, 1.00, 0.00, true,  now() - interval '15 days');

-- ============================================================================
--  6. LWF CONTRIBUTIONS  (229)  — Labour Welfare Fund for the last finalized run.
--     LWF is a small fixed state amount (not wage-driven like EPF/ESI). Seeded
--     per applicable employee for last month's contribution_month, by work state.
--     KA half-yearly ≈ ₹20 EE / ₹40 ER; MH ≈ ₹12 EE / ₹36 ER (illustrative demo
--     figures). gross_salary mirrors the slip gross (= CTC/12 − employer PF).
--     UNIQUE (tenant_id, employee_id, contribution_month).
-- ============================================================================
insert into lwf_contributions (tenant_id, employee_id, contribution_month, state_code, gross_salary, employee_contribution, employer_contribution, is_eligible)
select 'd0000000-0000-0000-0000-000000000001', e.id,
       to_char(current_date - interval '1 month','YYYY-MM'),
       case when e.work_location_id = 'a4000000-0000-0000-0000-000000000002' then 'MH' else 'KA' end,
       round(ec.ctc_annual/12.0) - 1800,
       case when e.work_location_id = 'a4000000-0000-0000-0000-000000000002' then 12 else 20 end,
       case when e.work_location_id = 'a4000000-0000-0000-0000-000000000002' then 36 else 40 end,
       true
from employees e
join employee_compensations ec
  on ec.employee_id = e.id and ec.tenant_id = e.tenant_id and ec.is_active = true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  7. OPERATIONAL INCIDENTS  (090)  — ops-health screen (mixed severity/status).
--     incident_type / severity / status / source per CHECK constraints.
-- ============================================================================
insert into operational_incidents (id, tenant_id, incident_type, severity, status, title, description, employee_id, department_id, assigned_to, resolved_by, resolved_at, resolution_note, payroll_impact_amount, affected_employee_count, sla_target_hours, sla_breached, source, created_by, created_at) values
 ('c8200000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','staffing_shortage','high','open',          'Pune Warehouse short-staffed for evening shift', 'Coverage dropped to 50% on the latest snapshot; one operations associate on leave with no backup scheduled.', null, 'a1000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-0000000000a1', null, null, null, 0,    2, 24, false, 'system', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '2 days'),
 ('c8200000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','attendance_integrity','medium','investigating','Duplicate punches detected at Delhi hub',     'Biometric device replayed punches for one employee; flagged for manual review before payroll lock.', 'e0000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-0000000000a1', null, null, null, 0, 1, 48, false, 'alert',  'd0000000-0000-0000-0000-0000000000a1', now() - interval '4 days'),
 ('c8200000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','workforce_overload','high','escalated',      'Sustained overtime in Engineering',           'One senior engineer carried >60% of OT for two consecutive weeks; escalated to the engineering manager.', 'e0000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1', null, null, null, 8200, 1, 72, true,  'system', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days'),
 ('c8200000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','system_outage','low','resolved',             'Attendance sync delay',                       'Nightly attendance import lagged by two hours; auto-recovered after the queue drained.', null, null, 'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '9 days', 'Queue cleared; no data loss. Monitoring added.', 0, 0, 12, false, 'system', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '10 days'),
 ('c8200000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','compliance_breach','critical','mitigating',  'PT registration missing for new site',        'Pune Warehouse activated without a mapped Professional Tax registration; payroll PT deduction at risk.', null, 'a1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-0000000000a1', null, null, null, 0, 4, 48, false, 'manual', 'd0000000-0000-0000-0000-0000000000a1', now() - interval '1 day');

-- ============================================================================
--  8. ONBOARDING PRE-JOINEE FUNNEL  (109 + 178 + 207 + 209)
--     A small funnel so onboarding analytics populate:
--       · Session A: candidate submitted form → in HR review (draft ready)
--       · Session B: invited only, awaiting submission
--     Wiring: pre_joinee_invitations.session_id → onboarding_sessions.id;
--             pre_joinee_submissions.invitation_id → pre_joinee_invitations.id;
--             onboarding_documents.session_id + draft_employee_profiles.session_id.
-- ============================================================================
insert into onboarding_sessions (id, tenant_id, candidate_name, status, extraction_progress, assigned_to, created_by, created_at) values
 ('c8300000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Sanya Kapoor','hr_review',   100, 'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '6 days'),
 ('c8300000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Imran Sheikh','draft_ready', 100, 'd0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '3 days');

insert into onboarding_documents (id, tenant_id, session_id, document_type, file_name, file_size, mime_type, storage_path, extraction_status, confidence_score, review_status, page_count, uploaded_by, uploaded_at) values
 ('c8310000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000001','pan',         'sanya-pan.pdf',     180000, 'application/pdf','demo/onboarding/c83-01-pan.pdf',    'extracted', 0.970, 'approved', 1, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days'),
 ('c8310000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000001','aadhaar',     'sanya-aadhaar.pdf', 220000, 'application/pdf','demo/onboarding/c83-01-aadhaar.pdf','extracted', 0.940, 'approved', 2, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days'),
 ('c8310000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000001','resume',      'sanya-resume.pdf',  340000, 'application/pdf','demo/onboarding/c83-01-resume.pdf', 'extracted', 0.910, 'reviewed', 3, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '6 days'),
 ('c8310000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000002','pan',         'imran-pan.pdf',     175000, 'application/pdf','demo/onboarding/c83-02-pan.pdf',    'extracted', 0.960, 'pending',  1, 'd0000000-0000-0000-0000-0000000000a1', now() - interval '3 days');

insert into draft_employee_profiles (id, tenant_id, session_id, status, first_name, last_name, email, phone, dob, gender, address_city, address_state, employee_code, joining_date, department_id, designation_id, grade_id, employment_type, pan_number, ctc_annual, overall_confidence, created_at) values
 ('c8320000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000001','hr_review_pending','Sanya','Kapoor','sanya.kapoor@example.com','+91-9820000051','1995-08-14','female','Bengaluru','Karnataka','SAAR013', current_date + 10, 'a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004','a3000000-0000-0000-0000-000000000004','permanent','AFZPK1234L', 1300000, 0.9300, now() - interval '6 days'),
 ('c8320000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','c8300000-0000-0000-0000-000000000002','draft_ready',      'Imran','Sheikh','imran.sheikh@example.com','+91-9820000052','1993-02-09','male',  'Mumbai',   'Maharashtra','SAAR014', current_date + 21, 'a1000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000006','a3000000-0000-0000-0000-000000000004','permanent','BKLPS5678M', 1500000, 0.9100, now() - interval '3 days');

-- Invitations (linked to the sessions above) — one submitted, one still pending.
insert into pre_joinee_invitations (id, tenant_id, token, first_name, last_name, email, phone, designation, department, joining_date, status, created_by, session_id, created_at) values
 ('c8330000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','demo-prejoinee-token-sanya-0001','Sanya','Kapoor','sanya.kapoor@example.com','+91-9820000051','Software Engineer','Engineering', current_date + 10, 'submitted','d0000000-0000-0000-0000-0000000000a1','c8300000-0000-0000-0000-000000000001', now() - interval '8 days'),
 ('c8330000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','demo-prejoinee-token-imran-0002','Imran','Sheikh','imran.sheikh@example.com','+91-9820000052','Sales Executive','Sales',      current_date + 21, 'pending',  'd0000000-0000-0000-0000-0000000000a1','c8300000-0000-0000-0000-000000000002', now() - interval '4 days');

-- Submission for the submitted invitation (Sanya). pre_joinee_submissions has a
-- UNIQUE invitation_id; only the submitted candidate has one.
insert into pre_joinee_submissions (id, invitation_id, tenant_id, dob, gender, nationality, address_line1, city, state, pincode, emergency_contact_name, emergency_contact_phone, emergency_contact_relation, bank_name, bank_account_number, bank_ifsc, bank_account_type, pan_number, aadhaar_number, documents_uploaded, declaration_accepted, submitted_at, created_at) values
 ('c8340000-0000-0000-0000-000000000001','c8330000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','1995-08-14','female','Indian','14 4th Block, Koramangala','Bengaluru','Karnataka','560034','Rahul Kapoor','+91-9820000061','Brother','HDFC Bank','50100123456789','HDFC0001234','savings','AFZPK1234L','123412341234', true, true, now() - interval '6 days', now() - interval '6 days');

-- ============================================================================
--  9. ATTENDANCE EXCEPTIONS  (081)  — exception analytics (distinct from the
--     attendance_anomalies already seeded). exception_category / severity /
--     status / source per CHECK; confidence_impact ∈ [0,1]. exception_type is
--     free text.
-- ============================================================================
insert into attendance_exceptions (tenant_id, employee_id, date, exception_type, exception_category, severity, payroll_impacting, requires_investigation, confidence_impact, status, sla_due_at, sla_breached, resolution_note, resolved_by, resolved_at, source, metadata, created_at) values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a', current_date - 4, 'duplicate_punch',     'integrity', 'high',     true,  true,  0.40, 'open',         now() + interval '1 day',  false, null,                                  null,                                   null,                       'system', '{"device":"DEL-BIO-02"}'::jsonb, now() - interval '4 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000006', current_date - 3, 'missing_punch',       'punch',     'medium',   true,  false, 0.25, 'acknowledged', now() + interval '2 days', false, null,                                  null,                                   null,                       'system', '{}'::jsonb,                      now() - interval '3 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003', current_date - 6, 'late_arrival',        'policy',    'low',      false, false, 0.10, 'resolved',     now() - interval '5 days', false, 'Within grace after manager note.',    'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days', 'system', '{}'::jsonb,                      now() - interval '6 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005', current_date - 8, 'excessive_hours',     'shift',     'medium',   false, false, 0.20, 'dismissed',    now() - interval '7 days', false, 'Approved overtime — not an exception.','d0000000-0000-0000-0000-0000000000a1', now() - interval '7 days', 'system', '{}'::jsonb,                      now() - interval '8 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000b', current_date - 2, 'device_offline',      'device',    'high',     false, true,  0.30, 'escalated',    now() - interval '1 day',  true,  null,                                  null,                                   null,                       'system', '{"site":"Bengaluru HQ"}'::jsonb, now() - interval '2 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004', current_date - 5, 'geo_mismatch',        'geo',       'medium',   false, true,  0.35, 'open',         now() + interval '1 day',  false, null,                                  null,                                   null,                       'system', '{}'::jsonb,                      now() - interval '5 days');

commit;

-- ============================================================================
--  DONE. leave_requests, sites (+ employee links), statutory_registrations,
--  intelligence_digest, workforce staffing snapshots + optimization hints,
--  lwf_contributions, operational_incidents, the onboarding pre-joinee funnel
--  and attendance_exceptions now have demo data for the analytics/intelligence
--  screens.
--
--  SKIPPED: none of the requested tables were impractical — all were seeded.
-- ============================================================================
