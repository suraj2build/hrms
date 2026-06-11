/**
 * TopNavV2 — Enterprise HRMS top navigation bar.
 *
 * Layout (left → right):
 *   [Logo + "HRMS"] [separator] [Domain tabs: Workforce · Attendance · Leave ·
 *   Payroll · Compliance · Operations · Reports · Setup]
 *   ────────────────────────────────────────────────────────────
 *   [Search ⌘K] [Tenant name] [Role badge] [Notifications] [Theme] [User ↓]
 *
 * Domain tabs drive both the top active indicator and the contextual sidebar.
 */

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Sun, Moon, LogOut, ChevronDown, Menu, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { LogoMark, Wordmark } from '@/components/brand/Logo'
import { getVisibleDomains, getDomainForPath, getExecutiveDomainForPath, EXECUTIVE_DOMAINS } from './nav-config'
import { NotificationCenter } from '@/components/operational/NotificationCenter'
import { NotificationBell }   from '@/components/notifications'
import { useAuthStore }        from '@/stores/authStore'
import { useTheme }            from '@/components/theme-provider'
import { getInitials }         from '@/lib/utils'
import { supabase }            from '@/lib/supabase/client'
import { toast }               from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useBasePath } from '@/lib/routing'

// Theme toggle now uses the shared ThemeProvider (aurora-theme key)

// ── TopNavV2 ──────────────────────────────────────────────────────────────────

export function TopNavV2({ onSearchOpen }: { onSearchOpen?: () => void } = {}) {
  const location   = useLocation()
  const navigate   = useNavigate()
  const basePath   = useBasePath()
  const { profile, tenant, clear } = useAuthStore()
  const toggleMobileNav      = useUIStore(s => s.toggleMobileNav)
  const executiveMode        = useUIStore(s => s.executiveMode)
  const toggleExecutiveMode  = useUIStore(s => s.toggleExecutiveMode)
  const [notifOpen, setNotifOpen]  = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === 'dark'
  function toggleTheme() { setTheme(dark ? 'light' : 'dark') }

  // In Executive Mode show only the curated exec domain set; otherwise role-filtered full set.
  const activeDomain   = executiveMode
    ? getExecutiveDomainForPath(location.pathname)
    : getDomainForPath(location.pathname)
  const visibleDomains = executiveMode
    ? EXECUTIVE_DOMAINS
    : getVisibleDomains(profile?.role)

  const canExecMode = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  function handleExecModeToggle() {
    toggleExecutiveMode()
    if (!executiveMode) navigate('/admin/intelligence/workforce-command')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  return (
    <header className="sticky top-0 z-40 w-full h-[52px] border-b border-black/15 bg-[image:var(--gradient-nav)] text-primary-foreground backdrop-blur-md flex items-stretch px-0 flex-shrink-0 overflow-hidden relative shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),inset_0_-1px_0_0_rgba(0,0,0,0.20),0_6px_16px_-4px_rgba(26,77,143,0.5)]">

      {/* 3D sheen — top highlight → bottom shade, behind the content (pointer-events-none) */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.12] via-transparent to-black/[0.10]" />

      {/* ── Mobile hamburger (opens contextual sidebar drawer) ──── */}
      <button
        type="button"
        onClick={toggleMobileNav}
        className="lg:hidden flex items-center justify-center px-3 border-r border-white/15 text-white/90 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Brand ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate('/admin/intelligence/workforce-command')}
        className="flex items-center gap-2 shrink-0 px-4 group border-r border-white/15 hover:bg-white/10 transition-colors"
      >
        <LogoMark size={28} tile />
        <Wordmark height={15} tone="light" className="hidden md:block" />
      </button>

      {/* ── Domain tabs — clean flat underline tabs ────────────── */}
      <nav
        className="flex items-stretch min-w-0 flex-1 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
        aria-label="Domain navigation"
      >
        {visibleDomains.map(domain => {
          const isActive = activeDomain?.id === domain.id
          const Icon = domain.icon
          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => navigate(domain.defaultRoute)}
              title={domain.label}
              className={cn(
                'relative flex items-center gap-1.5 px-3.5 h-full select-none whitespace-nowrap',
                'text-[11.5px] font-semibold transition-colors',
                isActive
                  ? 'text-white bg-white/[0.16]'
                  : 'text-white/85 hover:text-white hover:bg-white/10',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-white' : 'text-white/90')} />
              <span className="hidden lg:inline">{domain.label}</span>
              <span className="lg:hidden">{domain.shortLabel ?? domain.label.slice(0, 4)}</span>
              {/* Active underline indicator */}
              {isActive && (
                <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-white" />
              )}
            </button>
          )
        })}
      </nav>

      {/* ── Right actions ──────────────────────────────────────── */}
      {/* Search moved to a floating launcher (bottom-right) to declutter the top
          row — see SearchFab in AdminShellV2. ⌘K still toggles it. */}
      <div className="flex items-center gap-1 shrink-0 pl-2 pr-3">

        {/* Single hairline separates nav from the account cluster */}
        <span aria-hidden="true" className="h-6 w-px bg-white/20 mx-1.5" />

        {/* Tenant + role — grouped, no extra dividers */}
        <div className="hidden md:flex items-center gap-1.5 mr-1">
          {tenant?.name && (
            <span className="text-[11px] text-white/90 font-medium max-w-[130px] truncate">
              {tenant.name}
            </span>
          )}
          {profile?.role && (
            <span className="text-[9.5px] bg-white/15 text-white rounded-full px-2 py-0.5 font-bold uppercase tracking-wide border border-white/20">
              {profile.role === 'super_admin' ? 'Admin' :
               profile.role === 'hr_admin'    ? 'HR'    :
               profile.role === 'manager'     ? 'Mgr'   : profile.role}
            </span>
          )}
        </div>

        {/* Executive Mode toggle — super_admin + hr_admin only */}
        {canExecMode && (
          <button
            type="button"
            onClick={handleExecModeToggle}
            title={executiveMode ? 'Exit Executive Mode' : 'Switch to Executive View'}
            className={cn(
              'flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md transition-all border',
              executiveMode
                ? 'bg-white text-primary border-white shadow-sm'
                : 'bg-transparent text-white/90 border-white/30 hover:bg-white/10 hover:text-white',
            )}
          >
            <BarChart3 className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">Exec</span>
          </button>
        )}

        {/* Notifications — override the shared ghost button's colors for navy */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setNotifOpen(true)}
          onKeyDown={e => e.key === 'Enter' && setNotifOpen(true)}
          className="rounded-md cursor-pointer flex items-center justify-center relative [&_button]:!text-white/90 [&_button]:hover:!bg-white/10 [&_button]:hover:!text-white"
          title="Notifications"
        >
          <NotificationBell />
        </div>
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-white/90 hover:text-white"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark
            ? <Moon className="h-4 w-4" />
            : <Sun  className="h-4 w-4" />
          }
        </button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 cursor-pointer group ml-0.5 pl-1.5 rounded-md hover:bg-white/10 py-1 pr-1 transition-colors"
            >
              <div className="w-7 h-7 rounded-md bg-white/15 border border-white/25 flex items-center justify-center text-white font-bold text-[11px] shrink-0">
                {getInitials(profile?.full_name ?? 'U')}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[11px] font-semibold text-white leading-tight">
                  {profile?.full_name ?? 'Admin'}
                </span>
              </div>
              <ChevronDown className="h-3 w-3 text-white/85 hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {profile?.role?.replace(/_/g, ' ')}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/ess/profile')}>
              My Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`${basePath}/settings`)}>
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>
    </header>
  )
}
