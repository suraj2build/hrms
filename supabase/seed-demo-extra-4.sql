-- ============================================================================
--  CognixHR — DEMO TENANT ENRICHMENT #4  (run AFTER seed-demo.sql)
--  Populates the TAX & INVESTMENT DECLARATION admin/ESS pages:
--    • tenant-level tax declaration component master rows
--    • per-employee investment declaration plans (Plan A / Plan B) with line items
--      (80C, 80D, 80CCD(1B), 24(b) home-loan interest, HRA, etc.)
--    • a few legacy tax_declarations + uploaded proof rows
--    • previous-employer income/TDS for an employee who changed jobs mid-year
--
--  HOW TO RUN
--    Supabase SQL Editor: paste this whole file and Run (after seed-demo.sql).
--  Idempotent: re-running clears its own demo rows first, then reseeds.
--  Safe: standalone transaction — a failure here never affects the core seed.
--
--  NOTE: hra_declarations is seeded by seed-demo-extra-2.sql and is NOT touched
--  here. The system-level tax_declaration_components (tenant_id = NULL) shipped by
--  migration 168 are likewise left alone; this file only adds tenant-scoped rows.
-- ============================================================================
begin;

-- Demo tenant + profile + employees use the fixed IDs from seed-demo.sql:
--   tenant  = d0000000-0000-0000-0000-000000000001
--   profile = d0000000-0000-0000-0000-0000000000a1   (Demo Admin)
--   emp NN  = e0000000-0000-0000-0000-0000000000NN   (01..0c)
-- New rows created by THIS file use UUIDs prefixed 'c4'.
-- Current financial year (today = 2026-06-20) → FY '2026-2027'
-- (matches the 'YYYY-YYYY' convention used by hra_declarations in extra-2).

