/**
 * EssShell
 * Layout wrapper for Employee Self-Service routes (/ess/*).
 * Any authenticated user can view ESS pages.
 * Admin-role users who land here via /ess/* are allowed (cross-portal preview).
 */

import { Outlet, Navigate, useNavigate } from 'react-router-dom'
import { Suspense, useState } from 'react'
import { Loader2, AlertTriangle, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { EmployeeSidebar } from './EmployeeSidebar'
import { Topbar } from './Topbar'
import { useAuthStore } from '@/stores/authStore'
import { EventToast }    from '@/components/notifications'
import { api }           from '@/lib/api/client'
import { useIsMobile }   from '@/hooks/useIsMobile'
import { MobileEssShell } from '@/components/mobile/MobileEssShell'

interface Anomaly {
  date: string
  resolved?: boolean
}

function ShellPageLoader() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  )
}

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

/**
 * AnomalyLoginAlert — shown once per session when an employee has
 * unresolved anomalies in the current open pay period.
 * Dismissed per-session via sessionStorage.
 */
function AnomalyLoginAlert() {
  const nav = useNavigate()
  const DISMISS_KEY = 'anomaly-alert-dismissed'
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem(DISMISS_KEY) === 'true'
  )

  const { data } = useQuery<{ data: Anomaly[] }>({
    queryKey: ['my-anomalies-alert'],
    queryFn:  () => api.get('/attendance/anomalies/my?resolved=false&limit=10'),
    enabled:  !dismissed,
    staleTime: 10 * 60_000,
  })

  const anomalies: Anomaly[] = Array.isArray(data?.data) ? data.data : []
  const unresolved = anomalies.filter((a) => !a.resolved)

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  if (dismissed || unresolved.length === 0) return null

  // Show up to 3 dates
  const dates = unresolved.slice(0, 3).map((a) => {
    const _d = new Date(a.date + 'T12:00:00Z')
    const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return isNaN(_d.getTime()) ? a.date : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}`
  })
  const extra = unresolved.length > 3 ? ` +${unresolved.length - 3} more` : ''

  return (
    <div className="mx-4 mt-3 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {unresolved.length} unresolved attendance {unresolved.length === 1 ? 'anomaly' : 'anomalies'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {dates.join(', ')}{extra} — submit regularisation before payroll closes or these will be marked <strong>LOP</strong>
        </p>
        <button
          onClick={() => { nav('/ess/regularization'); dismiss() }}
          className="mt-1.5 text-xs font-semibold text-warning underline underline-offset-2 hover:text-warning/80 transition-colors"
        >
          Regularize now →
        </button>
      </div>
      <button
        onClick={dismiss}
        className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function EssShell() {
  const { profile, isBootstrapping } = useAuthStore()
  const isMobile = useIsMobile()

  // Gate only on the first bootstrap — not on silent token refreshes (TOKEN_REFRESHED).
  if (isBootstrapping) return <LoadingScreen />

  // Not authenticated → login
  if (!profile) return <Navigate to="/login" replace />

  // Mobile-only: dedicated phone ESS experience. Desktop is untouched below.
  if (isMobile) return <MobileEssShell />

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <EmployeeSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        {/* Inner Suspense — catches lazy-route chunk loading so the ESS shell
            chrome (Topbar, EmployeeSidebar) stays mounted while pages load. */}
        <AnomalyLoginAlert />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <EventToast />
          <Suspense fallback={<ShellPageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
