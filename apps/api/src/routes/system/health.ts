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

// Full (untruncated) commit SHA of the running deployment — lets a release-
// qualification check (e.g. CI's E2E gate) confirm the environment it's
// about to test is actually running the candidate commit, not a stale
// deployment. Railway sets RAILWAY_GIT_COMMIT_SHA; Vercel (if the API is
// ever hosted there) sets VERCEL_GIT_COMMIT_SHA; GIT_COMMIT_SHA is a
// manual fallback for other hosts.
const DEPLOYED_COMMIT_SHA =
  process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null

export default async function healthRoutes(fastify: FastifyInstance) {

  function livenessPayload() {
    return {
      status:    platformHealth.status,
      startedAt: platformHealth.startedAt,
      uptime:    Math.floor(process.uptime()),
      commitSha: DEPLOYED_COMMIT_SHA,
    }
  }

  /** Liveness — is the process running? */
  fastify.get('/health', async (_req, reply) => reply.code(200).send(livenessPayload()))

  /** /status — alias for /health; useful for manual connectivity checks */
  fastify.get('/status', async (_req, reply) => reply.code(200).send(livenessPayload()))

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
