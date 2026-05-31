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

// ── Permission hooks ──────────────────────────────────────────────────────────
//
// These hooks always use the user's REAL profile role.
// `activeRole` in uiStore is a workspace context signal (Admin Portal /
// Manager Workspace / Employee Self Service) — it does not affect RBAC.
// Backend API calls always use the real JWT and real server-side role.

import { useAuthStore } from '@/stores/authStore'

/**
 * Hook — returns true when the real profile role has the given permission.
 *
 * Use this for: sidebar item visibility, page-level access guards, button
 * enable/disable states, conditional tabs.
 *
 * Do NOT use for: API requests, backend-guarded operations. Those must use
 * the real role from `authStore.hasPermission()`.
 */
export function useEffectivePermission(permission: Permission): boolean {
  const profile = useAuthStore(s => s.profile)
  if (!profile) return false
  return hasPermission(profile.role, permission)
}

/**
 * Hook — returns the real profile role string (for display / conditional logic).
 */
export function useEffectiveRole(): string | null {
  const profile = useAuthStore(s => s.profile)
  return profile?.role ?? null
}
