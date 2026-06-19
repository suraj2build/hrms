/**
 * Front-end error tracking (Sentry) — DSN-gated.
 *
 * Initialises only when VITE_SENTRY_DSN is set, so the app runs as a complete
 * no-op in dev / when observability isn't configured. `captureError` is a safe
 * wrapper used by the global error seams (main.tsx, the React Query cache) so
 * those call sites don't need to know whether Sentry is active.
 */
import * as Sentry from '@sentry/react'

let enabled = false

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return // not configured → no-op

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Conservative defaults; tune sampling once volume is known.
    tracesSampleRate: 0.1,
    // Don't capture noisy expected errors (aborted requests, etc.).
    ignoreErrors: ['AbortError', 'Non-Error promise rejection captured'],
  })
  enabled = true
}

/**
 * Report an error to Sentry if configured; otherwise a no-op.
 * Returns the Sentry event id (for cross-referencing in error reports), or null.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): string | null {
  if (!enabled) return null
  return Sentry.captureException(error, context ? { extra: context } : undefined) ?? null
}
