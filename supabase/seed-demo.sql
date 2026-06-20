-- ============================================================================
--  CognixHR — DEMO TENANT SEED
--  Creates ONE tenant ("Demo") pre-loaded with a good chunk of data across all
--  modules, plus a pre-login admin user the website can auto-sign-in as.
--
--  HOW TO RUN
--    • Supabase SQL Editor: paste this whole file and Run, OR
--    • psql "$DATABASE_URL" -f supabase/seed-demo.sql
--
--  Demo login (auto-used by the website):
--    email:    demo@cognixhr.app
--    password: CognixDemo!1
--
--  Idempotent: re-running wipes the demo tenant + demo user and reseeds fresh.
--  Requires the pgcrypto extension (Supabase has it; `crypt`/`gen_salt`).
--
--  NOTE on the auth user: creating auth.users via SQL is the one part that is
--  sensitive to your Supabase/GoTrue version. If the INSERT into auth.users
--  fails, create the user once in Dashboard → Authentication → Add user
--  (email demo@cognixhr.app, password above, auto-confirm), copy its UID into
--  :demo_user below, delete the auth.users/auth.identities INSERTs, and re-run.
-- ============================================================================

begin;

-- Fixed IDs (deterministic so re-runs are stable):
--   tenant = d0000000-0000-0000-0000-000000000001
--   demo user/profile = d0000000-0000-0000-0000-0000000000a1
--   employees = e0000000-…-0000000000NN  (NN = 01..0c)

-- ============================================================================
--  0. RESET — remove any previous demo data so this is safe to re-run
-- ============================================================================
-- Recruitment / misc tables whose tenant_id has NO cascade FK must be cleared
-- explicitly; the rest cascade when the tenant row is deleted.
delete from interview_scores      where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from interview_panel       where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from interview_rounds      where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from applications          where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from candidates            where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from job_requisitions      where tenant_id = 'd0000000-0000-0000-0000-000000000001';
delete from recruitment_pipeline_stages where tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- Deleting the tenant cascades to all tenant_id-FK tables (employees, payroll,
-- attendance, leave, helpdesk, assets, masters, profiles, …).
delete from tenants where id = 'd0000000-0000-0000-0000-000000000001';

-- Demo auth user (separate from tenant cascade).
delete from auth.identities where user_id = 'd0000000-0000-0000-0000-0000000000a1';
delete from auth.users      where id      = 'd0000000-0000-0000-0000-0000000000a1';

-- ============================================================================
--  1. AUTH USER  (profiles.id must equal a real auth.users.id)
-- ============================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-0000-0000-0000000000a1',
  'authenticated', 'authenticated',
  'demo@cognixhr.app',
  crypt('CognixDemo!1', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Demo Admin"}',
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  'd0000000-0000-0000-0000-0000000000a1',
  'd0000000-0000-0000-0000-0000000000a1',
  '{"sub":"d0000000-0000-0000-0000-0000000000a1","email":"demo@cognixhr.app","email_verified":true}',
  'email', now(), now(), now()
);

-- ============================================================================
--  2. TENANT + PROFILE
-- ============================================================================
insert into tenants (id, name, slug, plan, country, timezone, status, trial_ends_at, created_at)
values ('d0000000-0000-0000-0000-000000000001', 'Demo', 'demo', 'enterprise', 'IN',
        'Asia/Kolkata', 'active', now() + interval '365 days', now());

-- profile links the auth user → tenant. employee_id is set AFTER employees are
-- inserted (profiles.employee_id has an FK to employees → chicken-and-egg).
insert into profiles (id, tenant_id, role, is_active, full_name, email, employee_id)
values ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000001',
        'hr_admin', true, 'Demo Admin', 'demo@cognixhr.app', null);

-- ============================================================================
--  3. MASTERS
-- ============================================================================
-- Departments
insert into departments (id, tenant_id, name, code, slug) values
 ('a1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Engineering','ENG','engineering'),
 ('a1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Sales','SAL','sales'),
 ('a1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Finance','FIN','finance'),
 ('a1000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Human Resources','HR','human-resources'),
 ('a1000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','Operations','OPS','operations'),
 ('a1000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','Marketing','MKT','marketing');

