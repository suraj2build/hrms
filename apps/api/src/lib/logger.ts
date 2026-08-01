/**
 * Standalone pino logger for background/library code (schedulers, event
 * emitters, provider clients) that has no `req`/`fastify.log` in scope.
 * Mirrors the Fastify instance's own logger config (see index.ts) so
 * background-job logs land in the same format/transport as request logs.
 */
import pino from 'pino'

export const logger = pino(
  process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {},
)
