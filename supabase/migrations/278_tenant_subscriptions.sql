-- ════════════════════════════════════════════════════════════════════════════
-- 278_tenant_subscriptions.sql
-- Razorpay subscription/billing scaffold.
--
-- Existing model: tenants are created in status='trial' by the owner panel, and
-- tenant_billing_snapshots holds read-only post-payroll usage. This migration
-- adds the columns + audit table needed to drive a self-serve subscribe→pay→
-- activate flow via Razorpay (see apps/api/src/routes/billing + BILLING.md).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Subscription state on the tenant ─────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS razorpay_customer_id      text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id  text,
  ADD COLUMN IF NOT EXISTS subscription_status       text,            -- created | authenticated | active | halted | cancelled | completed
  ADD COLUMN IF NOT EXISTS subscription_plan_id      text,            -- Razorpay plan id (maps to standard/enterprise)
  ADD COLUMN IF NOT EXISTS current_period_end        timestamptz;     -- next renewal / access-until

CREATE INDEX IF NOT EXISTS idx_tenants_razorpay_subscription
  ON tenants (razorpay_subscription_id);

-- ── Webhook / subscription event audit log (idempotency + history) ───────────
CREATE TABLE IF NOT EXISTS tenant_subscription_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id) ON DELETE CASCADE,
  razorpay_event_id text UNIQUE,                                      -- dedupe: Razorpay delivers webhooks at-least-once
  event_type      text NOT NULL,                                     -- e.g. subscription.activated, payment.captured
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscription_events_tenant
  ON tenant_subscription_events (tenant_id, created_at DESC);

-- RLS: this table is written only by the backend service-role (webhook handler)
-- and read by the owner panel. Enable RLS with no permissive policies so the
-- anon/tenant keys cannot touch it; service-role bypasses RLS.
ALTER TABLE tenant_subscription_events ENABLE ROW LEVEL SECURITY;
