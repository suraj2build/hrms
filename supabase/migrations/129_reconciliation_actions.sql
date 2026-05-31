-- 129_reconciliation_actions.sql
--
-- Persists payroll reconciliation lifecycle actions so that acknowledged /
-- escalated / resolved states survive page reloads and cross-session.
--
-- Design:
--   • Append-only log — each action is a new row (immutable audit trail).
--   • The LATEST row for a (tenant_id, item_id, month) pair determines the
--     current operational status of that reconciliation item.
--   • The GET /payroll/reconciliation endpoint joins this table to enrich
--     each computed item with its persisted status before returning.
--
-- Status progression:
--   open  →  acknowledge  →  escalate  →  resolve
--             (any terminal action is allowed from any non-terminal state)

CREATE TABLE IF NOT EXISTS payroll_reconciliation_actions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Computed item ID produced by the GET endpoint, e.g. "lop-<empId>-0"
  item_id     text        NOT NULL,
  -- Payroll period this item belongs to, 'YYYY-MM'
  month       text        NOT NULL,
  -- Which lifecycle step was performed
  action_type text        NOT NULL
                CHECK (action_type IN ('acknowledge', 'escalate', 'resolve')),
  -- Free-form operator note (maps to 'notes', 'reason', 'resolution_notes' per action)
  notes       text,
  -- Who performed the action
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of latest action per item (used by GET /payroll/reconciliation)
CREATE INDEX IF NOT EXISTS idx_recon_actions_lookup
  ON payroll_reconciliation_actions (tenant_id, month, item_id, created_at DESC);

-- Tenant-scoped audit dump (admin audit queries by date)
CREATE INDEX IF NOT EXISTS idx_recon_actions_tenant_date
  ON payroll_reconciliation_actions (tenant_id, created_at DESC);
