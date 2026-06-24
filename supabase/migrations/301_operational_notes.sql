-- Migration 301: operational_notes
--
-- Free-text operational notes attached to an employee (and optionally an
-- operations-queue item) by HR/ops staff. Referenced by
-- routes/notifications/index.ts (POST operational note).

CREATE TABLE IF NOT EXISTS operational_notes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id   UUID        REFERENCES employees(id)          ON DELETE CASCADE,
  queue_item_id UUID,
  note          TEXT        NOT NULL,
  created_by    UUID        REFERENCES profiles(id)           ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opnotes_tenant_emp ON operational_notes (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_opnotes_queue_item ON operational_notes (tenant_id, queue_item_id);

ALTER TABLE operational_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "opnotes_hr_all"  ON operational_notes;
DROP POLICY IF EXISTS "opnotes_tenant"  ON operational_notes;
CREATE POLICY "opnotes_hr_all" ON operational_notes FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "opnotes_tenant" ON operational_notes FOR SELECT USING (tenant_id = get_user_tenant_id());
