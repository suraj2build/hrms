-- Migration 332: Helpdesk AI routing + satisfaction + absconding auto-escalation

ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS satisfaction_rating  SMALLINT CHECK (satisfaction_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS satisfaction_comment  TEXT,
  ADD COLUMN IF NOT EXISTS satisfaction_rated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_suggested_category TEXT,
  ADD COLUMN IF NOT EXISTS ai_routing_confidence SMALLINT CHECK (ai_routing_confidence BETWEEN 0 AND 100);

-- Category-based SLA override table (separate from priority SLA)
CREATE TABLE IF NOT EXISTS helpdesk_category_sla (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category        TEXT        NOT NULL,
  response_hours  INTEGER     NOT NULL DEFAULT 24,
  resolution_hours INTEGER    NOT NULL DEFAULT 48,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);

-- Default category SLA values matching spec
INSERT INTO helpdesk_category_sla (tenant_id, category, response_hours, resolution_hours)
SELECT t.id, cat.category, cat.resp, cat.resol
FROM tenants t
CROSS JOIN (VALUES
  ('it_support', 8, 16),
  ('hr_query', 24, 48),
  ('payroll', 24, 48),
  ('general', 48, 96),
  ('grievance', 120, 240)
) AS cat(category, resp, resol)
ON CONFLICT (tenant_id, category) DO NOTHING;

ALTER TABLE helpdesk_category_sla ENABLE ROW LEVEL SECURITY;
CREATE POLICY "helpdesk_category_sla_admin" ON helpdesk_category_sla FOR ALL
  USING (tenant_id = get_user_tenant_id() AND get_user_role() IN ('super_admin','hr_admin'));
