-- ============================================================
-- 237_onboarding_lifecycle_events.sql
--
-- Phase O1.3: Auditability + O2 Timeline foundation.
--
-- A durable, append-only record of every onboarding lifecycle
-- event. The orchestrator persists one row per emitted event so
-- the Employee Journey Timeline (O2), Readiness Engine (O3), and
-- Executive Intelligence can consume a single source of truth
-- instead of each building its own onboarding history view.
--
-- Every row carries the full audit set required by O1.3:
--   tenant_id · event_type · session_id · employee_id · actor_id
--   · occurred_at (created_at)
--
-- Also extends notification_templates.category to allow
-- 'onboarding' so future DB-backed templates can be seeded.
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarding_lifecycle_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Canonical event type (e.g. 'onboarding.session.approved')
  event_type    TEXT        NOT NULL,

  -- Entity references — any may be NULL depending on lifecycle stage
  session_id    UUID        NULL,
  employee_id   UUID        NULL,
  draft_id      UUID        NULL,
  document_id   UUID        NULL,

  -- Who triggered it (NULL = system/automation)
  actor_id      UUID        NULL,

  -- Human-readable timeline label + structured payload
  title         TEXT        NOT NULL DEFAULT '',
  detail        JSONB       NOT NULL DEFAULT '{}',
  severity      TEXT        NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'success', 'warning', 'critical')),

  -- When the event actually occurred (matches event timestamp)
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timeline reads: by session, by employee, newest first
CREATE INDEX IF NOT EXISTS idx_onboarding_events_session
  ON onboarding_lifecycle_events (tenant_id, session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_employee
  ON onboarding_lifecycle_events (tenant_id, employee_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_type
  ON onboarding_lifecycle_events (tenant_id, event_type, occurred_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE onboarding_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ole_tenant_read" ON onboarding_lifecycle_events FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Service-role writes (orchestrator persists via service key, bypassing RLS;
-- this policy keeps tenant-scoped inserts valid for any authenticated path).
CREATE POLICY "ole_tenant_write" ON onboarding_lifecycle_events FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── notification_templates: allow 'onboarding' category ───────────────────────

ALTER TABLE notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_category_check;

ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_category_check
  CHECK (category IN (
    'attendance', 'leave', 'payroll', 'compliance',
    'escalation', 'incident', 'approval', 'general', 'onboarding'
  ));
