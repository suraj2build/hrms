import type { FastifyInstance } from 'fastify'
import auditRoutes from './audit.js'
import adminRoutes from './admin.js'

export default async function enterpriseRoutes(fastify: FastifyInstance) {
  await fastify.register(auditRoutes, { prefix: '/enterprise' })
  await fastify.register(adminRoutes, { prefix: '/enterprise' })
}
