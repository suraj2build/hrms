-- ============================================================
-- 066_hr_events.sql
-- HR Event bus: events emitted by system actions,
-- notifications derived per-user from events.
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL,
  -- e.g. 'leave.approved', 'leave.rejected', 'correction.applied',
  --      'shift.changed', 'anomaly.detected', 'payroll.locked'
  payload       JSONB       NOT NULL DEFAULT '{}',
  actor_id      UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  target_type   TEXT        NULL,   -- 'employee' | 'team' | 'all'
  target_id     UUID        NULL,   -- employee_id when target_type='employee'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_events_tenant_type
  ON hr_events (tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_events_target
  ON hr_events (tenant_id, target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  recipient_id  UUID        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  event_id      UUID        NOT NULL REFERENCES hr_events(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  link          TEXT        NULL,     -- optional deep link path e.g. '/ess/leave'
  is_read       BOOLEAN     NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (tenant_id, recipient_id, is_read, created_at DESC);

ALTER TABLE hr_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Events: HR admin / super_admin can read all; employees can read events targeting them
DROP POLICY IF EXISTS "events_hr_read"   ON hr_events;
DROP POLICY IF EXISTS "events_hr_insert" ON hr_events;
DROP POLICY IF EXISTS "notif_own_read"   ON notifications;
DROP POLICY IF EXISTS "notif_own_update" ON notifications;
DROP POLICY IF EXISTS "notif_hr_insert"  ON notifications;

CREATE POLICY "events_hr_read" ON hr_events FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      get_user_role() IN ('super_admin', 'hr_admin', 'manager')
      OR target_id = auth.uid()
    )
  );

CREATE POLICY "events_hr_insert" ON hr_events FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- Notifications: users can only read their own
CREATE POLICY "notif_own_read" ON notifications FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND recipient_id = auth.uid());

CREATE POLICY "notif_own_update" ON notifications FOR UPDATE
  USING (tenant_id = get_user_tenant_id() AND recipient_id = auth.uid());

CREATE POLICY "notif_hr_insert" ON notifications FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
