-- ============================================================
-- Migration 169: Tax Declaration Plans
-- Multi-plan support per employee per FY (Plan A / Plan B).
-- Employees can compare regimes before locking a primary plan.
-- ============================================================

-- ── tax_declaration_plans ──────────────────────────────────

CREATE TABLE IF NOT EXISTS tax_declaration_plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id              UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  plan_name                TEXT NOT NULL DEFAULT 'Plan A',
  financial_year           TEXT NOT NULL,
  tax_regime               TEXT NOT NULL DEFAULT 'new'
    CHECK (tax_regime IN ('old', 'new')),
  status                   TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'locked', 'archived', 'payroll_applied')),
  is_primary               BOOLEAN NOT NULL DEFAULT false,
  projected_tax            DECIMAL(14,2),
  projected_monthly_tds    DECIMAL(14,2),
  projected_taxable_income DECIMAL(14,2),
  submitted_at             TIMESTAMPTZ,
  locked_at                TIMESTAMPTZ,
  snapshot_id              UUID REFERENCES tds_declaration_snapshots(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes: tax_declaration_plans ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_tax_plans_employee_fy
  ON tax_declaration_plans (tenant_id, employee_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_tax_plans_tenant_status
  ON tax_declaration_plans (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_tax_plans_primary
  ON tax_declaration_plans (tenant_id, employee_id, financial_year)
  WHERE is_primary = true;

-- ── tax_declaration_plan_items ─────────────────────────────

CREATE TABLE IF NOT EXISTS tax_declaration_plan_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          UUID NOT NULL REFERENCES tax_declaration_plans(id) ON DELETE CASCADE,
  component_id     UUID NOT NULL REFERENCES tax_declaration_components(id) ON DELETE RESTRICT,
  declared_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  metadata         JSONB NOT NULL DEFAULT '{}',
  remarks          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, component_id)
);

-- ── Indexes: tax_declaration_plan_items ────────────────────

CREATE INDEX IF NOT EXISTS idx_tax_plan_items_plan_id
  ON tax_declaration_plan_items (plan_id);

CREATE INDEX IF NOT EXISTS idx_tax_plan_items_component_id
  ON tax_declaration_plan_items (component_id);

-- ── updated_at triggers ────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_updated_at_tax_plans()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_tax_plans ON tax_declaration_plans;
CREATE TRIGGER set_updated_at_tax_plans
  BEFORE UPDATE ON tax_declaration_plans
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_tax_plans();

CREATE OR REPLACE FUNCTION trg_set_updated_at_tax_plan_items()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_tax_plan_items ON tax_declaration_plan_items;
CREATE TRIGGER set_updated_at_tax_plan_items
  BEFORE UPDATE ON tax_declaration_plan_items
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_tax_plan_items();

-- ── Primary-plan exclusivity trigger ──────────────────────
-- When is_primary is set to true on a plan, demote all other
-- plans for the same (employee_id, financial_year) to false.

CREATE OR REPLACE FUNCTION trg_enforce_single_primary_plan()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only act when is_primary is being switched ON
  IF NEW.is_primary = true AND (OLD.is_primary IS DISTINCT FROM true) THEN
    UPDATE tax_declaration_plans
    SET    is_primary = false,
           updated_at = now()
    WHERE  tenant_id      = NEW.tenant_id
      AND  employee_id    = NEW.employee_id
      AND  financial_year = NEW.financial_year
      AND  id             <> NEW.id
      AND  is_primary     = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_primary_plan ON tax_declaration_plans;
CREATE TRIGGER enforce_single_primary_plan
  BEFORE INSERT OR UPDATE OF is_primary ON tax_declaration_plans
  FOR EACH ROW EXECUTE FUNCTION trg_enforce_single_primary_plan();

-- ── Row Level Security: tax_declaration_plans ──────────────

ALTER TABLE tax_declaration_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_plans_select"      ON tax_declaration_plans;
DROP POLICY IF EXISTS "tax_plans_insert"      ON tax_declaration_plans;
DROP POLICY IF EXISTS "tax_plans_update"      ON tax_declaration_plans;
DROP POLICY IF EXISTS "tax_plans_delete"      ON tax_declaration_plans;

-- All tenant users can read plans within their tenant
CREATE POLICY "tax_plans_select"
  ON tax_declaration_plans FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Employees can insert their own plans (self-service); admins can insert for any employee
CREATE POLICY "tax_plans_insert"
  ON tax_declaration_plans FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin', 'super_admin')
      OR employee_id = (
        SELECT employee_id FROM profiles
        WHERE id = auth.uid()
        LIMIT 1
      )
    )
  );

