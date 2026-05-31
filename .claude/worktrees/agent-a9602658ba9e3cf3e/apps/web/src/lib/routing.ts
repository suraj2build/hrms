/**
 * routing.ts — role-aware path helpers
 *
 * Admin portal (/admin/*): super_admin, hr_admin, manager
 * ESS portal   (/ess/*):   employee
 *
 * `activeRole` in UIStore lets admins preview the ESS portal without
 * changing their real Supabase profile role.
 */

import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import type { UserRole } from '@/types'

export type BasePath = '/admin' | '/ess'

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

/**
 * Pure function — derives base path from a role.
 * Falls back to '/admin' when role is undefined.
 */
export function getBasePath(role: UserRole | undefined): BasePath {
  return role === 'employee' ? '/ess' : '/admin'
}

/**
 * Hook — reads the *effective* role (activeRole override → real profile role)
 * and returns the matching base path.
 */
export function useBasePath(): BasePath {
  const { profile } = useAuthStore()
  const { activeRole } = useUIStore()
  return getBasePath(activeRole ?? profile?.role)
}

/** Returns the effective role (override takes precedence). */
export function useEffectiveRole(): UserRole | undefined {
  const { profile } = useAuthStore()
  const { activeRole } = useUIStore()
  return activeRole ?? profile?.role
}

/** Returns true if the real profile role is an admin-portal role. */
export function isAdminRole(role: UserRole | undefined): boolean {
  return ADMIN_ROLES.includes(role as UserRole)
}
