/**
 * ProfilePlatform — Admin Employee Record
 *
 * Renders the HR Admin employee master form (EmployeeProfile) for the given :id.
 *
 * Architecture note (2026-05):
 *   Admin shell ONLY ever shows the operational HR admin form here.
 *   ESS and Manager experiences each have their own dedicated shell:
 *     ESS     → /ess/*      (EssShell)
 *     Manager → /manager/*  (ManagerShell)
 *
 *   The previous "view as employee / view as manager" impersonation UX inside
 *   the admin profile was removed to eliminate shell confusion, duplicated UX,
 *   and permission ambiguity. If an admin needs to preview ESS or Manager views
 *   they should use the workspace switcher (RoleSwitcher) which navigates to the
 *   proper shell rather than embedding a foreign experience inside AdminShell.
 */

import { lazy, Suspense } from 'react'
import { Loader2 }        from 'lucide-react'

// Lazy-load the heavy admin form to keep the initial bundle small
const EmployeeProfile = lazy(() =>
  import('@/pages/employees/EmployeeProfile').then(m => ({ default: m.EmployeeProfile }))
)

function PlatformLoader() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )
}

export function ProfilePlatform() {
  return (
    <Suspense fallback={<PlatformLoader />}>
      <EmployeeProfile />
    </Suspense>
  )
}
