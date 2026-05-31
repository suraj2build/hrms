/**
 * Trust routes barrel — registers all trust & compliance intelligence endpoints.
 */
import type { FastifyInstance } from 'fastify'
import trustIntelligenceRoutes from './intelligence.js'

export default async function trustRoutes(fastify: FastifyInstance) {
  await fastify.register(trustIntelligenceRoutes)
}
