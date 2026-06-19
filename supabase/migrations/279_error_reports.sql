-- ════════════════════════════════════════════════════════════════════════════
-- 279_error_reports.sql
-- In-product error reporting: when a user hits an error they can report it; the
-- report lands here so the owner panel can triage it in a trackable way.
-- (Complements Sentry, which is for the dev team's external dashboard.)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS error_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid,                       -- auth user who reported (nullable)
  employee_id  uuid,                       -- mapped employee, if any
  -- what happened
  message      text NOT NULL,              -- error message / summary
  stack        text,                       -- stack / component trace (truncated client-side)
  url          text,                       -- page URL where it occurred
  user_agent   text,
  user_note    text,                       -- free-text "what were you doing?"
  sentry_event_id text,                    -- cross-reference to Sentry, if captured
  severity     text NOT NULL DEFAULT 'error',   -- error | crash | feedback
  -- triage (owner-managed)
  status       text NOT NULL DEFAULT 'new',     -- new | triaged | resolved | dismissed
  owner_note   text,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_reports_status   ON error_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_reports_tenant   ON error_reports (tenant_id, created_at DESC);

-- Written by the backend service-role (report endpoint) and read/triaged by the
-- owner panel. Enable RLS with no permissive policies so tenant/anon keys can't
-- read other tenants' reports; service-role bypasses RLS.
ALTER TABLE error_reports ENABLE ROW LEVEL SECURITY;