-- Designations
insert into designations (id, tenant_id, name, code, department_id) values
 ('a2000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Chief HR Officer','CHRO','a1000000-0000-0000-0000-000000000004'),
 ('a2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Engineering Manager','EM','a1000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Senior Software Engineer','SSE','a1000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Software Engineer','SE','a1000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','Sales Manager','SM','a1000000-0000-0000-0000-000000000002'),
 ('a2000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','Sales Executive','SX','a1000000-0000-0000-0000-000000000002'),
 ('a2000000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','Finance Manager','FM','a1000000-0000-0000-0000-000000000003'),
 ('a2000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','Finance Analyst','FA','a1000000-0000-0000-0000-000000000003'),
 ('a2000000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000001','Operations Lead','OL','a1000000-0000-0000-0000-000000000005'),
 ('a2000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','Marketing Specialist','MS','a1000000-0000-0000-0000-000000000006'),
 ('a2000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-000000000001','HR Executive','HRE','a1000000-0000-0000-0000-000000000004');

-- Grades
insert into grades (id, tenant_id, name, code, level_order, ctc_min_annual, ctc_max_annual) values
 ('a3000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','L5','L5',5,4000000,7000000),
 ('a3000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','L4','L4',4,2500000,4000000),
 ('a3000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','L3','L3',3,1500000,2500000),
 ('a3000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','L2','L2',2,800000,1500000),
 ('a3000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','L1','L1',1,400000,800000);

-- Work locations
insert into work_locations (id, tenant_id, name, code, city, state, country) values
 ('a4000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Bengaluru HQ','BLR','Bengaluru','Karnataka','India'),
 ('a4000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Mumbai Office','BOM','Mumbai','Maharashtra','India');

-- Cost centers
insert into cost_centers (id, tenant_id, name, code) values
 ('a5000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Technology','CC-TECH'),
 ('a5000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Revenue','CC-REV'),
 ('a5000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Corporate','CC-CORP');

-- Shift
insert into shifts (id, tenant_id, name, code, start_time, end_time, work_hours, grace_minutes) values
 ('a6000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','General Shift','GEN','09:00','18:00',8.5,15);

-- Payroll group
insert into payroll_groups (id, tenant_id, code, name, cycle_type, cutoff_day, payout_day) values
 ('a7000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','PG-IN','India Monthly','monthly',25,1);

-- Leave types
insert into leave_types (id, tenant_id, name, is_paid) values
 ('a8000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Casual Leave',true),
 ('a8000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Sick Leave',true),
 ('a8000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Earned Leave',true),
 ('a8000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Unpaid Leave',false);

-- Salary components
insert into salary_components (id, tenant_id, name, code, component_type, is_taxable) values
 ('a9000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Basic Salary','BASIC','earning',true),
 ('a9000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','House Rent Allowance','HRA','earning',true),
 ('a9000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Special Allowance','SPECIAL','earning',true),
 ('a9000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Conveyance','CONV','earning',false),
 ('a9000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','Provident Fund (EE)','PF_EE','deduction',false),
 ('a9000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','Professional Tax','PT','deduction',false),
 ('a9000000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','TDS','TDS','deduction',false),
 ('a9000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','Provident Fund (ER)','PF_ER','employer_contribution',false);

-- Salary structure (+ component links)
insert into salary_structures (id, tenant_id, name, code) values
 ('aa000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Standard CTC','STD');
insert into salary_structure_components (tenant_id, salary_structure_id, salary_component_id, calculation_type, default_value, sequence)
select 'd0000000-0000-0000-0000-000000000001','aa000000-0000-0000-0000-000000000001', c.id, c.ct, c.val, c.seq
from (values
  ('a9000000-0000-0000-0000-000000000001'::uuid,'pct_of_ctc',40,1),
  ('a9000000-0000-0000-0000-000000000002'::uuid,'pct_of_basic',50,2),
  ('a9000000-0000-0000-0000-000000000003'::uuid,'pct_of_ctc',25,3),
  ('a9000000-0000-0000-0000-000000000004'::uuid,'fixed',1600,4),
  ('a9000000-0000-0000-0000-000000000005'::uuid,'fixed',1800,5),
  ('a9000000-0000-0000-0000-000000000006'::uuid,'fixed',200,6),
  ('a9000000-0000-0000-0000-000000000007'::uuid,'pct_of_ctc',8,7),
  ('a9000000-0000-0000-0000-000000000008'::uuid,'fixed',1800,8)
) as c(id, ct, val, seq);

