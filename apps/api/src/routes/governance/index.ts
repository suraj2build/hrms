/**
 * Governance route registration.
 *
 * Registers all governance intelligence sub-routes under /governance.
 * Sprint 2: Governance Intelligence Layer.
 */

import type { FastifyInstance } from 'fastify'
import intelligenceRoutes       from './intelligence.js'

export default async function governanceRoutes(fastify: FastifyInstance) {
  await fastify.register(intelligenceRoutes, { prefix: '/governance' })
}
