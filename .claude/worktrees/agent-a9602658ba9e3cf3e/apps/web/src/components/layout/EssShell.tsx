/**
 * EssShell
 * Layout wrapper for Employee Self-Service routes (/ess/*).
 * Any authenticated user can view ESS pages.
 * Admin-role users who land here via /ess/* are allowed (cross-portal preview).
 */

import { Outlet, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { EmployeeSidebar } from './EmployeeSidebar'
import { Topbar } from './Topbar'
import { useAuthStore } from '@/stores/authStore'
import { EventToast }    from '@/components/notifications'

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

export function EssShell() {
  const { profile, isLoading } = useAuthStore()

  if (isLoading) return <LoadingScreen />

  // Not authenticated → login
  if (!profile) return <Navigate to="/login" replace />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <EmployeeSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          <EventToast />
          <Outlet />
        </main>
      </div>
    </div>
  )
}
