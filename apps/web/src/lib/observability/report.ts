/**
 * In-product error reporting — sends a user-submitted report to the backend
 * (POST /support/error-reports), where the owner panel can triage it. Also
 * forwards to Sentry (if configured) and attaches the Sentry event id.
 */
import { api } from '@/lib/api/client'
import { captureError } from './sentry'

export interface ErrorReport {
  message: string
  stack?: string
  userNote?: string
  severity?: 'error' | 'crash' | 'feedback'
}

export async function reportError(r: ErrorReport): Promise<boolean> {
  const sentryId = captureError(new Error(r.message), { stack: r.stack, userNote: r.userNote })
  try {
    await api.post('/support/error-reports', {
      message: r.message,
      stack: r.stack?.slice(0, 8000),
      url: window.location.href,
      user_note: r.userNote,
      sentry_event_id: sentryId ?? undefined,
      severity: r.severity ?? 'error',
    })
    return true
  } catch {
    return false // never let reporting throw on top of the original error
  }
}
