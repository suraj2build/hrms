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

    const { data: tenant } = await fastify.supabase
      .from('tenants').select('name, billing_email, subscription_status, razorpay_subscription_id').eq('id', req.tenantId).single()

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

      await fastify.supabase.from('tenants').update({
        razorpay_subscription_id: sub.id,
        subscription_status:      sub.status,
        subscription_plan_id:     planId,
      }).eq('id', req.tenantId)

      return reply.send({ configured: true, subscriptionId: sub.id, keyId: PUBLIC_KEY_ID })
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

    await fastify.supabase.from('tenant_subscription_events').insert({
      tenant_id:         tenantId,
      razorpay_event_id: eventId,
      event_type:        type ?? 'unknown',
      payload:           event,
    })

    return reply.send({ ok: true })
  })
}
