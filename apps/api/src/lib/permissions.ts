/**
 * Permission System — fine-grained permission strings per role.
 *
 * Permission format: "<resource>:<action>"
 *
 * Roles:
 *   super_admin  — all permissions
 *   hr_admin     — most permissions (no system settings)
 *   manager      — team-scoped read + approval permissions
 *   employee     — own-data read + self-service actions
 *
 * Usage in routes:
 *   import { requirePermission } from '../../lib/permissions.js'
 *   fastify.get('/route', {
 *     preHandler: [fastify.authenticate, requirePermission('attendance:view')],
 *   }, handler)
 *
 * Usage for programmatic checks:
 *   import { hasPermission } from '../../lib/permissions.js'
 *   if (!hasPermission(req.userRole, 'leave:approve')) { ... }
 */

import type { FastifyRequest, FastifyReply } from 'fastify'

// ── Permission strings ────────────────────────────────────────────────────────

export type Permission =
  // Employees
  | 'employees:view'
  | 'employees:create'
  | 'employees:edit'
  | 'employees:delete'
  // Attendance
  | 'attendance:view'
  | 'attendance:view_team'
  | 'attendance:process'
  | 'attendance:edit'
  | 'attendance:export'
  // Leave
  | 'leave:view'
  | 'leave:apply'
  | 'leave:approve'
  | 'leave:configure'
  // Corrections / Regularisation
  | 'corrections:view'
  | 'corrections:submit'
  | 'corrections:approve'
  // Anomalies
  | 'anomalies:view'
  | 'anomalies:resolve'
  // Roster / Shifts
  | 'roster:view'
  | 'roster:edit'
  | 'shifts:configure'
  // Reports
  | 'reports:view'
  | 'reports:export'
  // Settings / Masters
  | 'settings:view'
  | 'settings:edit'
  | 'masters:view'
  | 'masters:edit'
  // Payroll
  | 'payroll:view'
  | 'payroll:run'
  | 'payroll:export'
  | 'payroll:override'
  // Workflows
  | 'workflows:view'
  | 'workflows:configure'
  | 'workflows:approve'
  // Extended employee actions
  | 'employees:export'
  // Extended attendance actions
  | 'attendance:audit'
  | 'attendance:override'
  // Extended corrections actions
  | 'corrections:reject'
  // Extended leave actions
  | 'leave:reject'
  | 'leave:override'
  // Extended roster actions
  | 'roster:override'

// ── Role → Permission matrix ───────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: [
    'employees:view', 'employees:create', 'employees:edit', 'employees:delete',
    'attendance:view', 'attendance:view_team', 'attendance:process', 'attendance:edit', 'attendance:export',
    'leave:view', 'leave:apply', 'leave:approve', 'leave:configure',
    'corrections:view', 'corrections:submit', 'corrections:approve',
    'anomalies:view', 'anomalies:resolve',
    'roster:view', 'roster:edit', 'shifts:configure',
    'reports:view', 'reports:export',
    'settings:view', 'settings:edit', 'masters:view', 'masters:edit',
    'payroll:view', 'payroll:run', 'payroll:export', 'payroll:override',
    'workflows:view', 'workflows:configure', 'workflows:approve',
    'employees:export',
    'attendance:audit', 'attendance:override',
    'corrections:reject',
    'leave:reject', 'leave:override',
    'roster:override',
  ],

  hr_admin: [
    'employees:view', 'employees:create', 'employees:edit',
    'attendance:view', 'attendance:view_team', 'attendance:process', 'attendance:edit', 'attendance:export',
    'leave:view', 'leave:apply', 'leave:approve', 'leave:configure',
    'corrections:view', 'corrections:submit', 'corrections:approve',
    'anomalies:view', 'anomalies:resolve',
    'roster:view', 'roster:edit', 'shifts:configure',
    'reports:view', 'reports:export',
    'settings:view', 'masters:view', 'masters:edit',
    'payroll:view', 'payroll:export', 'payroll:override',
    'workflows:view', 'workflows:configure', 'workflows:approve',
    'employees:export',
    'attendance:audit', 'attendance:override',
    'corrections:reject',
    'leave:reject', 'leave:override',
    'roster:override',
  ],

  manager: [
    'employees:view',
    'attendance:view', 'attendance:view_team', 'attendance:edit',
    'leave:view', 'leave:apply', 'leave:approve',
    'corrections:view', 'corrections:submit', 'corrections:approve',
    'anomalies:view',
    'roster:view',
    'reports:view',
    'workflows:view', 'workflows:approve',
  ],

  employee: [
    'employees:view',
    'attendance:view',
    'leave:view', 'leave:apply',
    'corrections:view', 'corrections:submit',
    'workflows:view',
  ],
}

// ── Core check ────────────────────────────────────────────────────────────────

/**
 * Returns true when the given role has the specified permission.
 * super_admin always has everything.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  return perms.includes(permission)
}

/**
 * Returns true when the role has ALL of the specified permissions.
 */
export function hasAllPermissions(role: string, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p))
}

/**
 * Returns true when the role has at least one of the specified permissions.
 */
export function hasAnyPermission(role: string, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

/**
 * Returns the full permission set for a role.
 */
export function getPermissionsForRole(role: string): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

// ── Fastify pre-handler factory ───────────────────────────────────────────────

/**
 * Returns a Fastify pre-handler that aborts with 403 unless the authenticated
 * user has the specified permission.
 *
 * Must be placed AFTER fastify.authenticate in the preHandler chain.
 */
export function requirePermission(permission: Permission) {
  return async function permissionGuard(
    req:   FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userRole = (req as unknown as Record<string, unknown>).userRole as string | undefined
    if (!userRole || !hasPermission(userRole, permission)) {
      await reply.code(403).send({
        error:   'FORBIDDEN',
        message: `Permission '${permission}' is required for this action.`,
      })
    }
  }
}

/**
 * Returns a pre-handler that requires the user to have ANY of the given permissions.
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return async function permissionGuard(
    req:   FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userRole = (req as unknown as Record<string, unknown>).userRole as string | undefined
    if (!userRole || !hasAnyPermission(userRole, permissions)) {
      await reply.code(403).send({
        error:   'FORBIDDEN',
        message: `One of these permissions is required: ${permissions.join(', ')}.`,
      })
    }
  }
}

// ── /me/permissions endpoint helper ──────────────────────────────────────────

/**
 * Returns a permissions summary for the /me endpoint so the frontend
 * can render UI conditionally without multiple round-trips.
 */
export function buildPermissionsSummary(role: string): Record<Permission, boolean> {
  const allPerms: Permission[] = [
    'employees:view', 'employees:create', 'employees:edit', 'employees:delete',
    'attendance:view', 'attendance:view_team', 'attendance:process', 'attendance:edit', 'attendance:export',
    'leave:view', 'leave:apply', 'leave:approve', 'leave:configure',
    'corrections:view', 'corrections:submit', 'corrections:approve',
    'anomalies:view', 'anomalies:resolve',
    'roster:view', 'roster:edit', 'shifts:configure',
    'reports:view', 'reports:export',
    'settings:view', 'settings:edit', 'masters:view', 'masters:edit',
    'payroll:view', 'payroll:run', 'payroll:export', 'payroll:override',
    'workflows:view', 'workflows:configure', 'workflows:approve',
    'employees:export',
    'attendance:audit', 'attendance:override',
    'corrections:reject',
    'leave:reject', 'leave:override',
    'roster:override',
  ]
  const summary = {} as Record<Permission, boolean>
  for (const p of allPerms) {
    summary[p] = hasPermission(role, p)
  }
  return summary
}
