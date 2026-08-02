/**
 * Correlation ID Plugin — adds request tracing to every HTTP request.
 *
 * Reads X-Request-Id / X-Correlation-Id from incoming headers (or generates
 * a new UUID). Attaches the IDs to the request and includes them in every
 * response. Structured log lines include the correlationId field automatically
 * via Fastify's request logger.
 *
 * Usage (register BEFORE routes, AFTER security middleware):
 *   await fastify.register(correlationPlugin)
 *
 * Downstream route handlers can read:
 *   req.correlationId   — the request trace ID
 *   req.tenantId        — already set by auth plugin
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp                from 'fastify-plugin'
import { randomUUID }    from 'node:crypto'

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string
    requestedAt:   string
  }
}

async function correlationPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('correlationId', '')
  fastify.decorateRequest('requestedAt',   '')

  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const incoming =
      (req.headers['x-correlation-id'] as string | undefined) ||
      (req.headers['x-request-id']     as string | undefined) ||
      randomUUID()

    req.correlationId = incoming
    req.requestedAt   = new Date().toISOString()

    // Reflect back in every response
    void reply.header('X-Correlation-Id', incoming)
    void reply.header('X-Request-At',     req.requestedAt)
  })

  // Structured log enrichment (SYSCERT_AUDIT_2026-08-02.md H21): pino only
  // includes fields passed via a log call's merging object or bound via
  // .child(bindings) — mutating a property directly on the logger instance
  // (the previous `req.log.correlationId = ...`) is silently ignored and
  // never appears in log output. Rebind req.log to a child logger with
  // correlationId bound, so every req.log.info/warn/error call downstream
  // includes it automatically.
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    req.log = req.log.child({ correlationId: req.correlationId })
  })
}

export default fp(correlationPlugin, { name: 'correlation' })
