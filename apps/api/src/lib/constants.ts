/**
 * Shared API-layer constants.
 * Import from here rather than defining locally in each route file.
 */

/**
 * Requests whose total wall-clock time exceeds this threshold are logged at
 * WARN level with `slow_request: true` so they surface immediately in any
 * log-alerting tooling.
 */
export const SLOW_THRESHOLD_MS = 500
