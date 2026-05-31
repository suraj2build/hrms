/**
 * Dashboard — role-aware router.
 * Renders the correct dashboard based on effective role (respects dev preview).
 */
import { useAuthStore } from '@/stores/authStore'
import { useUIStore }   from '@/stores/uiStore'
import { AdminDashboard }       from './AdminDashboard'
import { ManagerDashboardPage } from './ManagerDashboard'
import { EmployeeDashboard }    from './EmployeeDashboard'

export function Dashboard() {
  const profile    = useAuthStore(s => s.profile)
  const activeRole = useUIStore(s => s.activeRole)

  // Use preview role in dev; always real role in production
  const effectiveRole = (!import.meta.env.PROD && activeRole) ? activeRole : (profile?.role ?? 'employee')

  if (effectiveRole === 'super_admin' || effectiveRole === 'hr_admin') {
    return <AdminDashboard />
  }
  if (effectiveRole === 'manager') {
    return <ManagerDashboardPage />
  }
  return <EmployeeDashboard />
}
