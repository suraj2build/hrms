/**
 * routing.ts — role-aware path helpers
 *
 * Admin portal (/admin/*): super_admin, hr_admin, manager
 * ESS portal   (/ess/*):   employee
 *
 * `activeRole` in UIStore is now a WORKSPACE CONTEXT signal (Admin Portal /
 * Manager Workspace / Employee Self Service) — it does NOT change the portal
 * base path. Route guards and navigation always use the user's real profile role.
 */

import { useAuthStore } from '@/stores/authStore'
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
 * Hook — returns the base path for the user's *real* profile role.
 * Workspace context overrides (activeRole) do NOT affect base path —
 * workspace switching is scoped to views within the admin portal.
 */
export function useBasePath(): BasePath {
  const { profile } = useAuthStore()
  return getBasePath(profile?.role)
}

/** Returns the user's real profile role (no workspace override). */
export function useEffectiveRole(): UserRole | undefined {
  const { profile } = useAuthStore()
  return profile?.role
}

/** Returns true if the real profile role is an admin-portal role. */
export function isAdminRole(role: UserRole | undefined): boolean {
  return ADMIN_ROLES.includes(role as UserRole)
}