-- Employees can update their own draft/submitted plans; admins can update any
CREATE POLICY "tax_plans_update"
  ON tax_declaration_plans FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin', 'super_admin')
      OR (
        employee_id = (
          SELECT employee_id FROM profiles
          WHERE id = auth.uid()
          LIMIT 1
        )
        AND status IN ('draft', 'submitted')
      )
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
  );

-- Employees can delete their own draft plans; admins can delete any non-locked plan
CREATE POLICY "tax_plans_delete"
  ON tax_declaration_plans FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('hr_admin', 'super_admin')
      OR (
        employee_id = (
          SELECT employee_id FROM profiles
          WHERE id = auth.uid()
          LIMIT 1
        )
        AND status = 'draft'
      )
    )
  );

-- ── Row Level Security: tax_declaration_plan_items ─────────

ALTER TABLE tax_declaration_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tax_plan_items_select"  ON tax_declaration_plan_items;
DROP POLICY IF EXISTS "tax_plan_items_insert"  ON tax_declaration_plan_items;
DROP POLICY IF EXISTS "tax_plan_items_update"  ON tax_declaration_plan_items;
DROP POLICY IF EXISTS "tax_plan_items_delete"  ON tax_declaration_plan_items;

-- SELECT: tenant users can read items belonging to their tenant's plans
CREATE POLICY "tax_plan_items_select"
  ON tax_declaration_plan_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tax_declaration_plans p
      WHERE p.id = plan_id
        AND p.tenant_id = get_user_tenant_id()
    )
  );

-- INSERT: employees can add items to their own draft/submitted plans; admins unrestricted within tenant
CREATE POLICY "tax_plan_items_insert"
  ON tax_declaration_plan_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tax_declaration_plans p
      WHERE p.id = plan_id
        AND p.tenant_id = get_user_tenant_id()
        AND (
          get_user_role() IN ('hr_admin', 'super_admin')
          OR (
            p.status IN ('draft', 'submitted')
            AND p.employee_id = (
              SELECT employee_id FROM profiles
              WHERE id = auth.uid()
              LIMIT 1
            )
          )
        )
    )
  );

-- UPDATE: same rule as insert — only mutable plan states for self, any for admin
CREATE POLICY "tax_plan_items_update"
  ON tax_declaration_plan_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tax_declaration_plans p
      WHERE p.id = plan_id
        AND p.tenant_id = get_user_tenant_id()
        AND (
          get_user_role() IN ('hr_admin', 'super_admin')
          OR (
            p.status IN ('draft', 'submitted')
            AND p.employee_id = (
              SELECT employee_id FROM profiles
              WHERE id = auth.uid()
              LIMIT 1
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tax_declaration_plans p
      WHERE p.id = plan_id
        AND p.tenant_id = get_user_tenant_id()
    )
  );

-- DELETE: same mutability rules
CREATE POLICY "tax_plan_items_delete"
  ON tax_declaration_plan_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tax_declaration_plans p
      WHERE p.id = plan_id
        AND p.tenant_id = get_user_tenant_id()
        AND (
          get_user_role() IN ('hr_admin', 'super_admin')
          OR (
            p.status IN ('draft', 'submitted')
            AND p.employee_id = (
              SELECT employee_id FROM profiles
              WHERE id = auth.uid()
              LIMIT 1
            )
          )
        )
    )
  );
