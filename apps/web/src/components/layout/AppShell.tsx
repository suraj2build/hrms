import { Outlet, Navigate } from 'react-router-dom'
import { Suspense } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuthStore } from '@/stores/authStore'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'
import { OperationalBanner }     from '@/components/operational/OperationalBanner'

function ShellPageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

export function AppShell() {
  const { profile, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return <Navigate to="/login" replace />
  }

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Topbar />
          <OperationalBanner />
          {/* Inner Suspense — catches lazy-route chunk loading before it can
              bubble to the global Suspense in App.tsx and unmount the shell. */}
          <main className="flex-1 overflow-y-auto p-6">
            <Suspense fallback={<ShellPageLoader />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
