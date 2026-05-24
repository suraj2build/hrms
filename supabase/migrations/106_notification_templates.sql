-- =============================================================================
-- 106_notification_templates.sql
-- Multi-channel notification infrastructure
-- Channel configuration, reusable template library with placeholder support,
-- and a full delivery log capturing status for every notification sent.
-- Supports in-app, email, SMS, WhatsApp, Slack, and Teams channels.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: notification_channels
-- One row per active channel per tenant. config holds provider credentials
-- and channel-specific settings (stored encrypted at the application layer).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_channels (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type  TEXT NOT NULL CHECK (channel_type IN (
                      'in_app','email','sms','whatsapp','slack','teams')),
    provider_name TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    config        JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, channel_type)
);

-- ---------------------------------------------------------------------------
-- TABLE: notification_templates
-- Reusable message templates. body_template supports {{placeholder}} syntax.
-- available_channels lists which channels this template can be sent on.
-- has_action_cta enables a deep-link button in the notification UI.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_code      TEXT NOT NULL,
    template_name      TEXT NOT NULL,
    category           TEXT NOT NULL CHECK (category IN (
                           'attendance','leave','payroll','compliance',
                           'escalation','incident','approval','general')),
    severity           TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (
                           'info','warning','error','critical')),
    subject            TEXT,
    body_template      TEXT NOT NULL,
    available_channels TEXT[] NOT NULL DEFAULT '{}',
    placeholders       TEXT[] NOT NULL DEFAULT '{}',
    has_action_cta     BOOLEAN NOT NULL DEFAULT false,
    cta_label          TEXT,
    cta_route          TEXT,
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, template_code)
);

-- ---------------------------------------------------------------------------
-- TABLE: notification_log
-- Delivery record for every notification dispatched by the platform.
-- external_message_id is the provider's message ID for delivery tracking.
-- correlation_id groups related notifications (e.g., same payroll event).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_id           UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    recipient_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    recipient_profile_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    channel               TEXT NOT NULL,
    subject               TEXT,
    body                  TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                              'pending','sent','delivered','failed','bounced')),
    sent_at               TIMESTAMPTZ,
    delivered_at          TIMESTAMPTZ,
    failed_at             TIMESTAMPTZ,
    failure_reason        TEXT,
    external_message_id   TEXT,
    metadata              JSONB NOT NULL DEFAULT '{}',
    correlation_id        TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nl_tenant_employee
    ON notification_log (tenant_id, recipient_employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nl_tenant_status
    ON notification_log (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nl_correlation
    ON notification_log (tenant_id, correlation_id)
    WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: notification_channels
-- ---------------------------------------------------------------------------
ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nc_tenant_read" ON notification_channels
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "nc_hr_write" ON notification_channels
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: notification_templates
-- ---------------------------------------------------------------------------
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nt_tenant_read" ON notification_templates
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "nt_hr_write" ON notification_templates
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: notification_log
-- ---------------------------------------------------------------------------
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nl_tenant_read" ON notification_log
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "nl_hr_write" ON notification_log
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
