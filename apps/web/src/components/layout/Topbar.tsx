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
import { ThemeToggle }         from '@/components/theme-toggle'
import { RoleSwitcher }        from './RoleSwitcher'
import { ManagerPersonaToggle } from './ManagerPersonaToggle'
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

  async function handleSignOut() {
    await supabase.auth.signOut()
    clear()
    navigate('/login')
    toast.success('Signed out successfully')
  }

  return (
    <header className="h-14 border-b border-border bg-background flex items-center px-4 gap-3 flex-shrink-0">
      {/* Mobile hamburger — opens the shell sidebar drawer */}
      <button
        type="button"
        onClick={toggleMobileNav}
        className="lg:hidden p-1.5 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Search now lives pinned at the bottom of the left sidebar
          (SidebarSearchButton). ⌘K still opens it from anywhere. */}

      {/* Employee / Manager persona toggle — only renders inside the Manager
          Console for manager identities; swaps the left navigation. */}
      <ManagerPersonaToggle />

      <div className="flex items-center gap-2 ml-auto">
        {/* Company name */}
        {tenant && (
          <span className="text-xs text-muted-foreground hidden md:block">
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
                <AvatarFallback className="text-xs bg-primary/20 text-primary">
                  {getInitials(profile?.full_name ?? 'U')}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm hidden md:block">{profile?.full_name ?? 'User'}</span>
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
