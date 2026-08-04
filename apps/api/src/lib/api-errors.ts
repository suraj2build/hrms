/**
 * api-errors.ts — Shared error response framework.
 *
 * Every route handler uses these helpers instead of writing
 * reply.code(N).send({ error, message }) manually.
 *
 * Rules:
 *   · 5xx paths  → serverError(req, reply, err, code, message)
 *                  Logs the exception exactly once with full request context.
 *                  Never forwards the original error text or stack to clients.
 *   · 4xx paths  → notFound / forbidden / unauthorized / validationError / conflictError
 *                  No exception parameter — these are expected outcomes, not bugs.
 *                  Do not log these (they are client errors, not server faults).
 *
 * All helpers return the same flat shape: { error: string, message: string }
 * which matches the pattern enforced by the error-sanitizer plugin.
 *
 * Adding new error codes:
 *   Add to the ErrorCode const below. Domain-specific codes belong in their
 *   domain section. Keep codes SCREAMING_SNAKE_CASE with no spaces.
 */

// ── Error code registry ──────────────────────────────────────────────────────

export const ErrorCode = {
  // ── Generic ────────────────────────────────────────────────────────────────
  INTERNAL_ERROR:   'INTERNAL_ERROR',
  QUERY_FAILED:     'QUERY_FAILED',
  INSERT_FAILED:    'INSERT_FAILED',
  UPDATE_FAILED:    'UPDATE_FAILED',
  DELETE_FAILED:    'DELETE_FAILED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND:        'NOT_FOUND',
  FORBIDDEN:        'FORBIDDEN',
  UNAUTHORIZED:     'UNAUTHORIZED',
  CONFLICT:         'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  RATE_LIMIT:       'RATE_LIMIT',
  PROFILE_NOT_LINKED: 'PROFILE_NOT_LINKED',
  NO_TENANT:          'NO_TENANT',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',

  // ── Payroll ────────────────────────────────────────────────────────────────
  PAYROLL_RUN_FAILED:       'PAYROLL_RUN_FAILED',
  PAYROLL_READINESS_FAILED: 'PAYROLL_READINESS_FAILED',
  PAYROLL_FINALIZE_FAILED:  'PAYROLL_FINALIZE_FAILED',
  ENQUEUE_FAILED:           'ENQUEUE_FAILED',

  // ── Leave ──────────────────────────────────────────────────────────────────
  LEAVE_APPLY_FAILED:    'LEAVE_APPLY_FAILED',
  BALANCE_DEDUCT_FAILED: 'BALANCE_DEDUCT_FAILED',
  COMPUTE_FAILED:        'COMPUTE_FAILED',
  OPENING_BALANCE_FAILED: 'OPENING_BALANCE_FAILED',
  LOOKUP_FAILED:          'LOOKUP_FAILED',

  // ── Attendance ─────────────────────────────────────────────────────────────
  ATTENDANCE_SYNC_FAILED: 'ATTENDANCE_SYNC_FAILED',
} as const

export type ApiErrorCode = typeof ErrorCode[keyof typeof ErrorCode]

// ── Standard error response shape ────────────────────────────────────────────

export interface ApiErrorResponse {
  error:      string
  message:    string
  /** Fastify request ID — present on 5xx responses so callers can report it to support. */
  requestId?: string | null
}

// ── Correlation context (extracted automatically from every request) ──────────

function reqCtx(req: any) {
  return {
    requestId:     req.id                              ?? null,
    correlationId: req.correlationId                   ?? null,
    tenantId:      req.tenantId                        ?? null,
    userId:        req.userId                          ?? null,
    route:         (req.routeOptions as any)?.url      ?? req.url ?? null,
    method:        req.method                          ?? null,
  }
}

// ── 5xx — server errors ───────────────────────────────────────────────────────

/**
 * serverError — log + respond for unexpected server-side failures.
 *
 * Logs `err` (preserving the stack trace in server-side structured logs)
 * exactly once, with the full request correlation context.  Returns a
 * sanitized { error, message } response — no raw DB messages or stack
 * traces ever reach the HTTP client.
 *
 * Usage:
 *   catch (err: any) {
 *     return serverError(req, reply, err, 'PAYROLL_RUN_FAILED', 'Failed to execute payroll run')
 *   }
 *   if (error) {
 *     return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')
 *   }
 */
export function serverError(
  req:     any,
  reply:   any,
  err:     unknown,
  code:    string = ErrorCode.INTERNAL_ERROR,
  message: string = 'An unexpected error occurred',
): any {
  const ctx = reqCtx(req)
  req.log.error(
    { err, ...ctx, error_code: code },
    `${code}: ${message}`,
  )
  // requestId in the response body lets callers report it to support.
  // Its presence also signals to the error-sanitizer that this response
  // is already safe (message is a hardcoded string, not raw DB content)
  // so the sanitizer's Pattern A will leave the message intact.
  return reply.code(500).send({
    error:     code,
    message,
    requestId: req.id ?? null,
  } satisfies ApiErrorResponse)
}

// ── 4xx — client errors ───────────────────────────────────────────────────────
// No `req` parameter — these are expected code paths, not bugs.
// Do not log 4xx at error level (that inflates error metrics with client noise).

/** 400 Bad Request — failed validation or malformed input */
export function validationError(
  reply:   any,
  code:    string = ErrorCode.VALIDATION_ERROR,
  message: string = 'Validation failed',
): any {
  return reply.code(400).send({ error: code, message } satisfies ApiErrorResponse)
}

/** 401 Unauthorized — missing or invalid authentication */
export function unauthorized(
  reply:   any,
  code:    string = ErrorCode.UNAUTHORIZED,
  message: string = 'Authentication required',
): any {
  return reply.code(401).send({ error: code, message } satisfies ApiErrorResponse)
}

/** 403 Forbidden — authenticated but insufficient permission */
export function forbidden(
  reply:   any,
  code:    string = ErrorCode.FORBIDDEN,
  message: string = 'Access denied',
): any {
  return reply.code(403).send({ error: code, message } satisfies ApiErrorResponse)
}

/** 404 Not Found — resource does not exist or was not found for this tenant */
export function notFound(
  reply:   any,
  code:    string = ErrorCode.NOT_FOUND,
  message: string = 'Resource not found',
): any {
  return reply.code(404).send({ error: code, message } satisfies ApiErrorResponse)
}

/** 409 Conflict — business rule violation, duplicate, or state mismatch */
export function conflictError(
  reply:   any,
  code:    string = ErrorCode.CONFLICT,
  message: string = 'Resource conflict',
): any {
  return reply.code(409).send({ error: code, message } satisfies ApiErrorResponse)
}