-- Recruitment pipeline stages
insert into recruitment_pipeline_stages (id, tenant_id, name, stage_order, stage_type, color) values
 ('ab000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Applied',1,'applied','#6B7280'),
 ('ab000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Screening',2,'screening','#2E6FE6'),
 ('ab000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Interview',3,'technical','#8B5CF6'),
 ('ab000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Offer',4,'offer','#F59E0B'),
 ('ab000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','Hired',5,'final','#15B8A6');

-- ============================================================================
--  4. EMPLOYEES  (lean table) — 12 people
-- ============================================================================
insert into employees (id, tenant_id, employee_code, first_name, last_name, email, phone, joining_date, status, work_location_id, manager_id) values
 ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','SAAR001','Priya','Sharma','priya.sharma@demo.cognixhr.app','+91-9800000001','2019-04-15','active','a4000000-0000-0000-0000-000000000001',null),
 ('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','SAAR002','Rahul','Verma','rahul.verma@demo.cognixhr.app','+91-9800000002','2020-06-01','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','SAAR003','Deepak','Chawla','deepak.chawla@demo.cognixhr.app','+91-9800000003','2021-02-10','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002'),
 ('e0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','SAAR004','Sneha','Sen','sneha.sen@demo.cognixhr.app','+91-9800000004','2020-09-21','active','a4000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','SAAR005','Arjun','Rampal','arjun.rampal@demo.cognixhr.app','+91-9800000005','2021-07-05','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002'),
 ('e0000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','SAAR006','Nandini','Gupta','nandini.gupta@demo.cognixhr.app','+91-9800000006','2021-11-18','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002'),
 ('e0000000-0000-0000-0000-000000000007','d0000000-0000-0000-0000-000000000001','SAAR007','Ayesha','Ahmed','ayesha.ahmed@demo.cognixhr.app','+91-9800000007','2022-03-14','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000c'),
 ('e0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001','SAAR008','Vikram','Singh','vikram.singh@demo.cognixhr.app','+91-9800000008','2020-12-01','active','a4000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-000000000009','d0000000-0000-0000-0000-000000000001','SAAR009','Kavya','Nair','kavya.nair@demo.cognixhr.app','+91-9800000009','2022-08-22','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','SAAR010','Rohan','Mehta','rohan.mehta@demo.cognixhr.app','+91-9800000010','2023-01-09','active','a4000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000004'),
 ('e0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-000000000001','SAAR011','Ananya','Iyer','ananya.iyer@demo.cognixhr.app','+91-9800000011','2022-05-30','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001'),
 ('e0000000-0000-0000-0000-00000000000c','d0000000-0000-0000-0000-000000000001','SAAR012','Karan','Patel','karan.patel@demo.cognixhr.app','+91-9800000012','2020-10-12','active','a4000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001');

-- Now that the employees exist, link the demo admin profile to the CHRO record.
update profiles set employee_id = 'e0000000-0000-0000-0000-000000000001'
where id = 'd0000000-0000-0000-0000-0000000000a1';

