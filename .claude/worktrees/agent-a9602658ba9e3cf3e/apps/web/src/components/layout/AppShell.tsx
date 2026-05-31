import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useAuthStore } from '@/stores/authStore'
import { CommandPaletteProvider } from '@/components/operational/CommandPalette'
import { OperationalBanner }     from '@/components/operational/OperationalBanner'

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
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
