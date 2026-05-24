-- ============================================================
-- 089_governance_evolution.sql
-- Enterprise Governance Evolution: approval matrices,
-- delegations, temporary overrides, governance simulation.
-- ============================================================

-- Approval matrices — who approves what, at what threshold
CREATE TABLE IF NOT EXISTS approval_matrices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  entity_type     TEXT        NOT NULL CHECK (entity_type IN (
    'leave_request', 'correction', 'overtime', 'comp_off',
    'separation', 'payroll_run', 'policy_change', 'roster_override',
    'expense', 'general'
  )),
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  description     TEXT,
  -- Stage configuration (JSONB array of stages)
  stages          JSONB       NOT NULL DEFAULT '[]',
  -- Each stage: { stage_number, approver_type ('role'|'employee'|'manager'),
  --               approver_value, condition, sla_hours, escalation_employee_id }
  -- Payroll threshold triggers
  payroll_threshold DECIMAL(12,2),  -- if transaction value > this, use this matrix
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_am_tenant_type
  ON approval_matrices (tenant_id, entity_type, is_active);

-- Approval delegations — temporary authority transfers
CREATE TABLE IF NOT EXISTS approval_delegations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delegator_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delegate_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_types    TEXT[]      NOT NULL DEFAULT '{}',   -- which entity types are covered
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_until     TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  reason          TEXT,
  approved_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from),
  CHECK (delegator_id != delegate_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_delegate_active
  ON approval_delegations (tenant_id, delegate_id, valid_from, valid_until)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ad_delegator
  ON approval_delegations (tenant_id, delegator_id, is_active);

-- Temporary operational overrides — time-boxed authority grants
CREATE TABLE IF NOT EXISTS operational_overrides (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  override_type   TEXT        NOT NULL CHECK (override_type IN (
    'bypass_approval', 'extend_sla', 'unlock_period',
    'force_process', 'grant_balance', 'roster_freeze_lift',
    'policy_exception'
  )),
  granted_to      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope           JSONB       NOT NULL DEFAULT '{}',   -- { entity_type, entity_id, department_id }
  reason          TEXT        NOT NULL,
  justification   TEXT,
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until     TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  revoked_at      TIMESTAMPTZ,
  revoked_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  revoke_reason   TEXT,
  used_count      INT         NOT NULL DEFAULT 0,
  max_uses        INT,                                 -- NULL = unlimited within time window
  audit_trail     JSONB       NOT NULL DEFAULT '[]',  -- array of usage events
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_oo_tenant_active
  ON operational_overrides (tenant_id, is_active, valid_until) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_oo_granted_to
  ON operational_overrides (tenant_id, granted_to, valid_until) WHERE is_active = true;

-- Governance simulation log — track what-if approval simulations
CREATE TABLE IF NOT EXISTS governance_simulations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  simulated_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  scenario        JSONB       NOT NULL DEFAULT '{}',  -- input scenario
  result          JSONB       NOT NULL DEFAULT '{}',  -- computed approval path
  matrix_used     UUID        REFERENCES approval_matrices(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gs_tenant_user
  ON governance_simulations (tenant_id, simulated_by, created_at DESC);

-- Governance rollback chains — audit of undone governance actions
CREATE TABLE IF NOT EXISTS governance_rollbacks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT        NOT NULL,
  entity_id       UUID        NOT NULL,
  action_type     TEXT        NOT NULL,               -- 'approved', 'rejected', 'escalated'
  rolled_back_by  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rollback_reason TEXT        NOT NULL,
  before_state    JSONB       NOT NULL DEFAULT '{}',
  after_state     JSONB       NOT NULL DEFAULT '{}',
  is_completed    BOOLEAN     NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gr_tenant_entity
  ON governance_rollbacks (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_gr_tenant_pending
  ON governance_rollbacks (tenant_id, is_completed, created_at DESC);

-- RLS
ALTER TABLE approval_matrices ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_rollbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "am_tenant_read" ON approval_matrices FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "am_admin_write" ON approval_matrices FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "ad_tenant_read" ON approval_delegations FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "ad_admin_write" ON approval_delegations FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "oo_tenant_read" ON operational_overrides FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "oo_admin_write" ON operational_overrides FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));

CREATE POLICY "gs_tenant_read" ON governance_simulations FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "gs_user_write" ON governance_simulations FOR ALL
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "gr_tenant_read" ON governance_rollbacks FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "gr_admin_write" ON governance_rollbacks FOR ALL
  USING (get_user_role() IN ('super_admin','hr_admin'));