-- ── RESET (children before parents) ─────────────────────────────────────────
-- Tables with a tenant_id are deleted directly. tax_declaration_plan_items has
-- no tenant_id, so it is cleared via its parent plans (this file's c4 plans).
do $$
declare tid uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  -- plan items first (no tenant_id) — delete via this file's plans
  if to_regclass('tax_declaration_plan_items') is not null
     and to_regclass('tax_declaration_plans') is not null then
    delete from tax_declaration_plan_items
     where plan_id in (
       select id from tax_declaration_plans
        where tenant_id = tid and id::text like 'c4%'
     );
  end if;

  -- proofs first (no useful child), then their parent tax_declarations
  if to_regclass('declaration_proofs') is not null then
    delete from declaration_proofs where tenant_id = tid and id::text like 'c4%';
  end if;

  if to_regclass('tax_declaration_plans') is not null then
    delete from tax_declaration_plans where tenant_id = tid and id::text like 'c4%';
  end if;

  if to_regclass('tax_declarations') is not null then
    delete from tax_declarations where tenant_id = tid and id::text like 'c4%';
  end if;

  if to_regclass('previous_employment_tax_details') is not null then
    delete from previous_employment_tax_details where tenant_id = tid;
  end if;

  -- only this file's tenant-scoped components (system NULL-tenant rows untouched)
  if to_regclass('tax_declaration_components') is not null then
    delete from tax_declaration_components where tenant_id = tid and id::text like 'c4%';
  end if;
end $$;

-- ============================================================================
--  1. TAX DECLARATION COMPONENTS  (tenant-scoped master rows)
--     parent_group ∈ ('chapter_via','hra','house_property','lta','other_income',
--                     'tds_tcs','previous_employment','perquisites','exemptions')
--     regime_eligibility ∈ ('old','new','both')
--     declaration_type ∈ ('amount','percentage','text','property','hra',
--                         'deduction','exemption')
--     component_scope ∈ ('global','country','state','company')   [migration 177]
--     visibility_scope ∈ ('all','admin_only','employee')         [migration 177]
--  These tenant rows are what THIS file's plan items reference (so the data is
--  self-contained and doesn't depend on the system NULL-tenant rows by id).
-- ============================================================================
insert into tax_declaration_components
  (id, tenant_id, section_code, section_name, sub_section, display_name, description,
   parent_group, display_order, regime_eligibility, declaration_type,
   max_limit, proof_required, is_system, is_active, component_scope, visibility_scope) values
 ('c4c00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','80C','Section 80C',NULL,'Life Insurance / PPF / ELSS','Aggregate Section 80C investments (LIC, PPF, ELSS, tuition).','chapter_via',10,'old','amount',150000,true,false,true,'company','all'),
 ('c4c00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','80CCD','Section 80CCD',  '80CCD(1B)','NPS Additional Contribution','Additional NPS contribution over and above 80CCD(1).','chapter_via',20,'both','amount',50000,true,false,true,'company','all'),
 ('c4c00000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','80D','Section 80D',NULL,'Medical Insurance - Self/Family','Health insurance premium for self, spouse and children.','chapter_via',30,'old','amount',25000,true,false,true,'company','all'),
 ('c4c00000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','24B','Section 24(b)',NULL,'Home Loan Interest','Interest on housing loan u/s 24(b) - self occupied.','house_property',10,'old','amount',200000,true,false,true,'company','all'),
 ('c4c00000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001','HRA','Section 10(13A)',NULL,'HRA Exemption','House Rent Allowance exemption u/s 10(13A).','hra',10,'old','hra',NULL,true,false,true,'company','all'),
 ('c4c00000-0000-0000-0000-000000000006','d0000000-0000-0000-0000-000000000001','80E','Section 80E',NULL,'Education Loan Interest','Interest on loan for higher education - no upper limit.','chapter_via',40,'old','amount',NULL,true,false,true,'company','all');

-- ============================================================================
--  2. TAX DECLARATION PLANS  (+ plan items)  — admin/ESS declaration workbench
--     tax_regime ∈ ('old','new')
--     status ∈ ('draft','submitted','locked','archived','payroll_applied')
--     Deepak (e03): two plans (old vs new) to compare regimes; old is primary.
--     Arjun  (e05): a single submitted old-regime plan.
--     Kavya  (e09): a draft new-regime plan (minimal items).
-- ============================================================================
insert into tax_declaration_plans
  (id, tenant_id, employee_id, plan_name, financial_year, tax_regime, status, is_primary,
   projected_tax, projected_monthly_tds, projected_taxable_income, submitted_at) values
 ('c4a00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Plan A — Old Regime','2026-2027','old','submitted',true,  185000, 15417, 1480000, now() - interval '15 days'),
 ('c4a00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Plan B — New Regime','2026-2027','new','draft',    false, 232000, 19333, 1950000, null),
 ('c4a00000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','Plan A — Old Regime','2026-2027','old','submitted',true,  142000, 11833, 1320000, now() - interval '10 days'),
 ('c4a00000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','Plan A — New Regime','2026-2027','new','draft',    true,  78000,  6500,  1010000, null);

-- Plan items: (plan_id, component_id, declared_amount, remarks).
-- Deepak — old-regime plan (full set of deductions).
insert into tax_declaration_plan_items
  (plan_id, component_id, declared_amount, remarks) values
 ('c4a00000-0000-0000-0000-000000000001','c4c00000-0000-0000-0000-000000000001', 150000, 'PPF 80,000 + ELSS 70,000 — maxed out 80C.'),
 ('c4a00000-0000-0000-0000-000000000001','c4c00000-0000-0000-0000-000000000002', 50000,  'NPS Tier-1 additional contribution.'),
 ('c4a00000-0000-0000-0000-000000000001','c4c00000-0000-0000-0000-000000000003', 25000,  'Family floater top-up premium.'),
 ('c4a00000-0000-0000-0000-000000000001','c4c00000-0000-0000-0000-000000000004', 200000, 'Home loan interest on self-occupied flat.'),
 ('c4a00000-0000-0000-0000-000000000001','c4c00000-0000-0000-0000-000000000005', 420000, 'HRA — annual rent 4.2L (Mumbai metro).'),
-- Deepak — new-regime comparison plan (only the 80CCD(1B) carries under new regime).
 ('c4a00000-0000-0000-0000-000000000002','c4c00000-0000-0000-0000-000000000002', 50000,  'NPS additional — still allowed under the new regime.'),
-- Arjun — old-regime plan.
 ('c4a00000-0000-0000-0000-000000000003','c4c00000-0000-0000-0000-000000000001', 120000, 'LIC + tuition fees + ELSS.'),
 ('c4a00000-0000-0000-0000-000000000003','c4c00000-0000-0000-0000-000000000003', 22000,  'Health insurance — self & spouse.'),
 ('c4a00000-0000-0000-0000-000000000003','c4c00000-0000-0000-0000-000000000005', 264000, 'HRA — annual rent 2.64L (Bengaluru metro).'),
 ('c4a00000-0000-0000-0000-000000000003','c4c00000-0000-0000-0000-000000000006', 38000,  'Education loan interest (sibling).'),
-- Kavya — draft new-regime plan (minimal).
 ('c4a00000-0000-0000-0000-000000000004','c4c00000-0000-0000-0000-000000000002', 30000,  'Planning to invest in NPS this year.');

-- ============================================================================
--  3. TAX DECLARATIONS (legacy per-section table) + PROOFS
--     declaration_proofs.declaration_id → tax_declarations(id) (NOT plan items),
--     so a parent tax_declarations row is required for each proof.
--     declaration_category ∈ ('80C','80D','80E','80G','80TTA','HRA','LTA',
--        'home_loan_principal','home_loan_interest','NPS','standard_deduction',
--        'professional_tax','other')
--     status ∈ ('declared','submitted','under_review','approved','rejected',
--               'revision_requested')
-- ============================================================================
insert into tax_declarations
  (id, tenant_id, employee_id, financial_year, declaration_category, section, description,
   declared_amount, approved_amount, status, submitted_at, reviewed_by, reviewed_at) values
 ('c4d00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','2026-2027','80C','Section 80C','PPF + ELSS investment proofs.',                 150000, 150000, 'approved',   now() - interval '14 days','d0000000-0000-0000-0000-0000000000a1', now() - interval '9 days'),
 ('c4d00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','2026-2027','home_loan_interest','Section 24(b)','Home loan interest certificate from bank.',     200000, NULL,   'under_review',now() - interval '6 days','d0000000-0000-0000-0000-0000000000a1', null),
 ('c4d00000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','2026-2027','80D','Section 80D','Health insurance premium receipt.',              22000,  22000,  'approved',   now() - interval '9 days','d0000000-0000-0000-0000-0000000000a1', now() - interval '7 days');

-- Proofs uploaded against the above declarations.
--   document_state ∈ ('draft','uploaded','under_review','verified','rejected',
--      'revision_requested','superseded','payroll_locked','archived')  [migration 177]
insert into declaration_proofs
  (id, tenant_id, declaration_id, file_name, storage_path, mime_type, file_size_bytes,
   uploaded_by, is_verified, document_state, verified_by, verified_at, verification_notes) values
 ('c4f00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','c4d00000-0000-0000-0000-000000000001','PPF_Passbook_2026.pdf',        'demo/tax/e03-ppf-2026.pdf',        'application/pdf', 184320, 'd0000000-0000-0000-0000-0000000000a1', true,  'verified',     'd0000000-0000-0000-0000-0000000000a1', now() - interval '9 days', 'PPF passbook and ELSS statement verified.'),
 ('c4f00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','c4d00000-0000-0000-0000-000000000001','ELSS_Statement_2026.pdf',      'demo/tax/e03-elss-2026.pdf',       'application/pdf', 96112,  'd0000000-0000-0000-0000-0000000000a1', true,  'verified',     'd0000000-0000-0000-0000-0000000000a1', now() - interval '9 days', 'Cross-checked against 80C declared amount.'),
 ('c4f00000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000001','c4d00000-0000-0000-0000-000000000002','HomeLoan_Interest_Cert.pdf',   'demo/tax/e03-homeloan-2026.pdf',   'application/pdf', 142880, 'd0000000-0000-0000-0000-0000000000a1', false, 'under_review', null,                                   null,                       null),
 ('c4f00000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001','c4d00000-0000-0000-0000-000000000003','Medical_Insurance_Receipt.pdf','demo/tax/e05-mediclaim-2026.pdf',  'application/pdf', 73216,  'd0000000-0000-0000-0000-0000000000a1', true,  'verified',     'd0000000-0000-0000-0000-0000000000a1', now() - interval '7 days', '80D premium receipt verified.');

-- ============================================================================
--  4. PREVIOUS EMPLOYMENT TAX DETAILS
--     For an employee treated as having changed jobs during the current FY.
--     verification_status ∈ ('pending','under_review','verified','rejected')
--     Rohan Mehta (e0a) — prior employer income/TDS for FY 2026-2027.
-- ============================================================================
insert into previous_employment_tax_details
  (id, tenant_id, employee_id, financial_year, employer_name, employer_tan,
   gross_income, tds_deducted, pf_deducted, ptax_deducted, from_date, to_date,
   verification_status, verified_by, verified_at, remarks) values
 ('c4e00000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-00000000000a','2026-2027','Helios Software Pvt Ltd','BLRH09876F', 480000, 38000, 21600, 1200, '2026-04-01', '2026-06-30', 'verified',     'd0000000-0000-0000-0000-0000000000a1', now() - interval '5 days', 'Form 16 (Part B) from previous employer verified.'),
 ('c4e00000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','2026-2027','Brightwave Media LLP',   'BLRB12345C', 210000, 6500,  9600,  600,  '2026-04-01', '2026-05-31', 'under_review', null,                                   null,                       'Awaiting prior-employer TDS certificate.');

commit;

-- ============================================================================
--  DONE. Tax declaration component master, per-employee investment declaration
--  plans (+ line items), legacy tax_declarations with uploaded proofs, and
--  previous-employment income/TDS now have demo data for FY 2026-2027.
-- ============================================================================
