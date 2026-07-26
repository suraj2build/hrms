/**
 * WebhookService — delivers tenant events to registered external webhooks.
 *
 * Design principles:
 *  - Fire-and-forget: dispatchEvent() schedules HTTP delivery as a background
 *    Promise chain; errors are caught, logged, and never thrown to the caller.
 *  - Delivery tracking: every outbound attempt creates / updates a
 *    webhook_deliveries row so operators have a full audit trail.
 *  - HMAC signing: if a webhook has a secret, the body is signed with
 *    HMAC-SHA256 and delivered in the X-HRMS-Signature header so the
 *    receiving endpoint can verify authenticity.
 *  - Timeout: AbortController is wired to webhook.timeout_seconds so slow
 *    endpoints do not hang the process.
 *  - Retry metadata: on failure the delivery row gets next_retry_at computed
 *    from webhook.retry_delay_seconds so a separate job can pick it up.
 */

import { createHmac }    from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ssrfCheck } from './ssrf-guard.js'

// ── Internal types ─────────────────────────────────────────────────────────────

interface WebhookRow {
  id:              string
  url:             string
  secret:          string | null
  headers:         Record<string, string> | null
  timeout_seconds: number
  retry_delay_seconds: number
  event_types:     string[]
}

interface DeliveryRow {
  id:         string
  webhook_id: string
  tenant_id:  string
  webhooks:   WebhookRow
}

// ── WebhookService ─────────────────────────────────────────────────────────────

export class WebhookService {
  private readonly supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  // ── Public: dispatchEvent ──────────────────────────────────────────────────

  /**
   * Fan-out an event to all active webhooks registered for this tenant and
   * event type.  Each delivery runs independently; a failure in one webhook
   * does not prevent others from receiving the event.
   *
   * This method is non-blocking: the HTTP work is queued as a microtask chain
   * and any unhandled rejection is silently swallowed after logging.
   */
  async dispatchEvent(
    tenantId:      string,
    eventType:     string,
    payload:       Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    // 1. Find webhooks that want this event type
    const { data: webhooks, error: fetchErr } = await this.supabase
      .from('webhooks')
      .select('id, url, secret, headers, timeout_seconds, retry_delay_seconds, event_types')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .contains('event_types', [eventType])

    if (fetchErr) {
      console.error('[WebhookService] failed to fetch webhooks', { tenantId, eventType, err: fetchErr })
      return
    }

    if (!webhooks || webhooks.length === 0) return

    // 2. Fan-out — fire and forget per webhook
    for (const webhook of webhooks as WebhookRow[]) {
      // Schedule work as a background microtask — never await at call site
      this._deliverToWebhook(tenantId, eventType, payload, webhook, correlationId).catch((err) => {
        console.error('[WebhookService] unhandled delivery error', { webhookId: webhook.id, err })
      })
    }
  }

  // ── Public: retryDelivery ──────────────────────────────────────────────────

  /**
   * Re-attempt a previously failed delivery.  Returns a structured result so
   * callers can surface the outcome to operators without throwing.
   */
  async retryDelivery(
    deliveryId: string,
    tenantId:   string,
  ): Promise<{ success: boolean; http_status?: number; error?: string }> {
    // Fetch the delivery row joined to its webhook
    const { data: delivery, error: fetchErr } = await this.supabase
      .from('webhook_deliveries')
      .select('id, webhook_id, tenant_id, webhooks(id, url, secret, headers, timeout_seconds, retry_delay_seconds, event_types)')
      .eq('id', deliveryId)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchErr || !delivery) {
      return { success: false, error: fetchErr?.message ?? 'Delivery not found' }
    }

    const d = delivery as unknown as DeliveryRow
    const webhook = d.webhooks

    if (!webhook) {
      return { success: false, error: 'Associated webhook not found' }
    }

    // Fetch the original request body from the delivery row
    const { data: deliveryDetail, error: detailErr } = await this.supabase
      .from('webhook_deliveries')
      .select('request_body:payload, event_type')
      .eq('id', deliveryId)
      .single()

    if (detailErr || !deliveryDetail) {
      return { success: false, error: 'Could not fetch delivery request body' }
    }

    const requestBody = (deliveryDetail.request_body as Record<string, unknown>) ?? {}
    const eventType   = (deliveryDetail.event_type as string) ?? ''

