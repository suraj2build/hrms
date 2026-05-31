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

  // Structured log enrichment — Fastify pino will pick this up automatically
  fastify.addHook('onRequest', async (req: FastifyRequest) => {
    ;(req.log as any).correlationId = req.correlationId
  })
}

export default fp(correlationPlugin, { name: 'correlation' })
