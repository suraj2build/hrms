/**
 * Dashboard — role-aware router.
 * Renders the correct dashboard based on the user's real profile role.
 * Workspace context (activeRole) does not affect which dashboard is shown —
 * workspace switching is scoped to profile views, not the dashboard.
 */
import { useAuthStore } from '@/stores/authStore'
import { AdminDashboard }       from './AdminDashboard'
import { ManagerDashboardPage } from './ManagerDashboard'
import { EmployeeDashboard }    from './EmployeeDashboard'

export function Dashboard() {
  const profile = useAuthStore(s => s.profile)
  const role    = profile?.role ?? 'employee'

  if (role === 'super_admin' || role === 'hr_admin') {
    return <AdminDashboard />
  }
  if (role === 'manager') {
    return <ManagerDashboardPage />
  }
  return <EmployeeDashboard />
}
