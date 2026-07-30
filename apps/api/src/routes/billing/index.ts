/**
 * Billing routes — Razorpay subscriptions.
 *
 *   GET  /billing/status   — current subscription state for the tenant (auth)
 *   POST /billing/checkout — create a Razorpay subscription, return checkout params (auth)
 *   POST /billing/webhook  — Razorpay → us; signature-verified; activates tenant (public)
 *
 * No-op safe: without RAZORPAY_* env vars, /status and /checkout report
 * `configured:false` and nothing charges. See BILLING.md + migration 278.
 */
import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { z } from 'zod'
import {
  getRazorpay, isBillingConfigured, PLAN_IDS, WEBHOOK_SECRET, PUBLIC_KEY_ID,
} from '../../lib/razorpay.js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'

const checkoutSchema = z.object({ plan: z.enum(['standard', 'enterprise']) })

export default async function billingRoutes(fastify: FastifyInstance) {
  // Financial terms (rate, plan, subscription status) and live subscription
  // mutation — only ever surfaced to the admin billing UI (AdminShellV2),
  // but that's a client-side route gate only. Lock server-side to hr_admin
  // so a regular employee can't read the tenant's billing terms or create a
  // live Razorpay subscription by calling the API directly.
  const auth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── GET /billing/status ─────────────────────────────────────────────────────
  fastify.get('/billing/status', auth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('tenants')
      .select('plan, status, subscription_status, subscription_plan_id, current_period_end, trial_ends_at, per_employee_rate')
      .eq('id', req.tenantId)
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch billing status')
    return reply.send({ data: { ...data, configured: isBillingConfigured(), keyId: PUBLIC_KEY_ID } })
  })

  // ── POST /billing/checkout ──────────────────────────────────────────────────
  fastify.post('/billing/checkout', auth, async (req, reply) => {
    if (!isBillingConfigured()) return reply.send({ configured: false })

    const parsed = checkoutSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'plan must be standard or enterprise' })
    }
    const planId = PLAN_IDS[parsed.data.plan]
    if (!planId) {
      return reply.code(400).send({ error: 'CONFIG', message: `No Razorpay plan id configured for ${parsed.data.plan}` })
    }

    // A dropped response / double-click retries the identical checkout
    // request — without this, the line 68 status-based guard only narrows
    // the double-subscription window, it doesn't close it (two concurrent
    // requests can both read the tenant row before either write lands).
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(fastify.supabase, req.tenantId, iKey, 'billing-checkout')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    const { data: tenant, error: tenantErr } = await fastify.supabase
      .from('tenants').select('name, billing_email, subscription_status, razorpay_subscription_id').eq('id', req.tenantId).single()
    if (tenantErr) return serverError(req, reply, tenantErr, ErrorCode.QUERY_FAILED, 'Failed to fetch tenant billing state')

    // Fresh audit finding: no precondition check meant a double-click or a
    // retried network timeout created two live Razorpay subscriptions for
    // the same tenant (both billing it), but the DB only ever remembered
    // the latest razorpay_subscription_id — the first was silently
    // orphaned. Gating only on subscription_status === 'active' didn't
    // actually close this: per migration 278, a freshly-created
    // subscription sits in 'created'/'authenticated' until Razorpay's
    // async webhook flips it to 'active' — exactly the window a
    // double-click/retry lands in. Reject re-checkout whenever a
    // subscription already exists and hasn't reached a terminal state.
    const existingStatus = (tenant as any)?.subscription_status as string | null
    if ((tenant as any)?.razorpay_subscription_id && existingStatus && !['cancelled', 'completed'].includes(existingStatus)) {
      return reply.code(409).send({ error: 'ALREADY_SUBSCRIBED', message: 'Tenant already has a subscription in progress' })
    }

    try {
      const sub = await getRazorpay().subscriptions.create({
        plan_id: planId,
        total_count: 12,            // billing cycles; adjust to your terms
        customer_notify: 1,
        notes: { tenant_id: req.tenantId, tenant_name: tenant?.name ?? '' },
      } as any)

      const { error: persistErr } = await fastify.supabase.from('tenants').update({
        razorpay_subscription_id: sub.id,
        subscription_status:      sub.status,
        subscription_plan_id:     planId,
      }).eq('id', req.tenantId)

      if (persistErr) {
        // The line 68 duplicate-subscription guard reads razorpay_subscription_id
        // off this row — if this write is lost, the tenant looks unsubscribed and
        // the next checkout attempt creates a second live subscription. Best-effort
        // cancel the one we just created rather than leaving it orphaned and
        // untracked; still fail the request either way so the client can retry.
        try {
          await getRazorpay().subscriptions.cancel(sub.id, false)
        } catch (cancelErr: any) {
          req.log.error({ err: cancelErr, subscriptionId: sub.id }, '[billing] failed to cancel orphaned subscription after DB write failure')
        }
        return serverError(req, reply, persistErr, ErrorCode.UPDATE_FAILED, 'Failed to save subscription. Please try again.')
      }

      const responseBody = { configured: true, subscriptionId: sub.id, keyId: PUBLIC_KEY_ID }
      if (iKey) await storeIdempotency(fastify.supabase, req.tenantId, iKey, 'billing-checkout', 200, responseBody)
      return reply.send(responseBody)
    } catch (e: any) {
      req.log.error({ err: e }, '[billing] checkout failed')
      return reply.code(502).send({ error: 'RAZORPAY', message: 'Failed to create subscription. Please try again or contact support.' })
    }
  })

  // ── POST /billing/webhook (public, signature-verified, raw body) ────────────
  fastify.post('/billing/webhook', { config: { rawBody: true } }, async (req, reply) => {
    if (!WEBHOOK_SECRET) return reply.code(503).send({ error: 'NOT_CONFIGURED' })

    const signature = req.headers['x-razorpay-signature'] as string | undefined
    const raw       = (req as any).rawBody as string | Buffer | undefined
    if (!signature || !raw) return reply.code(400).send({ error: 'BAD_REQUEST' })

    // Razorpay webhook signature = HMAC-SHA256(rawBody, webhookSecret)
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')
    const ok = expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    if (!ok) return reply.code(401).send({ error: 'INVALID_SIGNATURE' })

    const event   = req.body as any
    const eventId = (req.headers['x-razorpay-event-id'] as string) ?? null
    const type    = event?.event as string | undefined
    const sub     = event?.payload?.subscription?.entity
    const subId   = sub?.id as string | undefined

    // Idempotency — Razorpay delivers at-least-once.
    if (eventId) {
      const { data: seen } = await fastify.supabase
        .from('tenant_subscription_events').select('id').eq('razorpay_event_id', eventId).maybeSingle()
      if (seen) return reply.send({ ok: true, deduped: true })
    }

    // Resolve the tenant from notes.tenant_id, falling back to the stored sub id.
    let tenantId = (sub?.notes?.tenant_id as string | undefined) ?? null
    if (!tenantId && subId) {
      const { data: t } = await fastify.supabase
        .from('tenants').select('id').eq('razorpay_subscription_id', subId).maybeSingle()
      tenantId = t?.id ?? null
    }

    if (tenantId && type) {
      const updates: Record<string, any> = {}
      switch (type) {
        case 'subscription.activated':
        case 'subscription.charged':
          updates.status = 'active'
          updates.subscription_status = 'active'
          if (sub?.current_end) updates.current_period_end = new Date(sub.current_end * 1000).toISOString()
          break
        case 'subscription.halted':
          updates.subscription_status = 'halted'
          updates.status = 'suspended'
          break
        case 'subscription.cancelled':
          updates.subscription_status = 'cancelled'
          updates.status = 'cancelled'
          break
        // Fresh audit finding: fired when a subscription with a fixed
        // total_count (configured as 12 at checkout) finishes its cycles.
        // Without this case, `updates` stayed empty and subscription_status
        // was permanently stuck at 'active' — which both hides that billing
        // actually ended, and (since the double-subscription guard above
        // only allows re-checkout when subscription_status is 'cancelled'
        // or 'completed') would have permanently blocked the tenant from
        // ever re-subscribing. tenants.status has no 'completed' value in
        // its CHECK constraint, so it maps to 'cancelled' like the case above.
        case 'subscription.completed':
          updates.subscription_status = 'completed'
          updates.status = 'cancelled'
          break
      }
      if (Object.keys(updates).length) {
        const { error: tenantUpdateError } = await fastify.supabase.from('tenants').update(updates).eq('id', tenantId)
        if (tenantUpdateError) {
          // Do NOT report success to Razorpay — a 5xx makes Razorpay retry
          // delivery, which is the only way this update gets another chance.
          return serverError(req, reply, tenantUpdateError, ErrorCode.UPDATE_FAILED, 'Failed to apply subscription status update')
        }
      }
    }

    const { error: eventInsertErr } = await fastify.supabase.from('tenant_subscription_events').insert({
      tenant_id:         tenantId,
      razorpay_event_id: eventId,
      event_type:        type ?? 'unknown',
      payload:           event,
    })
    // 23505 = a concurrent duplicate delivery already inserted this event id
    // (the dedup check above is a TOCTOU, not a guarantee) — that's fine, the
    // row already exists. Anything else is a real audit-trail gap worth logging.
    if (eventInsertErr && eventInsertErr.code !== '23505') {
      req.log.error({ err: eventInsertErr, eventId }, '[billing] failed to record subscription event')
    }

    return reply.send({ ok: true })
  })
}
