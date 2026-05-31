/**
 * WorkspaceContextBanner
 *
 * Renders a compact strip below the Topbar when the user has switched from the
 * default Admin Portal workspace into either:
 *   • Employee Self Service — viewing a specific employee's worklife hub
 *   • Manager Workspace     — viewing a manager's operational view
 *
 * The banner is always visible (dev + staging + production) whenever an
 * impersonated identity is active. Provides a one-click exit back to Admin Portal.
 *
 * Rendered by AdminShell between Topbar and <main>.
 */

import { User2, Users, X } from 'lucide-react'
import { useUIStore }       from '@/stores/uiStore'
import { useNavigate }      from 'react-router-dom'
import { cn }               from '@/lib/utils'

export function PreviewBanner() {
  const {
    activeRole,
    impersonatedEmployee,
    impersonatedManager,
    clearWorkspaceContext,
  } = useUIStore()
  const navigate = useNavigate()

  function exitWorkspace() {
    clearWorkspaceContext()
    navigate('/admin/dashboard')
  }

  // ── Employee Self Service context ─────────────────────────────────────────
  if (activeRole === 'employee' && impersonatedEmployee) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-1.5',
          'bg-info/[0.08] border-b border-info/20 text-info text-xs select-none',
        )}
      >
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-info/15 flex items-center justify-center flex-shrink-0">
            <User2 className="h-3 w-3" />
          </div>
          <span>
            <span className="font-semibold">Employee Self Service</span>
            {' — '}
            viewing as{' '}
            <span className="font-semibold">{impersonatedEmployee.name}</span>
            <span className="opacity-60 ml-1">({impersonatedEmployee.code})</span>
          </span>
        </div>
        <button
          onClick={exitWorkspace}
          className="flex items-center gap-1 font-medium opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Exit Employee Self Service workspace"
        >
          <X className="h-3 w-3" />
          Exit
        </button>
      </div>
    )
  }

  // ── Manager Workspace context ─────────────────────────────────────────────
  if (activeRole === 'manager' && impersonatedManager) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-1.5',
          'bg-warning/[0.08] border-b border-warning/20 text-warning text-xs select-none',
        )}
      >
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0">
            <Users className="h-3 w-3" />
          </div>
          <span>
            <span className="font-semibold">Manager Workspace</span>
            {' — '}
            viewing as{' '}
            <span className="font-semibold">{impersonatedManager.name}</span>
            <span className="opacity-60 ml-1">({impersonatedManager.code})</span>
          </span>
        </div>
        <button
          onClick={exitWorkspace}
          className="flex items-center gap-1 font-medium opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Exit Manager Workspace"
        >
          <X className="h-3 w-3" />
          Exit
        </button>
      </div>
    )
  }

  return null
}
