-- ============================================================
-- 053_approval_workflows.sql
--
-- Multi-level approval workflow support.
--
-- approval_workflow_config  — defines ordered approval levels for a
--   workflow type (leave, correction, regularisation).  Each tenant
--   configures their own levels.
--
-- approval_instances        — one row per pending approval chain
--   (linked to a leave_request or attendance_correction).
--
-- approval_actions          — log of every approve/reject/escalate
--   action taken at each level.
--
-- Design:
--   • approval_instances.current_level starts at 1.
--   • On action: if current_level < total_levels AND action='approved'
--     → increment level and notify next approver.
--   • When current_level reaches total_levels and action='approved'
--     → final_approved = true; trigger back-end callback.
--   • Any rejection at any level → final_approved = false; done.
-- ============================================================

-- ── approval_workflow_config ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_workflow_config (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which workflow type this config applies to
  workflow_type  TEXT        NOT NULL
    CHECK (workflow_type IN ('leave', 'correction', 'regularisation')),

  -- Ordered level number (1 = first approver, 2 = second, …)
  level          INT         NOT NULL CHECK (level >= 1),

  -- Who approves at this level
  approver_type  TEXT        NOT NULL
    CHECK (approver_type IN ('direct_manager', 'hr_admin', 'super_admin', 'specific_role')),

  -- When approver_type = 'specific_role', this holds the role value
  specific_role  TEXT        NULL,

  -- Human-readable label (e.g. "Line Manager", "HR Department")
  label          TEXT        NOT NULL DEFAULT '',

  -- Optional: auto-approve after N hours if no action taken (NULL = never)
  auto_approve_after_hours INT NULL CHECK (auto_approve_after_hours IS NULL OR auto_approve_after_hours > 0),

  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, workflow_type, level)
);

CREATE INDEX IF NOT EXISTS idx_workflow_config_tenant
  ON approval_workflow_config (tenant_id, workflow_type, level);

-- ── approval_instances ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_instances (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which entity this approval chain is for
  entity_type    TEXT        NOT NULL
    CHECK (entity_type IN ('leave_request', 'attendance_correction', 'attendance_regularisation')),
  entity_id      UUID        NOT NULL,

  -- Submitter
  submitted_by   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Workflow progress
  total_levels   INT         NOT NULL DEFAULT 1,
  current_level  INT         NOT NULL DEFAULT 1,

  -- Final outcome (NULL = still in progress)
  final_approved BOOLEAN     NULL,
  closed_at      TIMESTAMPTZ NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_instances_entity
  ON approval_instances (tenant_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_instances_pending
  ON approval_instances (tenant_id, final_approved, current_level)
  WHERE final_approved IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_approval_instances_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_instances_updated_at ON approval_instances;
CREATE TRIGGER trg_approval_instances_updated_at
  BEFORE UPDATE ON approval_instances
  FOR EACH ROW EXECUTE FUNCTION set_approval_instances_updated_at();

-- ── approval_actions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_actions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id    UUID        NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,

  level          INT         NOT NULL,
  action         TEXT        NOT NULL CHECK (action IN ('approved', 'rejected', 'escalated', 'auto_approved')),
  actor_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comments       TEXT        NULL,
  acted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_actions_instance
  ON approval_actions (instance_id, level, acted_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE approval_workflow_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "awc_tenant_read" ON approval_workflow_config FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "awc_hr_write"    ON approval_workflow_config FOR ALL
  USING (get_user_role() IN ('super_admin', 'hr_admin'));

ALTER TABLE approval_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_tenant_read" ON approval_instances FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ai_service_write" ON approval_instances FOR ALL
  USING (tenant_id = get_user_tenant_id());

ALTER TABLE approval_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aa_tenant_read" ON approval_actions FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "aa_service_write" ON approval_actions FOR ALL
  USING (tenant_id = get_user_tenant_id());
