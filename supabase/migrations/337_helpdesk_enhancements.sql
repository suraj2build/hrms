-- Migration 337: Helpdesk Enhancements
-- Adds ticket number sequence, POSH/compliance categories, AI team suggestion,
-- KB promotion columns, and escalation matrix table.

-- ── Ticket number sequence ────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS helpdesk_ticket_seq START 1;

ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS ticket_number TEXT;

-- Populate existing rows (one-time backfill)
UPDATE helpdesk_tickets
SET ticket_number = 'TKT-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' ||
                    LPAD(nextval('helpdesk_ticket_seq')::TEXT, 5, '0')
WHERE ticket_number IS NULL;

-- Function to auto-generate ticket_number on insert
CREATE OR REPLACE FUNCTION set_helpdesk_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_number IS NULL THEN
    NEW.ticket_number := 'TKT-' || EXTRACT(YEAR FROM NEW.created_at)::TEXT || '-' ||
                         LPAD(nextval('helpdesk_ticket_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_helpdesk_ticket_number ON helpdesk_tickets;
CREATE TRIGGER trg_helpdesk_ticket_number
  BEFORE INSERT ON helpdesk_tickets
  FOR EACH ROW EXECUTE FUNCTION set_helpdesk_ticket_number();

-- ── Add POSH/compliance categories ───────────────────────────────────────────
-- Drop and recreate the category check to add new values
ALTER TABLE helpdesk_tickets
  DROP CONSTRAINT IF EXISTS helpdesk_tickets_category_check;

ALTER TABLE helpdesk_tickets
  ADD CONSTRAINT helpdesk_tickets_category_check
  CHECK (category IN ('payroll','leave','attendance','it','facilities',
                      'hr_policy','grievance','other','posh','compliance'));

-- ── AI suggested team column ─────────────────────────────────────────────────
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS ai_suggested_team TEXT;

-- ── KB promotion columns ──────────────────────────────────────────────────────
ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS kb_promoted    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kb_promoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kb_summary     TEXT;

-- ── Escalation matrix ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helpdesk_escalation_matrix (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category          TEXT        NOT NULL,
  level             INT         NOT NULL CHECK (level IN (1, 2)),
  assignee_role     TEXT        NOT NULL,
  notify_after_hours INT        NOT NULL DEFAULT 24,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category, level)
);

ALTER TABLE helpdesk_escalation_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escalation_matrix_admin" ON helpdesk_escalation_matrix;
CREATE POLICY "escalation_matrix_admin" ON helpdesk_escalation_matrix FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));

-- Seed default matrix for demo tenant
INSERT INTO helpdesk_escalation_matrix (tenant_id, category, level, assignee_role, notify_after_hours)
SELECT id, cat, lvl, role, hours
FROM tenants,
     (VALUES
       ('payroll', 1, 'hr_admin', 24),
       ('payroll', 2, 'hr_manager', 48),
       ('leave', 1, 'hr_admin', 24),
       ('leave', 2, 'hr_manager', 48),
       ('attendance', 1, 'hr_admin', 24),
       ('attendance', 2, 'hr_manager', 48),
       ('it', 1, 'it_manager', 24),
       ('it', 2, 'hr_admin', 48),
       ('facilities', 1, 'hr_admin', 24),
       ('facilities', 2, 'hr_manager', 48),
       ('posh', 1, 'hr_admin', 4),
       ('posh', 2, 'chro', 24),
       ('compliance', 1, 'hr_admin', 24),
       ('compliance', 2, 'chro', 48),
       ('hr_policy', 1, 'hr_admin', 24),
       ('hr_policy', 2, 'hr_manager', 48),
       ('grievance', 1, 'hr_manager', 24),
       ('grievance', 2, 'chro', 48),
       ('other', 1, 'hr_admin', 48),
       ('other', 2, 'hr_manager', 72)
     ) AS t(cat, lvl, role, hours)
WHERE NOT EXISTS (
  SELECT 1 FROM helpdesk_escalation_matrix m
  WHERE m.tenant_id = tenants.id AND m.category = t.cat AND m.level = t.lvl
);

-- Update category SLA entries to include posh/compliance
INSERT INTO helpdesk_category_sla (tenant_id, category, response_hours, resolution_hours)
SELECT t.id, v.category, v.response_hours, v.resolution_hours
FROM tenants t,
     (VALUES
       ('posh', 4, 120),
       ('compliance', 8, 48)
     ) AS v(category, response_hours, resolution_hours)
WHERE NOT EXISTS (
  SELECT 1 FROM helpdesk_category_sla h
  WHERE h.tenant_id = t.id AND h.category = v.category
);
