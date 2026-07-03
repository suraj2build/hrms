-- 351: Schema drift fixes — add columns referenced in API code but absent from migrations.
-- These align the database schema with what the API layer expects.

-- ── employees ────────────────────────────────────────────────────────────────
-- profile_id: links an employee row to their auth profile (used for ESS look-ups)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id);

-- personal_email: secondary contact address displayed on absconding case detail
ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email TEXT;

-- gross_salary: CTC / gross monthly, used for ESIC eligibility (≤ ₹21 000)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gross_salary NUMERIC(12, 2);

-- ── employee_separation ───────────────────────────────────────────────────────
-- fnf_status: Full & Final settlement state, updated when a case is terminated
ALTER TABLE employee_separation ADD COLUMN IF NOT EXISTS fnf_status TEXT
  CHECK (fnf_status IN ('pending', 'processed', 'paid'));

-- ── attendance_regularisation ─────────────────────────────────────────────────
-- submitted_by: profile that submitted the regularisation request
ALTER TABLE attendance_regularisation ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id);

-- ── benefit_plans ─────────────────────────────────────────────────────────────
-- status: enrollment lifecycle state ('draft' → 'open' → 'active' → 'inactive')
-- Complements the boolean is_active for finer-grained tracking.
ALTER TABLE benefit_plans ADD COLUMN IF NOT EXISTS status TEXT
  CHECK (status IN ('draft', 'open', 'active', 'inactive'))
  DEFAULT 'active';

-- ── calibration_changes ───────────────────────────────────────────────────────
-- tenant_id: explicit tenant scope (in addition to the RLS join via calibration_sessions)
ALTER TABLE calibration_changes ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
-- employee_id: direct FK to employees so PostgREST can embed employee details
ALTER TABLE calibration_changes ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id);

-- ── survey_response_analysis ──────────────────────────────────────────────────
-- tenant_id: explicit scope (surveys/index.ts uses it in upsert)
ALTER TABLE survey_response_analysis ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- ── survey_responses ──────────────────────────────────────────────────────────
-- Denormalised fields used by the intelligence scanner for onboarding-score queries.
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id);
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS response_value TEXT;
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS response_type TEXT DEFAULT 'text';
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS survey_type TEXT;
