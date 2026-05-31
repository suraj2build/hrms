-- ============================================================
-- 075_policy_governance.sql
--
-- Phase 1: Policy Engine Maturity
--
-- Adds enterprise-grade governance to the leave & attendance
-- policy infrastructure:
--
--   A. State machine on leave_policy_masters
--      status: 'draft' | 'review' | 'published' | 'archived'
--      version: incrementing integer per tenant+name
--      effective_from: schedule activation date at master level
--      published_by / published_at: who activated this policy
--      notes: free-text comment per publish
--
--   B. leave_policy_versions
--      Immutable snapshot table. Every time a policy transitions
--      from draft → published (or is archived), the full rule
--      set is snapshotted so past evaluations can always be
--      replayed without touching live tables.
--
--   C. policy_evaluation_log
--      One row per leave-type resolution for an employee.
--      Persisted when resolveEffectivePolicyRule() runs so that
--      attendance / leave decisions are always traceable.
--
--   D. policy_change_log
--      Field-level structured audit trail for every write to
--      leave_policy_masters, leave_policy_rules, and
--      leave_policy_assignments.  Replaces reliance on the
--      generic audit_logs JSONB blobs for policy changes.
--
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. State machine on leave_policy_masters
-- ──────────────────────────────────────────────────────────────

ALTER TABLE leave_policy_masters
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review', 'published', 'archived')),

  ADD COLUMN IF NOT EXISTS version       INT  NOT NULL DEFAULT 1,

  -- When status = 'published', this is the date the policy rules
  -- become the effective set for resolution (can be future-dated).
  ADD COLUMN IF NOT EXISTS effective_from DATE,

  -- Who promoted this version to published
  ADD COLUMN IF NOT EXISTS published_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ,

  -- A human-readable release note / change summary
  ADD COLUMN IF NOT EXISTS publish_notes TEXT;

-- Only ONE published policy per (tenant, name) makes sense.
-- The existing partial unique index already enforces one default;
-- add an index to speed up "active published" queries.
CREATE INDEX IF NOT EXISTS idx_policy_masters_status
  ON leave_policy_masters (tenant_id, status)
  WHERE status = 'published';

