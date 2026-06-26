/**
 * ManagerShell
 * Layout wrapper for Manager Console routes (/manager/*).
 *
 * Accessible by:
 *   - Users with role = 'manager'
 *   - hr_admin / super_admin accessing a manager identity via RoleSwitcher
 *     (they navigate here directly after impersonating a manager)
 *
 * Unauthenticated users → /login
 * Employees (role = 'employee') → /ess/dashboard
 */

import { Outlet, Navigate, useLocation } from 'react-router-dom'
import { Suspense }         from 'react'
import { Loader2 }          from 'lucide-react'
import { ManagerSidebar }   from './ManagerSidebar'
import { EssContextPanel }  from './EssContextPanel'
import { Topbar }           from './Topbar'
import { useAuthStore }     from '@/stores/authStore'
import { EventToast }       from '@/components/notifications'
import { useIsMobile }      from '@/hooks/useIsMobile'
import { MobileEssShell }   from '@/components/mobile/MobileEssShell'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'

function ShellPageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-warning border-t-transparent animate-spin" />
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-warning" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}

export function ManagerShell() {
  const { profile, isBootstrapping } = useAuthStore()
  const isMobile  = useIsMobile()
  const { pathname } = useLocation()
  const showPanel = pathname.startsWith('/manager/self')

  if (isBootstrapping) return <LoadingScreen />

  // Not authenticated
  if (!profile) return <Navigate to="/login" replace />

  // Employee-only users can't access manager console
  if (profile.role === 'employee') return <Navigate to="/ess/dashboard" replace />

  // Mobile-only: dedicated phone experience. Desktop is untouched below.
  if (isMobile) return <MobileEssShell />

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <ManagerSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar />
          <div className="flex flex-1 overflow-hidden">
            <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
              <EventToast />
              <Suspense fallback={<ShellPageLoader />}>
                <Outlet />
              </Suspense>
            </main>
            {showPanel && <EssContextPanel />}
          </div>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
