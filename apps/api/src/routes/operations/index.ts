/**
 * Operations routes barrel — Sprint 4.
 */
import type { FastifyInstance } from 'fastify'
import operationsIntelligenceRoutes from './intelligence.js'

export default async function operationsRoutes(fastify: FastifyInstance) {
  await fastify.register(operationsIntelligenceRoutes)
}
