-- ============================================================
-- 250_notification_preferences.sql
--
-- R9 (Scheduled Intelligence Push) — the delivery-preference + channel layer.
--
-- The R9 audit found that digests are computed but never delivered, the
-- channel toggle is a no-op stub, and there is no model for who-gets-what-when.
-- This migration adds the three tables R9-full needs:
--
--   notification_channel_settings — persists the tenant channel toggles that
--     /notifications/channels used to fake (in_app/email/sms/push/webhook).
--   user_notification_preferences — per-user digest subscription
--     (frequency × channel × enabled). Absence of a row = the seeded default.
--   digest_send_log — idempotency + audit trail: one send per
--     (tenant, recipient, frequency, channel, period). Prevents double-send
--     even if the scheduler ticks several times in a period.
--
-- All additive, tenant-scoped, RLS-enabled, idempotent.
-- ============================================================

-- ── Tenant channel settings (replaces the /channels stub) ─────────────────────
CREATE TABLE IF NOT EXISTS notification_channel_settings (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_type  TEXT         NOT NULL
                CHECK (channel_type IN ('in_app','email','sms','push','webhook')),
  is_enabled    BOOLEAN      NOT NULL DEFAULT false,
  config        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel_type)
);

CREATE INDEX IF NOT EXISTS idx_ncs_tenant ON notification_channel_settings (tenant_id);

ALTER TABLE notification_channel_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ncs_tenant_iso ON notification_channel_settings;
CREATE POLICY ncs_tenant_iso ON notification_channel_settings
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Per-user digest preferences ───────────────────────────────────────────────
-- One row per (user, frequency, channel). enabled flips the subscription.
-- frequency: daily | weekly | monthly   channel: in_app | email
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  frequency     TEXT         NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  channel       TEXT         NOT NULL CHECK (channel IN ('in_app','email')),
  enabled       BOOLEAN      NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, frequency, channel)
);

CREATE INDEX IF NOT EXISTS idx_unp_tenant_user
  ON user_notification_preferences (tenant_id, user_id);

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS unp_tenant_iso ON user_notification_preferences;
CREATE POLICY unp_tenant_iso ON user_notification_preferences
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ── Scheduled-send log (idempotency + audit) ──────────────────────────────────
-- period_key is the granularity guard: 'YYYY-MM-DD' (daily), 'YYYY-Www'
-- (weekly, ISO week), 'YYYY-MM' (monthly). The UNIQUE constraint makes a second
-- send in the same period a no-op (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS digest_send_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_id  UUID         NOT NULL,
  frequency     TEXT         NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  channel       TEXT         NOT NULL CHECK (channel IN ('in_app','email')),
  period_key    TEXT         NOT NULL,
  status        TEXT         NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent','skipped','failed')),
  detail        TEXT,
  sent_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, recipient_id, frequency, channel, period_key)
);

CREATE INDEX IF NOT EXISTS idx_dsl_tenant_period
  ON digest_send_log (tenant_id, frequency, period_key);

ALTER TABLE digest_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsl_tenant_iso ON digest_send_log;
CREATE POLICY dsl_tenant_iso ON digest_send_log
  USING  (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
