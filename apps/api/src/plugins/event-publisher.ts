/**
 * eventPublisherPlugin — registers EventPublisher on the Fastify instance.
 *
 * After registration, routes access it via: fastify.eventPublisher
 *
 * Usage in routes (always fire-and-forget, never await):
 *
 *   await core.doOperation(data)          // core op first
 *   fastify.eventPublisher.publish({...}) // then publish — no await
 */

import fp                from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import { EventPublisher } from '../platform/events/publishers/event-publisher.js'

declare module 'fastify' {
  interface FastifyInstance {
    eventPublisher: EventPublisher
  }
}

async function eventPublisherPlugin(fastify: FastifyInstance) {
  // supabasePlugin must be registered before this plugin
  const publisher = new EventPublisher(fastify.supabase)
  fastify.decorate('eventPublisher', publisher)
}

export default fp(eventPublisherPlugin, {
  name:         'event-publisher',
  dependencies: ['supabase'],
})
