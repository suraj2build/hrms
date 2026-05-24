/**
 * TopNavV2 — Horizontal top navigation bar for AdminShell V2.
 *
 * Layout (left → right):
 *   [Logo] [Domain Tabs with hover dropdowns] ──── [CommandPalette] [NotificationBell] [ThemeToggle] [UserMenu]
 *
 * Hover behaviour:
 *   · Mouse enters tab label → 120ms delay → show grouped dropdown
 *   · Mouse leaves both tab + dropdown → 180ms delay → hide dropdown
 *   · Click → navigate to domain.defaultRoute, hide dropdown
 *
 * Active state: domain tab is highlighted when pathname matches its prefixes.
 */

import { useState, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, LogOut, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DOMAINS, getDomainForPath, type Domain } from './nav-config'
import { CommandPaletteTrigger } from '@/components/operational/CommandPalette'
import { ThemeToggle } from '@/components/theme-toggle'
import { RoleSwitcher } from '@/components/layout/RoleSwitcher'
import { NotificationBell } from '@/components/notifications'
import { useAuthStore } from '@/stores/authStore'
import { useBasePath } from '@/lib/routing'
import { supabase } from '@/lib/supabase/client'
import { getInitials } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ── Domain Dropdown ───────────────────────────────────────────────────────────

interface DomainDropdownProps {
  domain: Domain
  onNavigate: () => void
}

function DomainDropdown({ domain, onNavigate }: DomainDropdownProps) {
  const location = useLocation()

  return (
    <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-xl border border-border bg-popover shadow-lg shadow-black/10 overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100">
      {domain.groups.map((group, gi) => (
        <div key={group.label} className={cn('py-1', gi > 0 && 'border-t border-border/50')}>
          <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 select-none">
            {group.label}
          </p>
          {group.items.map(item => {
            const isActive = item.exact
              ? location.pathname === item.route
              : location.pathname === item.route || location.pathname.startsWith(item.route + '/')

            return (
              <Link
                key={item.id}
                to={item.route}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-2.5 mx-1 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/75 hover:bg-accent hover:text-foreground',
                )}
              >
                <item.icon className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Domain Tab ────────────────────────────────────────────────────────────────

interface DomainTabProps {
  domain: Domain
  isActive: boolean
}

function DomainTab({ domain, isActive }: DomainTabProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const openTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = setTimeout(() => setOpen(true), 120)
  }, [])

  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }, [])

  const handleClick = () => {
    setOpen(false)
    if (openTimer.current)  clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    navigate(domain.defaultRoute)
  }

  return (
    <div
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors select-none',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/70 hover:text-foreground hover:bg-accent',
        )}
      >
        <domain.icon className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
        <span>{domain.shortLabel ?? domain.label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180', isActive ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
      </button>

      {open && (
        <div
          onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current) }}
          onMouseLeave={scheduleClose}
        >
          <DomainDropdown domain={domain} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

// ── TopNavV2 ──────────────────────────────────────────────────────────────────

export function TopNavV2() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, tenant, clear } = useAuthStore()
  const basePath = useBasePath()
  const activeDomain = getDomainForPath(location.pathname)

  async function handleSignOut() {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  return (
    <header className="h-14 bg-card border-b border-border shadow-[0_1px_3px_rgba(15,23,42,0.06)] flex items-center gap-2 px-4 flex-shrink-0 z-40">

      {/* ── Logo ────────────────────────────────────────────────────── */}
      <Link
        to="/admin/dashboard"
        className="flex items-center gap-2 flex-shrink-0 mr-2"
      >
        <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Building2 className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
        <span className="text-sm font-bold text-foreground hidden lg:block">HRMS</span>
      </Link>

      {/* Divider */}
      <div className="w-px h-5 bg-border flex-shrink-0 mr-1 hidden sm:block" />

      {/* ── Domain Tabs ─────────────────────────────────────────────── */}
      <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto no-scrollbar">
        {DOMAINS.map(domain => (
          <DomainTab
            key={domain.id}
            domain={domain}
            isActive={activeDomain?.id === domain.id}
          />
        ))}
      </nav>

      {/* ── Right utilities ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">

        {/* Command Palette */}
        <CommandPaletteTrigger className="flex-shrink-0" />

        {/* Tenant name */}
        {tenant && (
          <span className="text-xs text-muted-foreground hidden xl:block px-1">
            {tenant.name}
          </span>
        )}

        {/* Role switcher */}
        <RoleSwitcher />

        {/* Notifications */}
        <NotificationBell />

        {/* Theme */}
        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-1.5 h-9 px-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                  {getInitials(profile?.full_name ?? 'U')}
                </AvatarFallback>
              </Avatar>
              <span className="text-[13px] hidden md:block">{profile?.full_name ?? 'User'}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{profile?.full_name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {profile?.role?.replace('_', ' ')}
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
