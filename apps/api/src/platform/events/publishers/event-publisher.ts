/**
 * EventPublisher — centralized non-blocking event publisher.
 *
 * CRITICAL RULE: publish() is ALWAYS fire-and-forget.
 * It NEVER blocks or throws. Core operations MUST succeed first.
 *
 * Correct pattern:
 *   await coreService.doOperation(data)         // core op first
 *   publisher.publish({ event_type: ..., ... }) // then publish, no await
 *
 * Wrong pattern:
 *   await publisher.publish(...)                // NEVER await the publish
 *   await coreService.doOperation(data)         // NEVER put core op after
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID }          from 'crypto'
import type { PlatformEvent, ResolvedPlatformEvent } from '../types/platform-event.js'

export class EventPublisher {
  private readonly supabase: SupabaseClient

  // Circuit breaker state
  private consecutiveFailures = 0
  private readonly MAX_FAILURES = 5
  private circuitOpen = false
  private lastCircuitWarnAt = 0

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  /** Build the insert payload for a resolved event. */
  private buildInsertPayload(event: ResolvedPlatformEvent): Record<string, unknown> {
    return {
      event_id:           event.event_id,
      event_type:         event.event_type,
      module:             event.module,
      entity_type:        event.entity_type,
      entity_id:          event.entity_id,
      org_id:             event.org_id,
      branch_id:          event.branch_id          ?? null,
      actor_id:           event.actor_id           ?? null,
      actor_type:         event.actor_type         ?? 'user',
      severity:           event.severity           ?? 'info',
      payload:            event.payload,
      correlation_id:     event.correlation_id     ?? null,
      parent_event_id:    event.parent_event_id    ?? null,
      governance_context: event.governance_context ?? null,
      metadata:           event.metadata           ?? null,
      timestamp:          event.timestamp,
    }
  }

  /** Attempt a single insert. Resolves true on success, false on failure. */
  private async attemptInsert(payload: Record<string, unknown>): Promise<boolean> {
    const { error } = await Promise.resolve(
      this.supabase.from('platform_events').insert(payload),
    )
    return !error
  }

  /** Persist with retry-once and circuit breaker. */
  private async persistWithResilience(event: ResolvedPlatformEvent): Promise<void> {
    // Circuit breaker: skip if open
    if (this.circuitOpen) {
      const now = Date.now()
      if (now - this.lastCircuitWarnAt > 60_000) {
        this.lastCircuitWarnAt = now
        console.warn('[EventPublisher] circuit open — skipping persist', {
          event_type: event.event_type,
        })
      }
      return
    }

    const payload = this.buildInsertPayload(event)

    // First attempt
    let success = await this.attemptInsert(payload)

    // Retry once on failure
    if (!success) {
      await new Promise<void>((resolve) => setTimeout(resolve, 150))
      success = await this.attemptInsert(payload)
    }

    if (success) {
      // Reset on success
      this.consecutiveFailures = 0
    } else {
      this.consecutiveFailures += 1
      console.warn('[EventPublisher] persist failed after retry', {
        event_type:           event.event_type,
        entity_id:            event.entity_id,
        consecutive_failures: this.consecutiveFailures,
      })

      if (this.consecutiveFailures >= this.MAX_FAILURES) {
        this.circuitOpen = true
        this.lastCircuitWarnAt = Date.now()
        console.warn('[EventPublisher] circuit opened — too many consecutive failures', {
          consecutive_failures: this.consecutiveFailures,
        })
        // Auto-reset after 60 seconds
        setTimeout(() => {
          this.circuitOpen = false
          this.consecutiveFailures = 0
          console.warn('[EventPublisher] circuit reset — resuming persist attempts')
        }, 60_000)
      }
    }
  }

  /**
   * Fire-and-forget publish. Returns void immediately.
   * Persistence is async — failures are logged but never propagated.
   */
  publish(input: Omit<PlatformEvent, 'event_id' | 'timestamp'> & { event_id?: string; timestamp?: string }): void {
    const event: ResolvedPlatformEvent = {
      ...input,
      event_id:  input.event_id  ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
    }

    // Persist asynchronously — no await, no blocking the caller
    this.persistWithResilience(event).catch((err: unknown) => {
      console.warn('[EventPublisher] uncaught error in persistWithResilience', {
        event_type: event.event_type,
        error:      err,
      })
    })
  }

  /**
   * Publish a batch of related events.
   * Each event is published independently — one failure does not affect others.
   */
  publishBatch(events: Array<Parameters<EventPublisher['publish']>[0]>): void {
    for (const event of events) {
      this.publish(event)
    }
  }
}
