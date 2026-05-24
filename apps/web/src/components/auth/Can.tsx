/**
 * Can — permission-gating component for conditional UI rendering.
 *
 * Usage:
 *
 *   // Render children only when the user has the permission:
 *   <Can permission="leave:approve">
 *     <Button>Approve</Button>
 *   </Can>
 *
 *   // With a fallback:
 *   <Can permission="employees:edit" fallback={<p>Read only</p>}>
 *     <EditForm />
 *   </Can>
 *
 *   // Require ANY of several permissions:
 *   <Can anyOf={['leave:approve', 'corrections:approve']}>
 *     <ApprovePanel />
 *   </Can>
 *
 *   // Require ALL of several permissions:
 *   <Can allOf={['attendance:view', 'attendance:export']}>
 *     <ExportButton />
 *   </Can>
 */

import type { ReactNode } from 'react'
import { usePermission, usePermissions, useAnyPermission } from '@/hooks/usePermission'
import type { Permission } from '@/lib/permissions'

interface CanProps {
  /** Single permission — component renders when user has this. */
  permission?: Permission
  /** All of these permissions required. */
  allOf?: Permission[]
  /** At least one of these permissions required. */
  anyOf?: Permission[]
  /** Rendered when access is denied (default: null). */
  fallback?: ReactNode
  children: ReactNode
}

export function Can({ permission, allOf, anyOf, fallback = null, children }: CanProps) {
  const single = usePermission(permission ?? ('' as Permission))
  const all    = usePermissions(allOf ?? [])
  const any    = useAnyPermission(anyOf ?? [])

  let granted = false

  if (permission)      granted = single
  else if (allOf?.length)  granted = all
  else if (anyOf?.length)  granted = any
  else                 granted = true   // no constraints = always show

  return granted ? <>{children}</> : <>{fallback}</>
}
