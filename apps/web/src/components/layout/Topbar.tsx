import { LogOut, ChevronDown, Menu } from 'lucide-react'
import { useNavigate }         from 'react-router-dom'
import { useUIStore }          from '@/stores/uiStore'
import { toast }               from 'sonner'
import { supabase }            from '@/lib/supabase/client'
import { useAuthStore }        from '@/stores/authStore'
import { useBasePath }         from '@/lib/routing'
import { Button }              from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials }         from '@/lib/utils'
import { useCommandPalette } from '@/components/operational/CommandPalette'
import { SearchFab }         from '@/components/search/SearchFab'
import { ThemeToggle }         from '@/components/theme-toggle'
import { RoleSwitcher }        from './RoleSwitcher'
import { NotificationBell }    from '@/components/notifications'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ── Topbar ─────────────────────────────────────────────────────────────────────
//
// Architecture note (2026-05):
//   The "View Profile As" chip (employee / manager impersonation switcher) has
//   been removed. Each workspace now lives in its own shell:
//     ESS     → /ess/*      (EssShell)
//     Manager → /manager/*  (ManagerShell)
//     Admin   → /admin/*    (AdminShellV2) — operational governance only
//
//   Admins who need to preview ESS or Manager experiences use the RoleSwitcher
//   workspace dropdown, which navigates to the correct shell rather than
//   embedding a foreign UX inside AdminShell.

export function Topbar() {
  const { profile, tenant, clear } = useAuthStore()
  const navigate = useNavigate()
  const basePath = useBasePath()
  const toggleMobileNav = useUIStore(s => s.toggleMobileNav)
  const { open: openSearch } = useCommandPalette()

  async function handleSignOut() {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  return (
    <header className="h-14 border-b border-black/10 bg-gradient-to-r from-[#1A4D8F] via-[#1E5BA8] to-[#2260A8] text-white shadow-md shadow-[#1A4D8F]/20 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Mobile hamburger — opens the shell sidebar drawer */}
      <button
        type="button"
        onClick={toggleMobileNav}
        className="lg:hidden p-1.5 -ml-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Search moved to a floating launcher (bottom-right) — declutters the
          header. ⌘K still opens it. */}
      <SearchFab onClick={openSearch} />

      {/* Right cluster — scoped overrides recolour shared triggers (RoleSwitcher,
          ThemeToggle, bell, user menu) to white/translucent for the navy bar.
          Dropdown/dialog content is portaled, so it stays on the light theme. */}
      <div className="flex items-center gap-2 ml-auto [&_button]:!bg-transparent [&_button]:!text-white [&_button]:!border-white/25 [&_button:hover]:!bg-white/10 [&_svg]:!text-white/90">
        {/* Company name */}
        {tenant && (
          <span className="text-xs text-white/75 hidden md:block">
            {tenant.name}
          </span>
        )}

        {/* Workspace switcher (Admin Portal / Manager Workspace / ESS) */}
        <RoleSwitcher />

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <ThemeToggle />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
              <Avatar className="h-7 w-7">
                <AvatarImage src={profile?.avatar_url ?? undefined} />
                <AvatarFallback className="text-xs bg-white/15 text-white">
                  {getInitials(profile?.full_name ?? 'U')}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm hidden md:block">{profile?.full_name ?? 'User'}</span>
              <ChevronDown className="h-3 w-3 text-white/70" />
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
