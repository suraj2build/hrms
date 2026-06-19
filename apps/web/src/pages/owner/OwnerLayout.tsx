import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, FileText, Key,
  CreditCard, Users, LogOut, ExternalLink, Bug,
} from 'lucide-react'
import { LogoMark } from '@/components/brand/Logo'
import { ownerSupabase }  from '@/lib/supabase/ownerClient'
import { useOwnerStore }  from '@/stores/ownerStore'
import { ownerApi }       from '@/lib/api/ownerApi'
import { useQuery }       from '@tanstack/react-query'
import { cn }             from '@/lib/utils'

interface DashboardData {
  data: { requests: { pending: number } }
}

const navItems = [
  { to: '/owner/dashboard',  label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/owner/tenants',    label: 'Tenants',       icon: Building2 },
  { to: '/owner/requests',   label: 'Requests',      icon: FileText, badge: true },
  { to: '/owner/api-keys',   label: 'API Keys',      icon: Key },
  { to: '/owner/billing',    label: 'Billing',       icon: CreditCard },
  { to: '/owner/errors',     label: 'Error Reports', icon: Bug },
  { to: '/owner/admins',     label: 'Admins',        icon: Users },
]

export function OwnerLayout() {
  const navigate  = useNavigate()
  const { admin, accessToken, clear, setAccessToken } = useOwnerStore()
  // tokenReady becomes true once getSession() resolves — prevents 401s from
  // child pages firing queries before the Bearer token is available.
  const [tokenReady, setTokenReady] = useState(false)

  // Sync Supabase session token on mount
  useEffect(() => {
    ownerSupabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (token) setAccessToken(token)
      setTokenReady(true)   // signal even if no session (will redirect below)
    })

    const { data: { subscription } } = ownerSupabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null)
      if (!session) {
        clear()
        navigate('/owner/login', { replace: true })
      }
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  // Guard: no admin → redirect to login
  useEffect(() => {
    if (!admin || !accessToken) {
      navigate('/owner/login', { replace: true })
    }
  }, [admin, accessToken, navigate])

  const { data: dashData } = useQuery<DashboardData>({
    queryKey: ['owner-dashboard-badge'],
    queryFn:  () => ownerApi.get('/owner/dashboard'),
    enabled:  !!accessToken,
    refetchInterval: 60_000,
  })
  const pendingCount = dashData?.data?.requests?.pending ?? 0

  async function handleLogout() {
    await ownerSupabase.auth.signOut()
    clear()
    navigate('/owner/login', { replace: true })
  }

  // Don't render child routes until session is resolved — avoids 401 spam
  if (!admin) return null
  if (!tokenReady) return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-5 w-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="relative flex h-screen overflow-hidden text-foreground antialiased">
      {/* ── Ambient backdrop — soft gradient mesh for the "control room" feel ── */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-background" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(13,148,136,0.10),transparent_45%),radial-gradient(120%_120%_at_100%_0%,rgba(79,70,229,0.08),transparent_45%),radial-gradient(140%_140%_at_100%_100%,rgba(56,189,248,0.07),transparent_50%)]" />

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-border bg-card backdrop-blur-xl">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-border">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-indigo-600 shadow-lg shadow-teal-500/20">
            <LogoMark size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight truncate">Control Center</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground truncate">Platform Owner</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Operations</p>
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-r from-teal-500/10 to-indigo-500/10 text-teal-700 font-semibold shadow-sm ring-1 ring-teal-500/15'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-teal-500 to-indigo-500" />
                  )}
                  <Icon className={cn('h-[18px] w-[18px] flex-shrink-0 transition-colors', isActive ? 'text-teal-600' : 'text-muted-foreground group-hover:text-foreground')} />
                  <span className="flex-1 truncate">{label}</span>
                  {badge && pendingCount > 0 && (
                    <span className="h-5 min-w-5 px-1.5 rounded-full bg-amber-400 text-[10px] font-bold text-amber-950 flex items-center justify-center shadow-sm">
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Open HRMS app */}
        <div className="px-3 pb-2">
          <a
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-teal-700 hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Open CognixHR App</span>
          </a>
        </div>

        {/* Bottom: admin info + logout */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5 ring-1 ring-slate-200/60">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-teal-500 flex-shrink-0 shadow-sm">
              <span className="text-[11px] font-bold text-white">
                {admin.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold truncate text-foreground">{admin.name}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground capitalize">{admin.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  )
}
