/**
 * EventSubscriber — passive in-process event subscription layer.
 *
 * Handlers are always non-blocking and never affect operational flow.
 * Designed to be future-ready for Kafka / RabbitMQ / NATS without requiring them now.
 *
 * Use cases:
 *   - Governance listeners
 *   - Observability listeners
 *   - Automation triggers
 *   - AI evaluation pipelines
 */

import type { ResolvedPlatformEvent } from '../types/platform-event.js'

export type EventHandler = (event: ResolvedPlatformEvent) => void | Promise<void>

export class EventSubscriber {
  private readonly handlers = new Map<string, EventHandler[]>()

  /**
   * Register a handler for a specific event type.
   * Use '*' to receive all events.
   */
  on(eventType: string, handler: EventHandler): this {
    const list = this.handlers.get(eventType) ?? []
    list.push(handler)
    this.handlers.set(eventType, list)
    return this
  }

  /**
   * Unregister a specific handler.
   */
  off(eventType: string, handler: EventHandler): this {
    const list = this.handlers.get(eventType) ?? []
    this.handlers.set(eventType, list.filter(h => h !== handler))
    return this
  }

  /**
   * Dispatch an event to all registered handlers.
   * Each handler runs independently — one failure does not affect others.
   * Fire-and-forget: never blocks or throws to caller.
   */
  emit(event: ResolvedPlatformEvent): void {
    const specific  = this.handlers.get(event.event_type) ?? []
    const wildcard  = this.handlers.get('*')              ?? []
    const all       = [...specific, ...wildcard]

    for (const handler of all) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err: unknown) => {
          console.warn('[EventSubscriber] handler error', {
            event_type: event.event_type,
            error:      err,
          })
        })
    }
  }

  /** Return all registered event types (for diagnostics). */
  registeredTypes(): string[] {
    return [...this.handlers.keys()]
  }
}