-- Job history (dept/designation/grade/employment_type/manager live HERE)
insert into job_history (tenant_id, employee_id, employment_type, effective_from, is_current, department_id, designation_id, grade_id, work_location_id, manager_id)
select 'd0000000-0000-0000-0000-000000000001', j.emp, j.et, j.eff, true, j.dept, j.desig, j.grade, j.loc, j.mgr
from (values
 ('e0000000-0000-0000-0000-000000000001'::uuid,'permanent','2019-04-15'::date,'a1000000-0000-0000-0000-000000000004'::uuid,'a2000000-0000-0000-0000-000000000001'::uuid,'a3000000-0000-0000-0000-000000000001'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,null::uuid),
 ('e0000000-0000-0000-0000-000000000002'::uuid,'permanent','2020-06-01'::date,'a1000000-0000-0000-0000-000000000001'::uuid,'a2000000-0000-0000-0000-000000000002'::uuid,'a3000000-0000-0000-0000-000000000002'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid),
 ('e0000000-0000-0000-0000-000000000003'::uuid,'permanent','2021-02-10'::date,'a1000000-0000-0000-0000-000000000001'::uuid,'a2000000-0000-0000-0000-000000000003'::uuid,'a3000000-0000-0000-0000-000000000003'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000002'::uuid),
 ('e0000000-0000-0000-0000-000000000004'::uuid,'permanent','2020-09-21'::date,'a1000000-0000-0000-0000-000000000002'::uuid,'a2000000-0000-0000-0000-000000000005'::uuid,'a3000000-0000-0000-0000-000000000002'::uuid,'a4000000-0000-0000-0000-000000000002'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid),
 ('e0000000-0000-0000-0000-000000000005'::uuid,'permanent','2021-07-05'::date,'a1000000-0000-0000-0000-000000000001'::uuid,'a2000000-0000-0000-0000-000000000004'::uuid,'a3000000-0000-0000-0000-000000000003'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000002'::uuid),
 ('e0000000-0000-0000-0000-000000000006'::uuid,'permanent','2021-11-18'::date,'a1000000-0000-0000-0000-000000000001'::uuid,'a2000000-0000-0000-0000-000000000004'::uuid,'a3000000-0000-0000-0000-000000000003'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000002'::uuid),
 ('e0000000-0000-0000-0000-000000000007'::uuid,'permanent','2022-03-14'::date,'a1000000-0000-0000-0000-000000000003'::uuid,'a2000000-0000-0000-0000-000000000008'::uuid,'a3000000-0000-0000-0000-000000000004'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-00000000000c'::uuid),
 ('e0000000-0000-0000-0000-000000000008'::uuid,'permanent','2020-12-01'::date,'a1000000-0000-0000-0000-000000000005'::uuid,'a2000000-0000-0000-0000-000000000009'::uuid,'a3000000-0000-0000-0000-000000000003'::uuid,'a4000000-0000-0000-0000-000000000002'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid),
 ('e0000000-0000-0000-0000-000000000009'::uuid,'permanent','2022-08-22'::date,'a1000000-0000-0000-0000-000000000006'::uuid,'a2000000-0000-0000-0000-00000000000a'::uuid,'a3000000-0000-0000-0000-000000000004'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid),
 ('e0000000-0000-0000-0000-00000000000a'::uuid,'contract','2023-01-09'::date,'a1000000-0000-0000-0000-000000000002'::uuid,'a2000000-0000-0000-0000-000000000006'::uuid,'a3000000-0000-0000-0000-000000000004'::uuid,'a4000000-0000-0000-0000-000000000002'::uuid,'e0000000-0000-0000-0000-000000000004'::uuid),
 ('e0000000-0000-0000-0000-00000000000b'::uuid,'permanent','2022-05-30'::date,'a1000000-0000-0000-0000-000000000004'::uuid,'a2000000-0000-0000-0000-00000000000b'::uuid,'a3000000-0000-0000-0000-000000000004'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid),
 ('e0000000-0000-0000-0000-00000000000c'::uuid,'permanent','2020-10-12'::date,'a1000000-0000-0000-0000-000000000003'::uuid,'a2000000-0000-0000-0000-000000000007'::uuid,'a3000000-0000-0000-0000-000000000002'::uuid,'a4000000-0000-0000-0000-000000000001'::uuid,'e0000000-0000-0000-0000-000000000001'::uuid)
) as j(emp, et, eff, dept, desig, grade, loc, mgr);

-- Everyone on the General shift
insert into employee_shifts (tenant_id, employee_id, shift_id, effective_from, is_current)
select 'd0000000-0000-0000-0000-000000000001', e.id, 'a6000000-0000-0000-0000-000000000001', e.joining_date, true
from employees e where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  5. COMPENSATION  (one active comp per employee + component breakdown)
-- ============================================================================
insert into employee_compensations (id, tenant_id, employee_id, salary_structure_id, effective_from, ctc_annual, is_active)
select ('c0000000-0000-0000-0000-0000000000' || substr(e.id, 35, 2))::uuid,
       'd0000000-0000-0000-0000-000000000001', e.id, 'aa000000-0000-0000-0000-000000000001',
       e.joining_date, x.ctc, true
from employees e
join (values
 ('e0000000-0000-0000-0000-000000000001'::uuid, 5400000),
 ('e0000000-0000-0000-0000-000000000002'::uuid, 3000000),
 ('e0000000-0000-0000-0000-000000000003'::uuid, 2000000),
 ('e0000000-0000-0000-0000-000000000004'::uuid, 2800000),
 ('e0000000-0000-0000-0000-000000000005'::uuid, 1800000),
 ('e0000000-0000-0000-0000-000000000006'::uuid, 1900000),
 ('e0000000-0000-0000-0000-000000000007'::uuid, 1200000),
 ('e0000000-0000-0000-0000-000000000008'::uuid, 1700000),
 ('e0000000-0000-0000-0000-000000000009'::uuid, 1100000),
 ('e0000000-0000-0000-0000-00000000000a'::uuid, 900000),
 ('e0000000-0000-0000-0000-00000000000b'::uuid, 1000000),
 ('e0000000-0000-0000-0000-00000000000c'::uuid, 2600000)
) as x(emp, ctc) on x.emp = e.id
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- Component breakdown derived from each comp's ctc_annual
insert into employee_compensation_components (tenant_id, compensation_id, salary_component_id, calculation_type, value, computed_monthly, sequence)
select 'd0000000-0000-0000-0000-000000000001', ec.id, t.comp, t.ct, t.val,
       case t.code
         when 'BASIC'   then round(ec.ctc_annual/12.0 * 0.40)
         when 'HRA'     then round(ec.ctc_annual/12.0 * 0.40 * 0.50)
         when 'SPECIAL' then round(ec.ctc_annual/12.0 * 0.25)
         when 'CONV'    then 1600
         when 'PF_EE'   then 1800
         when 'PT'      then 200
         when 'TDS'     then round(ec.ctc_annual/12.0 * 0.08)
         when 'PF_ER'   then 1800
       end,
       t.seq
from employee_compensations ec
join (values
 ('a9000000-0000-0000-0000-000000000001'::uuid,'BASIC','pct_of_ctc',40,1),
 ('a9000000-0000-0000-0000-000000000002'::uuid,'HRA','pct_of_basic',50,2),
 ('a9000000-0000-0000-0000-000000000003'::uuid,'SPECIAL','pct_of_ctc',25,3),
 ('a9000000-0000-0000-0000-000000000004'::uuid,'CONV','fixed',1600,4),
 ('a9000000-0000-0000-0000-000000000005'::uuid,'PF_EE','fixed',1800,5),
 ('a9000000-0000-0000-0000-000000000006'::uuid,'PT','fixed',200,6),
 ('a9000000-0000-0000-0000-000000000007'::uuid,'TDS','pct_of_ctc',8,7),
 ('a9000000-0000-0000-0000-000000000008'::uuid,'PF_ER','fixed',1800,8)
) as t(comp, code, ct, val, seq) on true
where ec.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  6. LEAVE — balances for everyone + a few requests
-- ============================================================================
insert into employee_leave_balance (tenant_id, employee_id, leave_type_id, balance, year)
select 'd0000000-0000-0000-0000-000000000001', e.id, lt.id, lt.bal, extract(year from current_date)::int
from employees e
join (values
 ('a8000000-0000-0000-0000-000000000001'::uuid, 12.0),
 ('a8000000-0000-0000-0000-000000000002'::uuid, 8.0),
 ('a8000000-0000-0000-0000-000000000003'::uuid, 18.0),
 ('a8000000-0000-0000-0000-000000000004'::uuid, 0.0)
) as lt(id, bal) on true
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- A pending + an approved leave request (requested_by/approved_by = demo profile)
insert into leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, computed_days, status, reason, requested_by, approved_by, approved_at)
values
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','a8000000-0000-0000-0000-000000000001',
   current_date + 5, current_date + 6, 2, 'PENDING','Personal work','d0000000-0000-0000-0000-0000000000a1',null,null),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','a8000000-0000-0000-0000-000000000002',
   current_date - 10, current_date - 9, 2, 'APPROVED','Fever','d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1', now() - interval '11 days'),
 ('d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','a8000000-0000-0000-0000-000000000003',
   current_date + 12, current_date + 16, 5, 'PENDING','Family vacation','d0000000-0000-0000-0000-0000000000a1',null,null);

-- Holidays
insert into holiday_calendar (tenant_id, date, name, holiday_type) values
 ('d0000000-0000-0000-0000-000000000001', date_trunc('year', current_date) + interval '25 days','Republic Day','national'),
 ('d0000000-0000-0000-0000-000000000001', date_trunc('year', current_date) + interval '224 days','Independence Day','national'),
 ('d0000000-0000-0000-0000-000000000001', date_trunc('year', current_date) + interval '301 days','Diwali','national');

-- ============================================================================
--  7. ATTENDANCE — last 30 days, weekdays, present (bulk via generate_series)
-- ============================================================================
insert into attendance_daily (tenant_id, employee_id, date, work_hours, status, is_payable, day_fraction, confidence_score, confidence_level)
select 'd0000000-0000-0000-0000-000000000001', e.id, d::date, 8.5, 'present', true, 1.0, 99, 'high'
from employees e
cross join generate_series(current_date - 30, current_date - 1, interval '1 day') as g(d)
where e.tenant_id = 'd0000000-0000-0000-0000-000000000001'
  and extract(dow from d) between 1 and 5;   -- Mon..Fri

-- A couple of punch logs today for realism
insert into attendance_punch_logs (tenant_id, employee_id, punched_at, direction, source)
select 'd0000000-0000-0000-0000-000000000001', e.id, current_date + time '09:05', 'IN', 'web'
from employees e where e.tenant_id = 'd0000000-0000-0000-0000-000000000001';

-- ============================================================================
--  8. PAYROLL — 2 finalized monthly runs + slips for everyone
-- ============================================================================
insert into payroll_runs (id, tenant_id, month, status, employee_count, total_gross, total_net, finalized_by, finalized_at)
values
 ('f0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001', to_char(current_date - interval '2 months','YYYY-MM'),'finalized',12,0,0,'d0000000-0000-0000-0000-0000000000a1', now() - interval '50 days'),
 ('f0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001', to_char(current_date - interval '1 month','YYYY-MM'),'finalized',12,0,0,'d0000000-0000-0000-0000-0000000000a1', now() - interval '20 days');

-- Slips (gross/net derived from each employee's monthly CTC)
insert into payroll_slips (tenant_id, run_id, employee_id, month, total_working_days, payable_days, ctc_monthly, gross_pay, total_deductions, net_pay, status)
select 'd0000000-0000-0000-0000-000000000001', r.id, ec.employee_id, pr.month,
       22, 22,
       round(ec.ctc_annual/12.0),
       round(ec.ctc_annual/12.0 * 0.90),                         -- gross ≈ 90% of CTC/mo
       round(ec.ctc_annual/12.0 * 0.18),                         -- deductions ≈ 18%
       round(ec.ctc_annual/12.0 * 0.90) - round(ec.ctc_annual/12.0 * 0.18),
       'finalized'
from employee_compensations ec
cross join (values ('f0000000-0000-0000-0000-000000000001'::uuid), ('f0000000-0000-0000-0000-000000000002'::uuid)) as r(id)
join payroll_runs pr on pr.id = r.id
where ec.tenant_id = 'd0000000-0000-0000-0000-000000000001' and ec.is_active = true;

-- Roll the run totals up from the slips
update payroll_runs pr set
  total_gross = s.g, total_net = s.n, total_deductions = s.d, employee_count = s.c
from (select run_id, sum(gross_pay) g, sum(net_pay) n, sum(total_deductions) d, count(*) c
      from payroll_slips where tenant_id = 'd0000000-0000-0000-0000-000000000001' group by run_id) s
where pr.id = s.run_id;

-- ============================================================================
--  9. RECRUITMENT — 3 requisitions, candidates, applications, interviews
-- ============================================================================
insert into job_requisitions (id, tenant_id, title, department_id, employment_type, openings, status, location) values
 ('b1000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Senior Software Engineer','a1000000-0000-0000-0000-000000000001','full_time',2,'open','Bengaluru'),
 ('b1000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Sales Manager — South','a1000000-0000-0000-0000-000000000002','full_time',1,'open','Mumbai'),
 ('b1000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Finance Analyst','a1000000-0000-0000-0000-000000000003','full_time',1,'filled','Bengaluru');

insert into candidates (id, tenant_id, first_name, last_name, email, phone, source, current_title, total_experience) values
 ('b2000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Aakash','Rao','aakash.rao@example.com','+91-9810000001','linkedin','Backend Engineer',5),
 ('b2000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','Meera','Joshi','meera.joshi@example.com','+91-9810000002','referral','Full-Stack Engineer',6),
 ('b2000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','Tarun','Bansal','tarun.bansal@example.com','+91-9810000003','naukri','Software Engineer',4),
 ('b2000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','Ritika','Shah','ritika.shah@example.com','+91-9810000004','portal','Regional Sales Manager',8),
 ('b2000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','Manish','Pillai','manish.pillai@example.com','+91-9810000005','direct','Sales Manager',6),
 ('b2000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','Pooja','Desai','pooja.desai@example.com','+91-9810000006','referral','Finance Analyst',3);

insert into applications (id, tenant_id, requisition_id, candidate_id, stage_id, status, overall_score) values
 ('b3000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000003','interviewing',8),
 ('b3000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002','ab000000-0000-0000-0000-000000000004','offer',9),
 ('b3000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000003','ab000000-0000-0000-0000-000000000002','screening',7),
 ('b3000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000004','ab000000-0000-0000-0000-000000000003','interviewing',8),
 ('b3000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000005','ab000000-0000-0000-0000-000000000001','applied',6),
 ('b3000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000006','ab000000-0000-0000-0000-000000000005','hired',9);

insert into interview_rounds (id, tenant_id, application_id, round_number, interview_type, status, scheduled_at) values
 ('b4000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001',1,'video','completed', now() - interval '4 days'),
 ('b4000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002',2,'in_person','completed', now() - interval '2 days'),
 ('b4000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000004',1,'video','scheduled', now() + interval '2 days');

-- Interview scores (interviewer = demo profile)
insert into interview_scores (tenant_id, round_id, interviewer_id, technical_score, communication_score, culture_score, overall_score, recommendation) values
 ('d0000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-0000000000a1',4,4,4,4,'yes'),
 ('d0000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-0000000000a1',5,4,5,5,'strong_yes');

-- ============================================================================
-- 10. HELPDESK + ASSETS
-- ============================================================================
insert into helpdesk_tickets (tenant_id, subject, description, category, priority, status, employee_id, created_by) values
 ('d0000000-0000-0000-0000-000000000001','Payslip not visible for last month','I cannot see my payslip for the previous month in the portal.','payroll','medium','open','e0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','Update bank account details','Need to change my salary account to a new bank.','hr_policy','low','in_progress','e0000000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-0000000000a1'),
 ('d0000000-0000-0000-0000-000000000001','Laptop running slow','Requesting a RAM upgrade or replacement.','it','high','resolved','e0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-0000000000a1');

insert into assets (id, tenant_id, asset_code, name, status, assigned_to, serial_number) values
 ('b5000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','LAP-001','MacBook Pro 14"','assigned','e0000000-0000-0000-0000-000000000003','C02XYZ001'),
 ('b5000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','LAP-002','Dell XPS 15','assigned','e0000000-0000-0000-0000-000000000005','DXPS002'),
 ('b5000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','LAP-003','ThinkPad X1','available',null,'TPX1003');

insert into employee_asset_ledger (tenant_id, asset_id, employee_id, action, action_date) values
 ('d0000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','assigned', current_date - 120),
 ('d0000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000005','assigned', current_date - 90);

commit;

-- ============================================================================
--  DONE. Login at the portal with:  demo@cognixhr.app / CognixDemo!1
-- ============================================================================
