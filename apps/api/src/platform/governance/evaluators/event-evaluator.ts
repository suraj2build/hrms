/**
 * GovernanceEvaluator — dispatches platform events to registered governance listeners.
 *
 * Passive only. Runs listeners asynchronously after events are published.
 * A listener failure NEVER affects operational flow.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import type { GovernanceListener }    from '../listeners/governance-listener.js'

export class GovernanceEvaluator {
  private readonly listeners: GovernanceListener[] = []
  private readonly listenerErrors:  Map<string, number>  = new Map()
  private readonly listenerEnabled: Map<string, boolean> = new Map()
  private readonly MAX_LISTENER_ERRORS = 5

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

      // Skip disabled listeners
      if (this.listenerEnabled.get(listener.name) === false) {
        continue
      }

      Promise.resolve()
        .then(() => listener.evaluate(event))
        .catch((err: unknown) => {
          console.warn('[GovernanceEvaluator] listener error', {
            listener:   listener.name,
            event_type: event.event_type,
            error:      err,
          })
          const current = (this.listenerErrors.get(listener.name) ?? 0) + 1
          this.listenerErrors.set(listener.name, current)
          if (current >= this.MAX_LISTENER_ERRORS) {
            this.listenerEnabled.set(listener.name, false)
            console.warn('[GovernanceEvaluator] listener disabled — too many errors', {
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

  /** Returns health summary for all registered listeners. */
  listenerHealth(): Array<{ name: string; error_count: number; enabled: boolean }> {
    return this.listeners.map(l => ({
      name:        l.name,
      error_count: this.listenerErrors.get(l.name) ?? 0,
      enabled:     this.listenerEnabled.get(l.name) !== false,
    }))
  }

  /** Reset error count for a listener (admin recovery). */
  resetListener(name: string): void {
    this.listenerErrors.delete(name)
    this.listenerEnabled.delete(name)
  }
}

/** Singleton evaluator — register listeners at startup */
export const governanceEvaluator = new GovernanceEvaluator()