-- ──────────────────────────────────────────────────────────────
-- B. leave_policy_versions — immutable snapshots
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_policy_versions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID         NOT NULL REFERENCES tenants(id)             ON DELETE CASCADE,
  policy_id        UUID         NOT NULL REFERENCES leave_policy_masters(id) ON DELETE CASCADE,
  version          INT          NOT NULL,

  -- Snapshot metadata
  snapshot_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  snapshot_by      UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  reason           TEXT,          -- 'published' | 'archived' | 'manual'

  -- Full rule-set snapshot (JSONB array of leave_policy_rules rows)
  rules_snapshot   JSONB        NOT NULL DEFAULT '[]',

  -- Master-level metadata at snapshot time
  master_snapshot  JSONB        NOT NULL DEFAULT '{}',

  -- Immutable — no updates allowed
  UNIQUE (tenant_id, policy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_policy_versions_policy
  ON leave_policy_versions (tenant_id, policy_id, version DESC);

ALTER TABLE leave_policy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lpv_hr_all" ON leave_policy_versions;
CREATE POLICY "lpv_hr_all"  ON leave_policy_versions FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "lpv_read" ON leave_policy_versions;
CREATE POLICY "lpv_read"    ON leave_policy_versions FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────────
-- C. policy_evaluation_log — per-resolution trace record
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_evaluation_log (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  employee_id       UUID          NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id     UUID          NOT NULL REFERENCES leave_types(id),

  -- When was this rule resolved (leave application date or current date)
  evaluated_on      DATE          NOT NULL,
  evaluated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Which trigger caused this evaluation?
  -- 'leave_apply' | 'accrual' | 'manual' | 'api' | 'simulation'
  trigger_context   TEXT          NOT NULL DEFAULT 'api',

  -- Resolved policy details
  policy_id         UUID          REFERENCES leave_policy_masters(id) ON DELETE SET NULL,
  policy_name       TEXT,
  policy_version    INT,
  rule_id           UUID          REFERENCES leave_policy_rules(id)   ON DELETE SET NULL,

  -- How this rule was found (maps to priority rank)
  -- 'employee' | 'department' | 'work_location' | 'default' | 'legacy' | 'none'
  resolved_via      TEXT          NOT NULL DEFAULT 'none',
  scope_id          UUID,         -- The dept/location/employee ID that matched
  priority_rank     INT,          -- 1-5 (1 = most specific)

  -- Eligibility result at resolution time
  eligible          BOOLEAN       NOT NULL DEFAULT true,
  eligibility_reason TEXT,

  -- Full candidate chain (for transparency / debugging)
  -- Array of {policy_id, policy_name, scope_type, scope_id, priority_rank, skipped_reason}
  evaluated_candidates JSONB      DEFAULT '[]',

  -- Was this evaluation in simulation mode?
  is_simulation     BOOLEAN       NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_log_employee
  ON policy_evaluation_log (tenant_id, employee_id, evaluated_on DESC);

CREATE INDEX IF NOT EXISTS idx_eval_log_policy
  ON policy_evaluation_log (tenant_id, policy_id, evaluated_at DESC);

ALTER TABLE policy_evaluation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pel_hr_all" ON policy_evaluation_log;
CREATE POLICY "pel_hr_all"  ON policy_evaluation_log FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

DROP POLICY IF EXISTS "pel_read" ON policy_evaluation_log;
CREATE POLICY "pel_read"    ON policy_evaluation_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- ──────────────────────────────────────────────────────────────
-- D. policy_change_log — field-level structured audit trail
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_change_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which table was changed
  -- 'leave_policy_masters' | 'leave_policy_rules' | 'leave_policy_assignments' |
  -- 'attendance_policies'  | 'overtime_policies'  | 'regularisation_policy'
  table_name      TEXT          NOT NULL,
  record_id       UUID          NOT NULL,  -- PK of the changed row

  -- What kind of change
  -- 'create' | 'update' | 'delete' | 'publish' | 'archive' | 'rollback'
  operation       TEXT          NOT NULL
    CHECK (operation IN ('create', 'update', 'delete', 'publish', 'archive', 'rollback')),

  -- Human context
  changed_by      UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- IP / user-agent for compliance
  client_ip       TEXT,
  user_agent      TEXT,

  -- Structured field-level diff (for 'update' operations)
  -- Array of {field, old_value, new_value}
  field_changes   JSONB         DEFAULT '[]',

  -- Full snapshots (for 'create' / 'delete' / 'publish')
  before_snapshot JSONB,
  after_snapshot  JSONB,

  -- Optional human note (e.g. "Updated to comply with new maternity act")
  comment         TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_change_log_record
  ON policy_change_log (tenant_id, table_name, record_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_policy_change_log_user
  ON policy_change_log (tenant_id, changed_by, changed_at DESC);

ALTER TABLE policy_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pcl_hr_all" ON policy_change_log;
CREATE POLICY "pcl_hr_all"  ON policy_change_log FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

-- ──────────────────────────────────────────────────────────────
-- E. Attendance policy: add status + version (same model)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE attendance_policies
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'review', 'published', 'archived')),

  ADD COLUMN IF NOT EXISTS version       INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS publish_notes TEXT,
  ADD COLUMN IF NOT EXISTS published_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ;

-- Mark all existing rows as already-published (they were active)
UPDATE attendance_policies
  SET status = 'published', published_at = created_at
  WHERE status = 'published' OR status IS NULL;

-- ──────────────────────────────────────────────────────────────
-- F. Migrate existing published policies
--    All existing leave_policy_masters rows were always "live",
--    so treat them as version 1 published.
-- ──────────────────────────────────────────────────────────────

UPDATE leave_policy_masters
  SET status       = 'published',
      version      = 1,
      published_at = created_at
  WHERE status = 'draft';  -- default value applied above; this makes them published

-- ──────────────────────────────────────────────────────────────
-- G. updated_at triggers for new tables
-- ──────────────────────────────────────────────────────────────
-- policy_evaluation_log and policy_change_log are append-only;
-- no updated_at trigger needed.
-- leave_policy_versions is immutable; no trigger needed.
