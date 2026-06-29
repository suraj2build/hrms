-- ============================================================================
-- seed-demo-extra-13.sql
-- WFH Request demo data — makes EssWfh page non-empty in demo tenant.
--
-- Idempotent: safe to re-run (ON CONFLICT DO NOTHING everywhere or
-- guarded by IF NOT EXISTS checks).
-- Tenant : d0000000-0000-0000-0000-000000000001
-- Employees SAAR001–SAAR012 (e01..e0c)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tid UUID := 'd0000000-0000-0000-0000-000000000001';
  adm UUID := 'd0000000-0000-0000-0000-0000000000a1';
  e01 UUID := 'e0000000-0000-0000-0000-000000000001'; -- Priya Sharma  (HR Mgr)
  e02 UUID := 'e0000000-0000-0000-0000-000000000002'; -- Rahul Verma
  e03 UUID := 'e0000000-0000-0000-0000-000000000003'; -- Deepak Chawla
  e04 UUID := 'e0000000-0000-0000-0000-000000000004'; -- Sneha Sen
  e05 UUID := 'e0000000-0000-0000-0000-000000000005'; -- Arjun Rampal
  e06 UUID := 'e0000000-0000-0000-0000-000000000006'; -- Nandini Gupta
  e07 UUID := 'e0000000-0000-0000-0000-000000000007'; -- Ayesha Ahmed
  e08 UUID := 'e0000000-0000-0000-0000-000000000008'; -- Vikram Singh
  e09 UUID := 'e0000000-0000-0000-0000-000000000009'; -- Kavya Nair
  e0a UUID := 'e0000000-0000-0000-0000-00000000000a'; -- Rohan Mehta
  e0b UUID := 'e0000000-0000-0000-0000-00000000000b'; -- Ananya Iyer
  e0c UUID := 'e0000000-0000-0000-0000-00000000000c'; -- Karan Patel
BEGIN

  -- ── WFH REQUESTS ──────────────────────────────────────────────────────────
  -- Mix of: approved, pending, rejected — spread across past and upcoming dates.
  -- These give the EssWfh page meaningful demo data for ESS and manager views.

  -- Priya: approved WFH last week (Mon–Tue)
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_remarks)
  VALUES (
    'c0000000-0000-0000-0000-000000000001',
    tid, e01,
    (CURRENT_DATE - INTERVAL '8 days')::DATE,
    (CURRENT_DATE - INTERVAL '7 days')::DATE,
    2,
    'Child''s school event on Monday, working from home both days to manage logistics.',
    'approved', adm, now() - INTERVAL '9 days',
    'Approved. Ensure you''re reachable on Slack during core hours.'
  ) ON CONFLICT (id) DO NOTHING;

  -- Rahul: pending WFH next week
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status)
  VALUES (
    'c0000000-0000-0000-0000-000000000002',
    tid, e02,
    (CURRENT_DATE + INTERVAL '3 days')::DATE,
    (CURRENT_DATE + INTERVAL '4 days')::DATE,
    2,
    'Home internet installation scheduled. Need to be home to supervise technician.',
    'pending'
  ) ON CONFLICT (id) DO NOTHING;

  -- Deepak: approved WFH for tomorrow
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_remarks)
  VALUES (
    'c0000000-0000-0000-0000-000000000003',
    tid, e03,
    (CURRENT_DATE + INTERVAL '1 day')::DATE,
    (CURRENT_DATE + INTERVAL '1 day')::DATE,
    1,
    'Focus day for Q3 roadmap planning. No travel time preferred.',
    'approved', adm, now() - INTERVAL '1 day',
    'Approved. Attend the 4pm standup on video.'
  ) ON CONFLICT (id) DO NOTHING;

  -- Sneha: rejected WFH (too many pending requests overlap)
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_remarks)
  VALUES (
    'c0000000-0000-0000-0000-000000000004',
    tid, e04,
    (CURRENT_DATE + INTERVAL '2 days')::DATE,
    (CURRENT_DATE + INTERVAL '3 days')::DATE,
    2,
    'Want to work from hometown for a few days to visit family.',
    'rejected', adm, now() - INTERVAL '2 hours',
    'Declined — client site visit is required on Thursday. Please reschedule.'
  ) ON CONFLICT (id) DO NOTHING;

  -- Arjun: approved WFH last month (historical record)
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_remarks)
  VALUES (
    'c0000000-0000-0000-0000-000000000005',
    tid, e05,
    (CURRENT_DATE - INTERVAL '20 days')::DATE,
    (CURRENT_DATE - INTERVAL '18 days')::DATE,
    3,
    'Deep work sprint on architecture documentation. Fewer interruptions at home.',
    'approved', adm, now() - INTERVAL '22 days',
    NULL
  ) ON CONFLICT (id) DO NOTHING;

  -- Nandini: pending WFH next week (long stretch)
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status)
  VALUES (
    'c0000000-0000-0000-0000-000000000006',
    tid, e06,
    (CURRENT_DATE + INTERVAL '7 days')::DATE,
    (CURRENT_DATE + INTERVAL '9 days')::DATE,
    3,
    'Dependent spouse recovering from minor surgery. Need to be home to assist.',
    'pending'
  ) ON CONFLICT (id) DO NOTHING;

  -- Vikram: cancelled WFH (withdrew request)
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status)
  VALUES (
    'c0000000-0000-0000-0000-000000000007',
    tid, e08,
    (CURRENT_DATE + INTERVAL '5 days')::DATE,
    (CURRENT_DATE + INTERVAL '5 days')::DATE,
    1,
    'Personal errand.',
    'cancelled'
  ) ON CONFLICT (id) DO NOTHING;

  -- Kavya: approved WFH next Monday
  INSERT INTO wfh_requests (id, tenant_id, employee_id, from_date, to_date, days, reason, status, decided_by, decided_at, decision_remarks)
  VALUES (
    'c0000000-0000-0000-0000-000000000008',
    tid, e09,
    (CURRENT_DATE + INTERVAL '4 days')::DATE,
    (CURRENT_DATE + INTERVAL '4 days')::DATE,
    1,
    'Deep-dive data analysis. Prefer quiet environment for focused work.',
    'approved', adm, now() - INTERVAL '30 minutes',
    'Approved. Available on Slack at all times.'
  ) ON CONFLICT (id) DO NOTHING;

END $$;

COMMIT;
