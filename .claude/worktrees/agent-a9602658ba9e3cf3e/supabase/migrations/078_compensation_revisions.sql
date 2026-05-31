-- ============================================================
-- 078_compensation_revisions.sql
--
-- Governed compensation revision workflow.
-- Each revision request captures before/after snapshots,
-- goes through HR approval, and on approval automatically
-- creates the new employee_compensations record.
--
-- Revision types:
--   increment   — merit / cost-of-living increase
--   promotion   — role change with pay revision
--   revision    — general off-cycle revision
--   correction  — fix to an erroneously entered compensation
--   restructure — component mix change with same / similar CTC
--   retro       — retroactive backfill adjustment
-- ============================================================

CREATE TABLE IF NOT EXISTS compensation_revisions (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id                 UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requested_by                UUID          NOT NULL REFERENCES profiles(id)  ON DELETE RESTRICT,
  approved_by                 UUID          NULL     REFERENCES profiles(id)  ON DELETE SET NULL,

  -- Revision classification
  revision_type               TEXT          NOT NULL
    CHECK (revision_type IN ('increment', 'promotion', 'revision', 'correction', 'restructure', 'retro')),
  effective_date              DATE          NOT NULL,
  reason                      TEXT          NOT NULL,
  notes                       TEXT,

  -- Before snapshot (captured at submission from active compensation)
  before_compensation_id      UUID          NULL REFERENCES employee_compensations(id),
  before_ctc_annual           NUMERIC(12,2) NULL,
  before_ctc_monthly          NUMERIC(12,2) NULL,
  before_structure_name       TEXT          NULL,

  -- Proposed new compensation parameters
  new_salary_structure_id     UUID          NULL REFERENCES salary_structures(id),
  new_ctc_annual              NUMERIC(12,2) NULL,
  -- Per-component overrides as JSON array:
  -- [{ salary_component_id, calculation_type, value }]
  component_overrides         JSONB         NULL,

  -- Computed delta (populated at submission)
  delta_amount                NUMERIC(12,2) NULL,   -- new CTC - old CTC (annual)
  delta_pct                   NUMERIC(6,2)  NULL,   -- (delta / old) * 100

  -- Payroll impact preview (JSONB — computed lazily)
  payroll_impact_preview      JSONB         NULL,
  -- { monthly_delta, annual_delta, affected_runs: [{month, old_gross, new_gross}] }
  retro_months                INT           NOT NULL DEFAULT 0,

  -- Approval workflow
  status                      TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  submitted_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  decided_at                  TIMESTAMPTZ   NULL,
  rejection_reason            TEXT          NULL,

  -- Resulting record — set on approval after compensation creation
  resulting_compensation_id   UUID          NULL REFERENCES employee_compensations(id),

  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Efficient lookups
CREATE INDEX IF NOT EXISTS idx_comp_rev_employee_status
  ON compensation_revisions (tenant_id, employee_id, status);

CREATE INDEX IF NOT EXISTS idx_comp_rev_effective
  ON compensation_revisions (tenant_id, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_comp_rev_status
  ON compensation_revisions (tenant_id, status, submitted_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_comp_revision_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comp_rev_updated_at ON compensation_revisions;
CREATE TRIGGER trg_comp_rev_updated_at
  BEFORE UPDATE ON compensation_revisions
  FOR EACH ROW EXECUTE FUNCTION touch_comp_revision_updated_at();

-- RLS
ALTER TABLE compensation_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comprev_tenant_read" ON compensation_revisions FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "comprev_hr_all" ON compensation_revisions FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

CREATE POLICY "comprev_employee_insert" ON compensation_revisions FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
