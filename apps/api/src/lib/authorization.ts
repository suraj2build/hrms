/**
 * Authorization — unified middleware factory combining permissions + scope evaluation.
 *
 * This is the single source of truth for route-level authorization. It:
 *   1. Verifies the actor has the required permission
 *   2. (Optionally) evaluates organizational scope for subject-specific requests
 *   3. Logs authorization decisions to the audit log
 *   4. Returns structured error responses for denied requests
 *
 * Usage:
 *   import { authorize, authorizeOwn, authorizeTeam } from '../../lib/authorization.js'
 *
 *   // Permission check only (no scope)
 *   fastify.get('/route', { preHandler: [fastify.authenticate, authorize('attendance:view')] }, handler)
 *
 *   // Permission + scope (actor must have permission AND scope over the subject)
 *   fastify.get('/employees/:id/record', {
 *     preHandler: [fastify.authenticate, authorize('attendance:view', { subjectParam: 'id' })],
 *   }, handler)
 *
 *   // Self-only (actor can only see their own data)
 *   fastify.get('/me/attendance', {
 *     preHandler: [fastify.authenticate, authorizeOwn('attendance:view')],
 *   }, handler)
 *
 * Note: These pre-handlers must run AFTER fastify.authenticate.
 */

import type { FastifyRequest, FastifyReply } from 'fastify'
import { hasPermission, requirePermission }  from './permissions.js'
import type { Permission }                   from './permissions.js'
import { ScopeEvaluator }                   from './scope-evaluator.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthorizeOptions {
  /**
   * When set, the param name in req.params that contains the subject's employee_id.
   * The scope evaluator will verify the actor has scope over this subject.
   */
  subjectParam?: string
  /**
   * When true, skip scope evaluation and rely on permission check only.
   * Useful for list endpoints where scope is applied in the query layer.
   */
  skipScope?: boolean
  /**
   * Custom error message to return when authorization fails.
   */
  message?: string
}

// ── Core authorize factory ────────────────────────────────────────────────────

/**
 * Unified authorization pre-handler.
 * Combines permission check with optional scope evaluation.
 */
export function authorize(
  permission: Permission,
  opts?: AuthorizeOptions,
) {
  return async function authorizationGuard(
    req:   FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const r = req as unknown as Record<string, unknown>
    const userRole = r.userRole  as string | undefined
    const userId   = r.userId   as string | undefined
    const tenantId = r.tenantId as string | undefined

    // 1. Permission check
    if (!userRole || !hasPermission(userRole, permission)) {
      await reply.code(403).send({
        error:      'FORBIDDEN',
        message:    opts?.message ?? `Permission '${permission}' required.`,
        permission,
        role:       userRole ?? 'unknown',
      })
      return
    }

    // 2. Scope evaluation (optional)
    if (!opts?.skipScope && opts?.subjectParam && userId && tenantId) {
      const params    = req.params as Record<string, string>
      const subjectId = params[opts.subjectParam]

      if (subjectId) {
        const fastify   = (req as any).server
        const evaluator = new ScopeEvaluator(fastify?.supabase ?? (req as any).supabase)
        const result    = await evaluator.evaluate({
          actorId:   userId,
          actorRole: userRole,
          tenantId,
          subjectId,
        })

        if (!result.allowed) {
          await reply.code(403).send({
            error:   'SCOPE_DENIED',
            message: opts.message ?? 'You do not have organizational scope to access this resource.',
            scope:   result.scope,
            reason:  result.reason,
          })
          return
        }

        // Attach scope to request for downstream use
        ;(req as any).accessScope = result.scope
      }
    }
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Restricts access to the actor's own resources.
 * The subjectParam must match the actor's employee_id.
 */
export function authorizeOwn(permission: Permission, subjectParam = 'id') {
  return authorize(permission, { subjectParam, message: 'You can only access your own records.' })
}

/**
 * Restricts to team-scoped access (actor's direct reports + department).
 * Falls through to org-wide for HR admin / super admin.
 */
export function authorizeTeam(permission: Permission, subjectParam = 'id') {
  return authorize(permission, { subjectParam })
}

// ── Re-exports for backward compat ───────────────────────────────────────────

export { requirePermission, hasPermission } from './permissions.js'
export type { Permission }                  from './permissions.js'

// ── Permission constants (named exports for readability) ──────────────────────

export const PERM = {
  // Employees
  EMP_VIEW:         'employees:view'    as Permission,
  EMP_CREATE:       'employees:create'  as Permission,
  EMP_EDIT:         'employees:edit'    as Permission,
  EMP_DELETE:       'employees:delete'  as Permission,
  // Attendance
  ATT_VIEW:         'attendance:view'       as Permission,
  ATT_VIEW_TEAM:    'attendance:view_team'  as Permission,
  ATT_PROCESS:      'attendance:process'    as Permission,
  ATT_EDIT:         'attendance:edit'       as Permission,
  ATT_EXPORT:       'attendance:export'     as Permission,
  // Leave
  LEAVE_VIEW:       'leave:view'       as Permission,
  LEAVE_APPLY:      'leave:apply'      as Permission,
  LEAVE_APPROVE:    'leave:approve'    as Permission,
  LEAVE_CONFIGURE:  'leave:configure'  as Permission,
  // Corrections
  CORR_VIEW:        'corrections:view'    as Permission,
  CORR_SUBMIT:      'corrections:submit'  as Permission,
  CORR_APPROVE:     'corrections:approve' as Permission,
  // Anomalies
  ANOM_VIEW:        'anomalies:view'    as Permission,
  ANOM_RESOLVE:     'anomalies:resolve' as Permission,
  // Roster / Shifts
  ROSTER_VIEW:      'roster:view'      as Permission,
  ROSTER_EDIT:      'roster:edit'      as Permission,
  SHIFTS_CONFIG:    'shifts:configure' as Permission,
  // Reports
  REPORT_VIEW:      'reports:view'   as Permission,
  REPORT_EXPORT:    'reports:export' as Permission,
  // Settings / Masters
  SETTINGS_VIEW:    'settings:view'  as Permission,
  SETTINGS_EDIT:    'settings:edit'  as Permission,
  MASTERS_VIEW:     'masters:view'   as Permission,
  MASTERS_EDIT:     'masters:edit'   as Permission,
  // Payroll
  PAYROLL_VIEW:     'payroll:view' as Permission,
  PAYROLL_RUN:      'payroll:run'  as Permission,
  // Workflows
  WF_VIEW:          'workflows:view'      as Permission,
  WF_CONFIGURE:     'workflows:configure' as Permission,
  WF_APPROVE:       'workflows:approve'   as Permission,
} as const
