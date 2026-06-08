/**
 * AdminShellV2 — Enterprise HRMS admin shell.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  TopNavV2  (enterprise top nav with 8 domain tabs, full width)      │
 *   ├──────────────────────────────────────────────────────────────────── │
 *   │  PreviewBanner / OperationalBanner / PayrollDeadlineBanner          │
 *   ├────────────────────────┬────────────────────────────────────────── │
 *   │  ContextualSidebar     │  Page Content (<Outlet />)                 │
 *   │  (200px / 52px icon)   │  fullscreen canvas                         │
 *   └────────────────────────┴───────────────────────────────────────────┘
 *
 * Auth guard: super_admin, hr_admin, manager allowed.
 * Employees are redirected to /ess/dashboard.
 */

import { Outlet, Navigate } from 'react-router-dom'
import { Suspense, useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuthStore }           from '@/stores/authStore'
import type { UserRole }          from '@/types'
import { EventToast }             from '@/components/notifications'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'
import { OperationalBanner }      from '@/components/operational/OperationalBanner'
import { PayrollDeadlineBanner }  from '@/components/operational/PayrollDeadlineBanner'
import { PreviewBanner }          from '@/components/layout/PreviewBanner'
import { TopNavV2 }          from './v2/TopNavV2'
import { ContextualSidebar } from './v2/ContextualSidebar'
import { UniversalSearch }            from '@/components/search/UniversalSearch'
import { SearchFab }                  from '@/components/search/SearchFab'
import { OperationalContextProvider } from '@/contexts/OperationalContext'
import { PayrollDeadlineProvider }    from '@/contexts/PayrollDeadlineContext'

// ── Page-level loading fallback ────────────────────────────────────────────────

function ShellPageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  )
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES: UserRole[] = ['super_admin', 'hr_admin']

// ── Loading screen ─────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  )
}

// ── AdminShellV2 ───────────────────────────────────────────────────────────────

export function AdminShellV2() {
  const { profile, isBootstrapping } = useAuthStore()
  const [searchOpen, setSearchOpen] = useState(false)

  // ⌘K / Ctrl+K global shortcut → open universal search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (isBootstrapping) return <LoadingScreen />
  if (!profile)        return <Navigate to="/login" replace />

  // Pure manager role → dedicated manager console (not admin portal).
  // hr_admin / super_admin using RoleSwitcher to preview a manager identity
  // still have profile.role = 'hr_admin'/'super_admin', so they pass through normally.
  if (profile.role === 'manager') {
    return <Navigate to="/manager/dashboard" replace />
  }

  if (!ADMIN_ROLES.includes(profile.role)) {
    return <Navigate to="/ess/dashboard" replace />
  }

  return (
    <PayrollDeadlineProvider>
    <OperationalContextProvider>
    <CommandPaletteProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-background">

        {/* ── Thin operational header ──────────────────────────────── */}
        <TopNavV2 onSearchOpen={() => setSearchOpen(true)} />

        {/* ── System banners (below header) ────────────────────────── */}
        <PreviewBanner />
        <OperationalBanner />
        <PayrollDeadlineBanner />

        {/* ── Body: contextual sidebar + canvas ────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Contextual sidebar — 200px expanded / 52px icon-only */}
          <ContextualSidebar />

          {/* Fullscreen page canvas */}
          <main className="flex-1 overflow-y-auto bg-background op-canvas">
            <EventToast />
            <Suspense fallback={<ShellPageLoader />}>
              <Outlet />
            </Suspense>
          </main>

        </div>

        {/* ── Global floating overlays ──────────────────────────────── */}
        <SearchFab onClick={() => setSearchOpen(true)} />
        <UniversalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      </div>
    </CommandPaletteProvider>
    </OperationalContextProvider>
    </PayrollDeadlineProvider>
  )
}
