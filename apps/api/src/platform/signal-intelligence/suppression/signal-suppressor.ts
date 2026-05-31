import type { PlatformSignal } from '../types/signal-types.js'

const TTL_MS: Record<string, number> = {
  critical: 60 * 1000,
  high:     120 * 1000,
  warning:  300 * 1000,
  info:     600 * 1000,
}

export class SignalSuppressor {
  private seen: Map<string, number> = new Map()

  private key(signal: PlatformSignal): string {
    return `${signal.org_id}:${signal.source}:${signal.entity_id}:${signal.event_type}:${signal.severity}`
  }

  shouldSuppress(signal: PlatformSignal): { suppress: boolean; reason?: string } {
    const k         = this.key(signal)
    const lastSeen  = this.seen.get(k)
    if (lastSeen === undefined) return { suppress: false }

    const ttl = TTL_MS[signal.severity] ?? TTL_MS.info
    if (Date.now() - lastSeen < ttl) {
      return {
        suppress: true,
        reason:   `Duplicate of recent ${signal.severity} signal within TTL window (${ttl / 1000}s)`,
      }
    }
    return { suppress: false }
  }

  record(signal: PlatformSignal): void {
    this.seen.set(this.key(signal), Date.now())
  }

  clearExpired(): void {
    const now = Date.now()
    for (const [k, ts] of this.seen.entries()) {
      // Use the highest possible TTL to be safe when clearing
      if (now - ts > TTL_MS.info) {
        this.seen.delete(k)
      }
    }
  }
}

export const signalSuppressor = new SignalSuppressor()
