# Billing (Razorpay) — setup & go-live checklist

CognixHR uses **Razorpay Subscriptions** for self-serve subscription billing.
The integration is built to **no-op safely until keys are configured** — the
app runs normally without billing; the subscribe flow simply reports
"billing not configured" until the env vars below are set.

## Architecture

```
Signup (trial) ──► Admin › Billing ──► POST /billing/checkout ──► Razorpay Checkout
                                                                        │
                          tenant.status = active  ◄── POST /billing/webhook (signed)
```

- **DB**: `supabase/migrations/278_tenant_subscriptions.sql` adds subscription
  columns on `tenants` + an idempotent `tenant_subscription_events` audit table.
- **Backend**: `apps/api/src/routes/billing/index.ts`
  - `GET  /billing/status`   — current plan/status/subscription (auth: tenant)
  - `POST /billing/checkout` — creates a Razorpay subscription, returns checkout params (auth: tenant)
  - `POST /billing/webhook`  — verifies `x-razorpay-signature`, activates tenant on success (public)
- **Frontend**: `apps/web/src/pages/billing/Billing.tsx` — plan picker + Razorpay Checkout loader.

## 1. Razorpay dashboard setup

1. Create a Razorpay account → switch to **Test mode** first.
2. **Plans** (Subscriptions → Plans): create one plan per tier and note the plan ids:
   - `standard`   → e.g. `plan_XXXXXXXXXXXX`
   - `enterprise` → e.g. `plan_YYYYYYYYYYYY`
3. **Webhook** (Settings → Webhooks): add `https://<api-host>/billing/webhook`
   subscribed to: `subscription.activated`, `subscription.charged`,
   `subscription.halted`, `subscription.cancelled`, `payment.captured`.
   Copy the **webhook secret**.
4. Get your **Key ID** and **Key Secret** (API Keys).

## 2. Environment variables

**Backend** (`apps/api`):
```
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxx
RAZORPAY_PLAN_STANDARD=plan_XXXXXXXXXXXX
RAZORPAY_PLAN_ENTERPRISE=plan_YYYYYYYYYYYY
```

**Frontend** (`apps/web/.env`):
```
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
```

## 3. Apply the migration

Run `supabase/migrations/278_tenant_subscriptions.sql` against your database
(via the Supabase SQL editor or your migration runner).

## 4. Install the SDK

```
cd apps/api && npm i razorpay
```

## 5. Go-live checklist

- [ ] Migration 278 applied in production
- [ ] Razorpay account in **Live mode**; live Key ID/Secret set
- [ ] Live plan ids set for each tier
- [ ] Webhook URL points at the production API and is **reachable** (test with a sample event)
- [ ] Webhook signature verification confirmed (a tampered payload is rejected)
- [ ] Trial-expiry / suspended gating enforced in the app (see "Plan limits" TODO)
- [ ] Refund / cancellation flow agreed with finance
- [ ] Taxes/GST handling configured in Razorpay
- [ ] Tested end-to-end in Test mode: subscribe → pay → tenant becomes `active`

## Notes

- The webhook is **idempotent** (`tenant_subscription_events.razorpay_event_id`
  is unique) — Razorpay delivers at-least-once.
- Without `RAZORPAY_KEY_ID`, `/billing/checkout` returns `{ configured: false }`
  and the UI shows a "contact sales / not configured" state. Nothing charges.
- Plan-limit enforcement (seat caps, trial expiry gating) is a separate
  follow-up flagged in the go-live audit.
