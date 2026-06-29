-- Migration 324: Helpdesk Enhancements
-- Adds CSAT rating, merge-ticket link to helpdesk_tickets.
-- is_internal already exists on helpdesk_ticket_comments — no change needed.

ALTER TABLE helpdesk_tickets
  ADD COLUMN IF NOT EXISTS csat_rating       SMALLINT   CHECK (csat_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment      TEXT,
  ADD COLUMN IF NOT EXISTS csat_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into       UUID       REFERENCES helpdesk_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_merged_into
  ON helpdesk_tickets(merged_into) WHERE merged_into IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_helpdesk_tickets_csat
  ON helpdesk_tickets(tenant_id, csat_rating) WHERE csat_rating IS NOT NULL;
