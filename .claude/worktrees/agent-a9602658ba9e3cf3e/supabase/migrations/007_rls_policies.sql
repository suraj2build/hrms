-- ═══════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY — P0 — ALL TABLES MUST HAVE TENANT ISOLATION
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades       ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs   ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's tenant_id from profiles
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── tenants ──────────────────────────────────────────────────────
CREATE POLICY "tenants_select_own" ON tenants
  FOR SELECT USING (id = get_user_tenant_id());

CREATE POLICY "tenants_update_admin" ON tenants
  FOR UPDATE USING (id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── profiles ─────────────────────────────────────────────────────
CREATE POLICY "profiles_select_own_tenant" ON profiles
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid() OR get_user_role() IN ('super_admin','hr_admin'));

-- ── departments ──────────────────────────────────────────────────
CREATE POLICY "departments_tenant_select" ON departments
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "departments_tenant_insert" ON departments
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "departments_tenant_update" ON departments
  FOR UPDATE USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── designations ─────────────────────────────────────────────────
CREATE POLICY "designations_tenant_select" ON designations
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "designations_tenant_write" ON designations
  FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── grades ───────────────────────────────────────────────────────
CREATE POLICY "grades_tenant_select" ON grades
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "grades_tenant_write" ON grades
  FOR ALL USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));

-- ── employees ────────────────────────────────────────────────────
-- HR Admin & Super Admin: see all employees in tenant
CREATE POLICY "employees_hr_admin_all" ON employees
  FOR ALL USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin','hr_admin')
  );

-- Manager: see only direct reports
CREATE POLICY "employees_manager_team" ON employees
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = 'manager'
    AND (
      manager_id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
      OR id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
    )
  );

-- Employee: see only own record
CREATE POLICY "employees_self" ON employees
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
  );

-- ── documents ────────────────────────────────────────────────────
CREATE POLICY "documents_hr_admin_all" ON documents
  FOR ALL USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin','hr_admin')
  );

CREATE POLICY "documents_self" ON documents
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
  );

-- ── audit_logs ───────────────────────────────────────────────────
CREATE POLICY "audit_admin_select" ON audit_logs
  FOR SELECT USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin','hr_admin')
  );

-- Service role bypasses RLS (used by Fastify API)
-- Fastify uses SUPABASE_SERVICE_ROLE_KEY which bypasses all RLS automatically
