/**
 * Fabric routes barrel — Sprint 5.
 * Registers all Enterprise Orchestration Fabric API endpoints.
 */
import type { FastifyInstance } from 'fastify'
import fabricIntelligenceRoutes from './intelligence.js'

export default async function fabricRoutes(fastify: FastifyInstance) {
  await fastify.register(fabricIntelligenceRoutes)
}
