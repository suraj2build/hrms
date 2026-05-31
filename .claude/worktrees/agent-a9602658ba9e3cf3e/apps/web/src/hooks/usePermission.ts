/**
 * usePermission — React hook for permission-based UI gating.
 *
 * Usage:
 *   const canApprove  = usePermission('leave:approve')
 *   const canViewTeam = usePermission('attendance:view_team')
 *
 *   if (!canApprove) return null
 *
 *   // Or with multiple permissions:
 *   const canEdit = usePermissions(['employees:edit', 'employees:create'])
 *   // returns true if ALL permissions are granted
 *
 *   const canDoEither = useAnyPermission(['leave:approve', 'corrections:approve'])
 *   // returns true if ANY permission is granted
 */

import { useAuthStore } from '@/stores/authStore'
import {
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getPermissionsForRole,
  type Permission,
} from '@/lib/permissions'

/**
 * Returns true when the current user has the given permission.
 */
export function usePermission(permission: Permission): boolean {
  const { profile } = useAuthStore()
  return hasPermission(profile?.role, permission)
}

/**
 * Returns true when the current user has ALL of the given permissions.
 */
export function usePermissions(permissions: Permission[]): boolean {
  const { profile } = useAuthStore()
  return hasAllPermissions(profile?.role, permissions)
}

/**
 * Returns true when the current user has ANY of the given permissions.
 */
export function useAnyPermission(permissions: Permission[]): boolean {
  const { profile } = useAuthStore()
  return hasAnyPermission(profile?.role, permissions)
}

/**
 * Returns the full list of permissions granted to the current user's role.
 */
export function useMyPermissions(): Permission[] {
  const { profile } = useAuthStore()
  if (!profile?.role) return []
  return getPermissionsForRole(profile.role)
}
