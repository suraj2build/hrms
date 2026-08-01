/**
 * EventPublisher — centralized non-blocking event publisher.
 *
 * SCOPE (PEND-75 architecture decision): stays separate from event-bus.ts
 * (the canonical system for webhook fan-out / background automation).
 * platform_events is the event source the governance/compliance-rule
 * engine (GovernanceRuleRegistry, compliance-evaluator.ts) is built
 * around, so this remains the mechanism for events that need to be
 * evaluated against compliance rules. Don't add new call sites here for
 * things eventBus already covers (webhooks, standard automation).
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

interface CircuitState {
  consecutiveFailures: number
  circuitOpen:         boolean
  lastCircuitWarnAt:   number
}

export class EventPublisher {
  private readonly supabase: SupabaseClient

  // Circuit breaker state — keyed per tenant. This instance is a single
  // process-global singleton shared by every tenant's requests (see
  // plugins/event-publisher.ts), so unkeyed state would let one tenant's
  // insert failures (e.g. a malformed entity_id) silently black out event
  // persistence for every other tenant for the 60s cooldown window.
  private readonly circuits = new Map<string, CircuitState>()
  private readonly MAX_FAILURES = 5

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  private getCircuit(tenantId: string): CircuitState {
    let state = this.circuits.get(tenantId)
    if (!state) {
      state = { consecutiveFailures: 0, circuitOpen: false, lastCircuitWarnAt: 0 }
      this.circuits.set(tenantId, state)
    }
    return state
  }

  /** Build the insert payload for a resolved event. */
  private buildInsertPayload(event: ResolvedPlatformEvent): Record<string, unknown> {
    return {
      event_id:           event.event_id,
      event_type:         event.event_type,
      module:             event.module,
      entity_type:        event.entity_type,
      entity_id:          event.entity_id,
      tenant_id:             event.tenant_id,
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
    const circuit = this.getCircuit(event.tenant_id)

    // Circuit breaker: skip if open (scoped to this tenant only)
    if (circuit.circuitOpen) {
      const now = Date.now()
      if (now - circuit.lastCircuitWarnAt > 60_000) {
        circuit.lastCircuitWarnAt = now
        console.warn('[EventPublisher] circuit open — skipping persist', {
          tenant_id:  event.tenant_id,
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
      circuit.consecutiveFailures = 0
    } else {
      circuit.consecutiveFailures += 1
      console.warn('[EventPublisher] persist failed after retry', {
        tenant_id:            event.tenant_id,
        event_type:           event.event_type,
        entity_id:            event.entity_id,
        consecutive_failures: circuit.consecutiveFailures,
      })

      if (circuit.consecutiveFailures >= this.MAX_FAILURES) {
        circuit.circuitOpen = true
        circuit.lastCircuitWarnAt = Date.now()
        console.warn('[EventPublisher] circuit opened — too many consecutive failures', {
          tenant_id:            event.tenant_id,
          consecutive_failures: circuit.consecutiveFailures,
        })
        // Auto-reset after 60 seconds
        setTimeout(() => {
          circuit.circuitOpen = false
          circuit.consecutiveFailures = 0
          console.warn('[EventPublisher] circuit reset — resuming persist attempts', {
            tenant_id: event.tenant_id,
          })
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
