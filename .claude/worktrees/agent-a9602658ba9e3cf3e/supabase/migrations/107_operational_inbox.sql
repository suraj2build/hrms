-- =============================================================================
-- 107_operational_inbox.sql
-- Unified operational inbox and escalation engine
-- Provides a single inbox surface for approval requests, payroll blockers,
-- compliance alerts, and incident notifications. Escalation rules define
-- auto-escalation logic; inbox_escalations track each escalation hop.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLE: inbox_items
-- Each inbox item is a targeted notification requiring action or awareness.
-- entity_type + entity_id link the item to the originating domain object.
-- expires_at enables auto-expiry for time-sensitive alerts.
-- snoozed_until supports the snooze-and-remind UX pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
    item_type       TEXT NOT NULL CHECK (item_type IN (
                        'approval_request','payroll_blocker','incident_alert',
                        'escalation','sla_breach','compliance_alert',
                        'reimbursement_action','declaration_review',
                        'advance_action','loan_action','validation_error','general')),
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (
                        'info','warning','error','critical')),
    status          TEXT NOT NULL DEFAULT 'unread' CHECK (status IN (
                        'unread','read','actioned','dismissed','snoozed')),
    entity_type     TEXT,
    entity_id       UUID,
    action_route    TEXT,
    action_label    TEXT,
    snoozed_until   TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    actioned_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    correlation_id  TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: escalation_rules
-- Configurable rules that determine when and how inbox items are escalated.
-- trigger_condition: JSONB containing thresholds (e.g., {"pending_hours": 24}).
-- escalation_levels: JSONB array defining ordered escalation targets with
--   role or profile references (e.g., [{"level":1,"role":"hr_manager"}]).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalation_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_name           TEXT NOT NULL,
    trigger_type        TEXT NOT NULL CHECK (trigger_type IN (
                            'sla_breach','approval_pending','incident_open',
                            'reimbursement_delay','validation_blocked','payroll_freeze')),
    trigger_condition   JSONB NOT NULL DEFAULT '{}',
    escalation_levels   JSONB NOT NULL DEFAULT '[]',
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- TABLE: inbox_escalations
-- Records each individual escalation hop for an inbox item.
-- from_profile_id is the original assignee being bypassed.
-- to_profile_id is the new assignee receiving the escalated item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbox_escalations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    inbox_item_id    UUID NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
    rule_id          UUID REFERENCES escalation_rules(id) ON DELETE SET NULL,
    escalation_level INT NOT NULL DEFAULT 1,
    from_profile_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    to_profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason           TEXT NOT NULL,
    escalated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at  TIMESTAMPTZ,
    is_resolved      BOOLEAN NOT NULL DEFAULT false,
    resolved_at      TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ii_recipient_status
    ON inbox_items (tenant_id, recipient_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ii_item_type
    ON inbox_items (tenant_id, item_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ii_active_status
    ON inbox_items (tenant_id, status)
    WHERE status IN ('unread','read');

CREATE INDEX IF NOT EXISTS idx_ii_correlation
    ON inbox_items (tenant_id, correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ie_inbox_item
    ON inbox_escalations (tenant_id, inbox_item_id);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: inbox_items
-- Employees see only their own inbox items; HR can read and write all.
-- ---------------------------------------------------------------------------
ALTER TABLE inbox_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ii_recipient_read" ON inbox_items
    FOR SELECT
    USING (tenant_id = get_user_tenant_id() AND recipient_id = auth.uid());

CREATE POLICY "ii_hr_write" ON inbox_items
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: escalation_rules
-- ---------------------------------------------------------------------------
ALTER TABLE escalation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "er_tenant_read" ON escalation_rules
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "er_hr_write" ON escalation_rules
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY: inbox_escalations
-- ---------------------------------------------------------------------------
ALTER TABLE inbox_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ie_tenant_read" ON inbox_escalations
    FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ie_hr_write" ON inbox_escalations
    FOR ALL
    USING (get_user_role() IN ('super_admin','hr_admin'));
