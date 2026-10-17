/**
 * Webhook Retry Scheduler
 *
 * webhook-service.ts computes next_retry_at on a failed delivery and marks
 * the row 'retrying', but nothing was reading it — SYSCERT_AUDIT_2026-08-02.md
 * High #12: retry delivery was entirely manual (an operator had to open the
 * webhook admin UI and click "retry"), so a transient outage on the
 * receiving end silently stopped delivering events until someone noticed.
 *
 * This scheduler closes that gap: it polls webhook_deliveries rows in status
 * 'retrying' whose next_retry_at has elapsed and re-attempts them via
 * WebhookService.retryDelivery(), the same atomic-claim path the manual
 * "retry" button uses — so a delivery this tick is about to pick up can't
 * double-fire against a concurrent manual retry. Deliveries exhaust each
 * webhook's configured max_retries before landing in 'dead_lettered'.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows }   from './supabase-paginate.js'
import { durableQueue }   from './durable-queue.js'
import { WebhookService } from './webhook-service.js'
import { logger }         from './logger.js'

const TICK_MS   = 60 * 1_000   // 1 minute — webhooks.retry_delay_seconds defaults to 60s
const WARMUP_MS = 30 * 1_000

interface DueDelivery {
  id:        string
  tenant_id: string
}

/**
 * Run one retry-poll tick — fires every TICK_MS. Each due delivery is
 * retried independently; one delivery's exception must not abort the tick
 * for the rest (mirrors sla-scanner.ts's per-item error isolation).
 */
export async function runWebhookRetryTick(supabase: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString()

  let due: DueDelivery[]
  try {
    due = await fetchAllRows<DueDelivery>((from, to) =>
      supabase
        // lint-tenant-ok: deliberate cross-tenant background scan (polls every tenant's due retries on a schedule) — each row's own tenant_id is passed into service.retryDelivery(d.id, d.tenant_id) below, scoping the actual retry correctly
        .from('webhook_deliveries')
        .select('id, tenant_id')
        .eq('status', 'retrying')
        .lte('next_retry_at', nowIso)
        .range(from, to),
    )
  } catch (err) {
    logger.error({ err }, '[webhook-retry-scheduler] failed to fetch due deliveries')
    return
  }

  if (!due.length) return

  const service = new WebhookService(supabase)
  for (const d of due) {
    try {
      const result = await service.retryDelivery(d.id, d.tenant_id)
      if (!result.success) {
        logger.warn(
          { deliveryId: d.id, tenantId: d.tenant_id, error: result.error },
          '[webhook-retry-scheduler] retry attempt failed',
        )
      }
    } catch (err) {
      logger.error({ err, deliveryId: d.id, tenantId: d.tenant_id }, '[webhook-retry-scheduler] delivery error')
    }
  }
}

/**
 * Register the webhook retry scheduler with the given Supabase client.
 * Call once at server startup after the Supabase plugin is registered.
 * Wrapped in safeRegisterModule by the caller — this function must not throw.
 */
export function registerWebhookRetryScheduler(supabase: SupabaseClient): void {
  setTimeout(() => {
    const enqueue = () => {
      const key = `webhook-retry:${new Date().toISOString().slice(0, 16)}`
      durableQueue.enqueue('webhook-retry-scan', {}, { idempotencyKey: key }).catch(
        e => logger.error({ err: e }, '[webhook-retry-scheduler] enqueue error'),
      )
    }
    enqueue()
    setInterval(enqueue, TICK_MS)
    console.log(`🪝 Webhook retry scheduler active — polling every ${TICK_MS / 1000}s`)
  }, WARMUP_MS)
}
