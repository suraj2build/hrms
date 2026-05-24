/**
 * GET /health  — liveness probe (is the process alive?)
 * GET /ready   — readiness probe (is the platform ready to serve traffic?)
 *
 * /health returns 200 if the process is running (even if degraded).
 * /ready  returns 200 only if status is 'ok' or 'degraded'; 503 if 'unavailable'.
 *
 * These endpoints are intentionally unauthenticated so orchestration systems
 * (Kubernetes, Railway, Render, etc.) can poll them without credentials.
 */
import type { FastifyInstance } from 'fastify'
import { platformHealth }       from '../../lib/startup-health.js'

export default async function healthRoutes(fastify: FastifyInstance) {

  /** Liveness — is the process running? */
  fastify.get('/health', async (_req, reply) => {
    return reply.code(200).send({
      status:    platformHealth.status,
      startedAt: platformHealth.startedAt,
      uptime:    Math.floor(process.uptime()),
    })
  })

  /** Readiness — is the platform ready to serve requests? */
  fastify.get('/ready', async (_req, reply) => {
    const isReady = platformHealth.status !== 'unavailable'
    return reply.code(isReady ? 200 : 503).send({
      ready:     isReady,
      status:    platformHealth.status,
      startedAt: platformHealth.startedAt,
      checks:    platformHealth.checks.map(c => ({
        name:      c.name,
        status:    c.status,
        latencyMs: c.latencyMs,
        ...(c.message ? { message: c.message } : {}),
      })),
      modules:   platformHealth.modules,
    })
  })
}
