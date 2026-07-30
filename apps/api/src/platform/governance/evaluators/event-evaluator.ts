/**
 * GovernanceEvaluator — dispatches platform events to registered governance listeners.
 *
 * Passive only. Runs listeners asynchronously after events are published.
 * A listener failure NEVER affects operational flow.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import type { GovernanceListener }    from '../listeners/governance-listener.js'

const ERROR_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export class GovernanceEvaluator {
  private readonly listeners: GovernanceListener[] = []
  // Keyed `${tenant_id}:${listener.name}` — this evaluator is a single
  // process-global singleton shared by every tenant (see apps/api/src/
  // index.ts), so unkeyed state let one tenant's noisy/malformed events
  // (e.g. 5 events that throw inside one listener) disable that listener
  // for every other tenant until an admin manually reset it.
  //
  // Sliding window, not a lifetime counter — the same fix already applied to
  // drift-detection.service.ts's spike counter for the same reason: a bare
  // lifetime counter never decays, so 5 unrelated errors spread over months
  // would permanently disable a listener after the 5th, with no way to
  // recover short of an admin manually calling resetListener().
  private readonly listenerErrors:  Map<string, number[]> = new Map()
  private readonly listenerEnabled: Map<string, boolean>  = new Map()
  private readonly MAX_LISTENER_ERRORS = 5

  private circuitKey(tenantId: string, listenerName: string): string {
    return `${tenantId}:${listenerName}`
  }

  private bumpErrors(key: string): number {
    const now = Date.now()
    const recent = (this.listenerErrors.get(key) ?? []).filter(t => now - t < ERROR_WINDOW_MS)
    recent.push(now)
    this.listenerErrors.set(key, recent)
    return recent.length
  }

  /** Register a passive governance listener. */
  register(listener: GovernanceListener): this {
    this.listeners.push(listener)
    return this
  }

  /**
   * Evaluate a platform event against all registered listeners.
   * Each listener runs independently and asynchronously.
   * Never blocks or throws to caller.
   */
  evaluate(event: ResolvedPlatformEvent): void {
    for (const listener of this.listeners) {
      if (!listener.handles.includes('*') && !listener.handles.includes(event.event_type)) {
        continue
      }

      const key = this.circuitKey(event.tenant_id, listener.name)

      // Skip disabled listeners (scoped to this tenant only)
      if (this.listenerEnabled.get(key) === false) {
        continue
      }

      Promise.resolve()
        .then(() => listener.evaluate(event))
        .catch((err: unknown) => {
          console.warn('[GovernanceEvaluator] listener error', {
            tenant_id:  event.tenant_id,
            listener:   listener.name,
            event_type: event.event_type,
            error:      err,
          })
          const current = this.bumpErrors(key)
          if (current >= this.MAX_LISTENER_ERRORS) {
            this.listenerEnabled.set(key, false)
            console.warn('[GovernanceEvaluator] listener disabled — too many errors', {
              tenant_id:   event.tenant_id,
              listener:    listener.name,
              error_count: current,
            })
          }
        })
    }
  }

  /** Return registered listener names (for diagnostics). */
  registeredListeners(): string[] {
    return this.listeners.map(l => l.name)
  }

  /** Returns health summary for all registered listeners, scoped to one tenant. */
  listenerHealth(tenantId: string): Array<{ name: string; error_count: number; enabled: boolean }> {
    return this.listeners.map(l => {
      const key = this.circuitKey(tenantId, l.name)
      const now = Date.now()
      const recentErrors = (this.listenerErrors.get(key) ?? []).filter(t => now - t < ERROR_WINDOW_MS)
      return {
        name:        l.name,
        error_count: recentErrors.length,
        enabled:     this.listenerEnabled.get(key) !== false,
      }
    })
  }

  /** Reset error count for a listener within one tenant (admin recovery). */
  resetListener(tenantId: string, name: string): void {
    const key = this.circuitKey(tenantId, name)
    this.listenerErrors.delete(key)
    this.listenerEnabled.delete(key)
  }
}

/** Singleton evaluator — register listeners at startup */
export const governanceEvaluator = new GovernanceEvaluator()
