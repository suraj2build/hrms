import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Building2, FileText, Key,
  CreditCard, Users, LogOut, ExternalLink,
} from 'lucide-react'
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
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-slate-800 bg-slate-900">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-slate-800">
          <div className="h-7 w-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
            <Shield className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate">Owner Panel</p>
            <p className="text-[10px] text-slate-500 truncate">Platform Control</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800',
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {badge && pendingCount > 0 && (
                <span className="h-5 min-w-5 px-1 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Open HRMS app */}
        <div className="px-2 pb-2">
          <a
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Open HRMS App</span>
          </a>
        </div>

        {/* Bottom: admin info + logout */}
        <div className="border-t border-slate-800 p-3 space-y-1">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg">
            <div className="h-7 w-7 rounded-full bg-indigo-900 flex items-center justify-center flex-shrink-0">
              <span className="text-[11px] font-bold text-indigo-300">
                {admin.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium truncate">{admin.name}</p>
              <p className="text-[10px] text-slate-500 capitalize">{admin.role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-xs">Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-slate-950">
        <Outlet />
      </main>
    </div>
  )
}
