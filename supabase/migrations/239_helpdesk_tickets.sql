-- 239_helpdesk_tickets.sql
-- ESS-05: HR Helpdesk ticketing system.
--   helpdesk_tickets          — one row per support request
--   helpdesk_ticket_comments  — threaded conversation (+ internal HR notes)
-- Tenant-scoped, RLS-protected, with SLA tracking and auto-updated_at.

-- ── Tickets ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  subject           TEXT         NOT NULL,
  description       TEXT         NOT NULL,
  category          TEXT         NOT NULL DEFAULT 'other'
                    CHECK (category IN ('payroll','leave','attendance','it','facilities','hr_policy','other')),
  priority          TEXT         NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high','urgent')),
  status            TEXT         NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','awaiting_employee','resolved','closed')),

  -- Requester (employee record) + creating profile
  employee_id       UUID         REFERENCES employees(id) ON DELETE SET NULL,
  created_by        UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  -- Assigned HR agent
  assigned_to       UUID         REFERENCES profiles(id) ON DELETE SET NULL,

  -- SLA tracking
  sla_hours         INTEGER      NOT NULL DEFAULT 24,
  sla_due_at        TIMESTAMPTZ,
  sla_breached_at   TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  resolution_note   TEXT,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_tenant_status
  ON helpdesk_tickets (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_helpdesk_employee
  ON helpdesk_tickets (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_helpdesk_assigned
  ON helpdesk_tickets (tenant_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ── Comments ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS helpdesk_ticket_comments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id    UUID         NOT NULL REFERENCES helpdesk_tickets(id) ON DELETE CASCADE,
  author_id    UUID         NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  author_role  TEXT         NOT NULL DEFAULT 'employee'
               CHECK (author_role IN ('employee','hr')),
  body         TEXT         NOT NULL,
  -- Internal notes are visible to HR only, never to the employee.
  is_internal  BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helpdesk_comments_ticket
  ON helpdesk_ticket_comments (tenant_id, ticket_id, created_at ASC);

-- ── Auto-update updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_helpdesk_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_helpdesk_updated_at ON helpdesk_tickets;
CREATE TRIGGER trg_helpdesk_updated_at
  BEFORE UPDATE ON helpdesk_tickets
  FOR EACH ROW EXECUTE FUNCTION trg_helpdesk_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────
-- The API uses the service-role client (bypasses RLS) and enforces tenant +
-- ownership scoping in the handlers. These policies are defense-in-depth for any
-- authenticated direct access.

ALTER TABLE helpdesk_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_ticket_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS helpdesk_tickets_tenant_read  ON helpdesk_tickets;
CREATE POLICY helpdesk_tickets_tenant_read ON helpdesk_tickets FOR SELECT
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS helpdesk_tickets_tenant_write ON helpdesk_tickets;
CREATE POLICY helpdesk_tickets_tenant_write ON helpdesk_tickets FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS helpdesk_tickets_tenant_update ON helpdesk_tickets;
CREATE POLICY helpdesk_tickets_tenant_update ON helpdesk_tickets FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS helpdesk_comments_tenant_read  ON helpdesk_ticket_comments;
CREATE POLICY helpdesk_comments_tenant_read ON helpdesk_ticket_comments FOR SELECT
  USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS helpdesk_comments_tenant_write ON helpdesk_ticket_comments;
CREATE POLICY helpdesk_comments_tenant_write ON helpdesk_ticket_comments FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
