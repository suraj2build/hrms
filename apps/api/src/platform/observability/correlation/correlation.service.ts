/**
 * CorrelationService — enterprise traceability service.
 *
 * Enables linking related events into causal chains:
 *   compensation.revision.created
 *     → approval.pending
 *     → compensation.revision.approved
 *     → payroll.recalculation.triggered
 *
 * All linked by the same correlation_id.
 */

import { randomUUID } from 'crypto'

export class CorrelationService {
  /**
   * Generate a new root correlation ID for a fresh operation chain.
   */
  generate(): string {
    return randomUUID()
  }

  /**
   * Propagate an existing correlation ID through child events.
   * Returns the same ID — chain is maintained by reusing it.
   */
  chain(parentCorrelationId: string): string {
    return parentCorrelationId
  }

  /**
   * Extract correlation ID from an HTTP request header.
   * Returns null if not present.
   */
  fromHeader(headers: Record<string, string | string[] | undefined>): string | null {
    const raw = headers['x-correlation-id']
    if (!raw) return null
    return Array.isArray(raw) ? (raw[0] ?? null) : raw
  }
}

/** Singleton instance */
export const correlationService = new CorrelationService()
