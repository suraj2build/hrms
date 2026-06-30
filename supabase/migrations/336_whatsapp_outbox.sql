-- Migration 336: WhatsApp Outbox
-- Logs every outbound WhatsApp message. Real HTTP delivery happens only when
-- WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID env vars are set.

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_phone       TEXT        NOT NULL,
  template_name  TEXT        NOT NULL,
  variables      JSONB       NOT NULL DEFAULT '{}',
  body_preview   TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','sent','failed')),
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_status
  ON whatsapp_outbox(status, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_tenant
  ON whatsapp_outbox(tenant_id, created_at DESC);

ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_outbox_admin" ON whatsapp_outbox;
CREATE POLICY "wa_outbox_admin" ON whatsapp_outbox FOR ALL
  USING (tenant_id = get_user_tenant_id()
         AND get_user_role() IN ('super_admin','hr_admin'));
