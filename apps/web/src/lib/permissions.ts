/**
 * Frontend Permission System
 *
 * Mirror of apps/api/src/lib/permissions.ts — kept in sync manually.
 * Used for conditional UI rendering without extra API calls.
 *
 * Usage:
 *   import { hasPermission } from '@/lib/permissions'
 *   if (hasPermission(profile.role, 'leave:approve')) { ... }
 *
 *   // Or via hook/component (see usePermission, Can):
 *   const canApprove = usePermission('leave:approve')
 */

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
  // Workflows
  | 'workflows:view'
  | 'workflows:configure'
  | 'workflows:approve'

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
    'payroll:view', 'payroll:run',
    'workflows:view', 'workflows:configure', 'workflows:approve',
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
    'payroll:view',
    'workflows:view', 'workflows:configure', 'workflows:approve',
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

// ── Core helpers ──────────────────────────────────────────────────────────────

export function hasPermission(role: string | undefined | null, permission: Permission): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  return perms.includes(permission)
}

export function hasAllPermissions(role: string | undefined | null, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p))
}

export function hasAnyPermission(role: string | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

export function getPermissionsForRole(role: string): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

// ── Dev-only effective permission hook ────────────────────────────────────────
//
// ⚠️  DEVELOPMENT / STAGING ONLY — NOT real authorization.
// This hook respects the activeRole preview override set in uiStore so that
// sidebar items, page guards, and action buttons reflect the simulated role.
//
// Backend API calls are NEVER affected — the real JWT role governs all server
// requests. Use `authStore.hasPermission()` (or the raw `hasPermission()`
// function above) for any check that touches the server.
//
// In production builds (import.meta.env.PROD) the activeRole override is
// ignored and the real profile.role is always used.

import { useAuthStore } from '@/stores/authStore'
import { useUIStore }   from '@/stores/uiStore'

/**
 * Hook — returns true when the *effective* role has the given permission.
 *
 * Effective role:
 *   - DEV/staging: `uiStore.activeRole ?? profile.role`
 *   - Production:  always `profile.role`
 *
 * Use this for: sidebar item visibility, page-level access guards, button
 * enable/disable states, conditional tabs.
 *
 * Do NOT use for: API requests, backend-guarded operations. Those must use
 * the real role from `authStore.hasPermission()`.
 */
export function useEffectivePermission(permission: Permission): boolean {
  const profile    = useAuthStore(s => s.profile)
  const activeRole = useUIStore(s => s.activeRole)

  if (!profile) return false

  // In production the override is silently ignored.
  const effectiveRole = (!import.meta.env.PROD && activeRole) ? activeRole : profile.role

  return hasPermission(effectiveRole, permission)
}

/**
 * Hook — returns the effective role string (for display / conditional logic).
 *
 * Same dev-vs-production rules as `useEffectivePermission`.
 */
export function useEffectiveRole(): string | null {
  const profile    = useAuthStore(s => s.profile)
  const activeRole = useUIStore(s => s.activeRole)

  if (!profile) return null
  if (!import.meta.env.PROD && activeRole) return activeRole
  return profile.role
}
