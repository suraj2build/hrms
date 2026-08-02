/**
 * Webhook Management API
 *
 * Manages outbound webhooks and their delivery history.
 * All write operations are restricted to super_admin / hr_admin.
 *
 * GET    /system/webhooks                              — list webhooks with stats
 * GET    /system/webhooks/:id                          — single webhook + last 20 deliveries
 * POST   /system/webhooks                              — create webhook (admin)
 * PUT    /system/webhooks/:id                          — update webhook config (admin)
 * DELETE /system/webhooks/:id                          — soft-delete webhook (admin)
 * POST   /system/webhooks/:id/test                     — fire a test event to the webhook URL
 * GET    /system/webhooks/:id/deliveries               — paginated delivery history
 * POST   /system/webhooks/deliveries/:deliveryId/retry — mark delivery for retry (admin)
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { createHmac }           from 'crypto'
import { ssrfCheck }            from '../../lib/ssrf-guard.js'
import { WebhookService }       from '../../lib/webhook-service.js'

// ── Validation schemas ────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  is_active: z.enum(['true', 'false']).optional(),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
})

const createBodySchema = z.object({
  name:             z.string().min(1).max(255),
  url:              z.string().url({ message: 'url must be a valid URL' }),
  event_types:      z.array(z.string().min(1)).min(1, 'At least one event_type required'),
  secret:           z.string().optional(),
  headers:          z.record(z.string()).optional(),
  description:      z.string().optional(),
  max_retries:      z.coerce.number().int().min(0).max(10).optional(),
  timeout_seconds:  z.coerce.number().int().min(1).max(120).optional(),
})

const updateBodySchema = createBodySchema.partial().extend({
  is_active: z.boolean().optional(),
})

const deliveriesQuerySchema = z.object({
  status: z.enum(['pending', 'delivering', 'delivered', 'failed', 'retrying', 'dead_lettered']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

// ── Helper ────────────────────────────────────────────────────────────────────

import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

function isAdmin(role: string): boolean {
  return (HR_ADMIN_ROLES as readonly string[]).includes(role)
}

// Custom outbound headers (webhooks.headers, migration 091) commonly carry a
// destination Authorization/X-Api-Key value when the built-in HMAC secret
// mechanism doesn't fit the receiving vendor — mask the same way
// attendance/api-sources.ts redacts extra_headers, rather than passing them
// through in full on every read.
function redactHeaders(headers: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!headers) return {}
  const redacted: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (lower.includes('key') || lower.includes('password') || lower.includes('secret') || lower.includes('token') || lower.includes('authoriz')) {
      redacted[k] = typeof v === 'string' && v.length > 4 ? `${v.slice(0, 2)}${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-2)}` : '***'
    } else {
      redacted[k] = v
    }
  }
  return redacted
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function webhooksRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /system/webhooks ──────────────────────────────────────────────────
  fastify.get('/system/webhooks', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { is_active, limit } = parsed.data

    let q = fastify.supabase
      .from('webhooks')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false })
      .limit(limit)

    // Default to active-only when the caller doesn't specify — the frontend
    // has no "show inactive" toggle and treats DELETE as "remove from list",
    // so an omitted filter must not silently include deactivated webhooks.
    q = q.eq('is_active', is_active !== undefined ? is_active === 'true' : true)

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'webhooks list query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch webhooks' })
    }

    // Never re-serialize the HMAC signing secret, even to an admin — it's
    // write-only once set (same pattern as an API key), and this is the
    // secret used to sign every outbound webhook payload.
    const safeData = (data ?? []).map(({ secret, headers, ...w }: any) => ({ ...w, headers: redactHeaders(headers) }))
    return reply.send({ data: safeData, total: count ?? 0, limit })
  })

  // ── GET /system/webhooks/:id ──────────────────────────────────────────────
  fastify.get('/system/webhooks/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }
    const { id } = req.params as { id: string }

    const { data: webhook, error: webhookError } = await fastify.supabase
      .from('webhooks')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (webhookError || !webhook) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Webhook not found' })
    }

    const { data: deliveries, error: deliveryError } = await fastify.supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (deliveryError) {
      req.log.error({ err: deliveryError }, 'webhook deliveries fetch failed')
    }

    // Never re-serialize the HMAC signing secret — see GET / above.
    const { secret, headers, ...safeWebhook } = webhook as any

    return reply.send({
      data: {
        ...safeWebhook,
        headers:           redactHeaders(headers),
        recent_deliveries: deliveries ?? [],
      },
    })
  })

  // ── POST /system/webhooks ─────────────────────────────────────────────────
  fastify.post('/system/webhooks', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const parsed = createBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const {
      name, url, event_types, secret, headers,
      description, max_retries, timeout_seconds,
    } = parsed.data

    const ssrfBlockReason = ssrfCheck(url)
    if (ssrfBlockReason) {
      return reply.code(422).send({ error: 'INVALID_URL', message: ssrfBlockReason })
    }

    const { data, error } = await fastify.supabase
      .from('webhooks')
      .insert({
        tenant_id:       req.tenantId,
        name,
        url,
        event_types,
        secret:          secret          ?? null,
        headers:         headers         ?? null,
        description:     description     ?? null,
        max_retries:     max_retries     ?? 3,
        timeout_seconds: timeout_seconds ?? 30,
        is_active:       true,
        created_by:      req.userId,
      })
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'webhook insert failed')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to create webhook' })
    }

    // Never re-serialize the HMAC signing secret — see GET / above. The
    // caller just set it in this same request, so they already know it;
    // echoing it back in the response is unnecessary exposure (state,
    // network logs, browser devtools history).
    const { secret: _secret, headers: rowHeaders, ...safeData } = data as any
    return reply.code(201).send({ data: { ...safeData, headers: redactHeaders(rowHeaders) } })
  })

  // ── PUT /system/webhooks/:id ──────────────────────────────────────────────
  fastify.put('/system/webhooks/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const parsed = updateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    if (Object.keys(parsed.data).length === 0) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'No fields provided for update' })
    }

    if (parsed.data.url) {
      const ssrfBlockReason = ssrfCheck(parsed.data.url)
      if (ssrfBlockReason) {
        return reply.code(422).send({ error: 'INVALID_URL', message: ssrfBlockReason })
      }
    }

    const { data, error } = await fastify.supabase
      .from('webhooks')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select()
      .single()

    if (error) {
      req.log.error({ err: error }, 'webhook update failed')
      return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update webhook' })
    }

    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Webhook not found' })
    }

    // Never re-serialize the HMAC signing secret — see GET / above.
    const { secret: _secret, headers: rowHeaders, ...safeData } = data as any
    return reply.send({ data: { ...safeData, headers: redactHeaders(rowHeaders) } })
  })

  // ── DELETE /system/webhooks/:id ───────────────────────────────────────────
  fastify.delete('/system/webhooks/:id', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    const { data, error } = await fastify.supabase
      .from('webhooks')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id')
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Webhook not found' })
    }

    return reply.send({ message: 'Webhook deactivated', id })
  })

  // ── POST /system/webhooks/:id/test ────────────────────────────────────────
  fastify.post('/system/webhooks/:id/test', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { id } = req.params as { id: string }

    // Fetch the webhook
    const { data: webhook, error: webhookError } = await fastify.supabase
      .from('webhooks')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (webhookError || !webhook) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Webhook not found' })
    }

    // Validate the URL before attempting delivery — this previously checked
    // only that the URL parses and uses http/https, not that it points
    // somewhere safe to fetch. A webhook stored before the SSRF guard existed
    // (or one that slips past create/update validation some other way) could
    // otherwise have the server fetch cloud metadata or an internal service
    // on every test click.
    const ssrfBlockReason = ssrfCheck(webhook.url)
    if (ssrfBlockReason) {
      return reply.code(422).send({ error: 'INVALID_URL', message: ssrfBlockReason })
    }

    const testPayload = {
      event:      'webhook.test',
      webhook_id: webhook.id,
      tenant_id:  req.tenantId,
      timestamp:  new Date().toISOString(),
      data:       { message: 'This is a test delivery from the HRMS webhook system.' },
    }

    const requestBody = JSON.stringify(testPayload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'HRMS-Webhook/1.0',
      'X-Event-Type': 'webhook.test',
      ...((webhook.headers as Record<string, string>) ?? {}),
    }

    // Sign with HMAC-SHA256 like production delivery (webhook-service.ts) —
    // this previously forwarded the raw long-lived signing secret in plain
    // text to the externally-registered URL on every test click, and wasn't
    // representative of what a correctly-implemented receiver checks
    // (X-HRMS-Signature, never a raw secret header).
    if (webhook.secret) {
      const sig = createHmac('sha256', webhook.secret).update(requestBody).digest('hex')
      headers['X-HRMS-Signature'] = `sha256=${sig}`
    }

    // Create delivery row with status 'pending'
    const { data: delivery, error: insertError } = await fastify.supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id:     webhook.id,
        tenant_id:      req.tenantId,
        event_type:     'webhook.test',
        payload:        testPayload,
        status:         'pending',
        attempt_number: 1,
        created_at:     new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError || !delivery) {
      req.log.error({ err: insertError }, 'failed to create test delivery row')
      return reply.code(500).send({ error: 'INSERT_FAILED', message: 'Failed to record test delivery' })
    }

    // Attempt HTTP POST
    const startedAt   = Date.now()
    let httpStatus    = 0
    let success       = false
    let errorMessage: string | undefined

    try {
      const timeout     = (webhook.timeout_seconds ?? 30) * 1_000
      const controller  = new AbortController()
      const timer       = setTimeout(() => controller.abort(), timeout)

      // redirect: 'manual' — see webhook-service.ts's _attemptHttpDelivery
      // for why redirects must not be followed (SSRF via a 3xx pointing at
      // a private/metadata host).
      const response = await fetch(webhook.url, {
        method:  'POST',
        headers,
        body:    requestBody,
        signal:  controller.signal,
        redirect: 'manual',
      }).finally(() => clearTimeout(timer))

      httpStatus = response.status
      success    = response.ok
      if (!response.ok) {
        errorMessage = (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400))
          ? 'Destination returned a redirect — redirects are not followed for security reasons'
          : `HTTP ${response.status} ${response.statusText}`
      }
    } catch (err: any) {
      errorMessage = err?.name === 'AbortError'
        ? `Request timed out after ${webhook.timeout_seconds ?? 30}s`
        : (err?.message ?? 'Unknown fetch error')
    }

    const duration_ms = Date.now() - startedAt

    // Update delivery row
    await fastify.supabase
      .from('webhook_deliveries')
      .update({
        status:         success ? 'delivered' : 'failed',
        http_status:    httpStatus || null,
        duration_ms,
        last_error:     errorMessage ?? null,
        attempt_number: 1,
        delivered_at:   success ? new Date().toISOString() : null,
      })
      .eq('id', delivery.id)

    return reply.send({
      success,
      http_status:  httpStatus || null,
      duration_ms,
      delivery_id:  delivery.id,
      ...(errorMessage ? { error: errorMessage } : {}),
    })
  })

  // ── GET /system/webhooks/:id/deliveries ───────────────────────────────────
  fastify.get('/system/webhooks/:id/deliveries', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }
    const { id } = req.params as { id: string }

    const parsed = deliveriesQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { status, limit, offset } = parsed.data

    // Confirm webhook belongs to tenant
    const { data: webhook } = await fastify.supabase
      .from('webhooks')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (!webhook) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Webhook not found' })
    }

    let q = fastify.supabase
      .from('webhook_deliveries')
      .select('*', { count: 'exact' })
      .eq('webhook_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      q = q.eq('status', status)
    }

    const { data, error, count } = await q

    if (error) {
      req.log.error({ err: error }, 'webhook deliveries query failed')
      return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch deliveries' })
    }

    return reply.send({ data: data ?? [], total: count ?? 0, limit, offset })
  })

  // ── POST /system/webhooks/deliveries/:deliveryId/retry ────────────────────
  fastify.post('/system/webhooks/deliveries/:deliveryId/retry', auth, async (req: any, reply) => {
    if (!isAdmin(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Admin access required' })
    }

    const { deliveryId } = req.params as { deliveryId: string }

    // Confirm delivery belongs to a webhook in this tenant
    const { data: delivery, error: fetchError } = await fastify.supabase
      .from('webhook_deliveries')
      .select('id, webhook_id, status, webhooks!inner(tenant_id)')
      .eq('id', deliveryId)
      .single()

    if (fetchError || !delivery) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Delivery not found' })
    }

    const webhookTenantId = (delivery as any).webhooks?.tenant_id
    if (webhookTenantId !== req.tenantId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Delivery not found' })
    }

    // Actually re-attempt the HTTP delivery. This previously just flipped the
    // row's status to 'retrying' with no scheduler/poller anywhere in the
    // codebase ever reading it back out — the API reported "scheduled for
    // retry" while the event was never redelivered, silently doing nothing.
    const webhookService = new WebhookService(fastify.supabase)
    const result = await webhookService.retryDelivery(deliveryId, req.tenantId)

    if (!result.success) {
      return reply.code(502).send({
        error:       'RETRY_FAILED',
        message:     result.error ?? 'Retry attempt failed',
        http_status: result.http_status,
        delivery_id: deliveryId,
      })
    }

    return reply.send({ message: 'Delivery retried successfully', delivery_id: deliveryId, http_status: result.http_status })
  })
}