    // Attempt delivery
    const result = await this._attemptHttpDelivery(deliveryId, tenantId, webhook, requestBody)

    if (result.success) {
      // Update delivery row as delivered
      await this.supabase
        .from('webhook_deliveries')
        .update({
          status:       'delivered',
          http_status:  result.http_status,
          duration_ms:  result.duration_ms,
          delivered_at: new Date().toISOString(),
          last_error:   null,
        })
        .eq('id', deliveryId)

      // Update webhook aggregate counters — shared with _deliverToWebhook's
      // success branch so a manual retry's stats stay consistent with a
      // fresh delivery's.
      await this._updateWebhookStats(webhook.id, tenantId, true)

      return { success: true, http_status: result.http_status }
    } else {
      // Update delivery row as failed
      const nextRetry = new Date(Date.now() + (webhook.retry_delay_seconds ?? 300) * 1000).toISOString()
      await this.supabase
        .from('webhook_deliveries')
        .update({
          status:        'failed',
          http_status:   result.http_status ?? null,
          duration_ms:   result.duration_ms,
          last_error:    result.error,
          next_retry_at: nextRetry,
        })
        .eq('id', deliveryId)

      // Update webhook aggregate counters — previously only _deliverToWebhook's
      // failure branch did this, so a webhook that only ever failed via manual
      // retry never accumulated failed_deliveries/last_failure_at and could
      // look healthy in the registry despite every retry failing.
      await this._updateWebhookStats(webhook.id, tenantId, false)

      return { success: false, http_status: result.http_status, error: result.error }
    }
  }

  // ── Private: update webhook aggregate delivery counters ────────────────────
  // Shared by _deliverToWebhook and retryDelivery so both code paths keep the
  // registry's total/successful/failed counters and last_success_at/
  // last_failure_at consistent. Select-then-update (not an atomic increment)
  // — under concurrent deliveries to the same webhook this can lose an
  // update, but these are advisory health stats, not billing/accounting data.
  private async _updateWebhookStats(webhookId: string, tenantId: string, success: boolean): Promise<void> {
    const { data: wh } = await this.supabase
      .from('webhooks')
      .select('total_deliveries, successful_deliveries, failed_deliveries')
      .eq('id', webhookId)
      .eq('tenant_id', tenantId)
      .single()

    const totalDeliveries = ((wh?.total_deliveries as number) ?? 0) + 1

    await this.supabase
      .from('webhooks')
      .update(
        success
          ? {
              last_success_at:       new Date().toISOString(),
              total_deliveries:      totalDeliveries,
              successful_deliveries: ((wh?.successful_deliveries as number) ?? 0) + 1,
            }
          : {
              last_failure_at:   new Date().toISOString(),
              total_deliveries:  totalDeliveries,
              failed_deliveries: ((wh?.failed_deliveries as number) ?? 0) + 1,
            },
      )
      .eq('id', webhookId)
      .eq('tenant_id', tenantId)
  }

  // ── Private: orchestrate one webhook delivery ──────────────────────────────

  private async _deliverToWebhook(
    tenantId:      string,
    eventType:     string,
    payload:       Record<string, unknown>,
    webhook:       WebhookRow,
    correlationId?: string,
  ): Promise<void> {
    // Build the canonical request body
    const deliveryId = crypto.randomUUID()
    const timestamp  = new Date().toISOString()

    const body: Record<string, unknown> = {
      event_type:   eventType,
      tenant_id:    tenantId,
      payload,
      timestamp,
      delivery_id:  deliveryId,
      ...(correlationId ? { correlation_id: correlationId } : {}),
    }

    // 1. Insert a pending delivery row
    const { error: insertErr } = await this.supabase
      .from('webhook_deliveries')
      .insert({
        id:           deliveryId,
        webhook_id:   webhook.id,
        tenant_id:    tenantId,
        event_type:   eventType,
        status:       'pending',
        payload:      body,
        created_at:   timestamp,
      })

    if (insertErr) {
      console.error('[WebhookService] failed to create delivery row', { webhookId: webhook.id, err: insertErr })
      // Carry on — we still attempt delivery even if tracking row failed
    }

    // 2. Attempt HTTP delivery
    const result = await this._attemptHttpDelivery(deliveryId, tenantId, webhook, body)

    if (result.success) {
      // 3a. Mark delivered
      await this.supabase
        .from('webhook_deliveries')
        .update({
          status:       'delivered',
          http_status:  result.http_status,
          duration_ms:  result.duration_ms,
          delivered_at: new Date().toISOString(),
          last_error:   null,
        })
        .eq('id', deliveryId)

      await this._updateWebhookStats(webhook.id, tenantId, true)
    } else {
      // 3b. Mark failed
      const retryDelaySec = webhook.retry_delay_seconds ?? 300
      const nextRetry     = new Date(Date.now() + retryDelaySec * 1000).toISOString()

      await this.supabase
        .from('webhook_deliveries')
        .update({
          status:        'failed',
          http_status:   result.http_status ?? null,
          duration_ms:   result.duration_ms,
          last_error:    result.error,
          next_retry_at: nextRetry,
        })
        .eq('id', deliveryId)

      await this._updateWebhookStats(webhook.id, tenantId, false)
    }
  }

  // ── Private: raw HTTP attempt ──────────────────────────────────────────────

  private async _attemptHttpDelivery(
    deliveryId: string,
    tenantId:   string,
    webhook:    WebhookRow,
    body:       Record<string, unknown>,
  ): Promise<{ success: boolean; http_status?: number; duration_ms: number; error?: string }> {
    // SSRF guard — webhook.url is an admin-registered destination the server
    // fetches on every business event with no further action needed once
    // registered. Re-checked here (not just at create/update time) so a URL
    // that resolved to a public host when the guard was added elsewhere in
    // the codebase, or was stored before this check existed, still can't
    // reach cloud metadata / internal services from this delivery path.
    const blockReason = ssrfCheck(webhook.url)
    if (blockReason) {
      console.error('[WebhookService] blocked delivery to disallowed URL', {
        webhookId: webhook.id, deliveryId, tenantId, url: webhook.url, reason: blockReason,
      })
      return { success: false, duration_ms: 0, error: `Blocked: ${blockReason}` }
    }

    const bodyStr       = JSON.stringify(body)
    const timeoutMs     = (webhook.timeout_seconds ?? 30) * 1000
    const controller    = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'HRMS-Webhook/1.0',
      'X-HRMS-Delivery': deliveryId,
      ...(webhook.headers ?? {}),
    }

    // HMAC-SHA256 signature
    if (webhook.secret) {
      const sig = createHmac('sha256', webhook.secret).update(bodyStr).digest('hex')
      headers['X-HRMS-Signature'] = `sha256=${sig}`
    }

    const startAt = Date.now()

    try {
      // redirect: 'manual' — don't follow redirects. ssrfCheck() above only
      // inspects the literal registered URL; a destination that responds
      // with a 3xx to a private/metadata host (e.g. 169.254.169.254) would
      // otherwise have that redirect silently followed on every delivery,
      // bypassing the SSRF guard entirely. Same pattern already used for
      // the integration health-check probe.
      const response = await fetch(webhook.url, {
        method:  'POST',
        headers,
        body:    bodyStr,
        signal:  controller.signal,
        redirect: 'manual',
      })

      const duration_ms = Date.now() - startAt
      clearTimeout(timeoutHandle)

      if (response.ok) {
        return { success: true, http_status: response.status, duration_ms }
      }

      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        return {
          success:     false,
          http_status: response.status,
          duration_ms,
          error:       'Destination returned a redirect — redirects are not followed for security reasons',
        }
      }

      return {
        success:     false,
        http_status: response.status,
        duration_ms,
        error:       `HTTP ${response.status} ${response.statusText}`,
      }
    } catch (err: unknown) {
      const duration_ms = Date.now() - startAt
      clearTimeout(timeoutHandle)

      const isAbort = err instanceof Error && err.name === 'AbortError'
      const message = isAbort
        ? `Request timed out after ${webhook.timeout_seconds}s`
        : (err instanceof Error ? err.message : String(err))

      console.error('[WebhookService] HTTP delivery failed', {
        webhookId:  webhook.id,
        deliveryId,
        tenantId,
        url:        webhook.url,
        err:        message,
      })

      return { success: false, duration_ms, error: message }
    }
  }
}
