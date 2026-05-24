/**
 * AdminShell
 * Layout wrapper for HR / Admin routes (/admin/*).
 * Roles allowed: super_admin, hr_admin, manager.
 * Employees are bounced to /ess/dashboard.
 */

import { Outlet, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AdminSidebar }          from './AdminSidebar'
import { Topbar }                from './Topbar'
import { PreviewBanner }         from './PreviewBanner'
import { useAuthStore }          from '@/stores/authStore'
import type { UserRole }         from '@/types'
import { EventToast }            from '@/components/notifications'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'
import { OperationalBanner }      from '@/components/operational/OperationalBanner'

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}

export function AdminShell() {
  const { profile, isLoading } = useAuthStore()

  if (isLoading) return <LoadingScreen />

  // Not authenticated → login
  if (!profile) return <Navigate to="/login" replace />

  // Wrong role → redirect to ESS portal
  if (!ADMIN_ROLES.includes(profile.role)) {
    return <Navigate to="/ess/dashboard" replace />
  }

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar />
          <PreviewBanner />
          <OperationalBanner />
          <main className="flex-1 overflow-y-auto p-6">
            <EventToast />
            <Outlet />
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
