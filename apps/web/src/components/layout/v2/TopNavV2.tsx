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
import { Search, Sun, Moon, LogOut, ChevronDown, Menu, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'
import { LogoMark } from '@/components/brand/Logo'
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

  function openSearch() { onSearchOpen?.() }

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
    <header className="sticky top-0 z-40 w-full h-[52px] border-b border-border bg-card backdrop-blur-md flex items-stretch px-0 flex-shrink-0 shadow-sm shadow-border/30 overflow-hidden">

      {/* ── Mobile hamburger (opens contextual sidebar drawer) ──── */}
      <button
        type="button"
        onClick={toggleMobileNav}
        className="lg:hidden flex items-center justify-center px-3 border-r border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Brand ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => navigate('/admin/intelligence/workforce-command')}
        className="flex items-center gap-2 shrink-0 px-4 group border-r border-border/60 bg-card hover:bg-muted/40 transition-colors"
      >
        <LogoMark size={28} />
        <span className="font-display font-bold text-[13px] text-foreground hidden md:block group-hover:text-primary transition-colors tracking-tight">
          Emvora
        </span>
      </button>

      {/* ── Domain tabs — left-aligned compact angled shapes ───── */}
      <nav
        className="flex items-stretch shrink-0 overflow-x-auto"
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
                'relative flex items-center -mr-2.5 group select-none',
                'px-5 first:pl-4',
                isActive ? 'z-10' : 'z-0 hover:z-[5]',
              )}
            >
              {/* ── Angled tab background (skewed, not the content) ── */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 transition-colors duration-150',
                  '[transform:skewX(-13deg)]',
                  isActive
                    ? 'bg-primary'
                    : 'bg-muted/50 group-hover:bg-muted',
                )}
              />
              {/* ── Right-edge shadow line to separate tabs ── */}
              {!isActive && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 inset-y-[20%] w-px bg-border/60 [transform:skewX(-13deg)]"
                />
              )}
              {/* ── Label — NOT skewed ── */}
              <span className={cn(
                'relative z-10 flex items-center gap-1.5 text-[11.5px] font-semibold whitespace-nowrap',
                isActive
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground group-hover:text-foreground',
              )}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden lg:inline">{domain.label}</span>
                <span className="lg:hidden">{domain.shortLabel ?? domain.label.slice(0, 4)}</span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* ── Flexible spacer ────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Right actions ──────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 shrink-0 px-3 border-l border-border/60">

        {/* Search bar — full pill on md+, icon-only on small screens */}
        <button
          type="button"
          onClick={openSearch}
          className="hidden md:flex items-center gap-2.5 lg:w-64 xl:w-80 w-48 pl-3 pr-2.5 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted/70 hover:border-border/80 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background transition-all text-muted-foreground group"
          title="Search (⌘K)"
        >
          <Search className="h-3.5 w-3.5 shrink-0 group-hover:text-foreground transition-colors" />
          <span className="flex-1 text-left text-[11.5px] font-medium truncate group-hover:text-foreground/70 transition-colors">
            Search employees, pages, payroll…
          </span>
          <kbd className="shrink-0 hidden lg:inline-flex items-center gap-0.5 text-[10px] font-mono bg-background/80 border border-border/60 rounded px-1.5 py-0.5 text-muted-foreground/50">
            ⌘K
          </kbd>
        </button>

        {/* Icon-only on small screens */}
        <button
          type="button"
          onClick={openSearch}
          className="md:hidden p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Search (⌘K)"
        >
          <Search className="h-4 w-4" />
        </button>

        {/* Tenant name */}
        {tenant?.name && (
          <span className="text-[11px] text-muted-foreground font-medium hidden xl:block max-w-[120px] truncate border-l border-border pl-2">
            {tenant.name}
          </span>
        )}

        {/* Role badge */}
        {profile?.role && (
          <span className="text-[10px] bg-primary/10 text-primary rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide hidden sm:block border border-primary/20">
            {profile.role === 'super_admin' ? 'Admin' :
             profile.role === 'hr_admin'    ? 'HR'    :
             profile.role === 'manager'     ? 'Mgr'   : profile.role}
          </span>
        )}

        {/* Executive Mode toggle — super_admin + hr_admin only */}
        {canExecMode && (
          <button
            type="button"
            onClick={handleExecModeToggle}
            title={executiveMode ? 'Exit Executive Mode' : 'Switch to Executive View'}
            className={cn(
              'flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md transition-all border',
              executiveMode
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-transparent text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground',
            )}
          >
            <BarChart3 className="h-3 w-3 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">
              {executiveMode ? 'Exec' : 'Exec'}
            </span>
          </button>
        )}

        {/* Notifications */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setNotifOpen(true)}
          onKeyDown={e => e.key === 'Enter' && setNotifOpen(true)}
          className="p-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer flex items-center justify-center relative"
          title="Notifications"
        >
          <NotificationBell />
        </div>
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
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
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold text-[11px] shrink-0">
                {getInitials(profile?.full_name ?? 'U')}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-[11px] font-semibold text-foreground leading-tight">
                  {profile?.full_name ?? 'Admin'}
                </span>
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
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
