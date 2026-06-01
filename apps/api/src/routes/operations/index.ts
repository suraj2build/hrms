/**
 * Operations routes barrel — Sprint 4.
 */
import type { FastifyInstance } from 'fastify'
import operationsIntelligenceRoutes from './intelligence.js'
import operationalCountsRoutes      from './counts.js'

export default async function operationsRoutes(fastify: FastifyInstance) {
  await fastify.register(operationsIntelligenceRoutes)
  await fastify.register(operationalCountsRoutes)
}
