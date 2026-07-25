/**
 * RBAC — Role-Based Access Control helpers for Fastify route pre-handlers.
 *
 * Usage:
 *
 *   import { requireRole } from '../../lib/rbac.js'
 *
 *   // Route-level guard — added to preHandler array:
 *   fastify.post('/route', {
 *     preHandler: [fastify.authenticate, requireRole('super_admin', 'hr_admin')],
 *   }, handler)
 *
 * requireRole must always be placed AFTER fastify.authenticate in the preHandler
 * chain because authenticate decorates req.userRole.
 */
import type { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Returns a Fastify pre-handler that aborts with 403 unless the authenticated
 * user has one of the specified roles.
 */
export function requireRole(...roles: string[]) {
  return async function roleGuard(
    req:   FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userRole = (req as unknown as Record<string, unknown>).userRole as string | undefined
    if (!userRole || !roles.includes(userRole)) {
      await reply.code(403).send({
        error:   'FORBIDDEN',
        message: `Access denied. Required role(s): ${roles.join(' or ')}.`,
      })
    }
  }
}

/** Convenience constant for the two HR admin roles used throughout. */
export const HR_ADMIN_ROLES = ['super_admin', 'hr_admin'] as const

/**
 * Convenience constant for "manager or above" access checks — the two HR admin
 * roles plus 'manager'. Canonicalizes what was previously ~14 independently
 * duplicated inline literals across the codebase (some ordered
 * ['super_admin', 'hr_admin', 'manager'], others ['manager', 'hr_admin',
 * 'super_admin'], a few built as [...HR_ADMIN_ROLES, 'manager']) — a role
 * added or removed from this tier previously required updating every call site
 * individually, with no guarantee they'd all be found. (ISSUE-148)
 */
export const MANAGER_ROLES = [...HR_ADMIN_ROLES, 'manager'] as const
