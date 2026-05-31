/**
 * GovernanceListener — abstract base for passive governance evaluators.
 *
 * SPRINT 1 RULES:
 *   MAY:  classify, evaluate, score, alert, create incidents, generate explainability
 *   MUST NOT: block payroll, reject approvals, mutate records, change configurations
 *
 * All listeners are passive observers only.
 */

import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'

export abstract class GovernanceListener {
  /** Event types this listener handles. Use ['*'] for all events. */
  abstract readonly handles: string[]

  /** Human-readable name for logging */
  abstract readonly name: string

  /**
   * Evaluate the event. Must never throw — errors must be caught internally.
   * Must never block or mutate core operational data.
   */
  abstract evaluate(event: ResolvedPlatformEvent): Promise<void>
}
