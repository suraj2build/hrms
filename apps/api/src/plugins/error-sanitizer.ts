import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

/**
 * Global response sanitizer — strips raw database / internal error messages from
 * 5xx responses before they reach the client.
 *
 * Registered once at startup; intercepts every response via onSend lifecycle hook.
 * The original message is preserved in structured server-side logs (with requestId,
 * correlationId, tenantId) so operators retain full diagnostic context.
 *
 * Covers two patterns across ~745 route handlers:
 *   Pattern A — { error: 'CODE', message: rawDbError }  → message replaced
 *   Pattern B — { error: rawDbError }                   → error replaced with 'INTERNAL_ERROR'
 *               (detected by presence of a space in the string — error codes never have spaces)
 *
 * Non-5xx responses and non-JSON content types are always passed through unchanged.
 */
const errorSanitizerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 500) return payload
    if (typeof payload !== 'string') return payload

    const contentType = reply.getHeader('content-type')
    if (typeof contentType === 'string' && !contentType.includes('application/json')) {
      return payload
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return payload
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return payload
    }

    const obj    = parsed as Record<string, unknown>
    const reqAny = request as any
    let dirty    = false

    const logCtx = {
      requestId:     request.id,
      correlationId: reqAny.correlationId ?? null,
      tenantId:      reqAny.tenantId      ?? null,
      statusCode:    reply.statusCode,
      url:           request.url,
    }

    // Pattern A: { error: 'CODE', message: rawDbError }
    if (typeof obj.message === 'string') {
      fastify.log.error({ ...logCtx, original_message: obj.message }, 'error-sanitizer: stripped message field')
      obj.message = 'An internal error occurred'
      dirty = true
    }

    // Pattern B: { error: rawDbError } — raw message in `error` field, no separate `message` key
    // Error codes never contain spaces ('DB_ERROR', 'QUERY_FAILED'…); raw DB messages always do.
    if (typeof obj.error === 'string' && !obj.message && obj.error.includes(' ')) {
      fastify.log.error({ ...logCtx, original_error: obj.error }, 'error-sanitizer: stripped error field')
      obj.error = 'INTERNAL_ERROR'
      dirty = true
    }

    // Pattern C: { stack: '...' } — server-side stack trace must never reach clients.
    if (typeof obj.stack === 'string') {
      fastify.log.error({ ...logCtx, original_stack: obj.stack }, 'error-sanitizer: stripped stack field')
      delete obj.stack
      dirty = true
    }

    // Baseline: every 5xx emits a structured log entry so correlation/request IDs
    // are always captured even when no sanitization was needed (e.g. safe static messages).
    if (!dirty) {
      fastify.log.warn({ ...logCtx, error_code: typeof obj.error === 'string' ? obj.error : null }, '5xx response')
    }

    return dirty ? JSON.stringify(obj) : payload
  })
}

export default fp(errorSanitizerPlugin, { name: 'error-sanitizer' })
