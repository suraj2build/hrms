-- ============================================================
-- 015_rls_extended.sql
-- Additional RLS hardening for Sprint 2 tables.
-- The individual migration files (010-014) already enable RLS
-- and add base policies. This file adds any cross-table
-- policies and verifies all tables are covered.
-- ============================================================

-- Verify RLS is enabled on all Sprint 2 tables
-- (These are no-ops if already enabled; safe to re-run)
ALTER TABLE work_locations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_types              ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_types              ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components           ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures           ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_personal_info      ENABLE ROW LEVEL SECURITY;
ALTER TABLE previous_employment         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_bank_statutory     ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_identity           ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_family             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_nominations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_addresses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_separation         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_access_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_history                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation_components ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MANAGER POLICIES: managers can read their direct reports' data
-- ============================================================

-- Managers can read personal info of their direct reports
DROP POLICY IF EXISTS "epi_mgr_read" ON employee_personal_info;
CREATE POLICY "epi_mgr_read" ON employee_personal_info FOR SELECT
  USING (
    get_user_role() = 'manager'
    AND tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM job_history jh
      WHERE jh.employee_id = employee_personal_info.employee_id
        AND jh.manager_id IN (
          SELECT e.id FROM employees e
          INNER JOIN profiles p ON p.employee_id = e.id
          WHERE p.id = auth.uid()
        )
        AND jh.is_current = true
    )
  );

-- ============================================================
-- EMPLOYEE SELF-ACCESS: employees can read their own sub-tables
-- (Most are already covered by tenant_read policies in 012)
-- Bank & Statutory: only HR can access (no self-read for security)
-- Separation: only HR can access
-- ============================================================

-- Confirm bank_statutory has NO self-read (sensitive data)
-- (no additional policy needed — only hr_all policy exists from 012)

-- Nominations: employees can read own
DROP POLICY IF EXISTS "enom_self_read" ON employee_nominations;
CREATE POLICY "enom_self_read" ON employee_nominations FOR SELECT
  USING (
    get_user_role() = 'employee'
    AND tenant_id = get_user_tenant_id()
    AND employee_id IN (
      SELECT employee_id FROM profiles WHERE id = auth.uid() AND employee_id IS NOT NULL
    )
  );

-- Family: employees can read own
DROP POLICY IF EXISTS "ef_self_read" ON employee_family;
CREATE POLICY "ef_self_read" ON employee_family FOR SELECT
  USING (
    get_user_role() = 'employee'
    AND tenant_id = get_user_tenant_id()
    AND employee_id IN (
      SELECT employee_id FROM profiles WHERE id = auth.uid() AND employee_id IS NOT NULL
    )
  );

-- ============================================================
-- NOTE: The Fastify API uses SUPABASE_SERVICE_ROLE_KEY which
-- bypasses all RLS. These policies protect direct Supabase
-- client access (e.g., from the frontend or Supabase Studio).
-- The API enforces tenant isolation via req.tenantId in every query.
-- ============================================================
