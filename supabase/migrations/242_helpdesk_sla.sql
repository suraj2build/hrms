-- ============================================================
-- 242_helpdesk_sla.sql
--
-- ESS-05 completion: configurable SLA policies + resolution SLA.
--
--   • Adds resolution-SLA tracking columns to helpdesk_tickets
--     (response SLA already existed: sla_due_at / sla_breached_at).
--   • Adds a per-tenant, per-priority SLA policy table so response &
--     resolution windows are configurable instead of hard-coded.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Resolution-SLA columns on the ticket ───────────────────────────────────
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS resolution_due_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_breached_at TIMESTAMPTZ;

-- ── 2. Configurable SLA policy (per tenant, per priority) ──────────────────────
CREATE TABLE IF NOT EXISTS helpdesk_sla_policies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  priority         TEXT        NOT NULL CHECK (priority IN ('low','medium','high','urgent')),
  response_hours   INTEGER     NOT NULL CHECK (response_hours   > 0),
  resolution_hours INTEGER     NOT NULL CHECK (resolution_hours > 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  UNIQUE (tenant_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_sla_policies_tenant
  ON helpdesk_sla_policies (tenant_id);

ALTER TABLE helpdesk_sla_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS helpdesk_sla_policies_tenant_isolation ON helpdesk_sla_policies;
CREATE POLICY helpdesk_sla_policies_tenant_isolation
  ON helpdesk_sla_policies FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1));
