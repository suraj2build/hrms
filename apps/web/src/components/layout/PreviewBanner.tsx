/**
 * PreviewBanner
 *
 * ⚠️  DEV / STAGING ONLY — tree-shaken in production.
 *
 * Renders a compact amber strip when a role preview is active, reminding
 * developers that they are seeing a simulated permission view — NOT a real
 * role change. Backend API calls are unaffected.
 *
 * Rendered by AdminShell between Topbar and <main>.
 */

import { FlaskConical, X } from 'lucide-react'
import { useAuthStore }    from '@/stores/authStore'
import { useUIStore }      from '@/stores/uiStore'
import { useNavigate }     from 'react-router-dom'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  hr_admin:    'HR Admin',
  manager:     'Manager',
  employee:    'Employee',
}

export function PreviewBanner() {
  // Only render in dev/staging — tree-shaken in production via import.meta.env.DEV
  if (!import.meta.env.DEV) return null

  const activeRole = useUIStore(s => s.activeRole)
  const setActiveRole = useUIStore(s => s.setActiveRole)
  const realRole   = useAuthStore(s => s.profile?.role)
  const navigate   = useNavigate()

  if (!activeRole) return null

  const label = ROLE_LABELS[activeRole] ?? activeRole

  function reset() {
    setActiveRole(null)
    navigate('/admin/dashboard')
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1.5 bg-warning/[0.12] border-b border-warning/25 text-warning text-xs select-none"
    >
      <FlaskConical className="h-3 w-3 flex-shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">Dev Preview</span>
        {' — '}viewing admin portal as{' '}
        <span className="font-semibold">{label}</span>.
        {' '}
        <span className="text-warning/70">
          API calls still use your real role ({ROLE_LABELS[realRole ?? ''] ?? realRole}).
        </span>
      </span>
      <button
        onClick={reset}
        className="flex items-center gap-1 font-medium hover:text-warning/80 transition-colors"
        aria-label="Exit preview mode"
      >
        <X className="h-3 w-3" />
        Exit preview
      </button>
    </div>
  )
}
