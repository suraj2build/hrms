/**
 * AdminShellV2 — Modern enterprise admin workspace shell.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  TopNavV2  (h-14, full width, horizontal domain tabs)            │
 *   ├──────────────────────┬────────────────────────────┬─────────────┤
 *   │ ContextualSidebar    │   Page Content (<Outlet />) │ RightRail   │
 *   │ (200px | 52px)       │   overflow-y-auto           │ (240px)     │
 *   │ Domain-contextual    │                             │ priorities, │
 *   │ sub-nav              │                             │ deadlines,  │
 *   │                      │                             │ health,     │
 *   │                      │                             │ links       │
 *   └──────────────────────┴────────────────────────────┴─────────────┘
 *
 * Auth guard: super_admin, hr_admin, manager allowed.
 * Employees are redirected to /ess/dashboard.
 *
 * Preserved from AdminShell:
 *   · CommandPaletteProvider context
 *   · EventToast
 *   · PreviewBanner
 *   · OperationalBanner
 */

import { Outlet, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuthStore }           from '@/stores/authStore'
import type { UserRole }          from '@/types'
import { EventToast }             from '@/components/notifications'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'
import { OperationalBanner }      from '@/components/operational/OperationalBanner'
import { PreviewBanner }          from '@/components/layout/PreviewBanner'
import { TopNavV2 }               from './v2/TopNavV2'
import { ContextualSidebar }      from './v2/ContextualSidebar'
import { RightRail }              from './v2/RightRail'

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin', 'manager']

// ── Loading screen ────────────────────────────────────────────────────────────

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

// ── AdminShellV2 ──────────────────────────────────────────────────────────────

export function AdminShellV2() {
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
      <div className="flex flex-col h-screen overflow-hidden bg-background">

        {/* ── Horizontal top nav ──────────────────────────────────── */}
        <TopNavV2 />

        {/* ── Preview + Operational banners (below topnav) ─────────── */}
        <PreviewBanner />
        <OperationalBanner />

        {/* ── Body: sidebar + content ─────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Contextual left sidebar */}
          <ContextualSidebar />

          {/* Page workspace */}
          <main className="flex-1 overflow-y-auto p-6 bg-background">
            <EventToast />
            <Outlet />
          </main>

          {/* Contextual right rail (operations panel) */}
          <RightRail />

        </div>
      </div>
    </CommandPaletteProvider>
  )
}
